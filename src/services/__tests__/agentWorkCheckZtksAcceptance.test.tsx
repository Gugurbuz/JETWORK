import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createAgentWorkSseAdapter } from '../../../supabase/functions/_shared/agentWorkSseAdapter';
import { reduceAgentActivityEvents } from '../agentActivityReducer';
import type { AgentWorkEvent, AgentWorkEventKind, AgentWorkEventState } from '../agentWorkTypes';
import { AssistantWorkIndicator } from '../../components/AssistantWorkIndicator';
import { AgentWorkTimeline } from '../../components/AgentWorkTimeline';
import { consumeSseBuffer } from '../sseParser';

const sse = (event: string, payload: unknown) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

const toFrontendEvent = (payload: Record<string, unknown>): AgentWorkEvent => ({
  eventId: String(payload.event_id),
  sequence: Number(payload.sequence),
  kind: (payload.kind === 'tool' || payload.kind === 'source' || payload.kind === 'artifact' || payload.kind === 'warning' || payload.kind === 'final'
    ? payload.kind
    : 'agent') as AgentWorkEventKind,
  label: String(payload.label || ''),
  tool: payload.tool ? String(payload.tool) : undefined,
  sourceType: payload.source_type === 'knowledge'
    || payload.source_type === 'web'
    || payload.source_type === 'media'
    || payload.source_type === 'artifact'
    ? payload.source_type
    : 'runtime',
  startedAt: payload.started_at ? String(payload.started_at) : undefined,
  completedAt: payload.completed_at ? String(payload.completed_at) : undefined,
  state: String(payload.state || 'completed') as AgentWorkEventState,
});

const reduceCanonicalEvent = (state: AgentWorkEvent[], eventName: string | undefined, data: string) => {
  if (!['agent_activity', 'tool_start', 'tool_complete', 'artifact', 'warning', 'final'].includes(eventName || '')) return state;
  const payload = JSON.parse(data) as Record<string, unknown>;
  if (!payload.event_id) return state;
  return reduceAgentActivityEvents(state, toFrontendEvent(payload));
};

