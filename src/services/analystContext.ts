import type {
  DocumentData,
  KnowledgeItem,
  Message,
  ProjectMemoryItem,
  ProjectMemoryItemType,
} from '../types';
import { getActiveMemoryItems } from './ai/projectMemoryEngine';
import { extractKeywords, hybridSearch } from './contextManager';

export type ModelHistoryItem = {
  role: 'user' | 'model';
  parts: { text: string }[];
};

export interface AnalystContextDebug {
  approximateRecentTokens: number;
  summarizedMessageCount: number;
  selectedMessageIds: string[];
  excludedMessageIds: string[];
  selectedKnowledgeIds: string[];
  selectedMemoryIds: string[];
  artifactPresent: boolean;
  artifactRevisionId: string | null;
}

export interface AnalystTurnContext {
  userMessage: string;
  recentConversation: Message[];
  conversationSummary: string;
  projectFacts: ProjectMemoryItem[];
  currentArtifact: DocumentData | null;
  selectedContent: string | null;
  retrievedSources: KnowledgeItem[];
  requestedOperation?: string;
  debug: AnalystContextDebug;
}

export interface PreparedConversation {
  recentConversation: Message[];
  olderConversation: Message[];
  excludedMessageIds: string[];
  approximateRecentTokens: number;
}

const normalizeText = (value = ''): string => value.replace(/\s+/g, ' ').trim();

export const approximateTokenCount = (value: string): number => (
  Math.max(1, Math.ceil(value.length / 4))
);

const messageTokenCount = (message: Message): number => (
  approximateTokenCount(`${message.role}:${message.text || ''}`)
);

export function prepareConversation(
  messages: Message[],
  options: {
    currentUserMessageId?: string;
    tokenBudget?: number;
  } = {},
): PreparedConversation {
  const excludedMessageIds: string[] = [];
  const seenIds = new Set<string>();
  const cleaned: Message[] = [];

  for (const message of messages) {
    const text = normalizeText(message.text);
    const shouldExclude = (
      !text
      || message.isTyping
      || message.isError
      || message.id === options.currentUserMessageId
      || seenIds.has(message.id)
    );
    if (shouldExclude) {
      excludedMessageIds.push(message.id);
      continue;
    }

    const previous = cleaned[cleaned.length - 1];
    if (
      previous
      && previous.role === message.role
      && normalizeText(previous.text) === text
    ) {
      excludedMessageIds.push(message.id);
      continue;
    }

    seenIds.add(message.id);
    cleaned.push({ ...message, text });
  }

  const tokenBudget = Math.max(800, options.tokenBudget ?? 6_000);
  const recentReversed: Message[] = [];
  let usedTokens = 0;

  for (let index = cleaned.length - 1; index >= 0; index -= 1) {
    const message = cleaned[index];
    const tokens = messageTokenCount(message);
    if (recentReversed.length && usedTokens + tokens > tokenBudget) break;
    recentReversed.push(message);
    usedTokens += tokens;
  }

  const recentConversation = recentReversed.reverse();
  const recentIds = new Set(recentConversation.map(message => message.id));
  const olderConversation = cleaned.filter(message => !recentIds.has(message.id));

  return {
    recentConversation,
    olderConversation,
    excludedMessageIds,
    approximateRecentTokens: usedTokens,
  };
}

export function toModelHistory(messages: Message[]): ModelHistoryItem[] {
  const history: ModelHistoryItem[] = [];

  for (const message of messages) {
    const text = normalizeText(message.text);
    if (!text) continue;
    const role = message.role === 'user' ? 'user' : 'model';
    const decorated = message.senderName
      ? `[${message.senderName}${message.senderRole ? ` - ${message.senderRole}` : ''}]: ${text}`
      : text;
    const previous = history[history.length - 1];

    if (previous?.role === role) {
      previous.parts[0].text += `\n\n${decorated}`;
    } else {
      history.push({ role, parts: [{ text: decorated }] });
    }
  }

  return history;
}

const memoryType = (key: string): ProjectMemoryItemType => {
  if (key.startsWith('decision.')) return 'DECISION';
  if (key.startsWith('constraint.')) return 'CONSTRAINT';
  if (key.startsWith('assumption.')) return 'ASSUMPTION';
  if (key.startsWith('open_question.')) return 'OPEN_QUESTION';
  if (key.startsWith('preference.')) return 'PREFERENCE';
  return 'FACT';
};

export const toCanonicalProjectFacts = (
  memory: Record<string, string> = {},
  structuredItems: ProjectMemoryItem[] = [],
): ProjectMemoryItem[] => {
  const activeStructured = getActiveMemoryItems(structuredItems);
  const representedKeys = new Set(activeStructured.map(item => item.key));
  const legacyItems = Object.entries(memory)
    .filter(([key, value]) => !representedKeys.has(key) && !!normalizeText(value))
    .slice(-60)
    .map(([key, value]) => ({
      id: `legacy:${key}`,
      key,
      type: memoryType(key),
      value: normalizeText(value),
      sourceType: 'LEGACY' as const,
      sourceId: key,
      confirmationStatus: 'PROPOSED' as const,
      confidence: 0.5,
      validFrom: new Date(0).toISOString(),
    }));

  return [...legacyItems, ...activeStructured].slice(-60);
};

