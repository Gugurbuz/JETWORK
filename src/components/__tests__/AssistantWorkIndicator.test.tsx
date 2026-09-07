import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AssistantWorkIndicator,
  buildAssistantWorkActivities,
  buildPendingRuntimeActivities,
  formatAssistantWorkActivityLabel,
  formatAssistantWorkDuration,
  selectCompletedActivityEvidence,
} from '../AssistantWorkIndicator';

describe('AssistantWorkIndicator', () => {
  it('builds reported runtime activities plus real source observations and marks only the current phase active', () => {
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
      '3 kurumsal kaynak bulundu · kanıtlar eşleştiriliyor',
      'Kaynaklar karşılaştırılıyor',
    ]);
    expect(activities.at(-1)?.state).toBe('active');
    expect(activities.slice(0, -1).every(activity => activity.state === 'completed')).toBe(true);
  });

  it('keeps technical label formatting available without making it public chronology', () => {
    expect(formatAssistantWorkActivityLabel('Talep bağlamı çıkarılıyor; araç seçimini aktif LLM yapacak...', false)).toBe('Soru ve konuşma bağlamını hazırlıyorum...');
    expect(formatAssistantWorkActivityLabel('Advisory bağlam hazırlanıyor...', false)).toBe('İlgili proje bağlamını topluyorum...');
    expect(formatAssistantWorkActivityLabel('Semantic capability adayları çıkarılıyor...', false)).toBe('Uygun kaynak ve araçları değerlendiriyorum...');
    expect(formatAssistantWorkActivityLabel('Controller hazır: 10 semantic aday · 18 görünür tool', true)).toBe('Çalışma araçları hazırlandı');
    expect(formatAssistantWorkActivityLabel('Controller ek capability/kanıt çağrısı yapıyor...', false)).toBe('Bulduğum bilgiyi ek kaynaklarla doğruluyorum...');
    expect(formatAssistantWorkActivityLabel('Controller ek capability/kanıt çağrısı yapıyor...', true)).toBe('Bulduğum bilgi ek kaynaklarla doğrulandı');
    expect(formatAssistantWorkActivityLabel('Yanıt hazırlandı', true)).toBe('Yanıt oluşturuldu');
  });

  it('does not invent elapsed-time progress rows', () => {
    expect(buildPendingRuntimeActivities(1)).toEqual([]);
    expect(buildPendingRuntimeActivities(12)).toEqual([]);
    expect(buildPendingRuntimeActivities(37)).toEqual([]);
  });

  it('renders only meaningful fallback work and hides controller/context/capability plumbing', () => {
    const html = renderToStaticMarkup(
      <AssistantWorkIndicator
        isActive
        startedAt={Date.now() - 12_000}
        activityText={'• Talep işleme alındı\n• Talep bağlamı çıkarılıyor; araç seçimini aktif LLM yapacak...\n• Semantic capability adayları çıkarılıyor...\n• Controller hazır: 16 semantic aday · 11 görünür tool'}
        phaseLabel="Bilgi bankasında ilgili kayıtlar aranıyor"
      />,
    );

    expect(html).toContain('Düşünüyor');
    expect(html).toContain('data-testid="assistant-work-live-details"');
    expect(html).toContain('Bilgi Bankası');
    expect(html).toContain('Bilgi bankasında ilgili kayıtlar aranıyor');
    expect(html).not.toContain('Talep işleme alındı');
    expect(html).not.toContain('Soru ve konuşma bağlamı hazırlandı');
    expect(html).not.toContain('Uygun kaynak ve araçlar değerlendirildi');
    expect(html).not.toContain('Çalışma araçları hazırlandı');
    expect(html).not.toContain('Controller hazır:');
  });

  it('shows only the thinking header when fallback contains no meaningful work', () => {
    const html = renderToStaticMarkup(
      <AssistantWorkIndicator
        isActive
        startedAt={Date.now() - 8_000}
        activityText={'• Talep işleme alındı\n• Talep bağlamı çıkarılıyor; araç seçimini aktif LLM yapacak...\n• Semantic capability adayları çıkarılıyor...\n• Controller hazır: 16 semantic aday · 11 görünür tool\n• Controller ilk aksiyonu değerlendiriyor...'}
      />,
    );

    expect(html).toContain('Düşünüyor');
    expect(html).not.toContain('data-testid="assistant-work-live-details"');
    expect(html).not.toContain('Talep işleme alındı');
    expect(html).not.toContain('İlk inceleme adımını seçiyorum');
  });

  it('collapses completed work and uses the final thought-duration copy', () => {
    const html = renderToStaticMarkup(
      <AssistantWorkIndicator
        isActive={false}
        completedSeconds={19}
        activityText={'• Talep işleme alındı\n• Bilgi bankası tarandı\n• Yanıt hazırlandı'}
      />,
    );

    expect(html).toContain('19 sn düşündü');
    expect(html).toContain('aria-label="Çalışma ayrıntılarını göster"');
    expect(html).not.toContain('data-testid="assistant-work-details"');
  });

  it('renders a stopped result as thought-and-stopped and keeps the JetWork logo', () => {
    const html = renderToStaticMarkup(
      <AssistantWorkIndicator
        isActive={false}
        isStopped
        startedAt={Date.now() - 12_000}
        completedSeconds={12}
        activityText="• Bilgi bankası tarandı."
      />,
    );

    expect(html).toContain('12 sn düşündü · durduruldu');
    expect(html).toContain('data-testid="assistant-work-completed-logo"');
    expect(html).toContain('assistant-work__logo');
  });

  it('keeps source facts in the timeline but leaves evidence cards to ChatPanel source panels', () => {
    const html = renderToStaticMarkup(
      <AssistantWorkIndicator
        isActive
        startedAt={Date.now() - 4_000}
        phaseLabel="Kaynaklar değerlendiriliyor"
        knowledgeSources={[{
          sourceName: 'Kurumsal Kaynak',
          title: 'CRM Function Envanteri',
          sourceType: 'knowledge',
        }]}
      />,
    );

    expect(html).toContain('1 kurumsal kaynak bulundu');
    expect(html).not.toContain('CRM Function Envanteri');
  });

  it('uses the completed runtime summary as authoritative evidence when it exists', () => {
    const reported = [
      { label: 'Talep türü değerlendirildi', state: 'completed' as const },
      { label: 'Yanıt oluşturuldu', state: 'completed' as const },
    ];
    const observed = [...reported, { label: 'Eski geçici satır', state: 'completed' as const }];
    expect(selectCompletedActivityEvidence(reported, observed)).toEqual(reported);
  });

  it('formats longer work durations in compact Turkish form', () => {
    expect(formatAssistantWorkDuration(9)).toBe('9 sn');
    expect(formatAssistantWorkDuration(120)).toBe('2 dk');
    expect(formatAssistantWorkDuration(126)).toBe('2 dk 6 sn');
  });
});
