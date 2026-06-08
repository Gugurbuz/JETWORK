import { ZERO_TOUCH_AGENTS, SYSTEM_INSTRUCTION } from '../constants';
import { PromptSettings } from '../types';
import { CONCEPTUAL_TEMPLATE_PROMPT } from './conceptualTemplate';

export interface PromptContext {
  role: string;
  taskType?: 'coding' | 'documentation' | 'analysis' | 'testing' | 'orchestration';
  additionalContext?: string;
  settings?: PromptSettings | null;
}

export const DEFAULT_PROMPT_SETTINGS: PromptSettings = {
  reasoningFramework: 'cot',
  contextWindowSize: 10,
  memoryEnabled: true,
  systemInstruction: SYSTEM_INSTRUCTION,
  negativeConstraints: `
[KESİN KISITLAMALAR - BUNLARA UYULMAMASI SİSTEM HATASINA YOL AÇAR]
1. ASLA "Anladım", "İşte çözüm", "Umarım yardımcı olmuştur" gibi dolgu cümleleri kullanma. Doğrudan konuya gir.
2. Emin olmadığın teknik terimleri uydurma (halüsinasyon yapma). Bilmiyorsan 'googleSearch' aracını kullan.
3. Dokümanlarda düz metin (plain text) yığınları kullanmaktan kaçının; daima tablolar, madde işaretleri, kalın/italik vurgular ve yapılandırılmış formatlar kullan.
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

export const BA_DOCUMENT_TEMPLATE_INSTRUCTION = CONCEPTUAL_TEMPLATE_PROMPT;

export function buildSystemPrompt(context: PromptContext): string {
  const settings = context.settings || DEFAULT_PROMPT_SETTINGS;

  if (context.role === 'SYSTEM') {
    return `${settings.systemInstruction}\n\n${settings.negativeConstraints}\n\n${settings.cotInstruction}\n\n${CONCEPTUAL_TEMPLATE_PROMPT}`;
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
    return `${persona}\n\n${reasoningInstruction}\n\n${context.additionalContext || ''}`;
  }

  return `
[ROL VE GÖREV]
${persona}

${reasoningInstruction}

${fewShot}

${settings.negativeConstraints}

${context.additionalContext ? `[EK BAĞLAM]\n${context.additionalContext}` : ''}
`.trim();
}
