// ==============================================================================
// Supabase Edge Function: submit-lead
// Description: Secure lead ingestion endpoint for Orynex Studio.
// Runtime: Deno (Supabase Edge Runtime)
// ==============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Configuration constants
const MAX_PAYLOAD_BYTES = 10 * 1024 // 10 KB
const ALLOWED_SERVICES = [
  'Digital Product Design',
  'Technology Architecture',
  'Custom Engineering',
  'Performance & Optimization',
] as const

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9]+([.-][A-Za-z0-9]+)*\.[A-Za-z]{2,}$/

// ==============================================================================
// CORS Configuration & Origin Allowlist
// ==============================================================================
// Allowed origins for Orynex Studio.
// Production domains: https://orynex.studio, https://www.orynex.studio
// Deployed Vercel origin: https://orynexstudio-git-main-team-itachi.vercel.app
// Localhost development origins: allowed for local testing/development.
// Can also be augmented via ALLOWED_ORIGINS environment variable (comma-separated).
const DEFAULT_ALLOWED_ORIGINS = [
  'https://orynex.studio',
  'https://www.orynex.studio',
  'https://orynexstudio-git-main-team-itachi.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
]

function getAllowedOrigins(): string[] {
  const envOrigins = Deno.env.get('ALLOWED_ORIGINS')
  if (envOrigins) {
    const parsed = envOrigins
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
    return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...parsed]))
  }
  return DEFAULT_ALLOWED_ORIGINS
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false
  const allowed = getAllowedOrigins()
  return allowed.includes(origin)
}

// CORS Headers helper
// Disallowed origins must NOT receive permissive CORS headers.
function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin')

  if (!origin || !isOriginAllowed(origin)) {
    return {
      Vary: 'Origin',
    }
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

// ==============================================================================
// Rate Limiting — Architecture & Known Limitations
// ==============================================================================
// ARCHITECTURAL LIMITATION & SECURITY NOTICE:
// The in-memory rate limiter below ('rateLimits' Map) is strictly INSTANCE-LOCAL.
// Supabase Edge Functions execute on Deno Deploy's globally distributed, ephemeral
// serverless isolates. As a consequence:
// 1. Isolate Restarts / Cold Starts: When an isolate restarts or scales down,
//    the in-memory map resets to empty.
// 2. Multi-Region / Multi-Instance Concurrency: Requests routed to different edge
//    worker isolates (or different geographic regions) maintain separate rate-limit
//    counters. A malicious actor can bypass this limit by distributing requests
//    across edges or after isolate recycling.
// 3. THIS IS NOT A PRODUCTION-GRADE DISTRIBUTED RATE LIMITER. It serves only as a
//    first-layer best-effort defense against naive single-isolate burst floods.
//
// PROPOSED DURABLE DISTRIBUTED SOLUTIONS FOR PRODUCTION:
// Option A: Database-backed Atomic Token Bucket / Sliding Window (Recommended on Supabase)
//   - Implement a dedicated Postgres table:
//       CREATE TABLE rate_limit_buckets (
//         key text PRIMARY KEY,
//         tokens int NOT NULL,
//         last_refill timestamptz NOT NULL
//       );
//   - Use an atomic stored procedure (RPC) with `SELECT ... FOR UPDATE` or `pg_advisory_xact_lock`
//     that atomically refills tokens and decrements in a single transaction.
//   - Note: Avoid naive `SELECT COUNT(*) FROM leads WHERE created_at > ...` queries, as
//     plain count queries lack atomicity under concurrency and incur linear table/index
//     scan overhead at scale.
// Option B: Distributed Fast-Store (e.g. Upstash Redis / Cloudflare KV)
//   - Use an external distributed memory store with atomic multi-exec or sliding-window
//     scripts (e.g. `@upstash/ratelimit` via Upstash Redis REST API over HTTPS).
//
// DEFENSE-IN-DEPTH SAFEGUARDS RETAINED:
// 1. Anti-spam honeypot ('company_website' field) catches automated form bots.
// 2. Server-side duplicate suppression checks if the same email submitted within 60 seconds.
// 3. Maximum payload size constraint (10 KB) prevents payload abuse.
// ==============================================================================
interface RateLimitEntry {
  count: number
  resetAt: number
}
const rateLimits = new Map<string, RateLimitEntry>()
const RATE_LIMIT_MAX = 5 // max 5 requests
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimits.get(ip)

  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false
  }

  entry.count++
  return true
}

