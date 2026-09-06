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
  sourceType: payload.source_type === 'knowledge' || payload.source_type === 'web' || payload.source_type === 'artifact'
    ? payload.source_type
    : 'runtime',
  startedAt: payload.started_at ? String(payload.started_at) : undefined,
  completedAt: payload.completed_at ? String(payload.completed_at) : undefined,
  state: String(payload.state || 'completed') as AgentWorkEventState,
});

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

    let state: AgentWorkEvent[] = [];
    for (const event of parsed) {
      if (!['agent_activity', 'tool_start', 'tool_complete', 'final'].includes(event.event || '')) continue;
      const payload = JSON.parse(event.data) as Record<string, unknown>;
      if (!payload.event_id) continue;
      state = reduceAgentActivityEvents(state, toFrontendEvent(payload));
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
});
