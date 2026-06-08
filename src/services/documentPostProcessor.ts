import { marked } from 'marked';
import type { DocumentData, SectionData } from '../types';
import { evaluateDocumentQualityGate, type DocumentQualityGateResult } from './documentQualityGate';
import {
  buildBaQualityReviewMarkdown,
  evaluateBaQualityV2,
  replaceBaEngineReviewBlock,
  type BaQualityReportV2,
} from '../modules/ai-ba-engine';

export interface DocumentPostProcessResult {
  document: DocumentData;
  qualityGate: DocumentQualityGateResult;
  qualityReportV2: BaQualityReportV2;
  changedSections: string[];
}

const SECTION_LABELS: Record<string, string> = {
  businessAnalysis: 'BA Analiz',
  review: 'Review',
};

const LEGACY_QUALITY_BLOCK_START = '<!-- BA_QUALITY_GATE_START -->';
const LEGACY_QUALITY_BLOCK_END = '<!-- BA_QUALITY_GATE_END -->';

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

function replaceMarkedBlock(currentContent: string, nextBlock: string, startMarker: string, endMarker: string): string {
  const current = currentContent || '';
  const escapedStart = startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRegex = new RegExp(`${escapedStart}[\s\S]*?${escapedEnd}`, 'm');
  if (blockRegex.test(current)) return current.replace(blockRegex, nextBlock);
  return [current.trim(), nextBlock].filter(Boolean).join('\n\n');
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
    review: { content: '', status: 'DRAFT' as const, flags: [] },
  };

  const document: DocumentData = {
    businessAnalysis: normalizeSection(incoming.businessAnalysis, base.businessAnalysis, true),
    ...(incoming.review || base.review ? { review: normalizeSection(incoming.review, base.review, true) } : {}),
    suggestions: incoming.suggestions || base.suggestions,
  };

  const qualityGate = evaluateDocumentQualityGate(document);
  const qualityFlags = [
    ...qualityGate.warnings,
    ...(!qualityGate.canPublishToPanel ? [qualityGate.reason] : []),
  ];

  if (qualityFlags.length) {
    const legacyQualityBlock = renderMarkdownToHtml([
      LEGACY_QUALITY_BLOCK_START,
      '## BA Analiz Kalite Kapısı',
      `**Kalite Puanı:** ${qualityGate.score}/100`,
      `**Durum:** ${qualityGate.canPublishToPanel ? 'Taslak yayınlanabilir' : 'Eksik / yüzeysel taslak'}`,
      '',
      '### Eksik veya Zayıf Alanlar',
      ...(qualityGate.missingSections.length ? qualityGate.missingSections.map(item => `- ${item}`) : ['- Kritik eksik bulunmadı.']),
      '',
      '### Uyarılar',
      ...(qualityFlags.length ? qualityFlags.map(item => `- ${item}`) : ['- Uyarı yok.']),
      LEGACY_QUALITY_BLOCK_END,
    ].join('\n'));

    document.review = {
      content: replaceMarkedBlock(document.review?.content || '', legacyQualityBlock, LEGACY_QUALITY_BLOCK_START, LEGACY_QUALITY_BLOCK_END),
      status: qualityGate.canPublishToPanel ? 'DRAFT' : 'NEEDS_REVISION',
      flags: Array.from(new Set([...(document.review?.flags || []), ...qualityFlags])),
    };
  }

  const qualityReportV2 = evaluateBaQualityV2(document);
  const qualityReportHtml = renderMarkdownToHtml(buildBaQualityReviewMarkdown(qualityReportV2));
  const reviewFlags = Array.from(new Set([
    ...(document.review?.flags || []),
    ...qualityReportV2.warnings,
    ...(!qualityReportV2.canPublish ? qualityReportV2.priorityFixes.slice(0, 4) : []),
  ]));

  document.review = {
    content: replaceBaEngineReviewBlock(document.review?.content || '', qualityReportHtml),
    status: qualityReportV2.canPublish ? (document.review?.status || 'DRAFT') : 'NEEDS_REVISION',
    flags: reviewFlags,
  };

  document.score = Math.min(qualityGate.score, qualityReportV2.score);
  document.scoreExplanation = qualityReportV2.summary;

  const changedSections = Object.entries(SECTION_LABELS)
    .filter(([key]) => sectionsDiffer((document as any)[key], (base as any)[key]))
    .map(([, label]) => label);

  return { document, qualityGate, qualityReportV2, changedSections };
}
