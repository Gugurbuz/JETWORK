import type { Question } from '../../types';

export type SimpleBaCaseType = 'PROJECT' | 'SUPPORT' | 'GENERAL';

export type SimpleBaPolicyAction =
  | 'ANSWER'
  | 'ASK'
  | 'CREATE_ARTIFACT'
  | 'UPDATE_ARTIFACT'
  | 'REVIEW_ARTIFACT'
  | 'RESEARCH'
  | 'UPDATE_SELECTED_TEXT'
  | 'LEGACY';

export type SimpleBaFocus =
  | 'business_analysis'
  | 'technical_analysis'
  | 'test'
  | 'flow'
  | 'review';

export interface SimpleBaPolicyInput {
  userMessage: string;
  hasDocument: boolean;
  hasSelectedText?: boolean;
  knowledgeItemCount?: number;
  recentMessages?: Array<{
    role: string;
    text?: string;
    questions?: Question[];
  }>;
}

export interface SimpleBaPolicyDecision {
  action: SimpleBaPolicyAction;
  caseType: SimpleBaCaseType;
  focus: SimpleBaFocus;
  documentRequested: boolean;
  allowAssumptions: boolean;
  questions: Question[];
  reasonCode: string;
}

const normalize = (value = ''): string => value
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\u0131/g, 'i')
  .replace(/\s+/g, ' ')
  .trim();

const DOCUMENT_NOUN_RE = /\b(dokuman|belge|rapor|brd|fdd|is analizi|ihtiyac analizi|analiz cikti|test senaryo|uat senaryo|kabul kriter|fonksiyonel gereksinim|nfr|bpmn|mermaid|akis diyagram|surec akisi|xml)\w*\b/;
const DOCUMENT_WRITE_RE = /\b(olustur|hazirla|uret|yaz|cikar|donustur|baslat|duzenle|ekle|guncelle|revize|isle|aktar|tamamla)\w*\b/;
const DOCUMENT_UPDATE_RE = /\b(ekle|guncelle|revize|degistir|duzelt|genislet|kisalt|kaldir|isle|aktar|tamamla)\w*\b/;
const ASSUMPTION_CONSENT_RE = /\b(varsayimlarla|varsayimla|bu bilgilerle|mevcut bilgilerle|soru sorma|hizli taslak|ilk taslak|sen tamamla|sen yap|dogrudan hazirla)\b/;
const MATURATION_RE = /\b(birlikte olgunlastir|once olgunlastir|once soru sor|sorular sor|gerekirse soru|hemen dokuman olusturma|dokumana gecmeden)\w*\b/;
const REVIEW_RE = /\b(incele|degerlendir|review|gozden gecir|olgunluk seviy|eksik nokt|tutarsiz|kalite kontrol|riskleri bul)\w*\b/;
const RESEARCH_RE = /\b(arastir|webde ara|internette ara|guncel bilgi|resmi kaynak|best practice|mevzuati dogrula)\w*\b/;
const SUPPORT_RE = /\b(hata|bug|incident|support|destek|tek alan|alan adi|etiket|label|buton|zorunlu alan|validasyon|dogrulama|uyari mesaji|hata mesaji|gorunmuyor|calismiyor|yanlis geliyor|duzeltme)\w*\b/;
const STRONG_PROJECT_RE = /\b(proje|yeni ekran|yeni fonksiyon|yeni ozellik|entegrasyon|api|servis|birden fazla sistem|uc tan uca|mobil uygulama|portal|modul)\w*\b/;
const SYSTEM_CONTEXT_RE = /\b(crm|c4c|is-u|isu|sap)\w*\b/;
const FLOW_RE = /\b(bpmn|mermaid|akis diyagram|surec akisi|xml)\w*\b/;
const TEST_RE = /\b(test senaryo|uat|kabul kriter|given when then|bdd)\w*\b/;
const TECHNICAL_RE = /\b(teknik analiz|api|entegrasyon|veri modeli|servis sozlesmesi|mimari)\w*\b/;
const LEGACY_CONTROL_RE = /^(\/|uygula$|onayla$|onayliyorum$|iptal$|vazgec$)|\b(hafizaya kaydet|karar olarak kaydet|versiyonu geri yukle|dokumani paylas|dokumani indir|export et)\b/;

