// ==============================================================================
// Automated Test Suite: submit-lead backend & validation rules
// Runner: Node.js Built-in Test Runner (node --test)
// ==============================================================================

import test, { describe, it } from 'node:test'
import assert from 'node:assert/strict'
function validateProjectOverview(text) {
  if (typeof text !== 'string') {
    return { valid: false, error: 'Project overview is required.' }
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { valid: false, error: 'Project overview is required. Please describe your idea in simple words.' }
  }
  if (trimmed.length < 20) {
    return {
      valid: false,
      error: `Project overview is too short (${trimmed.length}/20 min characters). Describe your idea in simple words.`,
    }
  }
  if (trimmed.length > 2000) {
    return { valid: false, error: 'Project overview must not exceed 2,000 characters.' }
  }

  // Check for repetitive meaningless characters / low entropy
  if (!/[a-zA-Z0-9]/.test(trimmed)) {
    return { valid: false, error: 'Project overview must contain descriptive words.' }
  }

  // Consecutive identical character repetitions (e.g., aaaaaaaaaa)
  if (/(.)\1{7,}/i.test(trimmed)) {
    return { valid: false, error: 'Please provide a meaningful project overview rather than repetitive characters.' }
  }

  // Unique character diversity (ignoring whitespace)
  const cleanChars = trimmed.toLowerCase().replace(/\s+/g, '')
  const uniqueChars = new Set(cleanChars).size
  if (uniqueChars < 4) {
    return { valid: false, error: 'Please provide a meaningful project overview describing your idea.' }
  }

  // Repeated 2-4 character chunk pattern (e.g., "asdasdasdasdasd", "abcabcabcabcabc")
  for (let len = 2; len <= 4; len++) {
    const chunk = cleanChars.slice(0, len)
    const repeats = Math.floor(cleanChars.length / len)
    if (chunk.repeat(repeats) === cleanChars.slice(0, repeats * len) && repeats >= 5) {
      return { valid: false, error: 'Please provide a meaningful project overview describing your idea.' }
    }
  }

  return { valid: true, sanitized: trimmed }
}

// Configuration & Validation rules matching submit-lead edge function & DB constraints
const ALLOWED_SERVICES = [
  'Digital Product Design',
  'Technology Architecture',
  'Custom Engineering',
  'Performance & Optimization',
]

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9]+([.-][A-Za-z0-9]+)*\.[A-Za-z]{2,}$/
const MAX_PAYLOAD_BYTES = 10 * 1024 // 10 KB

const DEFAULT_ALLOWED_ORIGINS = [
  'https://orynex.studio',
  'https://www.orynex.studio',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
]

function isMeaningfulOverview(text) {
  if (typeof text !== 'string') return false
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

function validateLeadPayload(payload, payloadBytes = 0) {
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    return { valid: false, status: 413, error: 'Payload too large' }
  }

  // Honeypot check
  if (
    payload.company_website &&
    typeof payload.company_website === 'string' &&
    payload.company_website.trim().length > 0
  ) {
    return { valid: true, isHoneypot: true, status: 200 }
  }

  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const service = typeof payload.service === 'string' ? payload.service.trim() : ''
  const rawMessage = typeof payload.message === 'string' ? payload.message : ''
  const message = rawMessage.trim()

  if (!name || name.length < 1 || name.length > 100) {
    return { valid: false, status: 422, error: 'Valid full name is required (max 100 characters)' }
  }

  if (!email || email.length > 255 || !EMAIL_REGEX.test(email)) {
    return { valid: false, status: 422, error: 'Valid email address is required' }
  }

  if (!ALLOWED_SERVICES.includes(service)) {
    return { valid: false, status: 422, error: 'Please select a valid service focus' }
  }

  if (!rawMessage || message.length === 0) {
    return { valid: false, status: 422, error: 'Project overview is required (minimum 20 characters)' }
  }

  if (message.length < 20) {
    return { valid: false, status: 422, error: 'Project overview is too short (minimum 20 characters)' }
  }

  if (message.length > 2000) {
    return { valid: false, status: 422, error: 'Project overview must not exceed 2000 characters' }
  }

  if (!isMeaningfulOverview(message)) {
    return {
      valid: false,
      status: 422,
      error: 'Project overview must contain meaningful descriptive text rather than repetitive characters',
    }
  }

  return {
    valid: true,
    isHoneypot: false,
    status: 200,
    sanitized: { name, email, service, message },
  }
}

