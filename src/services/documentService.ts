import { marked } from 'marked';
import { DocumentData, SectionData } from '../types';
import { parseBusinessAnalysis } from '../utils/documentUtils';

export const processSection = (
  data: any,
  existing?: SectionData,
  parseMarkdown = true
): SectionData => {
  let content = '';
  let status: 'DRAFT' | 'NEEDS_REVISION' | 'APPROVED' = existing?.status || 'DRAFT';
  let flags: string[] = existing?.flags || [];

  if (data && typeof data === 'object' && 'content' in data) {
    content = data.content || '';
    status = data.status || status;
    flags = data.flags || flags;
  } else {
    content = typeof data === 'string' ? data : JSON.stringify(data);
  }

  const seemsLikeHtml = content.match(/<table|<h[1-6]>|<ul|<ol|<div|<p>/i);

  if (parseMarkdown && content && !seemsLikeHtml) {
    content = marked.parse(content) as string;
  }

  return { content, status, flags };
};

export const applyDocumentUpdates = (
  prev: DocumentData | null,
  parsedDocument: Record<string, any>
): { newDoc: DocumentData; hasChanges: boolean } => {
  const newDoc = { ...prev } as DocumentData;
  let hasChanges = false;

  const sections = ['businessAnalysis', 'code', 'test', 'review', 'bpmn'] as const;

  sections.forEach((section) => {
    if (parsedDocument[section]) {
      let newContent = parsedDocument[section].content || '';
      const currentSection = prev?.[section] as SectionData | undefined;

      const parsedContent =
        section === 'businessAnalysis' ? parseBusinessAnalysis(newContent) : newContent;

      if (parsedContent && parsedContent !== currentSection?.content) {
        (newDoc as any)[section] = processSection(
          parsedContent,
          currentSection,
          section !== 'bpmn'
        );
        hasChanges = true;
      }
    }
  });

  return { newDoc, hasChanges };
};

export const buildDocumentActions = (
  newDoc: DocumentData,
  previousDoc?: DocumentData
): string[] => {
  const actions: string[] = [];

  if (!previousDoc) {
    if (newDoc.businessAnalysis) actions.push('BA Analiz oluşturuldu');
    if (newDoc.code) actions.push('IT Analiz oluşturuldu');
    if (newDoc.test) actions.push('Test senaryoları oluşturuldu');
    if (newDoc.bpmn) actions.push('FLOW oluşturuldu');
  } else {
    if (newDoc.businessAnalysis !== previousDoc.businessAnalysis)
      actions.push('BA Analiz güncellendi');
    if (newDoc.code !== previousDoc.code) actions.push('IT Analiz güncellendi');
    if (newDoc.test !== previousDoc.test) actions.push('Test senaryoları güncellendi');
    if (newDoc.bpmn !== previousDoc.bpmn) actions.push('FLOW güncellendi');
  }

  return actions;
};
