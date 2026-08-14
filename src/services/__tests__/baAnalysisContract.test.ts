import { describe, expect, it } from 'vitest'
import {
  BA_ANALYSIS_CONTRACT,
  BA_ANALYSIS_CONTRACT_MARKER,
  baAnalysisInstructionForPlan,
} from '../../../supabase/functions/_shared/baAnalysisContract'

describe('JetWork BA analysis contract', () => {
  it('activates only for analysis intent', () => {
    expect(baAnalysisInstructionForPlan({ intent: 'analysis' })).toContain(BA_ANALYSIS_CONTRACT_MARKER)
    expect(baAnalysisInstructionForPlan({ intent: 'sap_diagnosis' })).toBe('')
    expect(baAnalysisInstructionForPlan({ intent: 'document' })).toBe('')
  })

  it('requires analysis beyond requirement restatement', () => {
    expect(BA_ANALYSIS_CONTRACT).toMatch(/yalnız özetleme yapma/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/maddeler arasındaki ilişki/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/çeliştiği|istisna/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/Açık Kararlar/i)
  })

  it('covers the B2B portal regression dimensions without inventing implementation facts', () => {
    expect(BA_ANALYSIS_CONTRACT).toMatch(/read\/görüntüleme/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/update\/kayıt/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/backend.*enforcement/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/all-or-nothing.*partial success/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/dönmemeli.*disabled\/pasif/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/endpoint, class, method, tablo, alan/i)
  })
})
