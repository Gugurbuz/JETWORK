import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersEvidenceTerminal.ts', import.meta.url),
  'utf8',
)

describe('metadata-only evidence terminal', () => {
  it('terminates from the evidence contract rather than request keywords', () => {
    expect(source).toContain("payload.evidenceBoundary !== 'metadata_only'")
    expect(source).not.toContain('SELECT')
    expect(source).not.toContain('Z_FICA_TKS_CHECK')
  })

  it('avoids another provider call when implementation evidence is unavailable', () => {
    expect(source).toContain('deterministic_provider_calls_avoided: 1')
    expect(source).toContain('evidence_boundary_metadata_only_terminal: 1')
    expect(source).toContain('if (payloads.length && input.allowTools)')
  })

  it('preserves the existing provider/evidence chain for all other turns', () => {
    expect(source).toContain('return upstreamRequest(input)')
    expect(source).toContain('modelProvidersMaxItemsLock.ts')
  })

  it('does not invent implementation details in its terminal answer', () => {
    expect(source).toContain('Kaynakta olmayan tablo, alan, kod, koşul veya algoritma ayrıntısı üretmeyeceğim.')
  })
})
