// ==============================================================================
// Gemini API Client for Orynex Studio AI Workflow
// Runtime: Deno (Supabase Edge Functions)
// ==============================================================================

import { SERVICE_PROMPTS, ServiceType } from './prompts.ts'

export interface GeminiCallOptions {
  service: ServiceType
  clientName: string
  clientEmail: string
  briefText: string
  modelOverride?: string
  customUserPrompt?: string
  customSystemInstruction?: string
  refinedInstructions?: string
}

export interface GeminiCallResult {
  success: boolean
  draft?: Record<string, unknown>
  error?: string
  status?: number
  modelUsed: string
  promptSnapshot: string
}

const DEFAULT_MODEL = 'gemini-3.8-flash'
const REQUEST_TIMEOUT_MS = 35000 // 35 seconds

export async function callGeminiServiceWorkflow(
  options: GeminiCallOptions
): Promise<GeminiCallResult> {
  const { service, clientName, clientEmail, briefText, modelOverride, customUserPrompt, customSystemInstruction, refinedInstructions } = options
  const model = modelOverride || Deno.env.get('GEMINI_MODEL') || DEFAULT_MODEL
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  const isExplicitMock = Deno.env.get('MOCK_GEMINI') === 'true'

  const promptDef = SERVICE_PROMPTS[service]
  if (!promptDef) {
    return {
      success: false,
      error: `Unsupported service type: ${service}`,
      modelUsed: model,
      promptSnapshot: '',
    }
  }

  // Sanitize and cap untrusted client input before snapshotting
  const sanitizedBrief = (briefText || '').slice(0, 2000).trim()
  let userPrompt = customUserPrompt || promptDef.userPromptTemplate(clientName, clientEmail, sanitizedBrief)
  if (refinedInstructions) {
    userPrompt += `\n\n[ADMINISTRATOR REVISION FEEDBACK & REQUIREMENTS]:\n${refinedInstructions}\n\nPlease revise the deliverable to address all administrator feedback while maintaining high engineering and design quality.`
  }

  const systemInstructionText = customSystemInstruction || promptDef.systemInstruction
  const promptSnapshot = `[System]: ${systemInstructionText.slice(0, 300)}...\n[User Prompt]: ${userPrompt.slice(0, 500)}...`

  // Offline Mock Mode strictly runs ONLY when MOCK_GEMINI=true is explicitly configured
  if (isExplicitMock) {
    console.log(`[Gemini Client] MOCK_GEMINI=true explicit test mode active for service: ${service}`)
    const mockDraft = generateMockDraft(service, clientName, sanitizedBrief)
    return {
      success: true,
      draft: mockDraft,
      modelUsed: `${model} (mock)`,
      promptSnapshot,
    }
  }

  // Production AI must fail closed if API key is missing
  if (!apiKey) {
    console.error('[Gemini Client] GEMINI_API_KEY is not configured. Production AI failing closed.')
    return {
      success: false,
      error: 'GEMINI_API_KEY is not configured in environment',
      status: 500,
      modelUsed: model,
      promptSnapshot,
    }
  }

  // Keep a supported stable fallback for temporary primary-model overloads.
  // GEMINI_FALLBACK_MODEL can override the default fallback without a code change.
  const fallbackModel = Deno.env.get('GEMINI_FALLBACK_MODEL') || 'gemini-3.6-flash'
  let selectedModel = model

  try {
    const payload = {
      system_instruction: {
        parts: [{ text: systemInstructionText }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: promptDef.jsonSchema,
      },
    }

    const requestModel = async (candidateModel: string): Promise<Response> => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        return await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        )
      } finally {
        clearTimeout(timeoutId)
      }
    }

    let response = await requestModel(model)

    // A 503 from Gemini means temporary provider overload. Try one supported fallback
    // model instead of burning a whole queue retry on the same overloaded endpoint.
    if (response.status === 503 && fallbackModel !== model) {
      const primaryError = await response.text()
      const safePrimaryError = apiKey ? primaryError.replaceAll(apiKey, '[REDACTED]') : primaryError
      console.warn(
        `[Gemini Client] Primary model ${model} returned HTTP 503; trying fallback ${fallbackModel}.`,
        safePrimaryError.slice(0, 200),
      )
      selectedModel = fallbackModel
      response = await requestModel(fallbackModel)
    }

    if (!response.ok) {
      const errText = await response.text()
      const safeErrText = apiKey ? errText.replaceAll(apiKey, '[REDACTED]') : errText
      console.error(`[Gemini Client] Provider error HTTP ${response.status} for model ${selectedModel}:`, safeErrText.slice(0, 300))
      return {
        success: false,
        status: response.status,
        error: `Gemini API returned HTTP ${response.status}`,
        modelUsed: selectedModel,
        promptSnapshot,
      }
    }

    const responseJson = await response.json()
    // Output text extraction from official generateContent API (with fallback compatibility)
    let rawText: string | null = null
    if (responseJson.candidates?.[0]?.content?.parts?.[0]?.text) {
      rawText = responseJson.candidates[0].content.parts[0].text
    } else if (responseJson.output_text) {
      rawText = responseJson.output_text
    } else if (Array.isArray(responseJson.outputs) && responseJson.outputs.length > 0) {
      rawText = responseJson.outputs[responseJson.outputs.length - 1].text
    }

    if (!rawText) {
      return {
        success: false,
        error: 'Empty response payload from Gemini API',
        modelUsed: selectedModel,
        promptSnapshot,
      }
    }

    let parsedData: Record<string, unknown>
    try {
      parsedData = JSON.parse(rawText)
    } catch {
      return {
        success: false,
        error: 'Failed to parse Gemini output as JSON',
        modelUsed: selectedModel,
        promptSnapshot,
      }
    }

    // Schema validation check
    const validation = promptDef.validateOutput(parsedData)
    if (!validation.valid) {
      console.warn(`[Gemini Client] Schema validation errors:`, validation.errors)
      return {
        success: false,
        error: `Schema validation failed: ${validation.errors.join('; ')}`,
        draft: parsedData,
        modelUsed: selectedModel,
        promptSnapshot,
      }
    }

    return {
      success: true,
      draft: parsedData,
      modelUsed: selectedModel,
      promptSnapshot,
    }
  } catch (err) {
    const isTimeout = (err as Error).name === 'AbortError'
    let errorMessage = isTimeout ? 'Gemini API request timed out after 35s' : (err as Error).message
    if (apiKey && errorMessage.includes(apiKey)) {
      errorMessage = errorMessage.replaceAll(apiKey, '[REDACTED]')
    }
    return {
      success: false,
      error: errorMessage,
      modelUsed: selectedModel,
      promptSnapshot,
    }
  }
}

