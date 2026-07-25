import type { KnowledgeItem, Message } from '../types';
import { callGemini } from './geminiService';

const STOP_WORDS = new Set([
  'acaba', 'ama', 'ancak', 'artık', 'az', 'bazı', 'belki', 'ben', 'bir', 'biz',
  'bu', 'bütün', 'çok', 'da', 'daha', 'de', 'diye', 'en', 'fakat', 'gibi',
  'hangi', 'her', 'hiç', 'için', 'ile', 'ise', 'kadar', 'ki', 'kim', 'mi',
  'mı', 'mu', 'mü', 'nasıl', 'ne', 'neden', 'niçin', 'o', 'olan', 'olarak',
  'oldu', 'olduğu', 'sonra', 'şimdi', 'şu', 'tüm', 've', 'veya', 'ya', 'yok',
]);

function normalize(value = ''): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const extractKeywords = (text: string): string[] => {
  const words = normalize(text).split(/\s+/);
  return [...new Set(words.filter(word => word.length > 2 && !STOP_WORDS.has(word)))];
};

export const hybridSearch = (
  query: string,
  knowledgeBase: KnowledgeItem[],
  limit = 3,
): KnowledgeItem[] => {
  const queryKeywords = extractKeywords(query);
  if (queryKeywords.length === 0) return [];

  const normalizedQuery = normalize(query);
  return knowledgeBase
    .map(item => {
      const itemKeywords = new Set([
        ...item.keywords.flatMap(extractKeywords),
        ...extractKeywords(item.content),
      ]);
      const matched = queryKeywords.filter(keyword => itemKeywords.has(keyword)).length;
      const keywordOverlap = matched / Math.max(queryKeywords.length, 1);
      const contentOverlap = matched / Math.max(itemKeywords.size, 1);
      const phraseBoost = normalize(item.content).includes(normalizedQuery) ? 0.2 : 0;
      const score = (keywordOverlap * 0.55)
        + (contentOverlap * 0.15)
        + ((item.importance / 10) * 0.1)
        + phraseBoost;
      return { item, score };
    })
    .filter(result => result.score >= 0.12)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(result => result.item);
};

export const summarizeConversation = async (messages: Message[]): Promise<string> => {
  const eligible = messages.filter(message => !message.isTyping && !!message.text?.trim());
  if (eligible.length === 0) return '';

  const conversationText = eligible
    .map(message => `${message.role === 'user' ? 'Kullanıcı' : 'Yapay Zeka'}: ${message.text}`)
    .join('\n');
  const result = await callGemini({
    model: 'gemini-3.1-flash-lite-preview',
    systemInstruction: [
      'Sen JETWORK Project Brain için bağlam özeti hazırlıyorsun.',
      'Yalnız kullanıcı tarafından belirtilen kararları, düzeltmeleri, kapsamı, kısıtları, iş kurallarını ve açık konuları koru.',
      'AI önerilerini kullanıcı kararı veya doğrulanmış FACT gibi yazma.',
      'Proje adı, kodu ve kapsam dışı maddelerini atlama.',
      'Kısa, maddeli ve kaynak rolü belirtilmiş bir özet döndür.',
    ].join(' '),
    contents: [{ parts: [{ text: conversationText }] }],
    onChunk: () => {},
  });

  return result.text.trim();
};

export const extractKeyFacts = async (text: string): Promise<{ fact: string; importance: number }[]> => {
  const result = await callGemini({
    model: 'gemini-3.1-flash-lite-preview',
    systemInstruction: [
      'Yalnız kullanıcının verdiği metinden workspace içinde ileride yardımcı olabilecek bilgi adaylarını çıkar.',
      'Bunlar kanonik FACT veya onaylı karar değildir; metinde açıkça olmayan bilgi ekleme.',
      'Önemli bilgi yoksa boş JSON dizisi dön.',
      'Yanıt yalnız şu formatta JSON dizisi olmalı: [{"fact":"Bilgi","importance":8}].',
    ].join(' '),
    contents: [{ parts: [{ text }] }],
    onChunk: () => {},
  });

  try {
    const json = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to parse key facts JSON', error);
    return [];
  }
};
