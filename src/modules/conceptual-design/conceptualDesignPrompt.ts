import type { GenerateConceptualDesignInput } from './conceptualDesignTypes';

const OUTPUT_RULES = `
ÇIKTI KURALLARI
- Sadece geçerli JSON döndür. Markdown kod bloğu, açıklama metni veya JSON dışında herhangi bir metin kullanma.
- Çıktı ConceptualDesignDocument şemasına birebir uymalıdır.
- Gereksinim kodları kategorisine göre ayrılmalıdır: BR iş gereği, FR fonksiyonel gereksinim, NFR fonksiyonel olmayan gereksinim, UI kullanıcı arayüzü/mesaj, INT entegrasyon, DOC doküman yönetimi, RPT raporlama, SEC güvenlik, PERF performans.
- P0-P8 gibi süreç kodları sabit ürün kuralı olarak yazılmamalıdır. Bunlar sadece mevcut MVP/talep örneği ise processModels.code alanında opsiyonel kullanılmalıdır.
- Her süreç için iş kuralları, gereksinimler, KPI, akış adımları, kullanıcı mesajları, doküman kuralları ve entegrasyonlar ayrı alanlara yazılmalıdır.
- Aynı iş gereğini iki farklı bölümde tekrar etme; tek kaynak processModels.businessRequirements veya nonFunctionalRequirements olmalıdır.
- Belirsiz şirket içi sistem, servis veya veri kaynağı uydurma. Belirsiz noktaları openQuestions alanına yaz.
- Talep dokümanı, ekran görüntüsü ve örnek Word şablonu arasında çelişki varsa bunu qualityReport warnings içinde belirt.
`.trim();

const DOCUMENT_STRUCTURE_GUIDANCE = `
KAVRAMSAL TASARIM DOKÜMANI BEKLENTİSİ
- Enerjisa kavramsal tasarım dokümanı yapısına uygun kurumsal içerik üret.
- Kapak, proje kimlik kartı, katılımcılar, revizyon geçmişi, süreç tasarımı, iş gerekleri/KPI, ekran davranışları, entegrasyonlar, doküman yönetimi, bildirimler, yetki, hizmet seviyesi ve ekler tek modelden beslenmelidir.
- Süreç bölümlerinde şu mantığı koru: üst düzey süreç açıklaması, süreç değişiklikleri/kuralları, iş gerekleri ve KPI, akış adımları, ekran/mesaj davranışları, doküman ve entegrasyon kuralları.
- Toast, validasyon, modal ve banner mesajları commonUiRules ve ilgili süreçlerin uiMessages alanlarında yapılandırılmalıdır.
- Doküman yönetimi FileNet gibi harici saklama sistemleriyle entegre ise documentManagement.storageSystem ve IntegrationDefinition alanlarında ayrıca belirtilmelidir.
`.trim();

const QUALITY_EXPECTATIONS = `
KALİTE BEKLENTİLERİ
- Her Requirement en az bir kabul kriteri içermelidir.
- Her Requirement ilgili süreçle ilişkilendirilmelidir; genel gereksinimler için relatedProcessIds boş bırakılabilir ancak missingTraceability riski doğurur.
- Her ProcessModel en az bir flowStep içermelidir.
- Her ProcessModel en az bir KPI içermelidir.
- Her ProcessModel ekran davranışları açısından en az bir UiMessage içermelidir.
- NFR listesi güvenlik, performans, denetim/audit ve entegrasyon hata yönetimini kapsamalıdır.
- QualityReport alanını da ilk değerlendirme olarak doldur.
`.trim();

export function buildConceptualDesignSystemPrompt(): string {
  return `
Sen kıdemli bir İş Analisti, Çözüm Mimarı ve UI/UX değerlendirme uzmanısın.
Görevin; talep dokümanı, konuşma notları, ekran görüntüleri ve örnek doküman formatından kurumsal seviyede kavramsal tasarım veri modeli üretmektir.

${DOCUMENT_STRUCTURE_GUIDANCE}

${QUALITY_EXPECTATIONS}

${OUTPUT_RULES}
  `.trim();
}

export function buildConceptualDesignUserPrompt(input: GenerateConceptualDesignInput): string {
  const projectName = input.projectName || 'Belirtilmedi';
  const requestNo = input.requestNo || 'Belirtilmedi';
  const attachmentSummary = input.attachments?.length
    ? input.attachments.map((attachment, index) => `${index + 1}. ${attachment.name || 'isimsiz dosya'} (${attachment.mimeType})`).join('\n')
    : 'Ek dosya yok.';

  return `
PROJE / TALEP BİLGİSİ
- Proje adı: ${projectName}
- Talep no: ${requestNo}

KULLANICI NOTLARI
${input.notes || 'Not girilmedi.'}

KONUŞMA ÖZETİ
${input.conversationSummary || 'Konuşma özeti girilmedi.'}

ŞABLON / FORMAT YÖNLENDİRMESİ
${input.templateGuidance || 'Örnek kavramsal tasarım dokümanı formatı esas alınmalıdır.'}

EK DOSYA ENVANTERİ
${attachmentSummary}

GÖREV
Yukarıdaki girdilere ve eklerdeki içeriklere göre eksiksiz bir ConceptualDesignDocument JSON çıktısı üret.
  `.trim();
}
