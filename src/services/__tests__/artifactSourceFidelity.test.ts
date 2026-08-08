import { describe, expect, it } from 'vitest';
import {
  enforceArtifactSourceFidelity,
  extractExplicitProcessSteps,
} from '../../../supabase/functions/_shared/artifactSourceFidelity';

const source = [
  'Problem: Abonelik iptal ve iade talepleri farkli kanallarda izlenemiyor.',
  'Surec 1 - Iptal talebinin alinmasi',
  'Surec 2 - Uygunluk kontrolu ve onay',
  'Surec 3 - Iade sonucu ve kapanis',
  'Roller: Musteri temsilcisi, operasyon uzmani, onayci.',
  'KPI: Tamamlanma suresi olculecek; hedef deger acik konu.',
].join('\n');

const generated = `# İHTİYAÇ ANALİZİ
## 1. ANALİZ KAPSAMI
| Başlık | Açıklama |
| --- | --- |
| Sistem | SAP CRM / IS-U [VARSAYIM] |
## 2. KISALTMALAR
| CRM | Customer Relationship Management |
## 3. İŞ GEREKSİNİMLERİ
### 3.1. İş Kuralları
- Kural
### 3.2. İş Modeli ve Kullanıcı Gereksinimleri
- Model
## 4. FONKSİYONEL GEREKSİNİMLER (FR)
### 4.1. Fonksiyonel Gereksinim Maddeleri
- FR-1
### 4.2. Süreç Akışı
1. Talep Girişi
2. Kontrol
3. Kapanış
## 5. FONKSİYONEL OLMAYAN GEREKSİNİMLER (NFR)
### 5.1. Güvenlik ve Yetkilendirme Gereksinimleri
- Yetki
### 5.2. Performans Gereksinimleri
- Liste 2 saniyenin altında açılmalıdır.
### 5.3. Raporlama Gereksinimleri
- KPI
## 6. SÜREÇ RİSK ANALİZİ
### 6.1. Kısıtlar ve Varsayımlar
- [VARSAYIM]
### 6.2. Bağımlılıklar
IS-U entegrasyonu gerekir.
### 6.3. Süreç Etkileri
- Etki
## 7. ONAY
## 8. FONKSİYONEL TASARIM DOKÜMANLARI`;

describe('artifact source fidelity guard', () => {
  it('extracts explicit user-defined process names without paraphrasing them', () => {
    expect(extractExplicitProcessSteps(source)).toEqual([
      'Iptal talebinin alinmasi',
      'Uygunluk kontrolu ve onay',
      'Iade sonucu ve kapanis',
    ]);
  });

  it('restores missing process names and removes unsupported enterprise context', () => {
    const result = enforceArtifactSourceFidelity(generated, source);

    expect(result.markdown).toContain('Iptal talebinin alinmasi');
    expect(result.markdown).toContain('Uygunluk kontrolu ve onay');
    expect(result.markdown).toContain('Iade sonucu ve kapanis');
    expect(result.markdown).not.toMatch(/\bSAP\b|\bCRM\b|IS-U/i);
    expect(result.markdown).not.toContain('2 saniye');
    expect(result.injectedProcessSteps).toHaveLength(3);
    expect(result.removedUnsupportedTechnicalLines).toBeGreaterThan(0);
    expect(result.replacedUnsupportedCommitments).toBeGreaterThan(0);
  });

  it('does not apply strict source-only technical cleanup to requests without an explicit process contract', () => {
    const result = enforceArtifactSourceFidelity(
      generated,
      'SAP CRM ile IS-U entegrasyonunu teknik olarak analiz eden doküman hazırla.',
    );
    expect(result.markdown).toContain('SAP CRM / IS-U');
    expect(result.processSteps).toEqual([]);
  });
});
