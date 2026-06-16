import { DocumentData, Message } from '../../types';
import { buildBaDiscoveryState, isLikelyBaDiscoveryAnswer } from '../../modules/ai-ba-engine';

export interface DiscoverySignals {
  forceGenerate: boolean;
  stopQuestions: boolean;
  greetingOnly: boolean;
  answeredQuestionCount: number;
  questionRoundCount: number;
  documentReadinessScore: number;
  baDiscoveryReadiness: number;
  missingDiscoveryFields: string[];
  isAnsweringDiscovery: boolean;
  mustGenerateNow: boolean;
  reason: string;
}

const FORCE_GENERATE_PATTERNS: RegExp[] = [
  /\b(tamam|ok|next)\b/i,
  /\bsonraki\s+ad[iı]m(?:a)?\b/i,
  /\b(devam\s+et|durma|calismaya\s+devam|çalışmaya\s+devam)\b/i,
  /\b(ben\s+mi\s+yap[iı]cam|ben\s+mi\s+yapacagim|sen\s+yap)\b/i,
  /\bevet[,\s!.?]*\s*(baslayalim|basla|baslayabilirsin|devam|ilerleyelim|ilerle|olsun|tabii)\b/i,
  /\b(baslayalim|basla(?:sin|lim|yalim)?|haydi|hadi)\b/i,
  /\b(varsay[iı]mlarla|bu\s+bilgilerle|mevcut\s+bilgilerle)\b/i,
  /\b(h[iı]zli\s+taslak|ilk\s+taslag?[iı]?\s*(c[iı]kar|olustur|haz[iı]rla|uret|yaz)|kabaca\s+taslak|taslakla\s+ilerle)\b/i,
  /\btamam[,\s!.?]*\s*(olustur|yaz|haz[iı]rla|basla|baslayalim)\b/i,
  /\buygula\b/i,
];

const STOP_QUESTION_PATTERNS: RegExp[] = [
  /\b(soru\s+sorma|soru\s+istemiyorum|sorular[iı]\s+b[iı]rak|sorulari\s+birak)\b/i,
  /\b(ben\s+mi\s+yap[iı]cam|ben\s+mi\s+yapacagim|sen\s+yap)\b/i,
  /\b(varsay[iı]mlarla|mevcut\s+bilgilerle|bu\s+bilgilerle)\b/i,
  /\byeter\s*(artik)?\b/i,
  /\bdaha\s*(fazla)?\s*soru\s*sorma\b/i,
  /\bsoru\s*(yeter|kes|durdur|sorma)\b/i,
  /\bsorulardan\s+biktim\b/i,
];

const GREETING_PATTERNS: RegExp[] = [
  /^\s*(selam(lar)?|slm|mrb|mrhb|merhaba|merhabalar|hey|hi|hello|hola|naber|nbr|nasilsin|ne haber|gunaydin|iyi aksamlar|iyi geceler|kolay gelsin|selamun aleykum|selamunaleykum)\s*[!?.,]*\s*$/i,
];

const GREETING_TOKENS = [
  'mrb', 'mrhb', 'merhaba', 'merhabalar',
  'selam', 'selamlar', 'slm',
  'hey', 'hi', 'hello', 'hola',
  'naber', 'nbr', 'nasilsin',
  'gunaydin',
];

const SMALL_TALK_CORRECTION_PATTERNS: RegExp[] = [
  /\b(selam|naber|mrb|slm|merhaba|hey)\b.*\b(dedim|yazdim|soyledim|verdim)\b/i,
  /\bsadece\s+(selam|naber|mrb|slm|merhaba|hey)\b/i,
  /\bne\s+sorusu\s*ya?\b/i,
  /\bneden\s+soru\s+soruyorsun\b/i,
  /\bsoru\s+sorma\s+sadece\b/i,
  /\bben\s+sana\s+(selam|naber|mrb|slm|merhaba|hey)\b/i,
];

function normalizeTr(input: string): string {
  return (input || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[.!?,;:]/g, '')
    .replace(/\s+/g, ' ');
}

function matchesAny(message: string, patterns: RegExp[]): boolean {
  const normalized = normalizeTr(message);
  return patterns.some((re) => re.test(message) || re.test(normalized));
}

