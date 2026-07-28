import { DocumentData, Message } from '../../types';
import { buildBaDiscoveryState, isLikelyBaDiscoveryAnswer } from '../../modules/ai-ba-engine';
import { ENERJISA_BA_SYSTEM_INSTRUCTION } from './enerjisaBaInstructions';

export interface DiscoverySignals {
  forceGenerate: boolean;
  stopQuestions: boolean;
  greetingOnly: boolean;
  newStandaloneRequest: boolean;
  answeredQuestionCount: number;
  questionRoundCount: number;
  documentReadinessScore: number;
  baDiscoveryReadiness: number;
  missingDiscoveryFields: string[];
  isAnsweringDiscovery: boolean;
  mustGenerateNow: boolean;
  reason: string;
}

export function resolveDiscoveryArtifactIntent(
  userMessage: string,
  messages: Message[],
  signals: Pick<DiscoverySignals, 'isAnsweringDiscovery' | 'mustGenerateNow' | 'newStandaloneRequest'>,
): string {
  if (signals.newStandaloneRequest) return userMessage;
  const continuesQuestionRound = signals.isAnsweringDiscovery
    || (signals.mustGenerateNow && hasPendingQuestionRound(messages));
  if (!continuesQuestionRound) return userMessage;

  let lastQuestionIndex = -1;
  messages.forEach((message, index) => {
    const sender = getSender(message);
    if (
      (sender === 'ai' || sender === 'model')
      && Array.isArray(message.questions)
      && message.questions.length > 0
    ) {
      lastQuestionIndex = index;
    }
  });
  if (lastQuestionIndex < 0) return userMessage;

  for (let index = lastQuestionIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (getSender(message) !== 'user') continue;
    const text = String(message.text || '').trim();
    if (!text || isLikelyBaDiscoveryAnswer(text) || isGreetingLike(text)) continue;
    return text;
  }

  return userMessage;
}

const FORCE_GENERATE_PATTERNS: RegExp[] = [
  /\b(tamam|ok|next)\b/i,
  /\bsonraki\s+ad[\u0131i]m(?:a)?\b/i,
  /\b(devam\s+et|durma|calismaya\s+devam)\b/i,
  /\b\u00e7al[\u0131i]smaya\s+devam\b/i,
  /\b(ben\s+mi\s+yap[\u0131i]cam|ben\s+mi\s+yapacagim|sen\s+yap)\b/i,
  /\bevet[,\s!.?]*\s*(başlayalım|başla|başlayabilirsin|devam|ilerleyelim|ilerle|olsun|tabii)/i,
  /\bbaşlayalım\b/i,
  /\bbaşla(?:sın|lım|yalım)?\b/i,
  /\bhaydi\b/i,
  /\bhadi\b/i,
  /\b(h[\u0131i]zl[\u0131i]\s+taslak|ilk\s+tasla[\u011f]?[\u0131i]?\s*(c[\u0131i]kar|olu[\u015fs]tur|haz[\u0131i]rla|uret|\u00fcret|yaz)|kabaca\s+taslak|taslakla\s+ilerle)\b/i,
  /\bbu\s+bilgilerle\s+(ilerle|devam|oluştur|yaz|hazırla)/i,
  /\bvarsay[\u0131i]mla(?:rla)?\s+(devam|ilerle|olu[\u015fs]tur|haz[\u0131i]rla)/i,
  /\bmevcut\s+bilgilerle\b/i,
  /\btaslakla\s+(devam|ilerle)\b/i,
  /\bvarsay[\u0131i]mla(?:rla)?\b/i,
  /\bbu\s+bilgilerle\b/i,
  /\bmevcut\s+bilgilerle\b/i,
  /\btamam[,\s!.?]*\s*(oluştur|yaz|hazırla|başla|başlayalım)/i,
  /\buygula\b/i,
];

const STOP_QUESTION_PATTERNS: RegExp[] = [
  /\b(soru\s+sorma|soru\s+istemiyorum|sorular[\u0131i]\s+b[\u0131i]rak|sorulari\s+birak)\b/i,
  /\b(ben\s+mi\s+yap[\u0131i]cam|ben\s+mi\s+yapacagim|sen\s+yap)\b/i,
  /\b(varsayi?mla(?:rla)?|mevcut\s+bilgilerle|bu\s+bilgilerle)\b/i,
  /\bvarsay[\u0131i]mla(?:rla)?\b/i,
  /\byeter\s*(artık)?\b/i,
  /\bdaha\s*(fazla)?\s*soru\s*sorma\b/i,
  /\bsoru\s*(yeter|kes|durdur|sorma)\b/i,
  /\bsorulardan\s+bıktım\b/i,
];

const GREETING_PATTERNS: RegExp[] = [
  /^\s*(selam(lar)?|slm|mrb|mrhb|merhaba|merhabalar|hey|hi|hello|hola|naber|nbr|nasılsın|nasilsin|ne haber|günaydın|gunaydin|iyi akşamlar|iyi geceler|kolay gelsin|selamün aleyküm|selamunaleykum)\s*[!?.,]*\s*$/i,
];