describe('CHECK_ZTKS Agent Work acceptance', () => {
  it('keeps the complete real work chronology while text starts streaming and final UI collapses', () => {
    let clock = Date.parse('2026-09-06T20:00:00.000Z');
    const adapter = createAgentWorkSseAdapter(() => clock);
    let wire = '';

    wire += adapter.transformFrame(sse('status', {
      type: 'status',
      stage: 'thinking',
      label: 'Talep bağlamı çıkarılıyor; araç seçimini aktif LLM yapacak...',
    }));
    clock += 1_000;
    wire += adapter.transformFrame(sse('status', {
      type: 'status',
      stage: 'routing',
      label: 'Semantic capability adayları çıkarılıyor...',
    }));
    clock += 1_000;
    wire += adapter.transformFrame(sse('status', {
      type: 'status',
      stage: 'searching_knowledge',
      label: 'Bilgi bankasında CHECK_ZTKS implementation aranıyor...',
    }));
    clock += 2_000;
    wire += adapter.transformFrame(sse('sources', {
      type: 'sources',
      sources: [
        { sourceName: 'CRM_Function_Envanteri.md', sourceType: 'knowledge' },
        { sourceName: 'CHECK_ZTKS source', sourceType: 'knowledge' },
        { sourceName: 'Z_FICA_TKS_CHECK', sourceType: 'knowledge' },
      ],
    }));
    clock += 1_000;
    wire += adapter.transformFrame(sse('status', {
      type: 'status',
      stage: 'verifying',
      label: 'Controller ek capability/kanıt çağrısı yapıyor...',
    }));
    clock += 1_000;
    wire += adapter.transformFrame(sse('text_delta', {
      type: 'text_delta',
      delta: 'CHECK_ZTKS metodu...',
    }));
    clock += 31_000;
    wire += adapter.transformFrame(sse('completed', {
      type: 'completed',
      conversationId: 'conv-check-ztks',
      model: 'gemini-3.8-flash',
      provider: 'gemini',
    }));
    wire += adapter.flush();

    const parsed = consumeSseBuffer(wire, true).events;
    expect(parsed.some(event => event.event === 'text_delta' && event.data.includes('CHECK_ZTKS metodu'))).toBe(true);
    expect(parsed.some(event => event.event === 'tool_start')).toBe(true);
    expect(parsed.some(event => event.event === 'tool_complete')).toBe(true);
    expect(parsed.some(event => event.event === 'final')).toBe(true);

    let liveState: AgentWorkEvent[] = [];
    for (const event of parsed) {
      if (event.event === 'text_delta') break;
      liveState = reduceCanonicalEvent(liveState, event.event, event.data);
    }

    expect(liveState.some(event => event.label === 'Soru ve konuşma bağlamı hazırlandı')).toBe(true);
    expect(liveState.some(event => event.label === '3 kurumsal kaynak bulundu')).toBe(true);
    expect(liveState.find(event => event.label === 'Bulduğum bilgiyi ek kaynaklarla doğruluyorum...')?.state).toBe('active');
    expect(liveState.filter(event => event.state === 'completed').length).toBeGreaterThanOrEqual(4);

    const liveHtml = renderToStaticMarkup(
      <AssistantWorkIndicator
        isActive
        startedAt={Date.parse('2026-09-06T20:00:00.000Z')}
        workEvents={liveState}
      />,
    );
    expect(liveHtml).toContain('Düşünüyor');
    expect(liveHtml).toContain('data-testid="assistant-work-live-details"');
    expect(liveHtml).toContain('Bulduğum bilgiyi ek kaynaklarla doğruluyorum...');

    let state: AgentWorkEvent[] = [];
    for (const event of parsed) {
      state = reduceCanonicalEvent(state, event.event, event.data);
    }

    const uniqueIds = new Set(state.map(event => event.eventId));
    expect(state).toHaveLength(uniqueIds.size);
    expect(state.some(event => event.label === 'Soru ve konuşma bağlamı hazırlandı')).toBe(true);
    expect(state.some(event => event.label === 'Uygun kaynak ve araçlar değerlendirildi')).toBe(true);
    expect(state.some(event => event.label === '3 kurumsal kaynak bulundu')).toBe(true);
    expect(state.some(event => event.label === 'Bulduğum bilgi ek kaynaklarla doğrulandı')).toBe(true);
    expect(state.some(event => event.label === 'Yanıt oluşturuldu')).toBe(true);
    expect(state.every(event => event.state !== 'active')).toBe(true);

    const timelineHtml = renderToStaticMarkup(<AgentWorkTimeline events={state} />);
    expect(timelineHtml).toContain('3 kurumsal kaynak bulundu');
    expect(timelineHtml).toContain('Bulduğum bilgi ek kaynaklarla doğrulandı');

    const finalHtml = renderToStaticMarkup(
      <AssistantWorkIndicator
        isActive={false}
        completedSeconds={37}
        workEvents={state}
        knowledgeSources={[
          { sourceName: 'CRM_Function_Envanteri.md', sourceType: 'knowledge' },
          { sourceName: 'CHECK_ZTKS source', sourceType: 'knowledge' },
          { sourceName: 'Z_FICA_TKS_CHECK', sourceType: 'knowledge' },
        ]}
      />,
    );
    expect(finalHtml).toContain('37 sn düşündü');
    expect(finalHtml).toContain('aria-label="Çalışma ayrıntılarını göster"');
    expect(finalHtml).not.toContain('data-testid="assistant-work-details"');
  });

  it('keeps user media distinct from enterprise knowledge in public source events', () => {
    let clock = Date.parse('2026-09-06T20:10:00.000Z');
    const mediaOnlyAdapter = createAgentWorkSseAdapter(() => clock);
    const mediaOnly = consumeSseBuffer(mediaOnlyAdapter.transformFrame(sse('sources', {
      type: 'sources',
      sources: [{ sourceName: 'screen.png', sourceType: 'media' }],
    })), true).events;
    const mediaEvent = mediaOnly.find(event => event.event === 'agent_activity');
    expect(mediaEvent).toBeTruthy();
    const mediaPayload = JSON.parse(mediaEvent!.data) as Record<string, unknown>;
    expect(mediaPayload.label).toBe('1 kullanıcı medyası incelendi');
    expect(mediaPayload.source_type).toBe('media');
    expect(String(mediaPayload.label)).not.toContain('kurumsal');

    clock += 1_000;
    const mixedAdapter = createAgentWorkSseAdapter(() => clock);
    const mixed = consumeSseBuffer(mixedAdapter.transformFrame(sse('sources', {
      type: 'sources',
      sources: [
        { sourceName: 'CRM_Function_Envanteri.md', sourceType: 'knowledge' },
        { sourceName: 'screen.png', sourceType: 'media' },
        { sourceName: 'official.example', sourceType: 'web' },
      ],
    })), true).events;
    const mixedEvent = mixed.find(event => event.event === 'agent_activity');
    expect(mixedEvent).toBeTruthy();
    const mixedPayload = JSON.parse(mixedEvent!.data) as Record<string, unknown>;
    expect(mixedPayload.label).toBe('1 kurumsal kaynak · 1 web kaynağı · 1 kullanıcı medyası incelendi');
    expect(mixedPayload.source_type).toBe('runtime');
    expect(mixedPayload.tool).toBe('Kaynaklar');
  });
});
