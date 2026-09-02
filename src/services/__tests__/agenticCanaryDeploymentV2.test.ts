import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const canaryEntry = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/canary.ts', import.meta.url),
  'utf8',
)
const bootstrap = readFileSync(
  new URL('../../../supabase/functions/_shared/runtime/agenticCanaryBootstrap.ts', import.meta.url),
  'utf8',
)
const runtimeFlags = readFileSync(
  new URL('../../../supabase/functions/_shared/runtime/runtimeFlags.ts', import.meta.url),
  'utf8',
)
const executableBootstrap = bootstrap
  .split(/\r?\n/u)
  .filter(line => !line.trimStart().startsWith('//'))
  .join('\n')

describe('Agentic Runtime V2 canary deployment boot', () => {
  it('uses static imports so hosted Edge Runtime does not require remote dynamic import', () => {
    const bootstrapImport = "import '../_shared/runtime/agenticCanaryBootstrap.ts'"
    const implementationImport = "import './implementation.ts'"
    expect(canaryEntry).toContain(bootstrapImport)
    expect(canaryEntry).toContain(implementationImport)
    expect(canaryEntry).not.toContain('await import(')
    expect(canaryEntry.indexOf(bootstrapImport)).toBeLessThan(canaryEntry.indexOf(implementationImport))
  })

  it('authorizes from deployment identity and overlays only the legacy env read', () => {
    expect(bootstrap).toContain('if (!isAgentControllerV2Enabled())')
    expect(bootstrap).toContain('const originalEnvGet = Deno.env.get.bind(Deno.env)')
    expect(bootstrap).toContain('Deno.env.get =')
    expect(bootstrap).toContain("key === 'ASSISTANT_AGENTIC_CONTROLLER' ? 'true' : originalEnvGet(key)")
    expect(executableBootstrap).not.toContain('Deno.env.set(')
    expect(executableBootstrap).not.toContain('req.headers')
    expect(executableBootstrap).not.toContain('request.body')
    expect(runtimeFlags).toContain('DENO_DEPLOYMENT_ID')
    expect(runtimeFlags).toContain('8889f9e7-b72b-4549-b793-0045311043d6')
    expect(runtimeFlags).toContain('7806a5b9-17a7-4cae-a15e-c3e2d6ec8eac')
  })
})
