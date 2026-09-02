import { describe, expect, it } from 'vitest'
import { verifyOfficeRevisionInvariant } from '../../../supabase/functions/_shared/artifact/officeRevisionVerifier.ts'

describe('office revision verifier v2', () => {
  it('accepts an exact DOCX replace with all non-target content unchanged', () => {
    const result = verifyOfficeRevisionInvariant({
      beforeInspection: {
        format: 'docx',
        text: 'Bölüm 1\nEski metin\nBölüm 3',
        headers: ['Enerjisa'],
        footers: ['Sayfa'],
      },
      afterInspection: {
        format: 'docx',
        text: 'Bölüm 1\nYeni metin\nBölüm 3',
        headers: ['Enerjisa'],
        footers: ['Sayfa'],
      },
      operation: 'replace_text',
      findText: 'Eski metin',
      replacementText: 'Yeni metin',
    })

    expect(result.verified).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('fails when replace_text changes an unrelated DOCX section', () => {
    const result = verifyOfficeRevisionInvariant({
      beforeInspection: {
        format: 'docx',
        text: 'Bölüm 1\nEski metin\nBölüm 3',
        headers: ['Enerjisa'],
        footers: [],
      },
      afterInspection: {
        format: 'docx',
        text: 'Bölüm 1 değişti\nYeni metin\nBölüm 3',
        headers: ['Enerjisa'],
        footers: [],
      },
      operation: 'replace_text',
      findText: 'Eski metin',
      replacementText: 'Yeni metin',
    })

    expect(result.verified).toBe(false)
    expect(result.failures).toContain('unexpected_non_target_change')
  })

  it('verifies DOCX append without allowing header/footer mutation', () => {
    const passing = verifyOfficeRevisionInvariant({
      beforeInspection: { format: 'docx', text: 'A', headers: ['H'], footers: ['F'] },
      afterInspection: { format: 'docx', text: 'A\nB', headers: ['H'], footers: ['F'] },
      operation: 'append_text',
      replacementText: 'B',
    })
    expect(passing.verified).toBe(true)

    const failing = verifyOfficeRevisionInvariant({
      beforeInspection: { format: 'docx', text: 'A', headers: ['H'], footers: ['F'] },
      afterInspection: { format: 'docx', text: 'A\nB', headers: ['changed'], footers: ['F'] },
      operation: 'append_text',
      replacementText: 'B',
    })
    expect(failing.verified).toBe(false)
  })
})