function inferCaseType(text: string): SimpleBaCaseType {
  const support = SUPPORT_RE.test(text);
  const strongProject = STRONG_PROJECT_RE.test(text);
  if (support && !strongProject) return 'SUPPORT';
  if (strongProject || SYSTEM_CONTEXT_RE.test(text)) return 'PROJECT';
  return 'GENERAL';
}

function inferFocus(text: string): SimpleBaFocus {
  if (FLOW_RE.test(text)) return 'flow';
  if (TEST_RE.test(text)) return 'test';
  if (TECHNICAL_RE.test(text)) return 'technical_analysis';
  if (REVIEW_RE.test(text)) return 'review';
  return 'business_analysis';
}

function informationDimensions(text: string): number {
  const dimensions = [
    /\b(amac|hedef|problem|beklenen sonuc|neden)\b/,
    /\b(kullanici|rol|musteri|bayi|temsilci|onaylayan)\b/,
    /\b(sistem|crm|c4c|sap|is-u|isu|api|servis)\b/,
    /\b(kural|kosul|esik|zorunlu|istisna|validasyon)\b/,
    /\b(akis|adim|tetik|mevcut durum|hedef durum)\b/,
    /\b(kabul kriter|basari olcut|sonuc|tamamlanmis)\b/,
  ];
  return dimensions.filter(pattern => pattern.test(text)).length;
}

function projectQuestions(): Question[] {
  return [
    {
      id: 'q1',
      text: 'Talebin çözeceği iş problemi ve beklenen sonuç nedir?',
      options: [],
    },
    {
      id: 'q2',
      text: 'Kapsamdaki kullanıcı rolleri, sistemler ve mevcut süreç nasıl çalışıyor?',
      options: [],
    },
    {
      id: 'q3',
      text: 'Kritik iş kuralları, istisnalar ve başarı/kabul ölçütleri nelerdir?',
      options: [],
    },
  ];
}

function supportQuestions(): Question[] {
  return [
    {
      id: 'q1',
      text: 'Şu an ne oluyor; beklenen davranış tam olarak nedir?',
      options: [],
    },
    {
      id: 'q2',
      text: 'Sorun hangi adımlarda, sistemde ve kullanıcı rolünde tekrarlanıyor?',
      options: [],
    },
    {
      id: 'q3',
      text: 'Etkilenen kayıtların kapsamı ve varsa görülen hata/uyarı mesajı nedir?',
      options: [],
    },
  ];
}

function clarificationQuestions(caseType: SimpleBaCaseType): Question[] {
  return caseType === 'SUPPORT' ? supportQuestions() : projectQuestions();
}

function explicitDocumentRequest(text: string): boolean {
  return (DOCUMENT_NOUN_RE.test(text) && DOCUMENT_WRITE_RE.test(text))
    || /\b(dokuman istiyorum|rapor istiyorum|bpmn istiyorum|analiz dokumani istiyorum)\b/.test(text)
    || /\bexper modu\b/.test(text);
}

function supportNeedsClarification(text: string): boolean {
  const hasCurrent = /\b(su an|mevcut|hata|yanlis|geliyor|gorunuyor|calismiyor)\b/.test(text);
  const hasExpected = /\b(beklenen|olmali|olmasi gerek|yerine|duzeltilmeli)\b/.test(text);
  return text.split(' ').filter(Boolean).length < 18 || !hasCurrent || !hasExpected;
}

function projectNeedsClarification(
  text: string,
  hasKnowledge: boolean,
  hasDocument: boolean,
  documentRequested: boolean,
): boolean {
  if (hasDocument && documentRequested && DOCUMENT_UPDATE_RE.test(text)) return false;
  if (hasKnowledge && documentRequested) return false;
  const words = text.split(' ').filter(Boolean).length;
  const dimensions = informationDimensions(text);
  return words < 18 || dimensions < 2;
}

