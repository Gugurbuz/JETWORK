import type { KnowledgeItem, Message } from '../types';
import { callGemini } from './geminiService';

// Keep this list intentionally small. Domain-bearing words such as "iş",
// "sistem", "uygulama", "veri", "belge" and "kural" must remain searchable.
const STOP_WORDS = new Set([
  'acaba',
  'ama',
  'ancak',
  'artık',
  'bazı',
  'belki',
  'bir',
  'biri',
  'biz',
  'bu',
  'bunu',
  'da',
  'daha',
  'de',
  'diye',
  'en',
  'fakat',
  'gibi',
  'hem',
  'her',
  'için',
  'ile',
  'ise',
  'ki',
  'mı',
  'mi',
  'mu',
  'mü',
  'nasıl',
  'ne',
  'neden',
  'o',
  'olan',
  'olarak',
  'oldu',
  'şu',
  've',
  'veya',
]);

const normalizeForSearch = (value = ''): string => value
  .toLocaleLowerCase('tr-TR')
  .normalize('NFC')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const extractKeywords = (text: string): string[] => {
  const words = normalizeForSearch(text).split(' ');
  return Array.from(new Set(
    words.filter(word => word.length > 1 && !STOP_WORDS.has(word)),
  ));
};

const tokenSet = (item: KnowledgeItem): Set<string> => new Set([
  ...extractKeywords(item.content),
  ...item.keywords.flatMap(extractKeywords),
]);

export const hybridSearch = (
  query: string,
  knowledgeBase: KnowledgeItem[],
  limit = 3,
): KnowledgeItem[] => {
  const queryKeywords = extractKeywords(query);
  if (!queryKeywords.length || !knowledgeBase.length) return [];

  const normalizedQuery = normalizeForSearch(query);
  return knowledgeBase
    .map(item => {
      const itemTokens = tokenSet(item);
      const overlap = queryKeywords.filter(keyword => itemTokens.has(keyword)).length;
      const coverage = overlap / queryKeywords.length;
      const precision = overlap / Math.max(itemTokens.size, 1);
      const phraseBoost = normalizeForSearch(item.content).includes(normalizedQuery) ? 0.2 : 0;
      const importance = Math.min(Math.max(item.importance, 0), 10) / 10;
      return {
        item,
        overlap,
        score: (coverage * 0.62) + (precision * 0.18) + (importance * 0.2) + phraseBoost,
      };
    })
    .filter(candidate => candidate.overlap > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(candidate => candidate.item);
};

export const summarizeConversation = async (
  messages: Message[],
  signal?: AbortSignal,
): Promise<string> => {
  const summarizable = messages.filter(message => (
    !message.isTyping
    && !message.isError
    && !!message.text?.trim()
  ));
  if (!summarizable.length) return '';

  const conversationText = summarizable
    .map(message => `${message.role === 'user' ? 'Kullanıcı' : 'JetWork'}: ${message.text.trim()}`)
    .join('\n');

  const result = await callGemini({
    model: 'gemini-3.1-flash-lite-preview',
    signal,
    timeoutMs: 30_000,
    systemInstruction: [
      'Uzun bir proje konuşmasının mevcut turdan önce kullanılacak çalışma özetini üret.',
      'Kararları, kullanıcı tarafından verilen gerçekleri, kısıtları, varsayımları, açık soruları ve değişen kararları koru.',
      'AI önerilerini kullanıcı kararı gibi yazma. Kısa, yoğun ve Türkçe bir özet döndür.',
    ].join(' '),
    contents: [{ role: 'user', parts: [{ text: conversationText }] }],
    onChunk: () => {},
  });

  return result.text.trim();
};

export const extractKeyFacts = async (
  text: string,
): Promise<{ fact: string; importance: number }[]> => {
  const result = await callGemini({
    model: 'gemini-3.1-flash-lite-preview',
    systemInstruction: [
      'Yalnız kullanıcının açıkça verdiği ve kalıcı olarak hatırlanması yararlı proje gerçeklerini çıkar.',
      'Öneri, tahmin veya çıkarımı gerçek gibi kaydetme.',
      'Önemli bilgi yoksa boş dizi döndür.',
      'SADECE JSON: [{ "fact": "...", "importance": 8 }]',
    ].join(' '),
    contents: [{ role: 'user', parts: [{ text }] }],
    onChunk: () => {},
  });

  try {
    const json = result.text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to parse key facts JSON', error);
    return [];
  }
};
