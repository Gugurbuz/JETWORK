import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const primaryAliasSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2-primary/index.ts', import.meta.url),
  'utf8',
)
const assistantProxySource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-auto-proxy/index.ts', import.meta.url),
  'utf8',
)
const fallbackProviderSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersAutoRouteFallback.ts', import.meta.url),
  'utf8',
)

describe('Auto-routed Gemini Pro transient recovery', () => {
  it('keeps the production primary bridge alias static and free of runtime fetch monkeypatches', () => {
    expect(primaryAliasSource).toContain('openai-assistant-v2-primary-bridge-evidence/index.ts')
    expect(primaryAliasSource).not.toContain('globalThis.fetch =')
    expect(primaryAliasSource).not.toContain('await import(')
  })

  it('signs Auto routing provenance only when the bridge marks the request as auto-routed', () => {
    expect(assistantProxySource).toContain('payload.autoRouted !== true')
    expect(assistantProxySource).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(assistantProxySource).toContain('jetwork-auto-route-v${AUTO_ROUTE_MARKER_VERSION}')
    expect(assistantProxySource).toContain('JETWORK_AUTO_ROUTE_ORIGIN')
    expect(assistantProxySource).toContain("const CORE_SLUG = 'openai-assistant-legacy-core-autofallback'")
  })

  it('removes the reserved provenance marker before provider execution', () => {
    expect(fallbackProviderSource).toContain('stripReservedMarkers(input.items)')
    expect(fallbackProviderSource).toContain(".replace(AUTO_ROUTE_MARKER, '')")
  })

  it('keeps explicit Pro locked while allowing signed Auto-routed Pro to recover to Flash', () => {
    expect(fallbackProviderSource).toContain('!autoRouted || input.model !== PRO_MODEL')
    expect(fallbackProviderSource).toContain('isTransientProviderFailure(error)')
    expect(fallbackProviderSource).toContain('callBuffered(FLASH_MODEL)')
    expect(fallbackProviderSource).toContain('auto_routed_gemini_pro_fallback_flash: 1')
  })

  it('does not retry after the parent run has been aborted', () => {
    expect(fallbackProviderSource).toContain('input.signal?.aborted || !isTransientProviderFailure(error)')
  })
})
