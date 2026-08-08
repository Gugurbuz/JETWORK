import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatPanel } from '../ChatPanel';
import type { Message } from '../../types';

const renderPanel = (messages: Message[] = []): string => renderToStaticMarkup(
  <ChatPanel
    messages={messages}
    onSendMessage={() => {}}
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
});
