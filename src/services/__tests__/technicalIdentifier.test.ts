import { describe, expect, it } from 'vitest'
import { extractExactTechnicalIdentifiers, hasExactTechnicalIdentifier } from '../../../supabase/functions/_shared/technicalIdentifier.ts'

describe('technical identifier detector', () => {
  it('keeps real structured enterprise identifiers', () => {
    expect(hasExactTechnicalIdentifier('ZCRM_COST_REPORT')).toBe(true)
    expect(hasExactTechnicalIdentifier('ZTAB0000RY')).toBe(true)
    expect(hasExactTechnicalIdentifier('CHECK_FATURADAR')).toBe(true)
    expect(extractExactTechnicalIdentifiers('ZCRM_NINJA_LOG_I ve ZCRM_NINJA_LOG_O')).toEqual(['ZCRM_NINJA_LOG_I', 'ZCRM_NINJA_LOG_O'])
  })

  it('does not promote ordinary Turkish z-words into technical identifiers', () => {
    expect(hasExactTechnicalIdentifier('bu zamanda işlem devam eder')).toBe(false)
    expect(hasExactTechnicalIdentifier('zamanında düzenlenmesi gerekir')).toBe(false)
    expect(hasExactTechnicalIdentifier('süreç üzerinden ilerler')).toBe(false)
  })

  it('preserves deliberately uppercase plain Z identifiers', () => {
    expect(hasExactTechnicalIdentifier('ZCRM')).toBe(true)
    expect(hasExactTechnicalIdentifier('zamanda')).toBe(false)
  })
})
