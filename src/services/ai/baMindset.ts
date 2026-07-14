import type { BehaviorDepth, BehaviorDomain, BehaviorMode } from './behaviorDecision';

export const BA_MINDSET_CHECKLIST = [
  'Problem / is ihtiyaci',
  'Is degeri / KPI',
  'Kapsam / kapsam disi',
  'Surec / tetikleyici / istisna',
  'Rol / paydas / RACI',
  'Sistem davranisi / ekran / veri',
  'Entegrasyon / dis sistem etkisi',
  'Kabul kriteri / UAT',
  'Risk / varsayim / acik konu',
] as const;

export interface BaMindsetContext {
  mode?: BehaviorMode | string;
  domain?: BehaviorDomain | string;
  depth?: BehaviorDepth | string;
}

function formatQuestion(text: string, options: string[]): string {
  return `${text}\nSecenekler: ${options.join(' | ')}`;
}

export const BA_MINDSET_SYSTEM_INSTRUCTION = `
[BA MINDSET - ZORUNLU]
JetWork AI bir kisa cevap motoru gibi degil, kidemli is analisti + cozum mimari + proje ortagi gibi calisir.

Her BA turunda ic kontrol listesi:
- ${BA_MINDSET_CHECKLIST.join('\n- ')}

Karar disiplini:
- Once kullanicinin niyetini ve hedef ciktiyi belirle: sohbet mi, dokuman uretimi mi, revizyon mu, review mu?
- Eksik bilgi kritik degilse varsayimla ilerle; varsayimi dokumanda [VARSAYIM], Review'da [ACIK KONU] olarak ayir.
- Sadece su durumlarda soru sor: yasal/guvenlik riski, geri donusu zor mimari karar, birbiriyle celisen kapsam, ya da dokumani kullanilamaz yapacak temel eksik.
- Soru gerekiyorsa en fazla 3 odakli soru sor; genel ve yorucu soru seti uretme.
- Kullanici sadece "dokuman hazirla / kavramsal tasarim yaz" diyorsa bunu hedef cikti niyeti say; kritik kapsam ve karar eksikleri varsa once domain'e ozel az sayida soru sor.
- Kullanici "varsayimlarla ilerle", "soru sorma", "hizli taslak", "ilk taslagi cikar", "bu bilgilerle devam", "ben mi yapicam", "sen yap" veya benzeri acik uygulama sinyali verdiyse yeni soru sorma.
- Cevap sadece sohbet degilse gorunur dokumana karar verilebilir gereksinim, surec, rol, ekran, veri, entegrasyon, risk ve kabul kriteri olarak islenir.

Insansi BA refleksi:
- Kullanici elestirirse savunmaya gecme; hatali davranisi kabul et, yeni kurali kisa anlat ve duzeltici aksiyona gec.
- "Simdi?", "sirada?", "ok", "devam" gibi kisa mesajlarda son baglamdan sonraki en mantikli aksiyonu cikar.
- Soru sordugunda neden sordugunu belli et: hangi kritik karari netlestirdigini acikla.
- Dokuman urettiginde "ne yaptim / hangi varsayimla ilerledim / hangi acik konu kaldi" bilgisini kisa chat mesajinda ozetle.
- Ayni kalip cumleleri tekrar etme; kullanicinin enerji ve sabir seviyesine gore daha net, daha kisa veya daha yonlendirici ol.
`.trim();

export function buildBaMindsetInstruction(context: BaMindsetContext = {}): string {
  const contextLines = [
    context.mode ? `- Davranis modu: ${context.mode}` : '',
    context.domain ? `- Domain: ${context.domain}` : '',
    context.depth ? `- Derinlik: ${context.depth}` : '',
  ].filter(Boolean);

  return [
    BA_MINDSET_SYSTEM_INSTRUCTION,
    contextLines.length ? `\n[BA MINDSET BAGLAM]\n${contextLines.join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

export function buildBaMindsetQuestions(domain: BehaviorDomain | string = 'generic_ba'): string[] {
  if (domain === 'sap_crm_ai_sales_bot') {
    return [
      formatQuestion('AI satis botunun cozmesi gereken ana is problemi ve hedef karar nedir?', ['Lead yakalama ve nitelendirme', 'Temsilci destek asistani', 'Varsayimla uctan uca satis asistanligi']),
      formatQuestion('Basari hangi KPI veya is degeriyle olculecek?', ['Nitelikli lead orani + donusum', 'Ilk yanit suresi + CRM veri tamligi', 'Varsayimla tum KPI seti']),
      formatQuestion('Ilk surumde hangi rol, surec ve sistem davranislari kesin kapsamda olmali?', ['Musteri + satis temsilcisi + SAP CRM kaydi', 'Sadece temsilci onayli aksiyonlar', 'Varsayimla risk bazli insan onayi']),
    ];
  }

  if (domain === 'sap_crm_iys') {
    return [
      formatQuestion('IYS entegrasyonunda ana is problemi ve uyum hedefi nedir?', ['Yasal izin senkronizasyonu', 'CRM veri kalitesi ve mutabakat', 'Varsayimla ikisi de hedef']),
      formatQuestion('Basari hangi KPI veya is degeriyle olculecek?', ['Uyum riski azaltma', 'Izin veri tutarliligi', 'Varsayimla uyum + veri kalitesi']),
      formatQuestion('Ilk surumde hangi surec, rol ve sistem davranislari kesin kapsamda olmali?', ['CRM -> IYS aktarim + IYS -> CRM delta', 'Initial load + gunluk mutabakat', 'Varsayimla tum ana surecler']),
    ];
  }

  if (domain === 'integration_project') {
    return [
      formatQuestion('Entegrasyonun cozmesi gereken ana is problemi ve hedef karar nedir?', ['Veri senkronizasyonu', 'Surec otomasyonu', 'Varsayimla ikisi de']),
      formatQuestion('Basari hangi KPI veya is degeriyle olculecek?', ['Hata azalmasi', 'Islem suresi azalmasi', 'Izlenebilirlik ve uyum']),
      formatQuestion('Ilk surumde hangi surec, rol ve sistem davranislari kesin kapsamda olmali?', ['Kaynak-hedef veri akisi', 'Hata/retry operasyonu', 'Varsayimla uctan uca entegrasyon']),
    ];
  }

  return [
    formatQuestion('Ana is problemi ve kullanicinin bekledigi hedef karar nedir?', ['Yeni surec/dokuman tasarimi', 'Mevcut sureci iyilestirme', 'Varsayimla kavramsal tasarim']),
    formatQuestion('Basari hangi KPI veya is degeriyle olculecek?', ['Sure azalmasi', 'Hata/risk azalmasi', 'Izlenebilirlik ve karar kalitesi']),
    formatQuestion('Ilk surumde hangi surec, rol ve sistem davranislari kesin kapsamda olmali?', ['MVP kapsam', 'Uctan uca kapsam', 'Varsayimla kurumsal BA kapsami']),
  ];
}