const GREETING_TOKENS = [
  'mrb', 'mrhb', 'merhaba', 'merhabalar',
  'selam', 'selamlar', 'slm',
  'hey', 'hi', 'hello', 'hola',
  'naber', 'nbr', 'nasılsın', 'nasilsin',
  'günaydın', 'gunaydin',
];

const SMALL_TALK_CORRECTION_PATTERNS: RegExp[] = [
  /\b(selam|naber|mrb|slm|merhaba|hey)\b.*\b(dedim|yazdım|yazdim|söyledim|soyledim|verdim)\b/i,
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
    .replace(/[.!?,;:]/g, '')
    .replace(/\s+/g, ' ');
}

function isGreetingLike(message: string): boolean {
  const normalized = normalizeTr(message);
  if (!normalized) return false;
  if (GREETING_PATTERNS.some((re) => re.test(message))) return true;
  if (SMALL_TALK_CORRECTION_PATTERNS.some((re) => re.test(message))) return true;

  const tokens = normalized.split(' ').filter(Boolean);
  const hasGreetingToken = tokens.some((t) => GREETING_TOKENS.includes(t));
  if (!hasGreetingToken) return false;
  return tokens.length <= 6;
}

function normalizeDiscoveryText(input: string): string {
  return normalizeTr(input)
    .replace(/\u0131/g, 'i')
    .replace(/\u015f/g, 's')
    .replace(/\u011f/g, 'g')
    .replace(/\u00fc/g, 'u')
    .replace(/\u00f6/g, 'o')
    .replace(/\u00e7/g, 'c');
}

function isSparseInitialDomainDocumentRequest(
  userMessage: string,
  messages: Message[],
  document: DocumentData | null,
): boolean {
  if (document || messages.length > 0) return false;
  const text = normalizeDiscoveryText(userMessage);
  const tokenCount = text.split(/\s+/).filter(Boolean).length;
  const looksLikeSapDomain = /sap\s*crm/.test(text)
    && /(ai|yapay zeka|bot|chatbot|asistan|satis|sales|iys|ileti yonetim sistemi)/.test(text);
  const asksForDocumentOutput = /(ba analiz|kavramsal|tasarim|dokuman|rapor|brd|fdd|hazirla|olustur|uret|yaz)/.test(text);
  const explicitlyAllowsDraft = /(varsayimla(?:rla)?|soru sorma|bu bilgilerle|mevcut bilgilerle|hizli taslak|ilk taslagi|sen yap)/.test(text);
  return looksLikeSapDomain && asksForDocumentOutput && !explicitlyAllowsDraft && tokenCount <= 14;
}

const BLOCKED_QUESTION_TERMS: string[] = [
  'iş arıyorum',
  'is ariyorum',
  'eleman arıyorum',
  'yetenek arıyorum',
  'aday arıyorum',
  'freelance',
  'tam zamanlı',
  'yarı zamanlı',
  'remote',
  'hibrit',
  'işveren',
  'isveren',
  'job',
  'talent',
  'recruit',
  'cv yükle',
];

export function containsBlockedQuestionDomain(
  questions: Array<{ text?: string; options?: string[] }> | undefined | null
): boolean {
  if (!questions || questions.length === 0) return false;
  const text = JSON.stringify(questions).toLocaleLowerCase('tr-TR');
  return BLOCKED_QUESTION_TERMS.some((term) => text.includes(term));
}

export function detectSignals(userMessage: string): {
  forceGenerate: boolean;
  stopQuestions: boolean;
  greetingOnly: boolean;
} {
  const msg = (userMessage || '').trim();
  return {
    forceGenerate: FORCE_GENERATE_PATTERNS.some((re) => re.test(msg)),
    stopQuestions: STOP_QUESTION_PATTERNS.some((re) => re.test(msg)),
    greetingOnly: isGreetingLike(msg),
  };
}

const getSender = (message: Message): string => String((message as any).sender || message.role || '').toLowerCase();