export function isVagueBrief(brief: string): boolean {
  if (!brief) return true
  const lower = brief.toLowerCase().trim()
  const vaguePhrases = [
    'make me an app',
    'need a website',
    'help my business',
    'make things better',
    'build something cool',
    'i need an app',
    'i want software',
    'just build it',
    'help us grow',
    'general inquiry',
    'something to help my business grow',
  ]
  if (vaguePhrases.some((phrase) => lower === phrase || lower === `${phrase}.` || lower.startsWith(phrase))) {
    return true
  }
  if (lower.includes('too vague') || lower.includes('vague brief') || lower.includes('vague requirement')) {
    return true
  }
  return false
}

export function generateMockDraft(
  service: ServiceType,
  clientName: string,
  brief: string
): Record<string, unknown> {
  if (isVagueBrief(brief)) {
    return {
      summary: `Clarification needed for ${clientName}'s ${service} inquiry: project overview requires additional detail before draft generation.`,
      needs_clarification: true,
      clarification_questions: [
        `What specific business problem, target audience, or workflow should this ${service} project address?`,
        'What existing systems, technologies, or data sources need to integrate with this solution?',
        'What are the primary operational goals or timeline constraints for the initial milestone?',
      ],
    }
  }

  const previewBrief = brief ? brief.slice(0, 150) : 'General service inquiry'

  switch (service) {
    case 'Digital Product Design':
      return {
        summary: `Strategic digital product design proposal crafted for ${clientName}`,
        design_brief: {
          target_audience: 'Modern enterprise operators seeking streamlined, high-clarity UX.',
          core_problems: [
            'Excessive workflow friction in existing digital touchpoints',
            'Fragmented design tokens creating visual inconsistency',
          ],
          design_principles: [
            'Radical clarity over superfluous ornamentation',
            'Fluid responsiveness with tactile micro-interactions',
            'Human-centered typographic scale',
          ],
        },
        page_structure: [
          {
            section_name: 'Hero Viewport',
            layout_hierarchy: 'Top-tier focal point with immersive headline and immediate primary CTA',
            key_elements: ['Value proposition hook', 'Interactive modal trigger', 'Social proof metrics'],
          },
          {
            section_name: 'Service Deep Dive',
            layout_hierarchy: 'Modular grid highlighting core capabilities',
            key_elements: ['Capabilities matrix', 'Interactive filter', 'Case study links'],
          },
        ],
        component_specifications: [
          {
            component_name: 'NavigationHeader',
            tokens: 'var(--flame-lit), backdrop-filter: blur(16px), border: 1px solid var(--border-subtle)',
            interactive_states: 'Default, hover with 150ms transform, active tap state',
            responsive_rules: 'Desktop: horizontal layout; Mobile: sliding drawer sheet',
          },
          {
            component_name: 'LeadInquiryCard',
            tokens: 'border-radius: 16px, background: var(--bg-card), box-shadow: 0 20px 40px rgba(0,0,0,0.4)',
            interactive_states: 'Focus-visible glow, loading spinner transition',
            responsive_rules: 'Full width on screens < 768px, fixed 540px on desktop',
          },
        ],
        prototype_draft: {
          format: 'html_css_preview',
          code_or_markup: `<div class="orynex-preview"><header><h1>${clientName} Design Concept</h1></header><main><p>${previewBrief}</p></main></div>`,
          walkthrough_notes: 'Demonstrates baseline layout structure and interaction hierarchy.',
        },
      }

    case 'Technology Architecture':
      return {
        summary: `Cloud architecture blueprint designed for ${clientName}`,
        executive_summary: `Scalable distributed architecture designed around serverless edge compute, relational Postgres persistence with RLS, and asynchronous event-driven workflow workers for ${clientName}.`,
        data_flow: [
          {
            step: 1,
            from: 'Client Application (Browser)',
            to: 'Edge Gateway / CDN',
            protocol_or_pattern: 'HTTPS / TLS 1.3',
            description: 'Encrypted request dispatch with origin verification',
          },
          {
            step: 2,
            from: 'Edge Function Worker',
            to: 'Supabase Postgres Database',
            protocol_or_pattern: 'pgBouncer Pooler / TCP TLS',
            description: 'Row-level security enforcement and transactional atomic queue write',
          },
        ],
        technology_choices: [
          {
            category: 'Database & Auth',
            selected_tech: 'Supabase (PostgreSQL 15+ & Row Level Security)',
            rationale: 'Provides ACID compliance, granular role-based security, and native connection pooling.',
            alternatives_considered: ['AWS DynamoDB', 'Firebase Firestore'],
          },
          {
            category: 'Compute Runtime',
            selected_tech: 'Deno Deploy Edge Functions',
            rationale: 'Sub-millisecond cold starts, zero-maintenance operational model, and secure isolate sandboxing.',
            alternatives_considered: ['AWS Lambda', 'Google Cloud Run'],
          },
        ],
        system_assumptions: [
          'High availability target: 99.95% uptime SLA',
          'Read/write ratio projected at 10:1 during peak traffic',
        ],
        risks_and_mitigations: [
          {
            risk: 'Third-party API rate limiting on downstream providers',
            severity: 'medium',
            mitigation_strategy: 'Implement exponential backoff retry queue with dead-letter logging',
          },
          {
            risk: 'Unauthenticated prompt injection or volumetric spam',
            severity: 'high',
            mitigation_strategy: 'Client IP pseudonymization, honeypot filters, and strict system instruction delimiters',
          },
        ],
      }

    case 'Custom Engineering':
      return {
        summary: `Production-grade engineering implementation blueprint for ${clientName}`,
        engineering_strategy: `Modular TypeScript architecture enforcing strict single-responsibility boundaries, declarative schemas, and zero-trust perimeter validation for ${clientName}.`,
        file_manifest: [
          {
            file_path: 'src/modules/core/dispatcher.ts',
            purpose: 'Coordinates event lifecycle and orchestrates service pipelines',
            exports_or_responsibilities: ['DispatchManager', 'EventPayloadValidator'],
          },
          {
            file_path: 'src/modules/adapters/gemini.ts',
            purpose: 'Encapsulates Google GenAI interactions with circuit-breaking',
            exports_or_responsibilities: ['GeminiAdapter', 'CircuitBreaker'],
          },
        ],
        core_implementation_draft: [
          {
            module_name: 'dispatcher.ts',
            language: 'typescript',
            code: `export class DispatchManager {\n  async dispatch(event: string, payload: unknown) {\n    console.log('Dispatching event:', event);\n  }\n}`,
          },
        ],
        test_plan: [
          {
            test_type: 'unit',
            target: 'DispatchManager.dispatch',
            assertions: [
              'Rejects malformed payloads with HTTP 422',
              'Emits event within 25ms SLA',
            ],
          },
          {
            test_type: 'integration',
            target: 'Database Transactional Boundaries',
            assertions: [
              'Rolls back cleanly on downstream socket failure',
              'Maintains zero orphan rows across retries',
            ],
          },
        ],
      }

    case 'Performance & Optimization':
      return {
        summary: `Runtime audit and Core Web Vitals optimization plan for ${clientName}`,
        audit_diagnosis: `Audit reveals opportunities to eliminate render-blocking JavaScript chunks, defer off-screen media assets, and improve thread responsiveness for ${clientName}.`,
        telemetry_and_metrics: [
          {
            metric_name: 'Largest Contentful Paint (LCP)',
            current_estimated: '3.4s',
            target_threshold: '< 1.8s',
            business_impact: 'Reduces visitor bounce rate by an estimated 28%',
          },
          {
            metric_name: 'Interaction to Next Paint (INP)',
            current_estimated: '260ms',
            target_threshold: '< 100ms',
            business_impact: 'Ensures instantaneous response during mobile form interactions',
          },
        ],
        proposed_improvements: [
          {
            area: 'Critical Asset Delivery',
            action_item: 'Preload hero loop video headers and critical font weights',
            priority: 'high',
            expected_gain: 'Saves 800ms on first visual viewport render',
          },
          {
            area: 'Bundle Optimization',
            action_item: 'Tree-shake unused icon symbols and split dynamic modal chunks',
            priority: 'medium',
            expected_gain: 'Reduces initial JavaScript payload by 45KB gzip',
          },
        ],
        validation_steps: [
          {
            step_number: 1,
            tool_or_method: 'Lighthouse CI / WebPageTest',
            verification_criteria: 'Score >= 95 on mobile profile with simulated 4G throttling',
          },
          {
            step_number: 2,
            tool_or_method: 'Chrome DevTools Performance Profiler',
            verification_criteria: 'Zero long-tasks exceeding 50ms during main-thread hydration',
          },
        ],
      }
  }
}
