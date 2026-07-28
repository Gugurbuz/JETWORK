import { marked } from 'marked';
import type { DocumentData, DocumentQualityFinding, SectionData } from '../types';
import { evaluateDocumentQualityGate, type DocumentQualityGateResult } from './documentQualityGate';
import { evaluateBaQualityV2, type BaQualityReportV2 } from '../modules/ai-ba-engine';
import { analyzeSourceIntelligence, normalizeSourceText } from './sourceIntelligence';
import { conceptualTemplateCoverage } from './conceptualTemplate';
import type { AiTurnDecision } from './ai/aiTurnDecision';
import type { AdaptiveReasoningPlan } from './ai/adaptiveReasoningPolicy';
import { evaluateAdaptiveReasoningCritique } from './ai/adaptiveReasoningCritic';
import { invalidEvidenceClaims } from './evidenceClaims';
import { sanitizeDocumentHtml } from '../lib/sanitizeHtml';

export interface DocumentPostProcessResult {
  document: DocumentData;
  qualityGate: DocumentQualityGateResult;
  qualityReportV2: BaQualityReportV2;
  changedSections: string[];
}

export interface DocumentPostProcessContext {
  sourceText?: string;
  workspaceTitle?: string;
  turnDecision?: AiTurnDecision;
  reasoningPlan?: AdaptiveReasoningPlan;
}

interface SourceFidelityFinding {
  signal: string;
  missing: string[];
  action: string;
}

const SECTION_LABELS: Record<string, string> = {
  businessAnalysis: 'BA Analiz',
  review: 'Review',
};

function isHtml(value: string): boolean {
  return /<\/?(h\d|p|table|ul|ol|li|div|section|article|strong|em|pre|code|blockquote|br|span)\b/i.test(value);
}

