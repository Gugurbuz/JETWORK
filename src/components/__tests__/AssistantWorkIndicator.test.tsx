import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AssistantWorkIndicator,
  buildAssistantWorkActivities,
} from '../AssistantWorkIndicator';

describe('AssistantWorkIndicator', () => {
  it('builds only real reported activities and marks the latest live activity active', () => {
    const activities = buildAssistantWorkActivities({
      isActive: true,
      activityText: '• Talep ve konuşma bağlamı inceleniyor\n• Bilgi bankası taranıyor',
      phaseLabel: 'Kaynaklar karşılaştırılıyor',
      knowledgeSourceCount: 3,
      webSourceCount: 0,
    });

    expect(activities.map(activity => activity.label)).toEqual([
      'Talep ve konuşma bağlamı inceleniyor',
      'Bilgi bankası taranıyor',
      'Kaynaklar karşılaştırılıyor',
      '3 kurumsal kaynak kullanıldı.',
    ]);
    expect(activities[2].state).toBe('active');
    expect(activities.at(-1)?.state).toBe('completed');
  });

  it('renders a stopped result without claiming that it was completed', () => {
    const html = renderToStaticMarkup(
      <AssistantWorkIndicator
        isActive={false}
        isStopped
        startedAt={Date.now() - 12_000}
        completedSeconds={12}
        activityText="• Bilgi bankası tarandı."
      />,
    );

    expect(html).toContain('12 sn’de durduruldu');
    expect(html).not.toContain('12 sn’de hazırlandı');
  });

  it('derives a useful completed summary from sources and hides connection noise', () => {
    const activities = buildAssistantWorkActivities({
      isActive: false,
      activityText: '• Asistana bağlanılıyor...',
      knowledgeSourceCount: 1,
      webSourceCount: 0,
    });

    expect(activities.map(activity => activity.label)).toEqual([
      'Kurumsal bilgi bankasında ilgili kaynaklar seçildi.',
      '1 kurumsal kaynak kullanıldı.',
      'Yanıt kaynaklarla eşleştirilerek hazırlandı.',
    ]);
  });

  it('renders web source links inside the work details when web search is used', () => {
    const html = renderToStaticMarkup(
      <AssistantWorkIndicator
        isActive
        startedAt={Date.now() - 18_000}
        activityText="• Web’de güvenilir kaynaklar tarandı."
        knowledgeSources={[{
          sourceName: 'OpenAI Docs',
          title: 'Web search guide',
          sourceType: 'web',
          url: 'https://platform.openai.com/docs/guides/tools-web-search',
        }]}
      />,
    );

    expect(html).toContain('Web kaynakları');
    expect(html).toContain('Web search guide');
    expect(html).toContain('https://platform.openai.com/docs/guides/tools-web-search');
  });

  it('does not expose planner, tool, or final-model timing breakdowns', () => {
    const html = renderToStaticMarkup(
      <AssistantWorkIndicator
        isActive={false}
        completedSeconds={9}
        activityText="• Yanıt hazırlandı."
      />,
    );

    expect(html).not.toContain('Planner');
    expect(html).not.toContain('Tool');
    expect(html).not.toContain('Final model');
    expect(html).toContain('9 sn’de hazırlandı');
  });
});