function isGreetingLike(message: string): boolean {
  const normalized = normalizeTr(message);
  if (!normalized) return false;
  if (GREETING_PATTERNS.some((re) => re.test(message) || re.test(normalized))) return true;
  if (SMALL_TALK_CORRECTION_PATTERNS.some((re) => re.test(message) || re.test(normalized))) return true;

  const tokens = normalized.split(' ').filter(Boolean);
  const hasGreetingToken = tokens.some((t) => GREETING_TOKENS.includes(t));
  if (!hasGreetingToken) return false;
  return tokens.length <= 6;
}

const BLOCKED_QUESTION_TERMS: string[] = [
  'is ariyorum',
  'eleman ariyorum',
  'yetenek ariyorum',
  'aday ariyorum',
  'freelance',
  'tam zamanli',
  'yari zamanli',
  'remote',
  'hibrit',
  'isveren',
  'job',
  'talent',
  'recruit',
  'cv yukle',
];

export function containsBlockedQuestionDomain(
  questions: Array<{ text?: string; options?: string[] }> | undefined | null
): boolean {
  if (!questions || questions.length === 0) return false;
  const text = normalizeTr(JSON.stringify(questions));
  return BLOCKED_QUESTION_TERMS.some((term) => text.includes(term));
}

export function detectSignals(userMessage: string): {
  forceGenerate: boolean;
  stopQuestions: boolean;
  greetingOnly: boolean;
} {
  const msg = (userMessage || '').trim();
  return {
    forceGenerate: matchesAny(msg, FORCE_GENERATE_PATTERNS),
    stopQuestions: matchesAny(msg, STOP_QUESTION_PATTERNS),
    greetingOnly: isGreetingLike(msg),
  };
}

const getSender = (message: Message): string => String((message as any).sender || message.role || '').toLowerCase();

function countQuestionRounds(messages: Message[]): number {
  return messages.filter((m) => getSender(m) === 'ai' || getSender(m) === 'model')
    .filter((m) => Array.isArray((m as any).questions) && (m as any).questions.length > 0)
    .length;
}

function countAnsweredQuestions(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    if (getSender(m) === 'user' && typeof m.text === 'string') {
      const markerMatches = m.text.match(/\*\*Soru\s+\d+:\*\*/g);
      const answerMatches = m.text.match(/\bCevap\s*:/gi);
      total += Math.max(markerMatches?.length || 0, answerMatches?.length || 0);
    }
  }
  return total;
}

function scoreDocumentReadiness(document: DocumentData | null, history: Message[]): number {
  const discovery = buildBaDiscoveryState({ document, messages: history });
  let lengthScore = 0;
  if (document) {
    const ba = String((document as any).businessAnalysis?.content || '');
    const review = String((document as any).review?.content || '');
    if (ba.length > 200) lengthScore += 20;
    if (ba.length > 800) lengthScore += 15;
    if (ba.length > 2500) lengthScore += 15;
    if (review.length > 100) lengthScore += 10;
  }
  return Math.min(100, Math.max(discovery.readinessScore, lengthScore));
}

export function computeDiscoverySignals(
  userMessage: string,
  messages: Message[],
  document: DocumentData | null
): DiscoverySignals {
  const { forceGenerate, stopQuestions, greetingOnly } = detectSignals(userMessage);
  const discovery = buildBaDiscoveryState({ userMessage, messages, document });
  const questionRoundCount = countQuestionRounds(messages);
  const answeredQuestionCount = Math.max(countAnsweredQuestions(messages), discovery.answeredQuestionCount);
  const documentReadinessScore = scoreDocumentReadiness(document, messages);
  const isAnsweringDiscovery = isLikelyBaDiscoveryAnswer(userMessage);

  let reason = '';
  let mustGenerateNow = false;

  if (forceGenerate) {
    mustGenerateNow = true;
    reason = 'user_force_generate';
  } else if (stopQuestions) {
    mustGenerateNow = true;
    reason = 'user_stop_questions';
  } else if (isAnsweringDiscovery && (answeredQuestionCount >= 1 || questionRoundCount > 0)) {
    mustGenerateNow = true;
    reason = 'user_answered_discovery_questions';
  } else if (answeredQuestionCount >= 6) {
    mustGenerateNow = true;
    reason = 'enough_answers_collected';
  } else if (questionRoundCount >= 2) {
    mustGenerateNow = true;
    reason = 'question_round_cap_reached';
  } else if (documentReadinessScore >= 60) {
    mustGenerateNow = true;
    reason = 'document_readiness_threshold';
  }

  return {
    forceGenerate,
    stopQuestions,
    greetingOnly,
    answeredQuestionCount,
    questionRoundCount,
    documentReadinessScore,
    baDiscoveryReadiness: discovery.readinessScore,
    missingDiscoveryFields: discovery.missingFields.map((field) => field.label),
    isAnsweringDiscovery,
    mustGenerateNow,
    reason,
  };
}

