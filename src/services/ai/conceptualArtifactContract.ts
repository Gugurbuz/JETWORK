import { Type } from '@google/genai';
import type { DocumentData, EvidenceClaim, EvidenceClaimStatus } from '../../types';
import { sanitizeEvidenceClaims, validateEvidenceClaim } from '../evidenceClaims';

export type ConceptualFactStatus = 'SOURCE' | 'VERIFIED' | 'INFERRED' | 'ASSUMPTION' | 'OPEN' | 'CONFLICTING';

export interface ConceptualFact {
  text: string;
  status: ConceptualFactStatus;
}

export interface ConceptualFlowStep extends ConceptualFact {
  actor: string;
  systemBehavior: string;
}

export interface ConceptualProcess {
  name: string;
  highLevelDescription: ConceptualFact;
  actors: ConceptualFact[];
  trigger: ConceptualFact;
  preconditions: ConceptualFact[];
  processChanges: ConceptualFact[];
  requirementsAndKpis: ConceptualFact[];
  businessRules: ConceptualFact[];
  validations: ConceptualFact[];
  alternateFlows: ConceptualFact[];
  exceptions: ConceptualFact[];
  dataRequirements: ConceptualFact[];
  uiRequirements: ConceptualFact[];
  integrationRequirements: ConceptualFact[];
  flowSteps: ConceptualFlowStep[];
  outputs: ConceptualFact[];
  relatedProcesses: ConceptualFact[];
  customerDevelopments: ConceptualFact[];
  adaptations: ConceptualFact[];
  changeManagement: ConceptualFact[];
}

export interface ConceptualArtifactPayload {
  project: {
    name: string;
    businessProblem: ConceptualFact;
    currentState: ConceptualFact;
    targetState: ConceptualFact;
    purpose: ConceptualFact;
    scopeIn: ConceptualFact[];
    scopeOut: ConceptualFact[];
    constraints: ConceptualFact[];
    successMetrics: ConceptualFact[];
  };
  documentControl: {
    participants: ConceptualFact[];
    revisionDate: ConceptualFact;
    approvers: ConceptualFact[];
  };
  processes: ConceptualProcess[];
  appendix: {
    relatedDocuments: ConceptualFact[];
    attachments: ConceptualFact[];
  };
  review: {
    risks: ConceptualFact[];
    assumptions: ConceptualFact[];
    openTopics: ConceptualFact[];
    conflicts: ConceptualFact[];
    quickActions: ConceptualFact[];
  };
  evidenceClaims: EvidenceClaim[];
}

const FACT_STATUSES: ConceptualFactStatus[] = [
  'SOURCE',
  'VERIFIED',
  'INFERRED',
  'ASSUMPTION',
  'OPEN',
  'CONFLICTING',
];

const factSchema = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
    status: { type: Type.STRING, enum: FACT_STATUSES },
  },
  required: ['text', 'status'],
};

const factArraySchema = {
  type: Type.ARRAY,
  items: factSchema,
};

const flowStepSchema = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
    status: { type: Type.STRING, enum: FACT_STATUSES },
    actor: { type: Type.STRING },
    systemBehavior: { type: Type.STRING },
  },
  required: ['text', 'status', 'actor', 'systemBehavior'],
};

const evidenceClaimSchema = {
  type: Type.OBJECT,
  properties: {
    claimId: { type: Type.STRING },
    claim: { type: Type.STRING },
    status: { type: Type.STRING, enum: ['VERIFIED', 'INFERRED', 'ASSUMPTION', 'OPEN', 'CONFLICTING'] },
    sourceUrl: { type: Type.STRING },
    sourceTitle: { type: Type.STRING },
    retrievedAt: { type: Type.STRING },
    evidenceExcerpt: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
  },
  required: ['claimId', 'claim', 'status', 'confidence'],
};

