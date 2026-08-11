import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatPanel } from '../ChatPanel';
import type { Message } from '../../types';

const renderPanel = (messages: Message[] = []): string => renderToStaticMarkup(
  <ChatPanel
    messages={messages}
    onSendMessage={() => {}}
    onStopGeneration={() => {}}
    isGenerating={false}
    isLoadingWorkspace={false}
    currentUser={{ name: 'Test', role: 'Analist' }}
  />,
);

describe('ChatPanel simple BA start', () => {
  it('shows four direct starters and no active-listening copy', () => {
    const html = renderPanel();
    expect(html).toContain('İş analizi talebini birlikte netleştirelim');
    expect(html).toContain('Bir talebim var; proje mi support konusu mu olduğunu birlikte netleştirelim.');
    expect(html).toContain('ZCRM2-545 hangi koşulda alınır?');
    expect(html).toContain('CHECK_ZTKS hangi mesajları üretiyor?');
    expect(html).toContain('Bir TXT veya MD kaynağını bilgi bankasına eklemek istiyorum.');
    expect(html).not.toContain('aktif dinlemede');
    expect(html).not.toContain('proaktif olarak dahil olur');
  });

  it('renders plain questions without invented answer chips', () => {
    const html = renderPanel([{
      id: 'm1',
      role: 'model',
      text: 'Talebi doğru çerçevelemek için şu noktaları netleştirelim.',
      createdAt: 1,
      questions: [{
        id: 'q1',
        text: 'Talebin çözeceği iş problemi nedir?',
        options: [],
      }],
    }]);
    expect(html).toContain('Talebin çözeceği iş problemi nedir?');
    expect(html).toContain('Varsayımlarla devam et');
    expect(html).not.toContain('data-testid="question-option"');
  });

  it('keeps the branded thinking indicator visible while reasoning is streaming', () => {
    const html = renderPanel([{
      id: 'm1',
      role: 'model',
      text: '',
      isTyping: true,
      thinkingText: '**Bağlam**\nBilgi bankası taranıyor.',
      phaseLabel: 'Bilgi bankasında ilgili kayıtlar seçiliyor.',
      createdAt: Date.now(),
    }]);

    expect(html).toContain('assistant-work');
    expect(html).toContain('assistant-work__logo-motion');
    expect(html).toContain('Düşünüyor');
    expect(html).toContain(' sn');
    expect(html).toContain('Ayrıntıları gizle');
    expect(html).toContain('Bilgi bankasında ilgili kayıtlar seçiliyor.');
    expect(html).toContain('Durdur');
    expect(html).not.toContain('jetwork-thinking-dots');
  });

  it('collapses completed work to a total duration and a how-it-was-made action', () => {
    const html = renderPanel([{
      id: 'm1',
      role: 'model',
      text: 'Hazır yanıt.',
      isTyping: false,
      thinkingText: '• Talep ve konuşma bağlamı incelendi.\n• Yanıt doğrulandı.',
      thinkingTime: 18,
      createdAt: Date.now() - 18_000,
    }]);

    expect(html).toContain('18 sn’de hazırlandı');
    expect(html).toContain('Nasıl hazırlandı?');
    expect(html).not.toContain('Planlama:');
    expect(html).not.toContain('Yanıt üretimi:');
  });
});
