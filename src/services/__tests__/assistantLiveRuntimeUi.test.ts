import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8');
const mobileCleanCss = readFileSync(new URL('../../assistant-mobile-clean.css', import.meta.url), 'utf8');
const liveRuntimeCss = readFileSync(new URL('../../assistant-live-runtime.css', import.meta.url), 'utf8');
const useMessagesSource = readFileSync(new URL('../../hooks/useMessages.ts', import.meta.url), 'utf8');
const runtimeClientSource = readFileSync(new URL('../assistantRuntimeClient.ts', import.meta.url), 'utf8');

describe('Gemini 3.8 live runtime UX', () => {
  it('loads the live runtime layer after the legacy mobile cleanup mask', () => {
    const legacyIndex = mainSource.indexOf("import './assistant-mobile-clean.css';");
    const liveIndex = mainSource.indexOf("import './assistant-live-runtime.css';");
    expect(legacyIndex).toBeGreaterThan(-1);
    expect(liveIndex).toBeGreaterThan(legacyIndex);
    expect(mobileCleanCss).toContain("content: 'Bilgi ve kaynaklar inceleniyor…'");
    expect(liveRuntimeCss).toContain('content: none !important');
    expect(liveRuntimeCss).toContain('display: flex !important');
  });

  it('keeps typed status, source, commentary and text-delta event support connected', () => {
    expect(runtimeClientSource).toContain("type: 'text_delta'");
    expect(runtimeClientSource).toContain("type: 'sources'");
    expect(runtimeClientSource).toContain("type: 'status'");
    expect(runtimeClientSource).toContain("type: 'commentary'");
    expect(useMessagesSource).toContain('onText: fullText =>');
    expect(useMessagesSource).toContain('onSources: sources =>');
    expect(useMessagesSource).toContain('onStatus: (stage, label) =>');
    expect(useMessagesSource).toContain('onCommentary: (event) =>');
  });

  it('folds public commentary into the active response instead of creating extra chat messages', () => {
    expect(useMessagesSource).not.toContain("senderRole: 'Çalışma güncellemesi'");
    expect(useMessagesSource).not.toContain('commentaryMessage');
    expect(useMessagesSource).toContain('latestPhaseLabel = safeMessage');
    expect(useMessagesSource).toContain("broadcastMessage(channelRef, 'ai_stream_chunk'");
  });

  it('surfaces live source observations and switches to a visible answer-stream label on first text', () => {
    expect(useMessagesSource).toContain('kurumsal kaynak bulundu');
    expect(useMessagesSource).toContain('web kaynağı bulundu');
    expect(useMessagesSource).toContain("latestPhaseLabel = 'Yanıt canlı olarak yazılıyor...'");
  });
});