function countQuestionRounds(messages: Message[]): number {
  return messages.filter((m) => getSender(m) === 'ai' || getSender(m) === 'model')
    .filter((m) => (
      Array.isArray((m as any).questions) && (m as any).questions.length > 0
    ) || /\?/.test(String(m.text || '')))
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

function hasPendingQuestionRound(messages: Message[]): boolean {
  let lastQuestionIndex = -1;
  let lastUserAnswerIndex = -1;

  messages.forEach((message, index) => {
    const sender = getSender(message);
    const isQuestionMessage = (
      Array.isArray((message as any).questions) && (message as any).questions.length > 0
    ) || /\?/.test(String(message.text || ''));
    if ((sender === 'ai' || sender === 'model') && isQuestionMessage) {
      lastQuestionIndex = index;
    }
    if (sender === 'user') {
      lastUserAnswerIndex = index;
    }
  });

  return lastQuestionIndex >= 0 && lastQuestionIndex > lastUserAnswerIndex;
}

function isLikelyStandaloneProjectRequest(userMessage: string): boolean {
  const text = normalizeDiscoveryText(userMessage);
  if (!text || /\*\*soru\s+\d+:\*\*|\bcevap\s*:/.test(text)) return false;
  const tokenCount = text.split(/\s+/).filter(Boolean).length;
  const hasProjectSignal = /(proje|uygulama|sistem|surec|entegrasyon|refactoring|refaktoring|donusum|d2d|mobil|mobile|sap|crm|iys|saha satis|satis uygulamasi|kavramsal|dokuman|analiz|tasarim)/.test(text);
  const hasActionSignal = /(analiz|incele|tasarla|tasarlayalim|yazalim|hazirla|olustur|uret|yaz|donusum|refactoring|refaktoring|entegrasyon|projesi|uygulamamiz)/.test(text);
  return tokenCount >= 4 && hasProjectSignal && hasActionSignal;
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
  const pendingQuestionRound = hasPendingQuestionRound(messages);
  const explicitNewTopic = /^\s*yeni\s+(konu|proje)\s*:/i.test(userMessage);
  const newStandaloneRequest = isLikelyStandaloneProjectRequest(userMessage)
    && (pendingQuestionRound || explicitNewTopic);
  const isAnsweringDiscovery = !newStandaloneRequest
    && (pendingQuestionRound || isLikelyBaDiscoveryAnswer(userMessage));
  const shouldProtectInitialDiscovery = isSparseInitialDomainDocumentRequest(userMessage, messages, document);

  let reason = '';
  let mustGenerateNow = false;

  if (newStandaloneRequest) {
    reason = 'new_standalone_request_after_questions';
  } else if (forceGenerate) {
    mustGenerateNow = true;
    reason = 'user_force_generate';
  } else if (stopQuestions) {
    mustGenerateNow = true;
    reason = 'user_stop_questions';
  } else if (isAnsweringDiscovery && (pendingQuestionRound || answeredQuestionCount >= 1 || questionRoundCount > 0)) {
    mustGenerateNow = true;
    reason = 'user_answered_discovery_questions';
  } else if (answeredQuestionCount >= 6) {
    mustGenerateNow = true;
    reason = 'enough_answers_collected';
  } else if (questionRoundCount >= 2) {
    mustGenerateNow = true;
    reason = 'question_round_cap_reached';
  } else if (documentReadinessScore >= 60 && !shouldProtectInitialDiscovery) {
    mustGenerateNow = true;
    reason = 'document_readiness_threshold';
  }

  return {
    forceGenerate,
    stopQuestions,
    greetingOnly,
    newStandaloneRequest,
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

export const DOMAIN_LOCK_RULE = `ÜRÜN TANIMI (ZORUNLU):
- Sen JetWork AI'sın.
- JETWORK bir iş ilanı, aday bulma, yetenek/eşleştirme, freelance, remote çalışma veya işveren-çalışan platformu DEĞİLDİR.
- JETWORK; iş analizi, kavramsal tasarım, gereksinim, süreç, kabul kriteri, risk ve review dokümanı üreten bir Vibe Analysis Workspace'tir.
- Görünür doküman sekmeleri şimdilik yalnızca BA Analiz ve Review'dür. Teknik analiz, test ve flow isteklerini BA Analiz içinde ilgili alt başlıklara; risk ve kalite notlarını Review içine yerleştir.
- Asla "İş arıyorum", "Yetenek arıyorum", "Freelance", "Tam zamanlı", "Remote", "Aday", "İşveren", "CV" gibi seçenekler üretme.
- Kullanıcı sadece selamlaşırsa (merhaba, mrb, selam, hey, naber vb.) soru kartı üretme; tek cümle kısa bir cevap dön ve analiz için ham talep beklediğini belirt.
- Üreteceğin tüm soru seçenekleri yalnızca yazılım/iş analizi domaininde olmalı: gereksinim tipi, etkilenen sistem, entegrasyon tipi, iş kuralı, kullanıcı grubu, veri kapsamı, hata yönetimi, kabul kriteri, doküman çıktısı.`;

export const DRAFT_FIRST_SYSTEM_RULE = `${DOMAIN_LOCK_RULE}

${ENERJISA_BA_SYSTEM_INSTRUCTION}

SADE ETKILESIM KURALI:
- Talebin proje/support ayrimini sessizce yap.
- Eksik kritik bilgi varsa en fazla uc soru sor.
- Kullanici acikca istemedikce dokuman olusturma veya guncelleme.
- Kullanici varsayimlarla ilerlemeyi acikca kabul ederse bilinmeyenleri etiketleyerek devam et.
- Chat cevabini kisa ve profesyonel tut; ic karar mekanizmasini aciklama.`;
