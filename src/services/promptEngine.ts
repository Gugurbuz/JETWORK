import { ZERO_TOUCH_AGENTS, SYSTEM_INSTRUCTION } from '../constants';
import { PromptSettings } from '../types';

export interface PromptContext {
  role: string;
  taskType?: 'coding' | 'documentation' | 'analysis' | 'testing' | 'orchestration';
  additionalContext?: string;
  settings?: PromptSettings | null;
}

const VISIBLE_DOCUMENT_SURFACE_RULE = `
[GORUNUR DOKUMAN YUZEYI - GUNCEL KURAL]
- Sag panelde gorunur ve guncellenecek ana sekmeler yalnizca businessAnalysis (BA Analiz) ve review alanlaridir.
- IT Analiz, Test, FLOW, BPMN, teknik mimari, veri modeli, UAT ve akis detaylari ayri code/test/bpmn sekmelerine yazilmaz; gerekiyorsa businessAnalysis icinde alt baslik olarak yazilir.
- Review yalnizca kalite, risk, kaynak/dogrulama, varsayim, acik konu ve hizli aksiyon notlarini tasir.
- Eski talimatlarda IT Analiz/Test/FLOW/BPMN alanlarini ayri doldur deniyorsa bu guncel kural gecerlidir.
`.trim();

export const DEFAULT_PROMPT_SETTINGS: PromptSettings = {
  reasoningFramework: 'cot',
  contextWindowSize: 10,
  memoryEnabled: true,
  systemInstruction: SYSTEM_INSTRUCTION,
  negativeConstraints: `
[KESİN KISITLAMALAR - BUNLARA UYULMAMASI SİSTEM HATASINA YOL AÇAR]
1. ASLA "Anladım", "İşte çözüm", "Umarım yardımcı olmuştur" gibi dolgu cümleleri kullanma. Doğrudan konuya gir.
2. Emin olmadığın teknik terimleri uydurma (halüsinasyon yapma). Bilmiyorsan 'googleSearch' aracını kullan.
3. Dokümanlarda düz metin (plain text) yığınları kullanmaktan kaçın; daima tablolar, madde işaretleri, kalın/italik vurgular ve yapılandırılmış formatlar kullan.
4. KESİNLİKLE JSON formatında düz metin yanıt dönme (AjanRolü, message gibi key'ler içeren JSON objeleri oluşturma). Senin görevin düşünmek ve sana verilen ARAÇLARI (TOOLS) çağırmaktır.
5. Karar verici değil, yardımcı (Copilot) ol. Kritik teknik veya iş kararlarında (mimari, veritabanı, akış vb.) varsayım yapmak yerine kullanıcıya seçenekler sun ve fikrini sor. Belirsizlik durumunda 'questions' aracını kullanarak netleştirme yap.
`.trim(),
  cotInstruction: `
[AKIL YÜRÜTME SÜRECİ (Chain of Thought) - ZORUNLU]
Yanıtını oluşturmadan önce veya araçları çağırmadan önce kendi içinde adım adım düşün:
1. Problemi Anlama: Kullanıcının asıl çözmek istediği problem nedir?
2. Bağlam Analizi: Mevcut doküman durumu ve proje gereksinimleri nelerdir?
3. Strateji Belirleme: Hangi adımları izlemeliyim? Hangi araçları (tools) kullanmalıyım?
4. Eksik Bilgi Kontrolü: Bilmediğim bir şey var mı? Varsa 'googleSearch' ile araştır.
5. Aksiyon: Karar verdiğin stratejiyi uygula (örneğin 'apply_micro_edit' aracını çağır).
`.trim(),
  totInstruction: `
[İLERİ DÜZEY AKIL YÜRÜTME (Tree of Thoughts) - ZORUNLU]
Yanıtını oluşturmadan önce çoklu olasılıkları değerlendir:
1. Fikir Üretimi (Brainstorming): Bu problemi çözmek için en az 3 farklı yaklaşım düşün.
2. Değerlendirme (Evaluation): Her bir yaklaşımın artılarını, eksilerini ve risklerini (halüsinasyon riski dahil) analiz et.
3. Seçim (Selection): En mantıklı, en güvenli ve en doğru yaklaşımı seç. Neden bu yaklaşımı seçtiğini kısaca açıkla.
4. Aksiyon (Execution): Seçtiğin yaklaşımı uygulamak için gerekli araçları (tools) çağır.
`.trim(),
  fewShotLibrary: {
    BA: `
[ÖRNEK ÇIKTI FORMATI - İŞ ANALİZİ]
**Kullanıcı Hikayesi (User Story):**
- **Başlık:** Kullanıcı Girişi
- **Açıklama:** Bir kullanıcı olarak, sisteme e-posta ve şifremle giriş yapabilmek istiyorum, böylece kişisel verilerime erişebilirim.
- **Kabul Kriterleri:**
  1. Başarılı girişte dashboard'a yönlendirmeli.
  2. Hatalı girişte "Geçersiz kimlik bilgileri" hatası vermeli.
`.trim(),
    IT: `
[ÖRNEK ÇIKTI FORMATI - TEKNİK MİMARİ]
**Sistem Mimarisi:**
- **Frontend:** React, TailwindCSS, Vite
- **Backend:** Node.js, Express
- **Veritabanı:** PostgreSQL
- **Entegrasyonlar:** Stripe API (Ödeme), SendGrid (E-posta)
**Veritabanı Şeması (Örnek):**
\`\`\`sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
\`\`\`
`.trim(),
    QA: `
[ÖRNEK ÇIKTI FORMATI - TEST SENARYOLARI]
**Test Senaryosu: TC-001 - Başarılı Kullanıcı Girişi**
- **Önkoşul:** Kullanıcı veritabanında kayıtlı olmalı.
- **Adımlar:**
  1. Giriş sayfasına git.
  2. Geçerli e-posta ve şifre gir.
  3. "Giriş Yap" butonuna tıkla.
- **Beklenen Sonuç:** Kullanıcı dashboard'a yönlendirilir ve hoşgeldin mesajı görür.
`.trim()
  },
  rolePersonas: Object.fromEntries(
    ZERO_TOUCH_AGENTS.map(agent => [agent.role, agent.instruction])
  )
};

