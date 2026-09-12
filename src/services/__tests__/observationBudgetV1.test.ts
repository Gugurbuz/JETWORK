import { describe, expect, it } from 'vitest'
import {
  compactObservation,
  OBSERVATION_PREVIEW_MAX_CHARS,
  readObservationContent,
} from '../../../supabase/functions/_shared/agent/observationBudget.ts'

describe('bounded addressable observation transport', () => {
  it('keeps small observations lossless', () => {
    const raw = JSON.stringify({ citationReady: true, records: [{ canonicalKey: 'message:zcrm_cost-111', title: 'Test' }] })
    const compact = compactObservation(raw, 'obs:1')
    expect(compact.truncated).toBe(false)
    expect(compact.fullCharacters).toBe(raw.length)
    expect(compact.preview).toEqual(JSON.parse(raw))
  })

  it('bounds large exact-source observations while preserving a server-side reference', () => {
    const raw = JSON.stringify({
      securityNotice: 'VERIFIED_KNOWLEDGE_EVIDENCE',
      tool: 'get_abap_source',
      citationReady: true,
      records: [{
        canonicalKey: 'method:z/test',
        verifiedSignals: { abapMessageCodes: ['ZCRM_COST-111'] },
        content: 'METHOD test.\n' + 'WRITE: / value.\n'.repeat(4_000),
      }],
    })
    const compact = compactObservation(raw, 'obs:large')
    expect(compact.truncated).toBe(true)
    expect(compact.observationRef).toBe('obs:large')
    expect(compact.previewCharacters).toBeLessThanOrEqual(OBSERVATION_PREVIEW_MAX_CHARS)
    expect(JSON.stringify(compact.preview)).toContain('method:z/test')
    expect(JSON.stringify(compact.preview)).toContain('ZCRM_COST-111')
  })

  it('supports model-authored literal find without semantic runtime selection', () => {
    const output = 'HEADER\n' + 'a'.repeat(20_000) + '\nMESSAGE e111(zcrm_cost).\n' + 'b'.repeat(20_000)
    const found = readObservationContent({
      output,
      mode: 'find',
      query: 'MESSAGE e111(zcrm_cost)',
      maxChars: 4_000,
    })
    expect(found.ok).toBe(true)
    expect('found' in found && found.found).toBe(true)
    expect('text' in found ? found.text : '').toContain('MESSAGE e111(zcrm_cost)')
    expect('text' in found ? found.text.length : 0).toBeLessThanOrEqual(4_000)
  })

  it('supports bounded offset slices', () => {
    const output = '0123456789'.repeat(2_000)
    const slice = readObservationContent({ output, mode: 'slice', offset: 5_000, maxChars: 2_000 })
    expect(slice.ok).toBe(true)
    expect('returnedOffset' in slice ? slice.returnedOffset : null).toBe(5_000)
    expect('text' in slice ? slice.text.length : 0).toBe(2_000)
  })
})
