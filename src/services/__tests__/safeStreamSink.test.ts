import { describe, expect, it } from 'vitest';
import {
  createSafeStreamSink,
  type SafeStreamTimingObservation,
} from '../../../supabase/functions/_shared/safeStreamSink';

class FakeController {
  chunks: string[] = [];
  closed = false;
  failWrites = false;

  enqueue(chunk: Uint8Array) {
    if (this.closed || this.failWrites) throw new TypeError('The stream controller cannot close or enqueue');
    this.chunks.push(new TextDecoder().decode(chunk));
  }

  close() {
    if (this.closed || this.failWrites) throw new TypeError('The stream controller cannot close or enqueue');
    this.closed = true;
  }
}

describe('safe stream sink', () => {
  it('writes SSE events and terminates exactly once', () => {
    const controller = new FakeController();
    const sink = createSafeStreamSink(controller, new TextEncoder(), { logTiming: false });

    expect(sink.event('status', { stage: 'answering' })).toBe(true);
    expect(sink.done()).toBe(true);
    expect(controller.closed).toBe(true);
    expect(controller.chunks.join('')).toContain('event: status');
    expect(controller.chunks.join('')).toContain('data: [DONE]');

    expect(sink.done()).toBe(false);
    expect(sink.close()).toBe(false);
    expect(sink.event('status', { stage: 'late' })).toBe(false);
  });

  it('turns a downstream disconnect into a no-op instead of throwing', () => {
    const controller = new FakeController();
    const sink = createSafeStreamSink(controller, new TextEncoder(), { logTiming: false });

    controller.failWrites = true;
    expect(() => sink.event('text_delta', { delta: 'late chunk' })).not.toThrow();
    expect(sink.isOpen()).toBe(false);
    expect(sink.event('completed', {})).toBe(false);
    expect(sink.close()).toBe(false);
  });

  it('does not attempt close after the final DONE write itself detects disconnect', () => {
    const controller = new FakeController();
    const sink = createSafeStreamSink(controller, new TextEncoder(), { logTiming: false });

    controller.failWrites = true;
    expect(sink.done()).toBe(false);
    expect(sink.isOpen()).toBe(false);
    expect(controller.closed).toBe(false);
  });

  it('emits canonical tool_start/tool_complete lifecycle with a stable event id', () => {
    const controller = new FakeController();
    const sink = createSafeStreamSink(controller, new TextEncoder(), { logTiming: false });

    sink.event('status', {
      type: 'status',
      stage: 'searching_knowledge',
      label: 'JetWork Global + proje bilgi bankasında kanıt aranıyor...',
    });
    sink.event('sources', {
      type: 'sources',
      sources: [
        { sourceType: 'knowledge', title: 'CRM Function Envanteri' },
        { sourceType: 'knowledge', title: 'CHECK_ZTKS source' },
        { sourceType: 'knowledge', title: 'Z_FICA_TKS_CHECK' },
      ],
    });
    sink.event('completed', { type: 'completed', conversationId: 'conv-1', model: 'gemini-3.8-flash', provider: 'gemini' });
    sink.done();

    const output = controller.chunks.join('');
    expect(output).toContain('event: tool_start');
    expect(output).toContain('event: tool_complete');
    expect(output.match(/"event_id":"tool:1"/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(output).toContain('3 kurumsal kaynak bulundu');
    expect(output).toContain('event: final');
  });

  it('keeps mechanical status events out of canonical Agent Work chronology', () => {
    const controller = new FakeController();
    const sink = createSafeStreamSink(controller, new TextEncoder(), { logTiming: false });

    sink.event('status', { type: 'status', stage: 'routing', label: 'Semantic capability adayları çıkarılıyor...' });
    sink.event('status', { type: 'status', stage: 'routing', label: 'Controller hazır: 16 semantic aday · 11 görünür tool' });
    sink.done();

    const output = controller.chunks.join('');
    expect(output).toContain('event: status');
    expect(output).toContain('Semantic capability adayları çıkarılıyor...');
    expect(output).not.toContain('event: agent_activity');
    expect(output).not.toContain('Uygun kaynak ve araçları değerlendiriyorum...');
    expect(output).not.toContain('Çalışma araçları hazırlandı');
  });

  it('turns meaningful LLM commentary into canonical Agent Work activity', () => {
    const controller = new FakeController();
    const sink = createSafeStreamSink(controller, new TextEncoder(), { logTiming: false });

    sink.event('commentary', {
      type: 'commentary',
      message: 'Bilgi bankasında Findeks ve KKB kayıtlarını inceliyorum...',
    });
    sink.event('completed', { type: 'completed', conversationId: 'conv-1', model: 'gemini-3.8-flash', provider: 'gemini' });
    sink.done();

    const output = controller.chunks.join('');
    expect(output).toContain('event: commentary');
    expect(output).toContain('event: agent_activity');
    expect(output).toContain('Bilgi bankasında Findeks ve KKB kayıtlarını inceliyorum...');
  });

  it('does not promote controller telemetry disguised as commentary', () => {
    const controller = new FakeController();
    const sink = createSafeStreamSink(controller, new TextEncoder(), { logTiming: false });

    sink.event('commentary', {
      type: 'commentary',
      message: 'Controller ek capability/kanıt çağrısı yapıyor...',
    });
    sink.done();

    const output = controller.chunks.join('');
    expect(output).toContain('event: commentary');
    expect(output).not.toContain('event: agent_activity');
    expect(output).not.toContain('Bulduğum bilgiyi ek kaynaklarla doğruluyorum...');
  });

  it('observes the first non-empty text delta without calling it end-to-end TTFT', () => {
    const controller = new FakeController();
    let clock = 1_000;
    let observed: SafeStreamTimingObservation | undefined;
    const sink = createSafeStreamSink(controller, new TextEncoder(), {
      now: () => clock,
      logTiming: false,
      onTiming: timing => { observed = timing; },
    });

    clock = 1_050;
    sink.event('status', { type: 'status', stage: 'answering' });
    clock = 1_120;
    sink.event('text_delta', { type: 'text_delta', delta: '' });
    clock = 1_180;
    sink.event('text_delta', { type: 'text_delta', delta: 'Merhaba' });
    clock = 1_260;
    sink.event('completed', {
      type: 'completed',
      conversationId: 'conv-1',
      model: 'gpt-5.6-sol',
      provider: 'openai',
      cached: false,
    });
    clock = 1_300;
    sink.done();

    expect(observed).toEqual({
      version: 'safe-stream-timing-v1',
      streamOpenedAtMs: 1_000,
      firstTextDeltaAtMs: 1_180,
      completedAtMs: 1_300,
      streamOpenToFirstTextMs: 180,
      streamTotalMs: 300,
      firstTextObserved: true,
      completedEventObserved: true,
      conversationId: 'conv-1',
      model: 'gpt-5.6-sol',
      provider: 'openai',
      cached: false,
    });
  });
});