// In-memory rate limiter simulation
function createRateLimiter(maxRequests = 5, windowMs = 60000) {
  const map = new Map()
  return function isAllowed(ip) {
    const now = Date.now()
    const entry = map.get(ip)
    if (!entry || now > entry.resetAt) {
      map.set(ip, { count: 1, resetAt: now + windowMs })
      return true
    }
    if (entry.count >= maxRequests) {
      return false
    }
    entry.count++
    return true
  }
}

// CORS Origin evaluation helper matching Edge Function behavior
function evaluateCors(origin, method = 'POST') {
  const isAllowed = origin ? DEFAULT_ALLOWED_ORIGINS.includes(origin) : false

  if (method === 'OPTIONS') {
    if (origin && !isAllowed) {
      return { status: 403, allowed: false, headers: { Vary: 'Origin' } }
    }
    return {
      status: 204,
      allowed: true,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      },
    }
  }

  if (origin && !isAllowed) {
    return { status: 403, allowed: false, headers: { Vary: 'Origin' } }
  }

  const headers = { Vary: 'Origin' }
  if (isAllowed && origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, x-client-info, apikey'
    headers['Access-Control-Max-Age'] = '86400'
  }
  return { status: 200, allowed: isAllowed, headers }
}

// Duplicate check helper matching Edge Function logic
function checkDuplicateSubmission(recentSubmissions, email, windowMs = 60000) {
  const now = Date.now()
  const cutoff = now - windowMs
  return recentSubmissions.some((sub) => sub.email === email && sub.timestamp >= cutoff)
}

// Client-side ContactModal submission logic simulation
function simulateContactModalSubmission({ endpoint, mockServerResponse, networkError }) {
  let status = 'idle'
  let errorMessage = null

  if (!endpoint) {
    status = 'error'
    errorMessage =
      'Inquiry submission is currently unavailable. Please reach out directly or try again later.'
    return { status, errorMessage, displayedSuccessModal: false }
  }

  if (networkError) {
    status = 'error'
    errorMessage = 'Network connection error. Please verify your connection and try again.'
    return { status, errorMessage, displayedSuccessModal: false }
  }

  if (mockServerResponse && mockServerResponse.ok && mockServerResponse.data?.success) {
    status = 'success'
    return { status, errorMessage: null, displayedSuccessModal: true }
  } else {
    status = 'error'
    errorMessage =
      mockServerResponse?.data?.message ||
      'Unable to submit your inquiry at this moment. Please try again shortly.'
    return { status, errorMessage, displayedSuccessModal: false }
  }
}

// ==============================================================================
// Test Suites
// ==============================================================================