const processSchema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    highLevelDescription: factSchema,
    actors: factArraySchema,
    trigger: factSchema,
    preconditions: factArraySchema,
    processChanges: factArraySchema,
    requirementsAndKpis: factArraySchema,
    businessRules: factArraySchema,
    validations: factArraySchema,
    alternateFlows: factArraySchema,
    exceptions: factArraySchema,
    dataRequirements: factArraySchema,
    uiRequirements: factArraySchema,
    integrationRequirements: factArraySchema,
    flowSteps: { type: Type.ARRAY, items: flowStepSchema },
    outputs: factArraySchema,
    relatedProcesses: factArraySchema,
    customerDevelopments: factArraySchema,
    adaptations: factArraySchema,
    changeManagement: factArraySchema,
  },
  required: [
    'name',
    'highLevelDescription',
    'actors',
    'trigger',
    'preconditions',
    'processChanges',
    'requirementsAndKpis',
    'businessRules',
    'validations',
    'alternateFlows',
    'exceptions',
    'dataRequirements',
    'uiRequirements',
    'integrationRequirements',
    'flowSteps',
    'outputs',
    'relatedProcesses',
    'customerDevelopments',
    'adaptations',
    'changeManagement',
  ],
};

export const conceptualArtifactResponseJsonSchema = {
  type: Type.OBJECT,
  properties: {
    thinking: { type: Type.STRING },
    message: { type: Type.STRING },
    actionSummary: { type: Type.STRING },
    conceptualArtifact: {
      type: Type.OBJECT,
      properties: {
        project: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            businessProblem: factSchema,
            currentState: factSchema,
            targetState: factSchema,
            purpose: factSchema,
            scopeIn: factArraySchema,
            scopeOut: factArraySchema,
            constraints: factArraySchema,
            successMetrics: factArraySchema,
          },
          required: [
            'name',
            'businessProblem',
            'currentState',
            'targetState',
            'purpose',
            'scopeIn',
            'scopeOut',
            'constraints',
            'successMetrics',
          ],
        },
        documentControl: {
          type: Type.OBJECT,
          properties: {
            participants: factArraySchema,
            revisionDate: factSchema,
            approvers: factArraySchema,
          },
          required: ['participants', 'revisionDate', 'approvers'],
        },
        processes: { type: Type.ARRAY, items: processSchema },
        appendix: {
          type: Type.OBJECT,
          properties: {
            relatedDocuments: factArraySchema,
            attachments: factArraySchema,
          },
          required: ['relatedDocuments', 'attachments'],
        },
        review: {
          type: Type.OBJECT,
          properties: {
            risks: factArraySchema,
            assumptions: factArraySchema,
            openTopics: factArraySchema,
            conflicts: factArraySchema,
            quickActions: factArraySchema,
          },
          required: ['risks', 'assumptions', 'openTopics', 'conflicts', 'quickActions'],
        },
        evidenceClaims: { type: Type.ARRAY, items: evidenceClaimSchema },
      },
      required: ['project', 'documentControl', 'processes', 'appendix', 'review', 'evidenceClaims'],
    },
  },
  required: ['message', 'actionSummary', 'conceptualArtifact'],
};

export const CONCEPTUAL_ARTIFACT_CONTRACT_PROMPT = `
[YAPISAL KAVRAMSAL ARTIFACT SOZLESMESI]
- Bu turda Markdown dokumani dogrudan yazma. conceptualArtifact alanlarini kaynak analiziyle doldur; renderer sirket Word yapisini olusturacak.
- Kullanici mesaji ve saglanan kaynakta acikca bulunan bilgiye SOURCE, dis kaynakla eksiksiz dogrulanana VERIFIED, mantiksal cikarima INFERRED, varsayima ASSUMPTION, kararsiz veya eksik bilgiye OPEN, celiskiye CONFLICTING durumu ver.
- Kaynakta tanimlanan her ana surec icin tam bir process nesnesi uret. Surec sayisini sabitlestirme ve kaynakta olmayan surec adi ekleme.
- Her sureci aktor, tetikleyici, on kosul, degisiklik, gereksinim/KPI, is kurali, validasyon, alternatif akis, istisna, veri, ekran, entegrasyon, akis adimlari, cikti, ilgili surec, uyarlama ve degisim yonetimi boyutlarinda analiz et.
- Bir boyut icin kaynak veya guvenilir cikarim yoksa ilgili diziyi bos birak. Renderer bu boslugu gorunur bir OPEN maddesine cevirecek; ayni acik konuyu JSON icinde tekrar ederek ciktiyi sisirme.
- KPI metrigi kaynakta varsa adini kaynakta yazildigi sekliyle birebir koru; yeniden adlandirma, daraltma veya baska bir metrikle degistirme. Sayisal hedef veya sahip verilmediyse bunlari OPEN olarak ayir.
- flowSteps ana ve karar akislarini sira ile tasir. actor ve systemBehavior alanlarinda kaynak yoksa [ACIK KONU] anlamina gelen OPEN durumlu ifade kullan.
- revisionDate, katilimci, onayci, referans dokuman veya eklenti verilmediyse hayali tarih/kisi/dokuman yazma; OPEN kullan.
- evidenceClaims icinde VERIFIED yalniz https sourceUrl, sourceTitle, retrievedAt ve evidenceExcerpt birlikte varsa kullanilabilir. Kullanici girdisi tek basina VERIFIED degildir.
- review ana dokumani tekrar etmez; risk, varsayim, acik konu, celiski ve uygulanabilir hizli aksiyonlari kanit durumuna gore ayirir.
`.trim();

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function fact(value: unknown, fallbackText = 'Kaynakta bilgi verilmedi.'): ConceptualFact {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const status = FACT_STATUSES.includes(candidate.status as ConceptualFactStatus)
    ? candidate.status as ConceptualFactStatus
    : 'OPEN';
  return {
    text: text(candidate.text, fallbackText),
    status,
  };
}

