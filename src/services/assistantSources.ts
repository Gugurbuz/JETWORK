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

export function splitAssistantSources(
  sources: AssistantKnowledgeSource[] = [],
  existingGroundingUrls: { uri: string; title: string }[] = [],
): AssistantSourceView {
  const knowledgeSources: AssistantKnowledgeSource[] = [];
  const mediaSources: AssistantKnowledgeSource[] = [];
  const groundingUrls: { uri: string; title: string }[] = [];
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
    if (source.sourceType === 'media') { mediaSources.push(source); return; }
    if (source.sourceType === 'web') {
      appendGrounding({
        uri: source.url,
        title: sourceTitle(source),
      });
      return;
    }
    knowledgeSources.push(source);
  });

  return { knowledgeSources, mediaSources, groundingUrls };
}