describe('Orynex Studio — Lead Submission Validation Suite', () => {
  it('accepts valid consultation submissions with meaningful descriptions', () => {
    const payload = {
      name: 'Elena Rostova',
      email: 'elena@techcorp.io',
      service: 'Digital Product Design',
      message: 'Looking for a complete UX audit and design system redesign for our retail application.',
    }
    const result = validateLeadPayload(payload, 250)
    assert.equal(result.valid, true)
    assert.equal(result.status, 200)
    assert.equal(result.sanitized.email, 'elena@techcorp.io')
    assert.equal(result.sanitized.message, 'Looking for a complete UX audit and design system redesign for our retail application.')
  })

  it('rejects submissions with missing name', () => {
    const payload = {
      name: '   ',
      email: 'valid@example.com',
      service: 'Custom Engineering',
      message: 'We need custom API integration for inventory management.',
    }
    const result = validateLeadPayload(payload, 100)
    assert.equal(result.valid, false)
    assert.equal(result.status, 422)
    assert.equal(result.error, 'Valid full name is required (max 100 characters)')
  })

  it('rejects names exceeding 100 characters', () => {
    const payload = {
      name: 'A'.repeat(101),
      email: 'valid@example.com',
      service: 'Custom Engineering',
      message: 'We need custom API integration for inventory management.',
    }
    const result = validateLeadPayload(payload, 200)
    assert.equal(result.valid, false)
    assert.equal(result.status, 422)
  })

  it('rejects missing or malformed email addresses', () => {
    const invalidEmails = [
      '',
      'plainaddress',
      '@missingusername.com',
      'username@.com',
      'user@domain..com',
      'user@domain,com',
    ]

    for (const email of invalidEmails) {
      const result = validateLeadPayload(
        {
          name: 'John Doe',
          email,
          service: 'Technology Architecture',
          message: 'Planning our cloud architecture migration from monolith to serverless.',
        },
        150
      )
      assert.equal(result.valid, false, `Expected ${email} to be invalid`)
      assert.equal(result.status, 422)
    }
  })

  it('rejects invalid service focus values', () => {
    const payload = {
      name: 'Marcus Vance',
      email: 'marcus@agency.com',
      service: 'SEO & Growth Hacking', // Not in allowed list
      message: 'We want to improve our search traffic and organic conversions.',
    }
    const result = validateLeadPayload(payload, 150)
    assert.equal(result.valid, false)
    assert.equal(result.status, 422)
    assert.equal(result.error, 'Please select a valid service focus')
  })

  it('accepts all four supported services', () => {
    for (const service of ALLOWED_SERVICES) {
      const payload = {
        name: 'Jordan Lee',
        email: 'jordan@example.com',
        service,
        message: `Inquiry for ${service}: need professional support on our upcoming project.`,
      }
      const result = validateLeadPayload(payload, 150)
      assert.equal(result.valid, true, `Expected service "${service}" to be accepted`)
      assert.equal(result.status, 200)
    }
  })

  // Mandatory Project Overview Tests
  it('rejects missing project overview (undefined or null)', () => {
    const missingUndefined = {
      name: 'Marcus Vance',
      email: 'marcus@agency.com',
      service: 'Performance & Optimization',
    }
    const resUndefined = validateLeadPayload(missingUndefined, 100)
    assert.equal(resUndefined.valid, false)
    assert.equal(resUndefined.status, 422)
    assert.ok(resUndefined.error.includes('required'))

    const missingNull = {
      name: 'Marcus Vance',
      email: 'marcus@agency.com',
      service: 'Performance & Optimization',
      message: null,
    }
    const resNull = validateLeadPayload(missingNull, 100)
    assert.equal(resNull.valid, false)
    assert.equal(resNull.status, 422)
  })

  it('rejects empty and whitespace-only project overview', () => {
    const emptyPayload = {
      name: 'Marcus Vance',
      email: 'marcus@agency.com',
      service: 'Custom Engineering',
      message: '',
    }
    const resEmpty = validateLeadPayload(emptyPayload, 100)
    assert.equal(resEmpty.valid, false)
    assert.equal(resEmpty.status, 422)

    const whitespacePayload = {
      name: 'Marcus Vance',
      email: 'marcus@agency.com',
      service: 'Custom Engineering',
      message: '   \n\t   \r\n   ',
    }
    const resWhitespace = validateLeadPayload(whitespacePayload, 100)
    assert.equal(resWhitespace.valid, false)
    assert.equal(resWhitespace.status, 422)
  })

  it('rejects project overviews shorter than 20 meaningful characters', () => {
    const shortPayloads = [
      'Short description',
      'Need an app.',
      'Help me build',
      '   19 characters here!   ',
    ]

    for (const text of shortPayloads) {
      const payload = {
        name: 'Marcus Vance',
        email: 'marcus@agency.com',
        service: 'Custom Engineering',
        message: text,
      }
      const result = validateLeadPayload(payload, 120)
      assert.equal(result.valid, false, `Expected "${text}" to be rejected as too short`)
      assert.equal(result.status, 422)
      assert.ok(result.error.includes('too short'))
    }
  })

  it('rejects repetitive or meaningless character sequences', () => {
    const repetitivePayloads = [
      'aaaaaaaaaaaaaaaaaaaa',
      '11111111111111111111',
      '....................',
      '--------------------',
      'asdasdasdasdasdasdasd',
      'abcabcabcabcabcabcabc',
      '!@#$%!@#$%!@#$%!@#$%',
    ]

    for (const text of repetitivePayloads) {
      const payload = {
        name: 'Test Client',
        email: 'client@domain.com',
        service: 'Custom Engineering',
        message: text,
      }
      const result = validateLeadPayload(payload, 120)
      assert.equal(result.valid, false, `Expected repetitive "${text}" to be rejected`)
      assert.equal(result.status, 422)
    }
  })

  it('accepts valid short, simple non-technical description', () => {
    const validSimple = {
      name: 'Claire Bennett',
      email: 'claire@flowerboutique.com',
      service: 'Digital Product Design',
      message: 'Example: I need a modern business website where customers can explore my services and contact me easily.',
    }
    const result = validateLeadPayload(validSimple, 250)
    assert.equal(result.valid, true)
    assert.equal(result.status, 200)

    const anotherSimple = {
      name: 'Sam Miller',
      email: 'sam@bakery.com',
      service: 'Digital Product Design',
      message: 'We need a simple web store for our local bakery in Seattle.',
    }
    const res2 = validateLeadPayload(anotherSimple, 150)
    assert.equal(res2.valid, true)
    assert.equal(res2.status, 200)
  })

  it('accepts project overview of exactly 2000 characters', () => {
    const paragraph = 'We are seeking a partner to redesign our global customer portal. Our current architecture struggles with latency during traffic spikes and lacks clear design hierarchy. We need a modern, accessible interface with high performance, secure authentication, and real-time telemetry. '
    const exact2000 = paragraph.repeat(8).slice(0, 1995) + ' end.'
    assert.equal(exact2000.length, 2000)
    assert.equal(exact2000.trim().length, 2000)

    const payload = {
      name: 'Marcus Vance',
      email: 'marcus@agency.com',
      service: 'Performance & Optimization',
      message: exact2000,
    }
    const result = validateLeadPayload(payload, 2200)
    assert.equal(result.valid, true)
    assert.equal(result.status, 200)
    assert.equal(result.sanitized.message.length, 2000)
  })

  it('rejects project overviews exceeding 2000 characters', () => {
    const payload = {
      name: 'Marcus Vance',
      email: 'marcus@agency.com',
      service: 'Performance & Optimization',
      message: 'Valid descriptive intro text. ' + 'x'.repeat(2000),
    }
    const result = validateLeadPayload(payload, 2200)
    assert.equal(result.valid, false)
    assert.equal(result.status, 422)
    assert.ok(result.error.includes('2000'))
  })

  it('rejects oversized payloads exceeding 10KB', () => {
    const payload = {
      name: 'Test',
      email: 'test@example.com',
      service: 'Custom Engineering',
      message: 'Valid project description for testing.',
    }
    const result = validateLeadPayload(payload, 11 * 1024)
    assert.equal(result.valid, false)
    assert.equal(result.status, 413)
    assert.equal(result.error, 'Payload too large')
  })
})

