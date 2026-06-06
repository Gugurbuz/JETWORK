import { marked } from 'marked';
import type { DocumentData, SectionData } from '../types';
import { evaluateDocumentQualityGate, type DocumentQualityGateResult } from './documentQualityGate';

export interface DocumentPostProcessResult {
  document: DocumentData;
  qualityGate: DocumentQualityGateResult;
  changedSections: string[];
}

const SECTION_LABELS: Record<string, string> = {
  businessAnalysis: 'BA Analiz',
  code: 'IT Analiz',
  test: 'Test',
  bpmn: 'FLOW',
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
  if (isHtml(trimmed) && !looksLikeMarkdown(trimmed)) return trimmed;
  return marked.parse(trimmed, { gfm: true, breaks: false }) as string;
}

function normalizeSection(section?: SectionData, existing?: SectionData, parseMarkdown = true): SectionData {
  const incomingContent = section?.content?.trim() || '';
  const existingContent = existing?.content || '';
  const content = incomingContent || existingContent;
  const html = parseMarkdown ? renderMarkdownToHtml(content) : content;

  return {
    content: html,
    status: section?.status || existing?.status || 'DRAFT',
    flags: Array.from(new Set([...(existing?.flags || []), ...(section?.flags || [])])),
  };
}

function sectionsDiffer(a?: SectionData, b?: SectionData): boolean {
  return (a?.content || '') !== (b?.content || '')
    || (a?.status || '') !== (b?.status || '')
    || JSON.stringify(a?.flags || []) !== JSON.stringify(b?.flags || []);
}

export function postProcessDocumentData(
  incoming: DocumentData,
  existing?: DocumentData | null,
): DocumentPostProcessResult {
  const base = existing || {
    businessAnalysis: { content: '', status: 'DRAFT' as const, flags: [] },
    code: { content: '', status: 'DRAFT' as const, flags: [] },
    test: { content: '', status: 'DRAFT' as const, flags: [] },
  };

  const document: DocumentData = {
    businessAnalysis: normalizeSection(incoming.businessAnalysis, base.businessAnalysis, true),
    code: normalizeSection(incoming.code, base.code, true),
    test: normalizeSection(incoming.test, base.test, true),
    ...(incoming.bpmn || base.bpmn ? { bpmn: normalizeSection(incoming.bpmn, base.bpmn, false) } : {}),
    ...(incoming.review || base.review ? { review: normalizeSection(incoming.review, base.review, true) } : {}),
    suggestions: incoming.suggestions || base.suggestions,
  };

  const qualityGate = evaluateDocumentQualityGate(document);
  const qualityFlags = [
    ...qualityGate.warnings,
    ...(!qualityGate.canPublishToPanel ? [qualityGate.reason] : []),
  ];

  if (qualityFlags.length) {
    document.review = normalizeSection({
      content: [
        document.review?.content || '',
        '## Doküman Kalite Kapısı',
        `**Kalite Puanı:** ${qualityGate.score}/100`,
        `**Durum:** ${qualityGate.canPublishToPanel ? 'Taslak yayınlanabilir' : 'Eksik / yüzeysel taslak'}`,
        '',
        '### Eksik veya Zayıf Alanlar',
        ...(qualityGate.missingSections.length ? qualityGate.missingSections.map(item => `- ${item}`) : ['- Kritik eksik bulunmadı.']),
        '',
        '### Uyarılar',
        ...(qualityFlags.length ? qualityFlags.map(item => `- ${item}`) : ['- Uyarı yok.']),
      ].join('\n'),
      status: qualityGate.canPublishToPanel ? 'DRAFT' : 'NEEDS_REVISION',
      flags: qualityFlags,
    }, document.review, true);
  }

  document.score = qualityGate.score;
  document.scoreExplanation = qualityGate.reason;

  const changedSections = Object.entries(SECTION_LABELS)
    .filter(([key]) => sectionsDiffer((document as any)[key], (base as any)[key]))
    .map(([, label]) => label);

  return { document, qualityGate, changedSections };
}
