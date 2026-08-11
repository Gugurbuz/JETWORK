import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AssistantWorkIndicator,
  buildAssistantWorkActivities,
  formatAssistantWorkDuration,
} from '../AssistantWorkIndicator';

describe('AssistantWorkIndicator', () => {
  it('builds only reported runtime activities and marks the latest live activity active', () => {
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
    ]);
    expect(activities[0].state).toBe('completed');
    expect(activities[1].state).toBe('completed');
    expect(activities[2].state).toBe('active');
  });

  it('does not invent activity rows from source counts or generic connection noise', () => {
    const activities = buildAssistantWorkActivities({
      isActive: false,
      activityText: '• Asistana bağlanılıyor...',
      knowledgeSourceCount: 4,
      webSourceCount: 2,
    });

    expect(activities).toEqual([]);
  });

  it('renders a stopped result as worked-and-stopped rather than completed', () => {
    const html = renderToStaticMarkup(
      <AssistantWorkIndicator
        isActive={false}
        isStopped
        startedAt={Date.now() - 12_000}
        completedSeconds={12}
        activityText="• Bilgi bankası tarandı."
      />,
    );

    expect(html).toContain('12 sn çalıştı · durduruldu');
    expect(html).not.toContain('hazırlandı');
  });

  it('keeps the branded thinking state and exposes the current real activity without an inline stop button', () => {
    const html = renderToStaticMarkup(
      <AssistantWorkIndicator
        isActive
        startedAt={Date.now() - 18_000}
        activityText="• Kurumsal bilgi bankası taranıyor"
        phaseLabel="İlgili kayıtlar karşılaştırılıyor"
      />,
    );

    expect(html).toContain('assistant-work__logo-motion');
    expect(html).toContain('Düşünüyor');
    expect(html).toContain('İlgili kayıtlar karşılaştırılıyor');
    expect(html).not.toContain('>Durdur<');
    expect(html).not.toContain('Arka planda çalışsın');
  });

  it('formats longer work durations in a compact Turkish form', () => {
    expect(formatAssistantWorkDuration(9)).toBe('9 sn');
    expect(formatAssistantWorkDuration(120)).toBe('2 dk');
    expect(formatAssistantWorkDuration(126)).toBe('2 dk 6 sn');
  });

  it('does not expose planner, tool, final-model timing, or the old prepared wording', () => {
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
    expect(html).not.toContain('hazırlandı');
    expect(html).toContain('9 sn çalıştı');
  });
});