export const BA_DOCUMENT_TEMPLATE_INSTRUCTION = `
[İŞ ANALİZİ DOKÜMANI YAPISI - ZORUNLU ŞABLON]
Oluşturacağın "businessAnalysis" içeriği, kurumsal standartlara uygun bir İş Analizi Dokümanı olmalıdır.
Markdown formatında aşağıdaki YAPILANDIRILMIŞ şablona BİREBİR uymalıdır.

ÇIKTI YAPISI (Markdown):

<div class="doc-cover">
  <div class="doc-cover-title">İŞ ANALİZİ DOKÜMANI</div>
  <div class="doc-cover-subtitle">[Ürün / Proje Adı]</div>
  <table class="doc-cover-meta">
    <tr><td>Doküman Adı</td><td>[Ad]</td></tr>
    <tr><td>Versiyon</td><td>1.0</td></tr>
    <tr><td>Tarih</td><td>[YYYY-AA-GG]</td></tr>
    <tr><td>Hazırlayan</td><td>İş Analizi Ekibi</td></tr>
    <tr><td>Onaylayan</td><td>Product Owner</td></tr>
  </table>
</div>

<div class="doc-toc">
<h2>İçindekiler</h2>

1. Giriş
   1.1. Amaç
   1.2. Kapsam
   1.3. Tanımlar ve Kısaltmalar
   1.4. Referanslar
2. Mevcut Durum (As-Is)
3. Hedeflenen Durum (To-Be)
4. Paydaşlar
5. İş Gereksinimleri
   5.1. Fonksiyonel Gereksinimler
   5.2. Fonksiyonel Olmayan Gereksinimler
6. Kullanıcı Hikayeleri ve Kabul Kriterleri
7. Süreç Akışı
8. Veri Modeli
9. Riskler ve Varsayımlar
10. Açık Sorular
</div>

## 1. Giriş

### 1.1. Amaç
[Dokümanın amacı]

### 1.2. Kapsam
[Kapsam dahil/hariç maddeleri]

### 1.3. Tanımlar ve Kısaltmalar
| Terim | Açıklama |
|---|---|
| [Kısaltma] | [Açıklama] |

### 1.4. Referanslar
1. [Referans 1]
2. [Referans 2]

## 2. Mevcut Durum (As-Is)
[Detaylı mevcut durum analizi]

## 3. Hedeflenen Durum (To-Be)
[Hedef durum anlatımı]

## 4. Paydaşlar
| Paydaş | Rol | İlgi Alanı | Etki |
|---|---|---|---|
| [Ad] | [Rol] | [İlgi] | Yüksek/Orta/Düşük |

## 5. İş Gereksinimleri

### 5.1. Fonksiyonel Gereksinimler
| ID | Gereksinim | Öncelik |
|---|---|---|
| FR-01 | [Açıklama] | Yüksek |

### 5.2. Fonksiyonel Olmayan Gereksinimler
| ID | Gereksinim | Kriter |
|---|---|---|
| NFR-01 | Performans | <2sn yanıt |

## 6. Kullanıcı Hikayeleri ve Kabul Kriterleri

### 6.1. [Hikaye Başlığı]
**User Story:** Bir [rol] olarak, [ihtiyaç] istiyorum, böylece [fayda].

**Kabul Kriterleri:**
1. [Kriter 1]
2. [Kriter 2]

## 7. Süreç Akışı
[Adım adım süreç anlatımı; numaralı liste halinde]

## 8. Veri Modeli
| Varlık | Alan | Tip | Açıklama |
|---|---|---|---|

## 9. Riskler ve Varsayımlar
| ID | Tür | Açıklama | Etki | Olasılık |
|---|---|---|---|---|

## 10. Açık Sorular
1. [Soru 1]
2. [Soru 2]

KURALLAR:
- Başlıkları mutlaka numaralı kullan (1., 1.1., 1.1.1.).
- Boş bırakılan placeholder'ları konuşmadan çıkan gerçek bilgilerle doldur; yoksa "Henüz belirlenmedi" yaz.
- Her bölümde en az 2-3 cümle veya en az 3 satırlı bir tablo bulunmalı.
- Markdown tablolarını GitHub-Flavored Markdown (GFM) ile oluştur.
- Kapak ve içindekiler için VERİLEN <div> BLOKLARINI AYNEN KORU; sadece içeriklerini güncelle.
`.trim();

