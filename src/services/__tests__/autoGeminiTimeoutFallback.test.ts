import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const primaryAliasSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2-primary/index.ts', import.meta.url),
  'utf8',
)
const fallbackProviderSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersAutoRouteFallback.ts', import.meta.url),
  'utf8',
)

describe('Auto-routed Gemini Pro transient recovery', () => {
  it('signs Auto routing provenance only after the primary bridge has marked the request as auto-routed', () => {
    expect(primaryAliasSource).toContain('payload.autoRouted !== true')
    expect(primaryAliasSource).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(primaryAliasSource).toContain('jetwork-auto-route-v${AUTO_ROUTE_MARKER_VERSION}')
    expect(primaryAliasSource).toContain('JETWORK_AUTO_ROUTE_ORIGIN')
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