function looksLikeMarkdown(value: string): boolean {
  return /(^|\n)#{1,4}\s+/.test(value)
    || /\*\*[^*]+\*\*/.test(value)
    || /(^|\n)\s*[-*]\s+/.test(value)
    || /(^|\n)\s*\d+\.\s+/.test(value)
    || /\|\s*[^\n]+\s*\|/.test(value)
    || /```/.test(value);
}

export function renderMarkdownToHtml(content = ''): string {
  const trimmed = content.trim();
  if (!trimmed) return '';
  if (isHtml(trimmed) && !looksLikeMarkdown(trimmed)) return sanitizeDocumentHtml(trimmed);
  return sanitizeDocumentHtml(marked.parse(trimmed, { gfm: true, breaks: false }) as string);
}

function normalizeSection(section?: SectionData, existing?: SectionData): SectionData {
  const incomingContent = section?.content?.trim() || '';
  const content = incomingContent || existing?.content || '';
  return {
    content: renderMarkdownToHtml(content),
    status: section?.status || existing?.status || 'DRAFT',
    flags: Array.from(new Set([...(existing?.flags || []), ...(section?.flags || [])])),
  };
}

function sectionsDiffer(left?: SectionData, right?: SectionData): boolean {
  return (left?.content || '') !== (right?.content || '')
    || (left?.status || '') !== (right?.status || '')
    || JSON.stringify(left?.flags || []) !== JSON.stringify(right?.flags || []);
}

function importantTokens(value: string): string[] {
  const stopWords = new Set(['icin', 'ile', 've', 'veya', 'olan', 'olarak', 'proje', 'sistem', 'surec']);
  return normalizeSourceText(value)
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 3 && !stopWords.has(token));
}

function isSignalRepresented(documentText: string, signal: string, minimumCoverage = 0.67): boolean {
  const normalizedDocument = normalizeSourceText(documentText);
  const normalizedSignal = normalizeSourceText(signal);
  if (!normalizedSignal || normalizedDocument.includes(normalizedSignal)) return true;
  const tokens = importantTokens(signal);
  if (tokens.length === 0) return true;
  const matched = tokens.filter(token => normalizedDocument.includes(token)).length;
  return matched / tokens.length >= (tokens.length <= 2 ? 1 : minimumCoverage);
}

function evaluateSourceFidelity(
  report: ReturnType<typeof analyzeSourceIntelligence>,
  businessContent: string,
): SourceFidelityFinding[] {
  if (!businessContent.trim()) return [];

  const groups = [
    {
      signal: 'Proje adi / ana baglam',
      items: report.inferredProjectName ? [report.inferredProjectName] : [],
      action: 'Proje adini ve ana baglami kaynakla uyumlu hale getir.',
      minimumCoverage: 0.75,
    },
    {
      signal: 'Kaynak surec omurgasi',
      items: report.processes.map(process => process.title),
      action: 'Eksik surecleri kaynakli bir repair onizlemesinde ele al.',
      minimumCoverage: 0.75,
    },
    {
      signal: 'Roller / aktorler',
      items: report.roles,
      action: 'Eksik aktor ve sorumluluklari kaynakli bir repair onizlemesinde ele al.',
      minimumCoverage: 0.67,
    },
    {
      signal: 'Sistemler',
      items: report.systems,
      action: 'Eksik sistem ve veri sahipligi kararlarini kaynakli bir repair onizlemesinde ele al.',
      minimumCoverage: 0.8,
    },
    {
      signal: 'Entegrasyonlar',
      items: report.integrations,
      action: 'Eksik entegrasyon detaylarini kaynakli bir repair onizlemesinde ele al.',
      minimumCoverage: 0.67,
    },
    {
      signal: 'Ekran / UI ihtiyaclari',
      items: report.uiNeeds,
      action: 'Eksik ekran davranislarini kaynakli bir repair onizlemesinde ele al.',
      minimumCoverage: 0.67,
    },
    {
      signal: 'KPI / basari olcutleri',
      items: report.kpis,
      action: 'Eksik KPI maddelerini kaynakli bir repair onizlemesinde ele al.',
      minimumCoverage: 0.67,
    },
  ];

  return groups.flatMap(group => {
    const items = Array.from(new Set(group.items)).filter(Boolean).slice(0, 12);
    if (items.length === 0) return [];
    const missing = items.filter(item => !isSignalRepresented(businessContent, item, group.minimumCoverage));
    if (missing.length !== items.length && missing.length / items.length < 0.5) return [];
    return [{ signal: group.signal, missing, action: group.action }];
  }).slice(0, 10);
}

/**
 * Read-only assessment boundary. It may normalize representation and attach
 * quality metadata, but it never creates or repairs business document prose.
 */
export function postProcessDocumentData(
  incoming: DocumentData,
  existing?: DocumentData | null,
  context: DocumentPostProcessContext = {},
): DocumentPostProcessResult {
  const base: DocumentData = existing || {
    businessAnalysis: { content: '', status: 'DRAFT', flags: [] },
    review: { content: '', status: 'DRAFT', flags: [] },
  };

  const document: DocumentData = {
    ...base,
    ...incoming,
    businessAnalysis: normalizeSection(incoming.businessAnalysis, base.businessAnalysis),
    ...(incoming.review || base.review
      ? { review: normalizeSection(incoming.review, base.review) }
      : {}),
    suggestions: incoming.suggestions ?? base.suggestions,
    evidenceClaims: incoming.evidenceClaims ?? base.evidenceClaims,
  };

  const sourceReport = analyzeSourceIntelligence({
    sourceText: context.sourceText || '',
    workspaceTitle: context.workspaceTitle,
  });

  const qualityGate = evaluateDocumentQualityGate(document, {
    artifactProfile: context.turnDecision?.artifactProfile,
    sourceProcessTitles: sourceReport.processes.map(process => process.title),
    sourceSensitive: context.turnDecision?.sourcePolicy.sourceSensitive,
    reasoningPlan: context.reasoningPlan,
    sourceText: context.sourceText,
  });
  const qualityReportV2 = evaluateBaQualityV2(document);
  const templateCoverage = conceptualTemplateCoverage(document.businessAnalysis?.content || '');
  const templateApplies = context.turnDecision?.artifactProfile.id.startsWith('conceptual_design')
    || /kavramsal\s+tasar/i.test(document.businessAnalysis?.content || '');
  const sourceFidelityFindings = evaluateSourceFidelity(sourceReport, document.businessAnalysis?.content || '');
  const invalidClaims = invalidEvidenceClaims(document.evidenceClaims || []);
  const adaptiveCritique = evaluateAdaptiveReasoningCritique({
    document,
    plan: context.reasoningPlan,
    sourceText: context.sourceText,
  });
  const findings: DocumentQualityFinding[] = [];

  const addFinding = (finding: DocumentQualityFinding): void => {
    if (!findings.some(item => item.category === finding.category && item.message === finding.message)) {
      findings.push(finding);
    }
  };

  qualityGate.missingSections
    .filter(message => !message.startsWith('Adaptif muhakeme:'))
    .forEach((message, index) => addFinding({
      id: `QG-MISSING-${String(index + 1).padStart(3, '0')}`,
      category: message.startsWith('Kurumsal Word sablonu')
        ? 'template'
        : message.startsWith('Artifact profili') || message.startsWith('Kaynak surec kapsami')
          ? 'coverage'
          : message.includes('EvidenceClaim') || message.includes('kanit')
            ? 'source'
            : 'content',
      severity: qualityGate.canPublishToPanel ? 'warning' : 'error',
      message,
      recommendedAction: 'Eksik alani kaynak veya acik varsayimla tamamla.',
    }));

  qualityGate.warnings.forEach((message, index) => addFinding({
    id: `QG-WARNING-${String(index + 1).padStart(3, '0')}`,
    category: 'consistency',
    severity: 'warning',
    message,
  }));

  if (templateApplies) {
    templateCoverage.missing.forEach((message, index) => addFinding({
      id: `QG-TEMPLATE-${String(index + 1).padStart(3, '0')}`,
      category: 'template',
      severity: 'warning',
      message,
      recommendedAction: 'Sablon repair islemi icin ayri bir onizleme olustur.',
    }));
  }

  sourceReport.mismatchWarnings.forEach((message, index) => addFinding({
    id: `QG-SOURCE-${String(index + 1).padStart(3, '0')}`,
    category: 'source',
    severity: 'error',
    message,
    recommendedAction: 'Kaynakla celisen icerigi duzeltmeden dokumani onaylama.',
  }));

  sourceFidelityFindings.forEach((finding, index) => addFinding({
    id: `QG-FIDELITY-${String(index + 1).padStart(3, '0')}`,
    category: 'source',
    severity: 'error',
    message: `${finding.signal}: ${finding.missing.join(', ')}`,
    recommendedAction: finding.action,
  }));

  invalidClaims.forEach((item, index) => addFinding({
    id: `QG-EVIDENCE-${String(index + 1).padStart(3, '0')}`,
    category: 'source',
    severity: 'error',
    message: `${item.claim.claimId}: ${item.errors.join('; ')}`,
    recommendedAction: 'Iddiayi OPEN/ASSUMPTION yap veya eksik resmi kaniti ekle.',
  }));

  adaptiveCritique.findings.forEach(finding => addFinding({
    id: finding.id,
    category: finding.id === 'AR-EVIDENCE'
      ? 'source'
      : finding.id === 'AR-CRITIC' || finding.id === 'AR-GAP-REVIEW'
        ? 'consistency'
        : 'coverage',
    severity: finding.severity,
    message: finding.message,
    recommendedAction: finding.recommendedAction,
  }));

  document.score = qualityGate.score;
  document.scoreExplanation = qualityGate.reason;
  document.qualityAssessment = {
    evaluatedAt: new Date().toISOString(),
    score: document.score,
    canPublish: qualityGate.canPublishToPanel,
    summary: document.scoreExplanation,
    findings,
    sourceConfidence: sourceReport.confidence,
    templateCoverage: templateApplies ? templateCoverage : undefined,
  };

  const changedSections = Object.entries(SECTION_LABELS)
    .filter(([key]) => sectionsDiffer((document as any)[key], (base as any)[key]))
    .map(([, label]) => label);

  return { document, qualityGate, qualityReportV2, changedSections };
}