function facts(value: unknown, fallbackText: string): ConceptualFact[] {
  const parsed = Array.isArray(value)
    ? value.map(item => fact(item)).filter(item => item.text)
    : [];
  return parsed.length > 0 ? parsed : [{ text: fallbackText, status: 'OPEN' }];
}

function flowSteps(value: unknown): ConceptualFlowStep[] {
  const parsed = Array.isArray(value)
    ? value.map((item): ConceptualFlowStep => {
      const candidate = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return {
        ...fact(candidate, 'Akis adimi kaynakta tanimlanmadi.'),
        actor: text(candidate.actor, 'Aktor acik konu.'),
        systemBehavior: text(candidate.systemBehavior, 'Sistem davranisi acik konu.'),
      };
    }).filter(item => item.text)
    : [];
  return parsed.length > 0
    ? parsed
    : [{
      text: 'Detayli akis kaynakta tanimlanmadi.',
      status: 'OPEN',
      actor: 'Aktor acik konu.',
      systemBehavior: 'Sistem davranisi acik konu.',
    }];
}

function normalizedEvidenceClaims(value: unknown): EvidenceClaim[] {
  return sanitizeEvidenceClaims(value).map((claim) => {
    if (claim.status !== 'VERIFIED' || validateEvidenceClaim(claim).valid) return claim;
    return {
      ...claim,
      status: 'OPEN' as EvidenceClaimStatus,
      sourceUrl: undefined,
      sourceTitle: undefined,
      retrievedAt: undefined,
      evidenceExcerpt: undefined,
      confidence: Math.min(claim.confidence, 0.5),
    };
  });
}

function process(value: unknown, index: number): ConceptualProcess {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    name: text(candidate.name, `Surec ${index + 1} - ad acik konu`),
    highLevelDescription: fact(candidate.highLevelDescription, 'Ust duzey surec aciklamasi kaynakta tanimlanmadi.'),
    actors: facts(candidate.actors, 'Surec aktorleri netlestirilmelidir.'),
    trigger: fact(candidate.trigger, 'Surec tetikleyicisi netlestirilmelidir.'),
    preconditions: facts(candidate.preconditions, 'Surec on kosullari netlestirilmelidir.'),
    processChanges: facts(candidate.processChanges, 'Mevcut ve hedef surec farki netlestirilmelidir.'),
    requirementsAndKpis: facts(candidate.requirementsAndKpis, 'Is geregi ve basari olcutleri netlestirilmelidir.'),
    businessRules: facts(candidate.businessRules, 'Is kurallari netlestirilmelidir.'),
    validations: facts(candidate.validations, 'Validasyon ve kullanici mesaji kurallari netlestirilmelidir.'),
    alternateFlows: facts(candidate.alternateFlows, 'Alternatif akislar netlestirilmelidir.'),
    exceptions: facts(candidate.exceptions, 'Istisna ve hata davranislari netlestirilmelidir.'),
    dataRequirements: facts(candidate.dataRequirements, 'Veri gereksinimleri netlestirilmelidir.'),
    uiRequirements: facts(candidate.uiRequirements, 'Ekran ve kullanici etkilesimi gereksinimleri netlestirilmelidir.'),
    integrationRequirements: facts(candidate.integrationRequirements, 'Entegrasyon gereksinimleri netlestirilmelidir.'),
    flowSteps: flowSteps(candidate.flowSteps),
    outputs: facts(candidate.outputs, 'Surec ciktilari ve kapanis durumu netlestirilmelidir.'),
    relatedProcesses: facts(candidate.relatedProcesses, 'Ilgili surecler netlestirilmelidir.'),
    customerDevelopments: facts(candidate.customerDevelopments, 'Musteri veya kullanici deneyimi gelistirmeleri netlestirilmelidir.'),
    adaptations: facts(candidate.adaptations, 'Uyarlama ihtiyaclari netlestirilmelidir.'),
    changeManagement: facts(candidate.changeManagement, 'Degisim yonetimi ihtiyaclari netlestirilmelidir.'),
  };
}

