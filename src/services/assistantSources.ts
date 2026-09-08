import type { AssistantKnowledgeSource } from '../types';

export interface AssistantSourceView {
  knowledgeSources: AssistantKnowledgeSource[];
  mediaSources: AssistantKnowledgeSource[];
  groundingUrls: { uri: string; title: string }[];
}

const cleanUrl = (value?: string): string | undefined => {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url : undefined;
};

const sourceTitle = (source: AssistantKnowledgeSource): string => (
  String(source.title || source.sourceName || source.url || 'Web kaynağı').trim()
);

const knowledgeDocumentKey = (source: AssistantKnowledgeSource): string => {
  const sourceId = String(source.sourceId || '').trim();
  if (sourceId) return `id:${sourceId}`;
  const sourceName = String(source.sourceName || '').trim().toLocaleLowerCase('tr-TR');
  if (sourceName) return `name:${sourceName}`;
  const canonicalKey = String(source.canonicalKey || '').trim().toLocaleLowerCase('en-US');
  return `object:${canonicalKey}`;
};

/**
 * UI source counts represent distinct enterprise source documents, not every
 * canonical object extracted from the same document. A catalog enumeration can
 * legitimately return many methods/classes from one source file; showing those
 * objects as dozens of independent "kurumsal kaynak" entries is misleading.
 *
 * Canonical object identity remains available in runtime/tool telemetry. This
 * presentation boundary only de-duplicates the user-visible source-document view.
 */
export function splitAssistantSources(
  sources: AssistantKnowledgeSource[] = [],
  existingGroundingUrls: { uri: string; title: string }[] = [],
): AssistantSourceView {
  const knowledgeSources: AssistantKnowledgeSource[] = [];
  const mediaSources: AssistantKnowledgeSource[] = [];
  const groundingUrls: { uri: string; title: string }[] = [];
  const seenKnowledgeDocuments = new Set<string>();
  const seenMedia = new Set<string>();
  const seenGrounding = new Set<string>();

  const appendGrounding = (candidate: { uri?: string; title?: string }) => {
    const uri = cleanUrl(candidate.uri);
    if (!uri) return;
    const key = uri.toLocaleLowerCase('tr-TR');
    if (seenGrounding.has(key)) return;
    seenGrounding.add(key);
    groundingUrls.push({
      uri,
      title: String(candidate.title || uri).trim() || uri,
    });
  };

  existingGroundingUrls.forEach(appendGrounding);

  sources.forEach(source => {
    if (source.sourceType === 'media') {
      const mediaKey = String(source.sourceId || source.contentHash || source.sourceName || source.title || '').trim();
      if (!mediaKey || !seenMedia.has(mediaKey)) {
        if (mediaKey) seenMedia.add(mediaKey);
        mediaSources.push(source);
      }
      return;
    }
    if (source.sourceType === 'web') {
      appendGrounding({
        uri: source.url,
        title: sourceTitle(source),
      });
      return;
    }
    const key = knowledgeDocumentKey(source);
    if (seenKnowledgeDocuments.has(key)) return;
    seenKnowledgeDocuments.add(key);
    knowledgeSources.push(source);
  });

  return { knowledgeSources, mediaSources, groundingUrls };
}