export const selectRelevantProjectFacts = (
  userMessage: string,
  facts: ProjectMemoryItem[],
  limit = 12,
): ProjectMemoryItem[] => {
  const queryTokens = new Set(extractKeywords(userMessage));
  if (!queryTokens.size) return facts.slice(-Math.min(limit, 8));

  const ranked = facts.map((item, index) => {
    const factTokens = new Set(extractKeywords(`${item.key} ${item.value}`));
    const overlap = [...queryTokens].filter(token => factTokens.has(token)).length;
    const authorityBoost = item.sourceType === 'USER' && item.confirmationStatus === 'CONFIRMED' ? 2 : 0;
    const decisionBoost = ['DECISION', 'CONSTRAINT', 'BUSINESS_RULE'].includes(item.type) ? 1 : 0;
    return { item, index, overlap, score: overlap * 10 + authorityBoost + decisionBoost };
  });
  const matching = ranked.filter(candidate => candidate.overlap > 0);
  if (!matching.length) return facts.slice(-Math.min(limit, 8));
  return matching
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .slice(0, limit)
    .map(candidate => candidate.item);
};

export async function buildAnalystTurnContext(input: {
  userMessage: string;
  currentUserMessageId?: string;
  messages: Message[];
  projectMemory?: Record<string, string>;
  memoryItems?: ProjectMemoryItem[];
  knowledgeBase?: KnowledgeItem[];
  currentArtifact: DocumentData | null;
  selectedContent?: string | null;
  tokenBudget?: number;
  memoryEnabled?: boolean;
  requestedOperation?: string;
  summarize: (messages: Message[]) => Promise<string>;
  retrieveKnowledge?: (
    query: string,
    knowledgeBase: KnowledgeItem[],
  ) => Promise<KnowledgeItem[]>;
}): Promise<AnalystTurnContext> {
  const prepared = prepareConversation(input.messages, {
    currentUserMessageId: input.currentUserMessageId,
    tokenBudget: input.tokenBudget,
  });
  const memoryEnabled = input.memoryEnabled ?? true;
  let retrievedSources: KnowledgeItem[] = [];
  if (memoryEnabled) {
    try {
      retrievedSources = input.retrieveKnowledge
        ? await input.retrieveKnowledge(input.userMessage, input.knowledgeBase || [])
        : hybridSearch(input.userMessage, input.knowledgeBase || [], 5);
    } catch (error) {
      console.warn('Configured knowledge retrieval failed; lexical fallback is active.', error);
      retrievedSources = hybridSearch(input.userMessage, input.knowledgeBase || [], 5);
    }
  }

  let conversationSummary = '';
  if (memoryEnabled && prepared.olderConversation.length) {
    try {
      conversationSummary = await input.summarize(prepared.olderConversation);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      console.warn('Conversation summary could not be prepared for this turn.', error);
    }
  }
  const projectFacts = memoryEnabled
    ? selectRelevantProjectFacts(
      input.userMessage,
      toCanonicalProjectFacts(input.projectMemory, input.memoryItems),
    )
    : [];

  return {
    userMessage: normalizeText(input.userMessage),
    recentConversation: prepared.recentConversation,
    conversationSummary,
    projectFacts,
    currentArtifact: input.currentArtifact,
    selectedContent: normalizeText(input.selectedContent || '') || null,
    retrievedSources,
    requestedOperation: input.requestedOperation,
    debug: {
      approximateRecentTokens: prepared.approximateRecentTokens,
      summarizedMessageCount: prepared.olderConversation.length,
      selectedMessageIds: prepared.recentConversation.map(message => message.id),
      excludedMessageIds: prepared.excludedMessageIds,
      selectedKnowledgeIds: retrievedSources.map(item => item.id),
      selectedMemoryIds: projectFacts.map(item => item.id),
      artifactPresent: !!input.currentArtifact,
      artifactRevisionId: input.currentArtifact?.artifactMeta?.revisionId || null,
    },
  };
}

const compactArtifact = (document: DocumentData | null): string => {
  if (!document) return '';
  return [
    document.businessAnalysis?.content
      ? `[BUSINESS ANALYSIS]\n${document.businessAnalysis.content.slice(0, 10_000)}`
      : '',
    document.review?.content
      ? `[REVIEW]\n${document.review.content.slice(0, 12_000)}`
      : '',
  ].filter(Boolean).join('\n\n');
};

export function renderAnalystTurnContext(context: AnalystTurnContext): string {
  const artifactContext = compactArtifact(context.currentArtifact);
  const blocks = [
    '[CANONICAL PROJECT CONTEXT]',
    'Aşağıdaki blok bu tur için hazırlanmış tek proje bağlamıdır.',
    context.conversationSummary
      ? `[CONVERSATION SUMMARY]\n${context.conversationSummary}`
      : '',
    context.projectFacts.length
      ? [
        '[PROJECT MEMORY WITH PROVENANCE]',
        'CONFIRMED USER kayıtları kullanıcı gerçeğidir. PROPOSED, LEGACY ve AI_INFERENCE kayıtlarını kesin gerçek sayma; çelişkide kullanıcının en yeni açık beyanını esas al.',
        ...context.projectFacts.map(item => (
          `- ${item.type} | ${item.key}: ${item.value}`
          + ` | source=${item.sourceType}:${item.sourceId}`
          + ` | status=${item.confirmationStatus}`
          + ` | confidence=${item.confidence.toFixed(2)}`
        )),
      ].join('\n')
      : '',
    context.retrievedSources.length
      ? [
        '[RETRIEVED WORKSPACE KNOWLEDGE]',
        ...context.retrievedSources.map(item => `- ${item.content} (önem ${item.importance}/10)`),
      ].join('\n')
      : '',
    artifactContext
      ? `[CURRENT LIVING ARTIFACT]\n${artifactContext}`
      : '',
    context.selectedContent
      ? `[SELECTED CONTENT]\n${context.selectedContent.slice(0, 4_000)}`
      : '',
  ];

  return blocks.filter(Boolean).join('\n\n');
}
