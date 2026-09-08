import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const providers = readFileSync(new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url), 'utf8')
const core = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')
const coreEntry = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/index.ts', import.meta.url), 'utf8')
const compatibility = readFileSync(new URL('../../../supabase/functions/_shared/openAiRequestCompatibility.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../../supabase/migrations/20260908131500_allow_gpt_5_6_luna_assistant_conversations.sql', import.meta.url), 'utf8')
const gateway = readFileSync(new URL('../../../supabase/functions/openai-assistant-v2/index.ts', import.meta.url), 'utf8')
const picker = readFileSync(new URL('../../components/CompactModelControl.tsx', import.meta.url), 'utf8')

describe('OpenAI GPT-5.6 Luna provider integration', () => {
  it('registers Luna as an explicit OpenAI model and makes it the OpenAI default', () => {
    expect(providers).toContain("'gpt-5.6-luna'")
    expect(core).toContain("const DEFAULT_MODEL = 'gpt-5.6-luna'")
    expect(gateway).toContain("const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna'")
  })

  it('exposes Luna in the canonical model picker', () => {
    expect(picker).toContain("value: 'gpt-5.6-luna'")
    expect(picker).toContain("label: 'GPT-5.6 Luna'")
  })

  it('normalizes OpenAI function schemas without changing tool selection authority', () => {
    expect(coreEntry).toContain('installOpenAiRequestCompatibility()')
    expect(compatibility).toContain("if (key === 'uniqueItems') continue")
    expect(compatibility).toContain("candidate.type !== 'function'")
    expect(compatibility).toContain('parameters: sanitizeOpenAiFunctionSchema(candidate.parameters)')
  })

  it('allows Luna to persist as the durable conversation model', () => {
    expect(migration).toContain('assistant_conversations_model_check')
    expect(migration).toContain("'gpt-5.6-luna'::text")
  })

  it('keeps provider quota messages provider-correct', () => {
    const geminiGuard = core.indexOf('resource_exhausted|quota exceeded|gemini.*quota')
    const openAiGuard = core.indexOf('no credits remaining|insufficient_quota|openai.*')
    expect(geminiGuard).toBeGreaterThan(0)
    expect(openAiGuard).toBeGreaterThan(geminiGuard)
    expect(core).not.toContain('/no credits remaining|insufficient_quota|billing/i')
  })
})
