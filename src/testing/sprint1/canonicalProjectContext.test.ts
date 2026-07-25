import { describe, expect, it } from 'vitest';
import type { KnowledgeItem, Message } from '../../types';
import {
  buildCanonicalProjectContext,
  buildDocumentContextSummary,
  normalizeModelHistory,
} from '../../services/ai/canonicalProjectContext';

function message(
  id: string,
  role: 'user' | 'model',
  text: string,
  extra: Partial<Message> = {},
): Message {
  return { id, role, text, ...extra };
}

describe('Sprint 1 canonical project context', () => {
  it('removes the active user turn and empty typing placeholder from model history', async () => {
    const context = await buildCanonicalProjectContext({
      workspaceId: 'workspace-a',
      currentUserMessageId: 'user-current',
      currentAiMessageId: 'ai-current',
      currentUserMessage: 'Yeni kısıtı ekle',
      messages: [
        message('user-old', 'user', 'Proje adı ZCRM110'),
        message('ai-old', 'model', 'Anlaşıldı.'),
        message('user-current', 'user', 'Yeni kısıtı ekle'),
        message('ai-current', 'model', '', { isTyping: true }),
      ],
      document: null,
      projectMemory: {},
      knowledgeBase: [],
      memoryEnabled: false,
    });

    const modelText = JSON.stringify(context.history);
    expect(modelText).toContain('Proje adı ZCRM110');
    expect(modelText).not.toContain('Yeni kısıtı ekle');
    expect(context.messageHistory.map(item => item.id)).toEqual(['user-old', 'ai-old']);
  });

  it('normalizes consecutive roles and never starts history with a model turn', () => {
    const history = normalizeModelHistory([
      message('ai-orphan', 'model', 'orphan'),
      message('u1', 'user', 'bir'),
      message('u2', 'user', 'iki'),
      message('a1', 'model', 'üç'),
      message('a2', 'model', 'dört'),
    ]);

    expect(history.map(item => item.role)).toEqual(['user', 'model']);
    expect(history[0].parts[0].text).toContain('bir');
    expect(history[0].parts[0].text).toContain('iki');
    expect(JSON.stringify(history)).not.toContain('orphan');
  });

  it('awaits a synchronous summary for turns outside the token budget', async () => {
    let summaryCompleted = false;
    const messages = Array.from({ length: 12 }, (_, index) => (
      message(
        `m-${index}`,
        index % 2 === 0 ? 'user' : 'model',
        `${index}: ${'uzun bağlam '.repeat(90)}`,
      )
    ));

    const context = await buildCanonicalProjectContext({
      workspaceId: 'workspace-a',
      currentUserMessageId: 'current-user',
      currentAiMessageId: 'current-ai',
      currentUserMessage: 'devam',
      messages,
      document: null,
      projectMemory: {},
      knowledgeBase: [],
      memoryEnabled: true,
      tokenBudget: 2_000,
      summarizeMessages: async excluded => {
        await Promise.resolve();
        summaryCompleted = excluded.length > 0;
        return '- Kullanıcı kapsamı ZCRM110 olarak kilitledi.';
      },
    });

    expect(summaryCompleted).toBe(true);
    expect(context.debug.summarizedMessageCount).toBeGreaterThan(0);
    expect(context.promptContext).toContain('SYNCHRONOUS CONVERSATION SUMMARY');
    expect(context.promptContext).toContain('ZCRM110');
  });

  it('keeps retrieval strictly inside the active workspace', async () => {
    const local: KnowledgeItem[] = [
      {
        id: 'a',
        content: 'ZCRM110 limiti 500 kayıttır.',
        keywords: ['zcrm110', 'limit'],
        importance: 9,
        createdAt: 1,
        projectId: 'workspace-a',
      },
      {
        id: 'b',
        content: 'Başka projenin gizli kararı.',
        keywords: ['gizli'],
        importance: 10,
        createdAt: 2,
        projectId: 'workspace-b',
      },
    ];
    const context = await buildCanonicalProjectContext({
      workspaceId: 'workspace-a',
      currentUserMessageId: 'current-user',
      currentAiMessageId: 'current-ai',
      currentUserMessage: 'limit nedir',
      messages: [],
      document: null,
      projectMemory: {},
      knowledgeBase: local,
      memoryEnabled: true,
      retrieveKnowledge: async () => local,
    });

    expect(context.workspaceKnowledge.map(item => item.id)).toEqual(['a']);
    expect(context.promptContext).not.toContain('Başka projenin gizli kararı');
  });

  it('places locked user memory before the approved document and workspace knowledge', async () => {
    const context = await buildCanonicalProjectContext({
      workspaceId: 'workspace-a',
      workspaceTitle: 'SAP CRM Toplu Statü',
      currentUserMessageId: 'current-user',
      currentAiMessageId: 'current-ai',
      currentUserMessage: 'devam',
      messages: [],
      document: {
        businessAnalysis: {
          content: '# ZCRM110 Toplu Statü Güncelleme\n\nKapsam: SAP CRM teklifleri.',
          status: 'APPROVED',
          flags: [],
        },
      },
      projectMemory: {
        'decision.limit': 'Toplu işlem limiti 500 kayıttır.',
      },
      knowledgeBase: [{
        id: 'kb',
        content: 'Destekleyici bilgi',
        keywords: ['destek'],
        importance: 5,
        createdAt: 1,
        projectId: 'workspace-a',
      }],
      memoryEnabled: true,
    });

    const memoryIndex = context.promptContext.indexOf('decision.limit');
    const documentIndex = context.promptContext.indexOf('CURRENT DOCUMENT SUMMARY');
    const knowledgeIndex = context.promptContext.indexOf('WORKSPACE KNOWLEDGE');
    expect(memoryIndex).toBeGreaterThanOrEqual(0);
    expect(memoryIndex).toBeLessThan(documentIndex);
    expect(documentIndex).toBeLessThan(knowledgeIndex);
  });

  it('summarizes the living BA and Review backbone on every turn', () => {
    const summary = buildDocumentContextSummary({
      businessAnalysis: {
        content: '# ZCRM110 Toplu Statü Güncelleme\n\nKapsam: SAP CRM teklif statüleri.',
        status: 'APPROVED',
        flags: [],
      },
      review: {
        content: '[AÇIK KONU] Toplu işlem limiti.',
        status: 'NEEDS_REVISION',
        flags: [],
      },
    }, 'SAP CRM Toplu Statü');

    expect(summary).toContain('ZCRM110 Toplu Statü Güncelleme');
    expect(summary).toContain('Kapsam: SAP CRM teklif statüleri');
    expect(summary).toContain('[AÇIK KONU] Toplu işlem limiti');
  });

  it('keeps the assembled project context inside the configured token budget', async () => {
    const context = await buildCanonicalProjectContext({
      workspaceId: 'workspace-a',
      currentUserMessageId: 'current-user',
      currentAiMessageId: 'current-ai',
      currentUserMessage: 'devam',
      currentAttachments: [{
        url: '',
        data: btoa('uzun ek '.repeat(4_000)),
        mimeType: 'text/plain',
        name: 'kapsam.txt',
      }],
      messages: Array.from({ length: 20 }, (_, index) => (
        message(`m-${index}`, index % 2 === 0 ? 'user' : 'model', 'uzun sohbet '.repeat(500))
      )),
      document: {
        businessAnalysis: {
          content: `# ZCRM110\nKapsam: ${'çok uzun belge '.repeat(2_000)}`,
          status: 'APPROVED',
          flags: [],
        },
      },
      projectMemory: Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => [`decision.${index}`, 'kilitli karar '.repeat(100)]),
      ),
      knowledgeBase: [{
        id: 'kb',
        content: 'workspace bilgisi '.repeat(1_000),
        keywords: ['workspace'],
        importance: 9,
        createdAt: 1,
        projectId: 'workspace-a',
      }],
      memoryEnabled: true,
      tokenBudget: 2_000,
      summarizeMessages: async () => 'konuşma özeti '.repeat(1_000),
    });

    expect(context.debug.estimatedTokensUsed).toBeLessThanOrEqual(2_000);
  });

  it('places uploaded text sources in Project Brain without duplicating the active user turn', async () => {
    const sourceText = 'Proje adı: ZCRM110\nKısıt: Toplu işlem limiti 500 kayıttır.';
    const context = await buildCanonicalProjectContext({
      workspaceId: 'workspace-a',
      currentUserMessageId: 'current-user',
      currentAiMessageId: 'current-ai',
      currentUserMessage: 'Bu kaynağı analiz et',
      currentAttachments: [{
        url: '',
        data: btoa(String.fromCharCode(...new TextEncoder().encode(sourceText))),
        mimeType: 'text/plain',
        name: 'talep.txt',
      }],
      messages: [
        message('current-user', 'user', 'Bu kaynağı analiz et'),
        message('current-ai', 'model', '', { isTyping: true }),
      ],
      document: null,
      projectMemory: {},
      knowledgeBase: [],
      memoryEnabled: true,
    });

    expect(context.promptContext).toContain('UPLOADED SOURCES');
    expect(context.promptContext).toContain('Toplu işlem limiti 500');
    expect(context.history).toEqual([]);
    expect(context.debug.entries.find(entry => entry.source === 'uploaded_source')?.included).toBe(true);
  });
});
