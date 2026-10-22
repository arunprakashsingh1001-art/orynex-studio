// ==============================================================================
// Supabase Edge Function: process-ai-workflow
// Description: Durable queue worker for AI service job orchestration using Gemini.
// Runtime: Deno (Supabase Edge Runtime)
// ==============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { callGeminiServiceWorkflow } from './gemini.ts'
import { ServiceType } from './prompts.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // 1. Verify caller authorization (must be service_role)
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: 'Server configuration missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }),
      { status: 503, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }

  // Authorize only service_role key to prevent public execution of queue jobs
  if (!token || token !== supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: worker execution requires service-role authorization' }),
      { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })

  // Parse optional target job_id or worker request
  let body: { job_id?: string; lead_id?: string } = {}
  try {
    const text = await req.text()
    if (text) body = JSON.parse(text)
  } catch {
    // Empty body is acceptable for generic queue pickup
  }

  const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`
  let jobToProcess: Record<string, unknown> | null = null

  // 2. Fetch specific job or atomically claim next from durable queue
  if (body.job_id) {
    const { data: job, error } = await supabase
      .from('ai_service_jobs')
      .select('*')
      .eq('id', body.job_id)
      .single()

    if (error || !job) {
      return new Response(
        JSON.stringify({ error: `Job not found: ${body.job_id}` }),
        { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }
    jobToProcess = job
  } else if (body.lead_id) {
    const { data: job, error } = await supabase
      .from('ai_service_jobs')
      .select('*')
      .eq('lead_id', body.lead_id)
      .single()

    if (error || !job) {
      return new Response(
        JSON.stringify({ error: `Job for lead not found: ${body.lead_id}` }),
        { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }
    jobToProcess = job
  } else {
    // Atomic queue claim using FOR UPDATE SKIP LOCKED stored procedure
    const { data: claimedJobs, error: claimError } = await supabase.rpc('claim_next_ai_job', {
      worker_id: workerId,
    })

    if (claimError) {
      console.error('[process-ai-workflow] Error claiming next job:', claimError)
      return new Response(
        JSON.stringify({ error: 'Failed to claim job from queue', details: claimError.message }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    if (!claimedJobs || claimedJobs.length === 0) {
      return new Response(
        JSON.stringify({ message: 'Queue empty. No pending jobs to process.' }),
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    jobToProcess = claimedJobs[0]
  }

  // 3. Retrieve associated lead context
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, name, email, service, project_overview')
    .eq('id', jobToProcess.lead_id)
    .single()

  if (leadError || !lead) {
    console.error(`[process-ai-workflow] Associated lead missing for job ${jobToProcess.id}`)
    await supabase
      .from('ai_service_jobs')
      .update({
        status: 'failed',
        error_message: 'Associated lead record not found',
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobToProcess.id)

    return new Response(
      JSON.stringify({ error: 'Associated lead record not found' }),
      { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }

  // 4. Mark job as processing
  await supabase
    .from('ai_service_jobs')
    .update({
      status: 'processing',
      locked_at: new Date().toISOString(),
      locked_by: workerId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobToProcess.id)

  console.log(`[process-ai-workflow] Processing job ${jobToProcess.id} for service "${jobToProcess.service}"...`)

  // 5. Invoke Gemini API
  const geminiResult = await callGeminiServiceWorkflow({
    service: jobToProcess.service as ServiceType,
    clientName: lead.name,
    clientEmail: lead.email,
    briefText: lead.project_overview || '',
  })

  // 6. Handle Outcome & State Transitions
  if (geminiResult.success && geminiResult.draft) {
    const { error: updateError } = await supabase
      .from('ai_service_jobs')
      .update({
        status: 'review_pending', // Must be reviewed by admin before client delivery
        generated_draft: geminiResult.draft,
        prompt_snapshot: geminiResult.promptSnapshot,
        model: geminiResult.modelUsed,
        validation_results: {
          valid: true,
          validated_at: new Date().toISOString(),
          error_count: 0,
        },
        error_message: null,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobToProcess.id)

    if (updateError) {
      console.error('[process-ai-workflow] Error updating job to review_pending:', updateError)
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    console.log(`[process-ai-workflow] Job ${jobToProcess.id} successfully generated and transitioned to review_pending`)

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobToProcess.id,
        status: 'review_pending',
        service: jobToProcess.service,
        model: geminiResult.modelUsed,
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  } else {
    // Retry handling
    const currentRetries = (jobToProcess.retry_count as number) || 0
    const maxRetries = (jobToProcess.max_retries as number) || 3
    const nextRetry = currentRetries + 1
    const isExhausted = nextRetry >= maxRetries

    console.error(`[process-ai-workflow] Job ${jobToProcess.id} failed (attempt ${nextRetry}/${maxRetries}): ${geminiResult.error}`)

    await supabase
      .from('ai_service_jobs')
      .update({
        status: isExhausted ? 'failed' : 'queued',
        retry_count: nextRetry,
        error_message: geminiResult.error || 'Gemini processing failed',
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobToProcess.id)

    return new Response(
      JSON.stringify({
        success: false,
        job_id: jobToProcess.id,
        status: isExhausted ? 'failed' : 'queued',
        retry_count: nextRetry,
        error: geminiResult.error,
      }),
      { status: isExhausted ? 500 : 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }
})
