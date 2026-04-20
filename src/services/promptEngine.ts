import { SYSTEM_AGENTS, SYSTEM_INSTRUCTION } from '../constants';
import { PromptSettings } from '../types';

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
3. ÇIKTI FORMATI: Doküman oluştururken KESİNLİKLE Markdown (##, **, \`\`\`) KULLANMA. Sadece geçerli, saf Semantik HTML kullan. İçeriğin başına veya sonuna asla \`\`\`html ekleme.
4. KESİNLİKLE JSON formatında düz metin yanıt dönme. Senin görevin düşünmek ve sana verilen ARAÇLARI (TOOLS) çağırmaktır.
5. Karar verici değil, yardımcı (Copilot) ol. Kritik teknik veya iş kararlarında (mimari, veritabanı, akış vb.) varsayım yapmak yerine kullanıcıya seçenekler sun ve fikrini sor. Belirsizlik durumunda DAİMA 'ask_clarification_questions' aracını kullanarak netleştirme yap.
`.trim(),
  cotInstruction: `
[AKIL YÜRÜTME SÜRECİ (Chain of Thought) - ZORUNLU]
Yanıtını oluşturmadan veya dokümanı güncellemeden önce kendi içinde adım adım düşün:
1. Problemi Anlama: Kullanıcının talebi nedir? Eksik iş kuralı, NFR veya finansal/muhasebesel detay var mı?
2. Eksik Bilgi Kontrolü: Enerjisa ekosistemine veya talebe dair bilmediğim bir şey var mı? Varsa 'googleSearch' kullan veya kullanıcıya 'ask_clarification_questions' aracıyla soru sor.
3. Onay Bekleme: Kullanıcı eksikleri tamamlamadan veya onay vermeden asla dokümanı yazmaya başlama.
4. Aksiyon: Kullanıcı tüm detayları verdiğinde 'update_document_section' aracını çağırarak SAF HTML formatında dokümanı oluştur.
`.trim(),
  totInstruction: `
[İLERİ DÜZEY AKIL YÜRÜTME (Tree of Thoughts) - ZORUNLU]
Yanıtını oluşturmadan önce çoklu olasılıkları değerlendir:
1. Fikir Üretimi: Bu problemi çözmek için en az 3 farklı yaklaşım düşün.
2. Değerlendirme: Her bir yaklaşımın artılarını ve eksilerini analiz et.
3. Seçim: En mantıklı, en güvenli yaklaşımı seç.
4. Aksiyon: Seçtiğin yaklaşımı uygulamak için gerekli araçları (tools) çağır.
`.trim(),
  fewShotLibrary: {
    BA: `
[KUSURSUZ ÇIKTI FORMATI - TİPTAP İÇİN SAF HTML]
İş Analizi dokümanını 'update_document_section' aracını kullanarak KESİNLİKLE Semantik HTML formatında üretmelisin. 
Markdown KULLANMA. Tablolar için mutlaka <table border="1" style="border-collapse: collapse; width: 100%;">, <thead>, <tbody>, <tr>, <th>, <td> kullan.

Örnek Beklenen Yapı:
<h1>İş Analizi Dokümanı</h1>
<h2>1. ANALİZ KAPSAMI</h2>
<p>Bu talep hangi ihtiyacı çözüyor? Etkilenen ana modüller (CRM, BILL, FICA vb.) nelerdir?</p>

<h2>2. KISALTMALAR</h2>
<table border="1" style="border-collapse: collapse; width: 100%;">
  <thead><tr><th>Kısaltma</th><th>Açıklama</th></tr></thead>
  <tbody><tr><td>CRM</td><td>Müşteri İlişkileri Yönetimi</td></tr></tbody>
</table>

<h2>3. İŞ GEREKSİNİMLERİ</h2>
<h3>3.1. İş Kuralları</h3>
<ul>
  <li>Kural 1...</li>
  <li>Kural 2...</li>
</ul>

<h2>4. FONKSİYONEL GEREKSİNİMLER (FR)</h2>
<h3>4.1. Fonksiyonel Gereksinim Maddeleri (CRM vb.)</h3>
<p>Kullanıcı arayüzü, ürün konfigürasyonları vb.</p>

<h2>5. FONKSİYONEL OLMAYAN GEREKSİNİMLER (NFR)</h2>
<p>Güvenlik, yetkilendirme, performans gereksinimleri...</p>

<h2>6. SÜREÇ RİSK ANALİZİ</h2>
<p>Kısıtlar, varsayımlar ve bağlılıklar...</p>

<h2>7. ONAY</h2>
<table border="1" style="border-collapse: collapse; width: 100%;">
  <thead><tr><th>Analiz Tamamlanma Tarihi</th><th>Hazırlayan</th><th>Kontrol Tarihi</th><th>Kontrol Eden</th></tr></thead>
  <tbody><tr><td>-</td><td>-</td><td>-</td><td>-</td></tr></tbody>
</table>
`.trim(),
    IT: `
[ÖRNEK ÇIKTI FORMATI - TEKNİK MİMARİ]
Lütfen çıktıyı Semantik HTML olarak üret. Markdown kullanma.
<h1>Sistem Mimarisi</h1>
<ul>
  <li><strong>Frontend:</strong> React, TailwindCSS, Vite</li>
  <li><strong>Backend:</strong> Node.js, Express</li>
</ul>
`.trim(),
    QA: `
[ÖRNEK ÇIKTI FORMATI - TEST SENARYOLARI]
Lütfen çıktıyı Semantik HTML olarak üret. Markdown kullanma.
<h2>Test Senaryosu: TC-001 - Başarılı Kullanıcı Girişi</h2>
<ul>
  <li><strong>Önkoşul:</strong> Kullanıcı veritabanında kayıtlı olmalı.</li>
  <li><strong>Beklenen Sonuç:</strong> Dashboard'a yönlendirilir.</li>
</ul>
`.trim()
  },
  rolePersonas: Object.fromEntries(
    SYSTEM_AGENTS.map(agent => [agent.role, agent.instruction])
  )
};

export function buildSystemPrompt(context: PromptContext): string {
  const settings = context.settings || DEFAULT_PROMPT_SETTINGS;

  if (context.role === 'SYSTEM') {
    return `${settings.systemInstruction}\n\n${settings.negativeConstraints}\n\n${settings.cotInstruction}`;
  }

  const persona = settings.rolePersonas[context.role] || settings.rolePersonas['BA'] || '';
  const fewShot = settings.fewShotLibrary[context.role] || '';
  
  let reasoningInstruction = '';
  if (settings.reasoningFramework === 'cot') {
    reasoningInstruction = settings.cotInstruction;
  } else if (settings.reasoningFramework === 'tot') {
    reasoningInstruction = settings.totInstruction;
  }
  
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