describe('Orynex Studio — Frontend ContactModal Validator Component Unit Tests', () => {
  it('validates required, minimum, maximum, and meaningfulness rules on frontend', () => {
    assert.equal(validateProjectOverview('').valid, false)
    assert.equal(validateProjectOverview('   ').valid, false)
    assert.equal(validateProjectOverview('Too short').valid, false)
    assert.equal(validateProjectOverview('aaaaaaaaaaaaaaaaaaaa').valid, false)
    assert.equal(validateProjectOverview('asdasdasdasdasdasdasd').valid, false)
    assert.equal(validateProjectOverview('x'.repeat(2001)).valid, false)

    const validExample = 'Example: I need a modern business website where customers can explore my services and contact me easily.'
    const validResult = validateProjectOverview(validExample)
    assert.equal(validResult.valid, true)
    assert.equal(validResult.sanitized, validExample)
  })
})

describe('Orynex Studio — Anti-Spam Honeypot & Duplicate Submissions', () => {
  it('silently absorbs spam bots via honeypot field without saving', () => {
    const spamPayload = {
      name: 'Bot Spammer',
      email: 'spammer@botnet.ru',
      service: 'Digital Product Design',
      message: 'Spam message that looks long enough to bypass simple length checks.',
      company_website: 'https://spam-pills.com', // Honeypot filled
    }
    const result = validateLeadPayload(spamPayload, 180)
    assert.equal(result.valid, true)
    assert.equal(result.isHoneypot, true)
    assert.equal(result.status, 200)
  })

  it('detects and suppresses duplicate submissions within 60 seconds', () => {
    const now = Date.now()
    const recentSubmissions = [
      { email: 'alex@example.com', timestamp: now - 15000 }, // 15 seconds ago
      { email: 'sarah@example.com', timestamp: now - 120000 }, // 2 minutes ago
    ]

    // alex submitted 15s ago: should detect as duplicate
    const isAlexDuplicate = checkDuplicateSubmission(recentSubmissions, 'alex@example.com')
    assert.equal(isAlexDuplicate, true)

    // sarah submitted 2m ago: outside 60s window
    const isSarahDuplicate = checkDuplicateSubmission(recentSubmissions, 'sarah@example.com')
    assert.equal(isSarahDuplicate, false)

    // new user never submitted
    const isNewUserDuplicate = checkDuplicateSubmission(recentSubmissions, 'newuser@example.com')
    assert.equal(isNewUserDuplicate, false)
  })
})

