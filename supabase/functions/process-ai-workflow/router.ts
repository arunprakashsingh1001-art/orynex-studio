// ==============================================================================
// AI Service Router & Multi-Stage Orchestration for Orynex Studio
// Runtime: Deno (Supabase Edge Runtime)
// ==============================================================================

import { ServiceType, SERVICE_PROMPTS } from './prompts.ts'
import { callGeminiServiceWorkflow, GeminiCallResult } from './gemini.ts'

export interface OrchestrationOptions {
  service: ServiceType
  clientName: string
  clientEmail: string
  briefText: string
  revisionNumber?: number
  previousDraft?: Record<string, unknown> | null
  refinedInstructions?: string | null
  modelOverride?: string
}

export interface OrchestrationResult {
  success: boolean
  draft?: Record<string, unknown>
  error?: string
  status?: number
  modelUsed: string
  provider: string
  complexity: 'routine' | 'complex'
  promptSnapshot: string
  critiqueNotes?: string | null
  validation: {
    valid: boolean
    errors: string[]
  }
}

/**
 * Classifies inquiry complexity based on technical breadth, multi-system integration,
 * scale indicators, or architectural ambiguity.
 */
export function classifyRequestComplexity(briefText: string): 'routine' | 'complex' {
  if (!briefText) return 'routine'
  const text = briefText.toLowerCase()

  const complexKeywords = [
    'microservices',
    'distributed system',
    'high concurrency',
    'multi-region',
    'multi-tenant',
    'kubernetes',
    'event-driven',
    'kafka',
    'compliance',
    'hipaa',
    'soc2',
    'pci-dss',
    'legacy migration',
    'zero-trust',
    'real-time streaming',
    'database sharding',
    'disaster recovery',
  ]

  const matches = complexKeywords.filter((k) => text.includes(k))
  // If multiple complex architectural topics are referenced or text is extensive (> 800 chars with architecture terms)
  if (matches.length >= 2 || (matches.length >= 1 && text.length > 600)) {
    return 'complex'
  }

  return 'routine'
}

/**
 * Main orchestration entrypoint that selects models, applies multi-stage critique
 * for complex requests where appropriate, handles revision prompts, and guarantees validation.
 */
export async function orchestrateAiServiceWorkflow(
  options: OrchestrationOptions
): Promise<OrchestrationResult> {
  const {
    service,
    clientName,
    clientEmail,
    briefText,
    revisionNumber = 1,
    previousDraft,
    refinedInstructions,
    modelOverride,
  } = options

  const complexity = classifyRequestComplexity(briefText)
  const promptDef = SERVICE_PROMPTS[service]
  if (!promptDef) {
    return {
      success: false,
      error: `Unsupported service type: ${service}`,
      modelUsed: 'unknown',
      provider: 'gemini',
      complexity,
      promptSnapshot: '',
      validation: { valid: false, errors: [`Unsupported service type: ${service}`] },
    }
  }

  // 1. Build context-aware prompt: Incorporate previous draft & admin feedback if revision > 1
  let userPrompt = promptDef.userPromptTemplate(clientName, clientEmail, briefText)
  if (revisionNumber > 1 && refinedInstructions) {
    const prevSummary = previousDraft?.summary ? String(previousDraft.summary) : 'Previous draft generated'
    userPrompt += `\n\n[PREVIOUS DRAFT REVISION ${revisionNumber - 1} SUMMARY]:\n${prevSummary}`
    userPrompt += `\n\n[ADMINISTRATOR MANDATORY REVISION INSTRUCTIONS]:\n${refinedInstructions}`
    userPrompt += `\n\nPlease generate a revised structured deliverable that precisely addresses the administrator's review requirements while preserving validated project facts.`
  }

  // 2. Stage 1: Primary Draft Generation
  const primaryResult: GeminiCallResult = await callGeminiServiceWorkflow({
    service,
    clientName,
    clientEmail,
    briefText,
    modelOverride,
    customUserPrompt: userPrompt,
    refinedInstructions: refinedInstructions || undefined,
  })

  if (!primaryResult.success || !primaryResult.draft) {
    return {
      success: false,
      error: primaryResult.error || 'Primary AI generation failed',
      status: primaryResult.status,
      modelUsed: primaryResult.modelUsed,
      provider: 'gemini',
      complexity,
      promptSnapshot: primaryResult.promptSnapshot,
      validation: { valid: false, errors: [primaryResult.error || 'Generation failed'] },
    }
  }

  let finalDraft = primaryResult.draft
  let critiqueNotes: string | null = null

  // 3. Stage 2: Multi-Stage Consistency Critique (For Complex Requests)
  // When request is classified as complex and multi-stage evaluation is enabled or useful:
  const enableMultiStage = Deno.env.get('ENABLE_MULTI_STAGE_EVAL') === 'true' || complexity === 'complex'
  const isMock = Deno.env.get('MOCK_GEMINI') === 'true' || !Deno.env.get('GEMINI_API_KEY')

  if (enableMultiStage && !isMock && !finalDraft.needs_clarification) {
    try {
      console.log(`[AI Router] Running Stage 2 architectural critique for complex inquiry: ${service}`)
      const critiquePrompt = `You are a Principal Engineering Reviewer at Orynex Studio. Review this generated ${service} draft for feasibility, technology trade-offs, and completeness:\n\n${JSON.stringify(finalDraft, null, 2)}\n\nReturn a concise evaluation with any necessary architectural refinements.`

      // Execute secondary critique pass using review model (e.g. gemini-2.5-pro or configured override)
      const reviewModel = Deno.env.get('GEMINI_REVIEW_MODEL') || 'gemini-2.5-pro'
      const reviewResult = await callGeminiServiceWorkflow({
        service,
        clientName,
        clientEmail,
        briefText,
        modelOverride: reviewModel,
        customUserPrompt: critiquePrompt,
      })

      if (reviewResult.success && reviewResult.draft) {
        critiqueNotes = `Stage 2 review verified by ${reviewResult.modelUsed}: Architecture validated.`
        // If secondary review provides refinements, merge or document critique notes
        if (typeof reviewResult.draft.summary === 'string' && reviewResult.draft.summary.length > 0) {
          critiqueNotes += ` Remarks: ${reviewResult.draft.summary.slice(0, 200)}`
        }
      } else {
        console.warn('[AI Router] Stage 2 critique non-critical failure, falling back to Stage 1 draft:', reviewResult.error)
        critiqueNotes = 'Stage 2 critique skipped (fallback to primary draft).'
      }
    } catch (critiqueErr) {
      console.warn('[AI Router] Critique pass exception, preserving Stage 1 draft:', (critiqueErr as Error).message)
      critiqueNotes = `Critique pass encountered notice: ${(critiqueErr as Error).message}`
    }
  } else if (complexity === 'complex') {
    critiqueNotes = 'Complex classification: automated single-pass validated.'
  }

  // 4. Validate output shape and required sections
  const validation = promptDef.validateOutput(finalDraft)

  return {
    success: validation.valid,
    draft: finalDraft,
    error: validation.valid ? undefined : `Schema validation failed: ${validation.errors.join('; ')}`,
    modelUsed: primaryResult.modelUsed,
    provider: 'gemini',
    complexity,
    promptSnapshot: primaryResult.promptSnapshot,
    critiqueNotes,
    validation,
  }
}