export function parseConceptualArtifact(value: unknown): ConceptualArtifactPayload | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const project = candidate.project && typeof candidate.project === 'object'
    ? candidate.project as Record<string, unknown>
    : {};
  const control = candidate.documentControl && typeof candidate.documentControl === 'object'
    ? candidate.documentControl as Record<string, unknown>
    : {};
  const appendix = candidate.appendix && typeof candidate.appendix === 'object'
    ? candidate.appendix as Record<string, unknown>
    : {};
  const review = candidate.review && typeof candidate.review === 'object'
    ? candidate.review as Record<string, unknown>
    : {};

  return {
    project: {
      name: text(project.name, 'Proje adi acik konu'),
      businessProblem: fact(project.businessProblem, 'Is problemi netlestirilmelidir.'),
      currentState: fact(project.currentState, 'Mevcut durum netlestirilmelidir.'),
      targetState: fact(project.targetState, 'Hedef durum netlestirilmelidir.'),
      purpose: fact(project.purpose, 'Dokumanin amaci netlestirilmelidir.'),
      scopeIn: facts(project.scopeIn, 'Kapsam dahilindeki yetenekler netlestirilmelidir.'),
      scopeOut: facts(project.scopeOut, 'Kapsam disi maddeler netlestirilmelidir.'),
      constraints: facts(project.constraints, 'Kisitlar netlestirilmelidir.'),
      successMetrics: facts(project.successMetrics, 'Basari metrikleri ve hedefleri netlestirilmelidir.'),
    },
    documentControl: {
      participants: facts(control.participants, 'Katilimcilar netlestirilmelidir.'),
      revisionDate: fact(control.revisionDate, 'Revize tarihi netlestirilmelidir.'),
      approvers: facts(control.approvers, 'Kontrol eden ve onaylayan roller netlestirilmelidir.'),
    },
    processes: Array.isArray(candidate.processes)
      ? candidate.processes.map((item, index) => process(item, index))
      : [],
    appendix: {
      relatedDocuments: facts(appendix.relatedDocuments, 'Ilgili veya referans dokuman bildirilmedi.'),
      attachments: facts(appendix.attachments, 'Eklenti bildirilmedi.'),
    },
    review: {
      risks: facts(review.risks, 'Riskler kapsam detaylandikca degerlendirilmelidir.'),
      assumptions: facts(review.assumptions, 'Varsayim bulunmuyor veya henuz kaydedilmedi.'),
      openTopics: facts(review.openTopics, 'Acik konular kapsam detaylandikca netlestirilmelidir.'),
      conflicts: facts(review.conflicts, 'Kaynaklarda belirgin bir celiski saptanmadi.'),
      quickActions: facts(review.quickActions, 'Sonraki analiz aksiyonu netlestirilmelidir.'),
    },
    evidenceClaims: normalizedEvidenceClaims(candidate.evidenceClaims),
  };
}

const STATUS_LABELS: Record<ConceptualFactStatus, string> = {
  SOURCE: 'KAYNAKTA',
  VERIFIED: 'DOĞRULANDI',
  INFERRED: 'ÇIKARIM',
  ASSUMPTION: 'VARSAYIM',
  OPEN: 'AÇIK KONU',
  CONFLICTING: 'ÇELİŞKİ',
};