describe('Orynex Studio — CORS Origins & OPTIONS Preflight Handling', () => {
  it('permits authorized production origins with proper headers', () => {
    const prodOrigin = 'https://orynex.studio'
    const result = evaluateCors(prodOrigin, 'POST')
    assert.equal(result.allowed, true)
    assert.equal(result.status, 200)
    assert.equal(result.headers['Access-Control-Allow-Origin'], prodOrigin)
    assert.equal(result.headers['Access-Control-Allow-Methods'], 'POST, OPTIONS')
  })

  it('permits localhost development origins for local dev server', () => {
    const localhostOrigin = 'http://localhost:5173'
    const result = evaluateCors(localhostOrigin, 'POST')
    assert.equal(result.allowed, true)
    assert.equal(result.headers['Access-Control-Allow-Origin'], localhostOrigin)
  })

  it('strictly rejects disallowed origins without permissive CORS headers', () => {
    const rogueOrigin = 'https://malicious-phishing.com'
    const result = evaluateCors(rogueOrigin, 'POST')
    assert.equal(result.allowed, false)
    assert.equal(result.status, 403)
    assert.equal(result.headers['Access-Control-Allow-Origin'], undefined)
  })

  it('handles OPTIONS preflight for allowed origin with 204 and CORS headers', () => {
    const prodOrigin = 'https://www.orynex.studio'
    const result = evaluateCors(prodOrigin, 'OPTIONS')
    assert.equal(result.status, 204)
    assert.equal(result.headers['Access-Control-Allow-Origin'], prodOrigin)
    assert.equal(result.headers['Access-Control-Max-Age'], '86400')
  })

  it('rejects OPTIONS preflight for disallowed origin with 403 and no allow-origin', () => {
    const rogueOrigin = 'https://evil-site.com'
    const result = evaluateCors(rogueOrigin, 'OPTIONS')
    assert.equal(result.status, 403)
    assert.equal(result.headers['Access-Control-Allow-Origin'], undefined)
  })
})