export function decideSimpleBaTurn(input: SimpleBaPolicyInput): SimpleBaPolicyDecision {
  const text = normalize(input.userMessage);
  const recentMessages = (input.recentMessages || []).slice(-8);
  const previousMessages = recentMessages.filter(message => normalize(message.text || '') !== text);
  const lastModelMessage = [...previousMessages].reverse().find(message => message.role === 'model');
  const lastModelAsked = !!lastModelMessage && (
    (lastModelMessage.questions?.length || 0) > 0
    || /\?|netlestirelim|netlestirmem/.test(normalize(lastModelMessage.text || ''))
  );
  const pendingDocumentMessage = lastModelAsked
    ? [...previousMessages].reverse().find(message => (
      message.role === 'user' && explicitDocumentRequest(normalize(message.text || ''))
    ))
    : undefined;
  const pendingDocumentRequest = !!pendingDocumentMessage;
  const pendingDocumentText = normalize(pendingDocumentMessage?.text || '');
  const caseType = inferCaseType(text) === 'GENERAL' && pendingDocumentRequest
    ? inferCaseType(pendingDocumentText)
    : inferCaseType(text);
  const currentFocus = inferFocus(text);
  const focus = currentFocus === 'business_analysis' && pendingDocumentRequest
    ? inferFocus(pendingDocumentText)
    : currentFocus;
  const documentRequested = explicitDocumentRequest(text) || pendingDocumentRequest;
  const allowAssumptions = ASSUMPTION_CONSENT_RE.test(text);
  const hasKnowledge = (input.knowledgeItemCount || 0) > 0;
  const questions = clarificationQuestions(caseType);

  if (LEGACY_CONTROL_RE.test(text)) {
    return {
      action: 'LEGACY',
      caseType,
      focus,
      documentRequested,
      allowAssumptions,
      questions: [],
      reasonCode: 'legacy_explicit_control',
    };
  }

  if (input.hasSelectedText && DOCUMENT_UPDATE_RE.test(text)) {
    return {
      action: 'UPDATE_SELECTED_TEXT',
      caseType,
      focus,
      documentRequested: true,
      allowAssumptions,
      questions: [],
      reasonCode: 'explicit_selected_text_update',
    };
  }

  const wantsReadOnlyReview = REVIEW_RE.test(text)
    && !DOCUMENT_WRITE_RE.test(text)
    && (input.hasDocument || /\b(mevcut analiz|mevcut dokuman|bu analiz|bu dokuman)\b/.test(text));
  if (wantsReadOnlyReview) {
    return {
      action: 'REVIEW_ARTIFACT',
      caseType,
      focus: 'review',
      documentRequested: false,
      allowAssumptions: false,
      questions: [],
      reasonCode: 'explicit_read_only_review',
    };
  }

  if (RESEARCH_RE.test(text) && !documentRequested) {
    return {
      action: 'RESEARCH',
      caseType,
      focus,
      documentRequested: false,
      allowAssumptions: false,
      questions: [],
      reasonCode: 'explicit_research',
    };
  }

  if (documentRequested) {
    if (pendingDocumentRequest && !explicitDocumentRequest(text)) {
      return {
        action: input.hasDocument ? 'UPDATE_ARTIFACT' : 'CREATE_ARTIFACT',
        caseType,
        focus,
        documentRequested: true,
        allowAssumptions,
        questions: [],
        reasonCode: 'maturation_answers_received',
      };
    }
    const needsClarification = MATURATION_RE.test(text)
      || projectNeedsClarification(text, hasKnowledge, input.hasDocument, true);
    if (needsClarification && !allowAssumptions) {
      return {
        action: 'ASK',
        caseType,
        focus,
        documentRequested: true,
        allowAssumptions: false,
        questions,
        reasonCode: 'explicit_document_request_needs_maturation',
      };
    }
    return {
      action: input.hasDocument && DOCUMENT_UPDATE_RE.test(text)
        ? 'UPDATE_ARTIFACT'
        : 'CREATE_ARTIFACT',
      caseType,
      focus,
      documentRequested: true,
      allowAssumptions,
      questions: [],
      reasonCode: input.hasDocument ? 'explicit_document_write' : 'explicit_document_create',
    };
  }

  if (caseType === 'SUPPORT' && supportNeedsClarification(text)) {
    return {
      action: 'ASK',
      caseType,
      focus,
      documentRequested: false,
      allowAssumptions: false,
      questions,
      reasonCode: 'support_needs_current_expected_state',
    };
  }

  if (caseType === 'PROJECT' && projectNeedsClarification(text, hasKnowledge, input.hasDocument, false)) {
    return {
      action: 'ASK',
      caseType,
      focus,
      documentRequested: false,
      allowAssumptions: false,
      questions,
      reasonCode: 'project_needs_maturation',
    };
  }

  return {
    action: 'ANSWER',
    caseType,
    focus,
    documentRequested: false,
    allowAssumptions: false,
    questions: [],
    reasonCode: `${caseType.toLowerCase()}_chat_only`,
  };
}