function escapeTable(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function renderedFact(item: ConceptualFact): string {
  return `[${STATUS_LABELS[item.status]}] ${item.text}`;
}

function factList(items: ConceptualFact[]): string {
  return items.map(item => `- ${renderedFact(item)}`).join('\n');
}

function factTable(items: ConceptualFact[], prefix: string): string {
  return [
    '| ID | Gereksinim / Karar | Kanıt Durumu |',
    '|---|---|---|',
    ...items.map((item, index) => `| ${prefix}-${String(index + 1).padStart(2, '0')} | ${escapeTable(item.text)} | ${STATUS_LABELS[item.status]} |`),
  ].join('\n');
}

function mermaidLabel(value: string): string {
  return value.replace(/["`\[\]{}]/g, '').replace(/\s+/g, ' ').slice(0, 90);
}

function flowDiagram(steps: ConceptualFlowStep[]): string {
  const nodes = steps.map((step, index) => `  S${index + 1}["${mermaidLabel(step.text)}"]`);
  const links = steps.slice(1).map((_step, index) => `  S${index + 1} --> S${index + 2}`);
  return ['```mermaid', 'flowchart TD', ...nodes, ...links, '```'].join('\n');
}

function renderProcess(item: ConceptualProcess, index: number): string {
  const section = `5.${index + 1}`;
  const requirementRows = [
    ...item.requirementsAndKpis,
    ...item.businessRules,
    ...item.validations,
    ...item.dataRequirements,
    ...item.uiRequirements,
    ...item.integrationRequirements,
    ...item.outputs,
  ];
  return `### ${section}. SÜREÇ MODELİ: ${item.name}

#### ${section}.1. ÜST DÜZEY SÜREÇ AÇIKLAMASI

${renderedFact(item.highLevelDescription)}

| Boyut | Analiz |
|---|---|
| Aktörler | ${escapeTable(item.actors.map(renderedFact).join('; '))} |
| Tetikleyici | ${escapeTable(renderedFact(item.trigger))} |
| Ön Koşullar | ${escapeTable(item.preconditions.map(renderedFact).join('; '))} |

#### ${section}.2. SÜREÇ DEĞİŞİKLİKLERİ

${factTable(item.processChanges, `CHG-${index + 1}`)}

#### ${section}.3. İŞ GEREKLERİ VE KPIs (KPI'LAR)

${factTable(requirementRows, `REQ-${index + 1}`)}

#### ${section}.4. DETAYLI SÜREÇ AKIŞI

| Adım | Aktör | Kullanıcı / İş Adımı | Sistem Davranışı | Kanıt Durumu |
|---|---|---|---|---|
${item.flowSteps.map((step, stepIndex) => `| ${stepIndex + 1} | ${escapeTable(step.actor)} | ${escapeTable(step.text)} | ${escapeTable(step.systemBehavior)} | ${STATUS_LABELS[step.status]} |`).join('\n')}

**Alternatif Akışlar**

${factList(item.alternateFlows)}

**İstisnalar ve Hata Davranışları**

${factList(item.exceptions)}

#### ${section}.5. AKIŞ DİYAGRAMI

${flowDiagram(item.flowSteps)}

#### ${section}.6. İLGİLİ SÜREÇLER

${factList(item.relatedProcesses)}

#### ${section}.7. ÜST DÜZEY MÜŞTERİ GELİŞTİRMESİ

${factTable(item.customerDevelopments, `CUX-${index + 1}`)}

#### ${section}.8. ÖNEMLİ UYARLAMALAR VE AMAÇLARI

${factTable(item.adaptations, `ADP-${index + 1}`)}

#### ${section}.9. DEĞİŞİM YÖNETİMİ

${factTable(item.changeManagement, `CM-${index + 1}`)}`;
}

function renderEvidenceLedger(claims: EvidenceClaim[]): string {
  if (claims.length === 0) {
    return '| İddia | Durum | Kaynak / Kanıt | Güven |\n|---|---|---|---|\n| Yapısal kanıt kaydı bulunmuyor. | AÇIK KONU | Kaynak eklenmedi. | 0.00 |';
  }
  return [
    '| İddia | Durum | Kaynak / Kanıt | Güven |',
    '|---|---|---|---|',
    ...claims.map(claim => `| ${escapeTable(claim.claim)} | ${claim.status} | ${escapeTable(claim.sourceTitle || claim.sourceUrl || 'Kaynak eklenmedi.')} | ${claim.confidence.toFixed(2)} |`),
  ].join('\n');
}

export function renderConceptualArtifact(payload: ConceptualArtifactPayload): DocumentData {
  const processEntries = payload.processes.length > 0
    ? payload.processes.map((item, index) => `${index + 1}. ${item.name}`)
    : ['1. [AÇIK KONU] Kaynakta ana süreç tanımlanmadı.'];
  const processContent = payload.processes.length > 0
    ? payload.processes.map(renderProcess).join('\n\n')
    : '### 5.1. SÜREÇ MODELİ\n\n[AÇIK KONU] Kaynakta ana süreç tanımlanmadı; süreç modeli üretilemedi.';

  const businessAnalysis = `# KAVRAMSAL TASARIM RAPORU

## 1. PROJE KİMLİK KARTI

| Parametre | Açıklama |
|---|---|
| Proje Adı | ${escapeTable(payload.project.name)} |
| İş Problemi | ${escapeTable(renderedFact(payload.project.businessProblem))} |
| Mevcut Durum | ${escapeTable(renderedFact(payload.project.currentState))} |
| Hedef Durum | ${escapeTable(renderedFact(payload.project.targetState))} |
| Kapsam Dahili | ${escapeTable(payload.project.scopeIn.map(renderedFact).join('; '))} |
| Kapsam Dışı | ${escapeTable(payload.project.scopeOut.map(renderedFact).join('; '))} |
| Kısıtlar | ${escapeTable(payload.project.constraints.map(renderedFact).join('; '))} |
| Başarı Metrikleri | ${escapeTable(payload.project.successMetrics.map(renderedFact).join('; '))} |

## 2. AMAÇ

${renderedFact(payload.project.purpose)}

## 3. DOKÜMAN TARİHÇESİ

### 3.1. KATILIMCILAR

${factTable(payload.documentControl.participants, 'PART')}

### 3.2. REVİZE TARİH

${renderedFact(payload.documentControl.revisionDate)}

### 3.3. KONTROL EDEN VE ONAYLAYAN

${factTable(payload.documentControl.approvers, 'APR')}

## 4. İÇİNDEKİLER

1. Proje Kimlik Kartı
2. Amaç
3. Doküman Tarihçesi
4. İçindekiler
5. Süreç Tasarımı
${processEntries.map(entry => `   - ${entry}`).join('\n')}
6. Ek A

## 5. SÜREÇ TASARIMI

${processContent}

## 6. EK A

### 6.1. İLGİLİ / REFERANS DOKÜMANLAR

${factList(payload.appendix.relatedDocuments)}

### 6.2. EKLENTİ

${factList(payload.appendix.attachments)}
`;

  const review = `# DEĞERLENDİRME RAPORU

## 1. KAYNAK VE KANIT DURUMU

${renderEvidenceLedger(payload.evidenceClaims)}

## 2. RİSKLER

${factList(payload.review.risks)}

## 3. VARSAYIMLAR

${factList(payload.review.assumptions)}

## 4. AÇIK KONULAR

${factList(payload.review.openTopics)}

## 5. ÇELİŞKİLER

${factList(payload.review.conflicts)}

## 6. HIZLI AKSİYONLAR

${factList(payload.review.quickActions)}
`;

  const hasOpenItems = JSON.stringify(payload).includes('"OPEN"');
  return {
    businessAnalysis: {
      content: businessAnalysis.trim(),
      status: hasOpenItems ? 'NEEDS_REVISION' : 'DRAFT',
      flags: ['CONCEPTUAL_DESIGN', 'STRUCTURED_ARTIFACT'],
    },
    review: {
      content: review.trim(),
      status: hasOpenItems ? 'NEEDS_REVISION' : 'DRAFT',
      flags: ['EVIDENCE_REVIEW', 'OPEN_TOPICS'],
    },
    evidenceClaims: payload.evidenceClaims,
  };
}
