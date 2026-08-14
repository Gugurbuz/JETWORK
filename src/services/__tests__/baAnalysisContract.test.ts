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
    expect(BA_ANALYSIS_CONTRACT).toMatch(/istisna/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/Açık Kararlar/i)
  })

  it('keeps source facts, inference, design options and open decisions distinct', () => {
    expect(BA_ANALYSIS_CONTRACT).toMatch(/Kaynakta Kesin/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/Analitik Çıkarım/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/Tasarım Seçeneği/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/Açık Karar/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/çıkarımı kaynakta yazılı gereksinim gibi sunma/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/teknik implementasyonu zorunlu gerçek gibi yazma/i)
  })

  it('forbids invented exact technical names when evidence did not provide them', () => {
    expect(BA_ANALYSIS_CONTRACT).toMatch(/Exact teknik isim guardı/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/yeni exact isim icat etme/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/Örnek vermek için bile hayali identifier üretme/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/jenerik kavramsal ifade/i)
  })

  it('keeps inference and design language modal instead of asserting requirements', () => {
    expect(BA_ANALYSIS_CONTRACT).toMatch(/Kesinlik dili guardı/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/Analitik Çıkarım veya Tasarım Seçeneği/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/gerekmektedir.*olacaktır.*zorunludur/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/değerlendirilmelidir.*gerekebilir.*önerilebilir/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/yalnız kullanıcı\/doğrulanmış kaynak açıkça/i)
  })

  it('covers generic functional-analysis boundaries without prescribing implementation', () => {
    expect(BA_ANALYSIS_CONTRACT).toMatch(/read\/görüntüleme/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/update\/kayıt/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/veri sahibi/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/backend.*enforcement/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/all-or-nothing.*partial success/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/transaction sınır/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/mevcut kontratın genişletilmesi.*yeni servis\/endpoint/i)
    expect(BA_ANALYSIS_CONTRACT).toMatch(/endpoint, class, method, tablo, alan/i)
  })

  it('does not encode example-specific business vocabulary in the production contract', () => {
    expect(BA_ANALYSIS_CONTRACT).not.toMatch(/TEİ|Ayesaş|Başkent|Toroslar|KOHM|1294|B2B Portal/i)
  })
})