function isMeaningfulOverview(text: string): boolean {
  // 1. Must contain alphanumeric characters
  if (!/[a-zA-Z0-9]/.test(text)) {
    return false
  }

  // 2. Reject 8 or more consecutive identical characters (e.g. aaaaaaaa, --------)
  if (/(.)\1{7,}/i.test(text)) {
    return false
  }

  // 3. Unique character diversity check (ignoring whitespace and case)
  const cleanChars = text.toLowerCase().replace(/\s+/g, '')
  const uniqueChars = new Set(cleanChars).size
  if (uniqueChars < 4) {
    return false
  }

  // 4. Repeated 2-4 character chunk pattern (e.g. "asdasdasdasdasd", "abcabcabcabcabc")
  for (let len = 2; len <= 4; len++) {
    const chunk = cleanChars.slice(0, len)
    const repeats = Math.floor(cleanChars.length / len)
    if (chunk.repeat(repeats) === cleanChars.slice(0, repeats * len) && repeats >= 5) {
      return false
    }
  }

  return true
}

// SHA-256 helper for IP hashing (avoids storing raw IP addresses)
async function hashIp(ip: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(ip + (Deno.env.get('IP_SALT') || 'orynex-salt'))
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Generic response helper
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
  const origin = req.headers.get('Origin')
  const isAllowed = isOriginAllowed(origin)
  const corsHeaders = getCorsHeaders(req)

  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    // If an Origin header is present and disallowed, reject with 403 and non-permissive headers
    if (origin && !isAllowed) {
      return new Response('Disallowed CORS origin', { status: 403, headers: corsHeaders })
    }
    // Allowed origin preflight response
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  // 2. Reject disallowed origins on POST requests
  if (origin && !isAllowed) {
    return jsonResponse(
      { success: false, message: 'Disallowed request origin' },
      403,
      corsHeaders
    )
  }

  try {
    // 3. Validate HTTP Method
    if (req.method !== 'POST') {
      return jsonResponse({ success: false, message: 'Method not allowed' }, 405, corsHeaders)
    }

  // 4. Validate Content-Type
  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return jsonResponse(
      { success: false, message: 'Content-Type must be application/json' },
      415,
      corsHeaders
    )
  }

  // 5. Rate Limiting Check
  const clientIp =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    '127.0.0.1'

  if (!checkRateLimit(clientIp)) {
    return jsonResponse(
      { success: false, message: 'Too many requests. Please try again later.' },
      429,
      corsHeaders
    )
  }

  // 6. Check Payload Size Limit
  const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return jsonResponse({ success: false, message: 'Payload too large' }, 413, corsHeaders)
  }

  // 7. Parse and Validate Request Body
  let bodyText: string
  try {
    bodyText = await req.text()
    if (new TextEncoder().encode(bodyText).length > MAX_PAYLOAD_BYTES) {
      return jsonResponse({ success: false, message: 'Payload too large' }, 413, corsHeaders)
    }
  } catch {
    return jsonResponse({ success: false, message: 'Malformed request body' }, 400, corsHeaders)
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(bodyText)
  } catch {
    return jsonResponse({ success: false, message: 'Invalid JSON payload' }, 400, corsHeaders)
  }

  // 8. Anti-Spam Honeypot Verification
  // If the hidden 'company_website' field is populated by bots, return a generic success without saving
  if (data.company_website && typeof data.company_website === 'string' && data.company_website.trim().length > 0) {
    console.warn(`[submit-lead] Honeypot triggered from IP hash`)
    return jsonResponse({ success: true, message: 'Inquiry received' }, 200, corsHeaders)
  }

  // 9. Field Validations
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : ''
  const service = typeof data.service === 'string' ? data.service.trim() : ''
  const rawMessage = typeof data.message === 'string' ? data.message : ''
  const message = rawMessage.trim()

  if (!name || name.length < 1 || name.length > 100) {
    return jsonResponse(
      { success: false, message: 'Valid full name is required (max 100 characters)' },
      422,
      corsHeaders
    )
  }

  if (!email || email.length > 255 || !EMAIL_REGEX.test(email)) {
    return jsonResponse(
      { success: false, message: 'Valid email address is required' },
      422,
      corsHeaders
    )
  }

  if (!ALLOWED_SERVICES.includes(service as (typeof ALLOWED_SERVICES)[number])) {
    return jsonResponse(
      { success: false, message: 'Please select a valid service focus' },
      422,
      corsHeaders
    )
  }

  if (!rawMessage || message.length === 0) {
    return jsonResponse(
      { success: false, message: 'Project overview is required (minimum 20 characters)' },
      422,
      corsHeaders
    )
  }

  if (message.length < 20) {
    return jsonResponse(
      { success: false, message: 'Project overview is too short (minimum 20 characters)' },
      422,
      corsHeaders
    )
  }

  if (message.length > 2000) {
    return jsonResponse(
      { success: false, message: 'Project overview must not exceed 2000 characters' },
      422,
      corsHeaders
    )
  }

  if (!isMeaningfulOverview(message)) {
    return jsonResponse(
      { success: false, message: 'Project overview must contain meaningful descriptive text rather than repetitive characters' },
      422,
      corsHeaders
    )
  }

  // 10. Initialize Supabase Admin Client
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[submit-lead] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return jsonResponse(
      { success: false, message: 'Service temporarily unavailable. Please try again later.' },
      503,
      corsHeaders
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })

  // 11. Duplicate Prevention (Recent Submission Check)
  // Check if this exact email submitted a lead within the last 60 seconds
  const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString()
  const { data: existingLeads } = await supabase
    .from('leads')
    .select('id')
    .eq('email', email)
    .gte('created_at', sixtySecondsAgo)
    .limit(1)

  if (existingLeads && existingLeads.length > 0) {
    // Return success to user without re-inserting duplicate record
    return jsonResponse({ success: true, message: 'Inquiry received' }, 200, corsHeaders)
  }

  // 12. Database Insertion (Atomic RPC with reliable idempotent fallback)
  const ipHash = await hashIp(clientIp)
  let leadId: string | null = null

  // Attempt atomic transaction via submit_lead_with_job RPC
  const { data: atomicData, error: atomicError } = await supabase.rpc('submit_lead_with_job', {
    p_name: name,
    p_email: email,
    p_service: service,
    p_project_overview: message,
    p_ip_hash: ipHash,
  })

  if (!atomicError && atomicData && atomicData.length > 0) {
    leadId = atomicData[0].lead_id
    console.log(`[submit-lead] Atomically created lead ${leadId} and AI service job`)
  } else {
    if (atomicError) {
      console.warn('[submit-lead] Atomic RPC notice, falling back to sequential transaction:', atomicError.message)
    }

    // Sequential fallback: insert lead record
    const { data: insertedLead, error: insertError } = await supabase
      .from('leads')
      .insert([
        {
          name,
          email,
          service,
          project_overview: message,
          ip_hash: ipHash,
          notification_status: 'pending',
          queue_status: 'pending',
        },
      ])
      .select('id')
      .single()

    if (insertError || !insertedLead) {
      console.error('[submit-lead] Database insert error code:', insertError?.code)
      return jsonResponse(
        { success: false, message: 'Unable to save inquiry. Please try again shortly.' },
        500,
        corsHeaders
      )
    }

    leadId = insertedLead.id
    console.log(`[submit-lead] Lead successfully created with ID: ${leadId}`)

    // Enqueue initial AI Service Job idempotently
    const { error: jobEnqueueError } = await supabase
      .from('ai_service_jobs')
      .upsert(
        [
          {
            lead_id: leadId,
            service,
            status: 'queued',
            delivery_status: 'not_started',
            revision_count: 1,
          },
        ],
        { onConflict: 'lead_id' }
      )

    if (jobEnqueueError) {
      console.error('[submit-lead] CRITICAL: Failed to enqueue AI service job for lead:', leadId, jobEnqueueError.message)
      // Record observable error state on lead in queue_status / queue_error
      // Note: notification_status is strictly for email notifications ('pending', 'sent', 'failed')
      await supabase
        .from('leads')
        .update({
          queue_status: 'failed',
          queue_error: jobEnqueueError.message,
        })
        .eq('id', leadId)

      return jsonResponse(
        { success: false, message: 'Your inquiry was recorded, but processing queue encountered an issue. Our team has been notified.' },
        500,
        corsHeaders
      )
    }

    // Mark lead queue_status as queued upon successful job creation
    await supabase
      .from('leads')
      .update({ queue_status: 'queued' })
      .eq('id', leadId)

    console.log(`[submit-lead] AI service job queued for lead: ${leadId}`)
  }

  // 13. Email Notification Dispatch (Resend / Transactional API)
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const adminEmail = Deno.env.get('ADMIN_NOTIFICATION_EMAIL') || Deno.env.get('ADMIN_EMAIL')
  const senderEmail = Deno.env.get('SENDER_EMAIL') || 'Orynex Studio <onboarding@resend.dev>'

  if (resendApiKey && adminEmail) {
    try {
      const emailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #ff3d00; margin-top: 0;">New Inbound Lead — Orynex Studio</h2>
          <p style="font-size: 15px; color: #333;">A new consultation request has been submitted through the website:</p>
          <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
            <tr>
              <td style="padding: 8px 0; font-weight: bold; width: 140px; color: #555;">Name:</td>
              <td style="padding: 8px 0; color: #111;">${escapeHtml(name)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold; color: #555;">Email:</td>
              <td style="padding: 8px 0; color: #111;"><a href="mailto:${escapeHtml(email)}" style="color: #ff3d00;">${escapeHtml(email)}</a></td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold; color: #555;">Service Focus:</td>
              <td style="padding: 8px 0; color: #111;">${escapeHtml(service)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold; color: #555; vertical-align: top;">Overview:</td>
              <td style="padding: 8px 0; color: #111; white-space: pre-wrap;">${message ? escapeHtml(message) : '<em>No overview provided</em>'}</td>
            </tr>
          </table>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="font-size: 12px; color: #888;">Lead ID: ${leadId} | Secure Ingestion by Orynex Studio Backend</p>
        </div>
      `

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: senderEmail,
          to: [adminEmail],
          subject: `[Lead] ${service} inquiry from ${name}`,
          html: emailHtml,
        }),
      })

      if (resendRes.ok) {
        console.log(`[submit-lead] Notification email dispatched for lead: ${leadId}`)
        await supabase
          .from('leads')
          .update({ notification_status: 'sent' })
          .eq('id', leadId)
      } else {
        const errorText = await resendRes.text()
        console.error(`[submit-lead] Resend API error (${resendRes.status}):`, errorText)
        await supabase
          .from('leads')
          .update({
            notification_status: 'failed',
            notification_error: `HTTP ${resendRes.status}`,
          })
          .eq('id', leadId)
      }
    } catch (err) {
      console.error('[submit-lead] Email dispatch exception:', (err as Error).message)
      await supabase
        .from('leads')
        .update({
          notification_status: 'failed',
          notification_error: (err as Error).message,
        })
        .eq('id', leadId)
    }
  } else {
    console.log('[submit-lead] Email notifications unconfigured (RESEND_API_KEY or ADMIN_EMAIL missing). Lead saved as pending.')
  }

  // 14. Return generic success to visitor
  return jsonResponse({ success: true, message: 'Inquiry received' }, 200, corsHeaders)
  } catch (fatalErr) {
    console.error('[submit-lead] Uncaught server error:', fatalErr)
    return jsonResponse(
      { success: false, message: 'Internal server error. Please try again later.' },
      500,
      corsHeaders
    )
  }
})

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