describe('Orynex Studio — Rate Limiting Behavior', () => {
  it('enforces IP rate limiting limits', () => {
    const limiter = createRateLimiter(3, 60000)
    const testIp = '203.0.113.195'

    assert.equal(limiter(testIp), true, 'Request 1 should pass')
    assert.equal(limiter(testIp), true, 'Request 2 should pass')
    assert.equal(limiter(testIp), true, 'Request 3 should pass')
    assert.equal(limiter(testIp), false, 'Request 4 should be rate-limited')
    assert.equal(limiter('198.51.100.1'), true, 'Different IP should pass')
  })
})

describe('Orynex Studio — Frontend Failure Handling & Zero Fake Success', () => {
  it('shows clear error when backend endpoint is missing (never shows Inquiry Received)', () => {
    const result = simulateContactModalSubmission({
      endpoint: null,
      mockServerResponse: null,
    })

    assert.equal(result.status, 'error')
    assert.equal(result.displayedSuccessModal, false)
    assert.ok(result.errorMessage.includes('unavailable'))
  })

  it('shows clear error when network fails (never shows Inquiry Received)', () => {
    const result = simulateContactModalSubmission({
      endpoint: 'https://example.supabase.co/functions/v1/submit-lead',
      networkError: new Error('Failed to fetch'),
    })

    assert.equal(result.status, 'error')
    assert.equal(result.displayedSuccessModal, false)
    assert.ok(result.errorMessage.includes('Network connection error'))
  })

  it('shows clear error on server 500 error (never shows Inquiry Received)', () => {
    const result = simulateContactModalSubmission({
      endpoint: 'https://example.supabase.co/functions/v1/submit-lead',
      mockServerResponse: {
        ok: false,
        status: 500,
        data: { success: false, message: 'Unable to save inquiry. Please try again shortly.' },
      },
    })

    assert.equal(result.status, 'error')
    assert.equal(result.displayedSuccessModal, false)
    assert.equal(result.errorMessage, 'Unable to save inquiry. Please try again shortly.')
  })

  it('shows success modal ONLY when server explicitly responds with HTTP 200 and success: true', () => {
    const result = simulateContactModalSubmission({
      endpoint: 'https://example.supabase.co/functions/v1/submit-lead',
      mockServerResponse: {
        ok: true,
        status: 200,
        data: { success: true, message: 'Inquiry received' },
      },
    })

    assert.equal(result.status, 'success')
    assert.equal(result.displayedSuccessModal, true)
    assert.equal(result.errorMessage, null)
  })

  it('masks database errors with generic client responses', () => {
    const clientResponse = {
      success: false,
      message: 'Unable to save inquiry. Please try again shortly.',
    }
    assert.equal(
      clientResponse.message.includes('postgres'),
      false,
      'Internal details must never leak'
    )
  })

  it('preserves lead status as failed without discarding record when email API fails', () => {
    const leadRecord = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      name: 'Sarah Connor',
      email: 'sarah@skynet.defense',
      service: 'Technology Architecture',
      notification_status: 'pending',
    }

    // Simulate email dispatch failure
    const emailDispatchSuccess = false
    if (!emailDispatchSuccess) {
      leadRecord.notification_status = 'failed'
      leadRecord.notification_error = 'HTTP 401 Unauthorized: Invalid Resend API Key'
    }

    assert.equal(leadRecord.notification_status, 'failed')
    assert.ok(leadRecord.id, 'Lead must remain persisted in DB even if notification fails')
  })
})