export function buildSystemPrompt(context: PromptContext): string {
  const settings = context.settings || DEFAULT_PROMPT_SETTINGS;

  if (context.role === 'SYSTEM') {
    return `${settings.systemInstruction}\n\n${VISIBLE_DOCUMENT_SURFACE_RULE}\n\n${settings.negativeConstraints}\n\n${settings.cotInstruction}`;
  }

  const persona = settings.rolePersonas[context.role] || settings.rolePersonas['BA'] || '';
  const fewShot = settings.fewShotLibrary[context.role] || '';
  
  let reasoningInstruction = '';
  if (settings.reasoningFramework === 'cot') {
    reasoningInstruction = settings.cotInstruction;
  } else if (settings.reasoningFramework === 'tot') {
    reasoningInstruction = settings.totInstruction;
  }
  
  // Orchestrator has a specific JSON output requirement, so we don't add the full strict constraints to it
  if (context.role === 'Orchestrator') {
    return `${persona}\n\n${VISIBLE_DOCUMENT_SURFACE_RULE}\n\n${reasoningInstruction}\n\n${context.additionalContext || ''}`;
  }

  return `
[ROL VE GÖREV]
${persona}

${VISIBLE_DOCUMENT_SURFACE_RULE}

${reasoningInstruction}

${fewShot}

${settings.negativeConstraints}

${context.additionalContext ? `[EK BAĞLAM]\n${context.additionalContext}` : ''}
`.trim();
}