export const DOMAIN_LOCK_RULE = `URUN TANIMI (ZORUNLU):
- Sen JetWork AI'sin.
- JETWORK bir is ilani, aday bulma, yetenek/eslestirme, freelance, remote calisma veya isveren-calisan platformu DEGILDIR.
- JETWORK; is analizi, kavramsal tasarim, gereksinim, surec, kabul kriteri, risk ve review dokumani ureten bir Vibe Analysis Workspace'tir.
- Gorunur dokuman sekmeleri simdilik yalnizca BA Analiz ve Review'dur. Teknik analiz, test ve flow isteklerini BA Analiz icinde ilgili alt basliklara; risk ve kalite notlarini Review icine yerlestir.
- Asla "Is ariyorum", "Yetenek ariyorum", "Freelance", "Tam zamanli", "Remote", "Aday", "Isveren", "CV" gibi secenekler uretme.
- Kullanici sadece selamlasirsa (merhaba, mrb, selam, hey, naber vb.) soru karti uretme; tek cumle kisa bir cevap don ve analiz icin ham talep bekledigini belirt.
- Uretecegin tum soru secenekleri yalnizca yazilim/is analizi domaininde olmali: gereksinim tipi, etkilenen sistem, entegrasyon tipi, is kurali, kullanici grubu, veri kapsami, hata yonetimi, kabul kriteri, dokuman ciktisi.`;

export const DRAFT_FIRST_SYSTEM_RULE = `${DOMAIN_LOCK_RULE}

AI BA ENGINE V1 CALISMA POLITIKASI (zorunlu):
- Once niyeti belirle: sohbet, kesif sorusu, BA uretimi, revizyon, review/kalite veya arastirma.
- Kullanici yalnizca net bir proje fikri yazdiysa (ornegin "sap crm ai satis botu projesi") bunu otomatik dokuman komutu sayma; once domain'e ozel kritik kesif sorularini sor.
- Kullanici sadece "dokuman olustur", "FDD hazirla", "kavramsal tasarim yaz" dediyse bunu hedef cikti niyeti say; kritik kapsam/karar eksikleri varsa once domain'e ozel az sayida soru sor.
- Soru soracaksan AI BA kesif checklist'ine gore en kritik en fazla 4 soruyu sor: problem, hedef, kapsam, is kurali, fonksiyonel gereksinim, kabul kriteri, surec, veri/entegrasyon, NFR, risk.
- Her soru hizli cevaplanabilir olmali ve 2-4 secenek icermeli.
- Bir talep icin en fazla 2 soru turu yapabilirsin.
- Kullanici 6'dan fazla soruya cevap verdiyse ARTIK YENI SORU SORMA.
- Kullanici "bu bilgilerle ilerle", "varsayimlarla devam", "soru sorma", "hizli taslak", "ilk taslagi cikar", "sen yap", "uygula" dediyse soru sorma, dokumani uret.
- Kullanici soru kartlarina cevap verdiyse cevaplari BA hafizasi gibi ele al; dokumana gereksinim, varsayim, is kurali veya acik soru olarak isle.
- Mukemmel bilgi bekleme. Eksik bilgileri [VARSAYIM] olarak dokuman icinde acikca isaretle, kalan belirsizlikleri Review > Acik Sorular bolumune yaz.
- Chat cevabin kisa olsun; uzun detaylar sag paneldeki dokumana yazilir.
- Selamlasma veya kucuk sohbete sorularla karsilik verme; kisa cevap don.`;
