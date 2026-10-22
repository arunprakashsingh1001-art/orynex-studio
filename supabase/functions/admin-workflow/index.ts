// ==============================================================================
// Supabase Edge Function: admin-workflow
// Description: Secure admin review, editing, approval, and client delivery API.
// Security: Requires valid Supabase Auth JWT and verified record in admin_users.
// Runtime: Deno (Supabase Edge Runtime)
// ==============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DEFAULT_ALLOWED_ORIGINS = [
  'https://orynex.studio',
  'https://www.orynex.studio',
  'https://orynexstudio-git-main-team-itachi.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
]

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin')
  const allowed = origin && DEFAULT_ALLOWED_ORIGINS.includes(origin) ? origin : DEFAULT_ALLOWED_ORIGINS[0]

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  corsHeaders: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse(
      { success: false, message: 'Server configuration error: missing database credentials' },
      503,
      corsHeaders
    )
  }

  // 1. Authenticate Caller via Supabase Auth JWT
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()

  if (!token) {
    return jsonResponse(
      { success: false, message: 'Authentication required. Missing Bearer token.' },
      401,
      corsHeaders
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })

  // Verify JWT with Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData?.user) {
    return jsonResponse(
      { success: false, message: 'Invalid or expired authentication session' },
      401,
      corsHeaders
    )
  }

  const authenticatedUser = authData.user

  // 2. Authorize Admin Role via public.admin_users
  const { data: adminRecord, error: adminQueryError } = await supabase
    .from('admin_users')
    .select('id, user_id, email, role')
    .eq('user_id', authenticatedUser.id)
    .single()

  if (adminQueryError || !adminRecord) {
    console.warn(`[admin-workflow] Access denied for user ${authenticatedUser.id} (${authenticatedUser.email}): not registered in admin_users`)
    return jsonResponse(
      {
        success: false,
        message: 'Forbidden: Your account is not authorized as an Orynex Studio administrator.',
      },
      403,
      corsHeaders
    )
  }

  const url = new URL(req.url)

  // ----------------------------------------------------------------------------
  // GET Requests: List or Retrieve Jobs
  // ----------------------------------------------------------------------------
  if (req.method === 'GET') {
    const action = url.searchParams.get('action') || 'list_jobs'

    if (action === 'list_jobs') {
      const statusFilter = url.searchParams.get('status')
      let query = supabase
        .from('ai_service_jobs')
        .select(`
          id,
          lead_id,
          service,
          status,
          retry_count,
          model,
          created_at,
          updated_at,
          reviewed_at,
          delivery_status,
          leads:lead_id (
            name,
            email,
            service,
            project_overview,
            created_at
          )
        `)
        .order('created_at', { ascending: false })
        .limit(50)

      if (statusFilter) {
        query = query.eq('status', statusFilter)
      }

      const { data: jobs, error: listError } = await query
      if (listError) {
        return jsonResponse({ success: false, message: listError.message }, 500, corsHeaders)
      }

      return jsonResponse({ success: true, jobs }, 200, corsHeaders)
    }

    if (action === 'get_job') {
      const jobId = url.searchParams.get('job_id')
      if (!jobId) {
        return jsonResponse({ success: false, message: 'job_id is required' }, 400, corsHeaders)
      }

      const { data: job, error: jobError } = await supabase
        .from('ai_service_jobs')
        .select(`
          *,
          leads:lead_id (
            name,
            email,
            service,
            project_overview,
            created_at
          )
        `)
        .eq('id', jobId)
        .single()

      if (jobError || !job) {
        return jsonResponse({ success: false, message: 'Job not found' }, 404, corsHeaders)
      }

      return jsonResponse({ success: true, job }, 200, corsHeaders)
    }

    return jsonResponse({ success: false, message: `Unknown action: ${action}` }, 400, corsHeaders)
  }

  // ----------------------------------------------------------------------------
  // POST Requests: Admin Modifications, Approvals, Rejections
  // ----------------------------------------------------------------------------
  if (req.method === 'POST') {
    let payload: Record<string, unknown>
    try {
      payload = await req.json()
    } catch {
      return jsonResponse({ success: false, message: 'Invalid JSON payload' }, 400, corsHeaders)
    }

    const action = payload.action as string
    const jobId = payload.job_id as string

    if (!jobId) {
      return jsonResponse({ success: false, message: 'job_id is required' }, 400, corsHeaders)
    }

    // Retrieve existing job and associated lead
    const { data: existingJob, error: fetchErr } = await supabase
      .from('ai_service_jobs')
      .select('*, leads:lead_id(name, email, service, project_overview)')
      .eq('id', jobId)
      .single()

    if (fetchErr || !existingJob) {
      return jsonResponse({ success: false, message: 'Job not found' }, 404, corsHeaders)
    }

    // 1. Edit Draft Action
    if (action === 'edit_draft') {
      const editedDraft = payload.edited_draft
      const reviewNotes = (payload.review_notes as string) || existingJob.review_notes

      if (!editedDraft || typeof editedDraft !== 'object') {
        return jsonResponse({ success: false, message: 'edited_draft object is required' }, 400, corsHeaders)
      }

      const { error: updateErr } = await supabase
        .from('ai_service_jobs')
        .update({
          edited_draft: editedDraft,
          review_notes: reviewNotes,
          reviewed_by: authenticatedUser.id,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      if (updateErr) {
        return jsonResponse({ success: false, message: updateErr.message }, 500, corsHeaders)
      }

      return jsonResponse({ success: true, message: 'Draft edits saved successfully' }, 200, corsHeaders)
    }

    // 2. Reject Job Action
    if (action === 'reject_job') {
      const reviewNotes = (payload.review_notes as string) || 'Rejected by administrator'

      const { error: rejectErr } = await supabase
        .from('ai_service_jobs')
        .update({
          status: 'rejected',
          review_notes: reviewNotes,
          reviewed_by: authenticatedUser.id,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      if (rejectErr) {
        return jsonResponse({ success: false, message: rejectErr.message }, 500, corsHeaders)
      }

      return jsonResponse({ success: true, message: 'Job marked as rejected' }, 200, corsHeaders)
    }

    // 3. Regenerate Job Action
    if (action === 'regenerate_job') {
      const { error: regenErr } = await supabase
        .from('ai_service_jobs')
        .update({
          status: 'queued',
          retry_count: 0,
          error_message: null,
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      if (regenErr) {
        return jsonResponse({ success: false, message: regenErr.message }, 500, corsHeaders)
      }

      return jsonResponse({ success: true, message: 'Job re-queued for generation' }, 200, corsHeaders)
    }

    // 4. Approve and Deliver to Client Action (Phase 5 Email Delivery)
    if (action === 'approve_and_deliver') {
      // Check delivery idempotency: avoid duplicate sending
      if (existingJob.delivery_status === 'sent') {
        return jsonResponse(
          {
            success: false,
            message: 'Delivery already sent to client. Duplicate dispatch prevented.',
            resend_id: existingJob.delivery_resend_id,
          },
          409,
          corsHeaders
        )
      }

      const activeDraft = existingJob.edited_draft || existingJob.generated_draft
      if (!activeDraft) {
        return jsonResponse(
          { success: false, message: 'Cannot approve a job with no generated draft' },
          422,
          corsHeaders
        )
      }

      const clientEmail = existingJob.leads?.email
      const clientName = existingJob.leads?.name || 'Client'
      const service = existingJob.service

      if (!clientEmail) {
        return jsonResponse(
          { success: false, message: 'Associated lead has no valid client email' },
          422,
          corsHeaders
        )
      }

      // Mark job as approved in database first
      const reviewNotes = (payload.review_notes as string) || 'Approved for delivery by admin'
      await supabase
        .from('ai_service_jobs')
        .update({
          status: 'approved',
          delivery_status: 'pending',
          review_notes: reviewNotes,
          reviewed_by: authenticatedUser.id,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      // Dispatch Client Delivery Email via Resend
      const resendApiKey = Deno.env.get('RESEND_API_KEY')
      const senderEmail = Deno.env.get('SENDER_EMAIL') || 'Orynex Studio <onboarding@resend.dev>'
      const isTestDelivery = Deno.env.get('TEST_DELIVERY_MODE') === 'true' || !resendApiKey

      let resendId: string | null = null
      let deliverySuccess = false
      let deliveryErrorMsg: string | null = null

      if (isTestDelivery) {
        // Safe simulated delivery during test mode or when Resend key is unconfigured
        console.log(`[admin-workflow] Simulated client delivery email for job ${jobId} to ${clientEmail}`)
        resendId = `sim_resend_${crypto.randomUUID().slice(0, 12)}`
        deliverySuccess = true
      } else {
        try {
          const clientEmailHtml = formatClientDeliveryEmail(clientName, service, activeDraft)
          const resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: senderEmail,
              to: [clientEmail],
              subject: `Your ${service} Proposal from Orynex Studio`,
              html: clientEmailHtml,
            }),
          })

          if (resendRes.ok) {
            const resData = await resendRes.json()
            resendId = resData?.id || `resend_${crypto.randomUUID().slice(0, 8)}`
            deliverySuccess = true
          } else {
            const errText = await resendRes.text()
            deliveryErrorMsg = `Resend HTTP ${resendRes.status}: ${errText.slice(0, 200)}`
          }
        } catch (dispatchErr) {
          deliveryErrorMsg = (dispatchErr as Error).message
        }
      }

      // Update delivery record & write to immutable audit log
      if (deliverySuccess) {
        await supabase
          .from('ai_service_jobs')
          .update({
            status: 'delivered',
            delivery_status: 'sent',
            delivered_at: new Date().toISOString(),
            delivery_resend_id: resendId,
            delivery_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId)

        await supabase.from('ai_delivery_logs').insert([
          {
            job_id: jobId,
            recipient: clientEmail,
            status: 'success',
            resend_id: resendId,
            payload_snapshot: activeDraft,
          },
        ])

        return jsonResponse(
          {
            success: true,
            message: 'Proposal successfully approved and delivered to client',
            job_id: jobId,
            delivery_status: 'sent',
            resend_id: resendId,
          },
          200,
          corsHeaders
        )
      } else {
        await supabase
          .from('ai_service_jobs')
          .update({
            delivery_status: 'failed',
            delivery_error: deliveryErrorMsg,
            delivery_attempts: (existingJob.delivery_attempts || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId)

        await supabase.from('ai_delivery_logs').insert([
          {
            job_id: jobId,
            recipient: clientEmail,
            status: 'failed',
            error: deliveryErrorMsg,
            payload_snapshot: activeDraft,
          },
        ])

        return jsonResponse(
          {
            success: false,
            message: 'Job was approved, but client delivery email failed to dispatch',
            error: deliveryErrorMsg,
            job_id: jobId,
            delivery_status: 'failed',
          },
          502,
          corsHeaders
        )
      }
    }

    return jsonResponse({ success: false, message: `Unknown action: ${action}` }, 400, corsHeaders)
  }

  return jsonResponse({ success: false, message: 'Method not allowed' }, 405, corsHeaders)
})

function formatClientDeliveryEmail(
  clientName: string,
  service: string,
  draft: Record<string, unknown>
): string {
  const isClarification = draft.needs_clarification === true
  const summary = (draft.summary as string) || (isClarification ? 'Project Scoping Questions' : 'Executive Proposal Summary')
  const rawJson = JSON.stringify(draft, null, 2)
  const questions = Array.isArray(draft.clarification_questions) ? (draft.clarification_questions as string[]) : []

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a; background-color: #ffffff; border: 1px solid #eaeaea; border-radius: 12px;">
      <div style="margin-bottom: 24px; border-bottom: 2px solid #ff3d00; padding-bottom: 16px;">
        <span style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: #ff3d00; font-weight: 700;">Orynex Studio</span>
        <h1 style="font-size: 24px; font-weight: 700; margin: 8px 0 0; color: #111;">
          ${isClarification ? `Your ${escapeHtml(service)} Consultation — Next Steps` : `Your ${escapeHtml(service)} Proposal`}
        </h1>
      </div>

      <p style="font-size: 16px; line-height: 1.6; color: #333;">Dear <strong>${escapeHtml(clientName)}</strong>,</p>
      <p style="font-size: 15px; line-height: 1.6; color: #444;">
        ${
          isClarification
            ? `Thank you for your inquiry regarding ${escapeHtml(service)}. Our team has reviewed your project overview. To ensure our strategic proposal is accurately tailored to your requirements, we would appreciate your feedback on the following questions:`
            : `Following your inquiry, our team has reviewed and prepared your personalized strategic proposal. Here is the executive breakdown:`
        }
      </p>

      <div style="background-color: #f9f9fb; border-left: 4px solid #ff3d00; padding: 16px; border-radius: 4px; margin: 20px 0;">
        <p style="margin: 0; font-size: 15px; font-weight: 600; color: #111;">${escapeHtml(summary)}</p>
      </div>

      ${
        isClarification && questions.length > 0
          ? `
        <div style="margin: 20px 0;">
          <h3 style="font-size: 16px; color: #222; margin-bottom: 12px;">Clarification Questions:</h3>
          <ol style="padding-left: 20px; line-height: 1.8; color: #333; font-size: 14px;">
            ${questions.map((q) => `<li style="margin-bottom: 8px;">${escapeHtml(q)}</li>`).join('')}
          </ol>
        </div>
      `
          : ''
      }

      <div style="margin-top: 24px;">
        <h3 style="font-size: 16px; color: #222; margin-bottom: 8px;">Deliverable Specification</h3>
        <pre style="background: #110e0c; color: #f5f5f5; padding: 16px; border-radius: 8px; font-size: 12px; overflow-x: auto; max-height: 350px;"><code>${escapeHtml(rawJson)}</code></pre>
      </div>

      <p style="font-size: 14px; line-height: 1.6; color: #555; margin-top: 24px;">
        Our team will follow up directly to schedule your technical consultation and walk through the implementation milestones.
      </p>

      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px;" />
      <p style="font-size: 12px; color: #888; text-align: center;">
        Orynex Studio &bull; Technology Crafted for All &bull; Verified Admin Delivery
      </p>
    </div>
  `
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
