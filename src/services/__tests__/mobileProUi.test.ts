import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatPanelSource = readFileSync(new URL('../../components/ChatPanel.tsx', import.meta.url), 'utf8');
const shellCss = readFileSync(new URL('../../jetwork-conversation-shell.css', import.meta.url), 'utf8');
const workIndicatorSpeedCss = readFileSync(new URL('../../assistant-work-indicator-speed.css', import.meta.url), 'utf8');

describe('mobile-first pro conversation UI', () => {
  it('keeps assistant actions persistent and functional', () => {
    expect(chatPanelSource).toContain('data-testid="message-action-bar"');
    expect(chatPanelSource).toContain('navigator.clipboard.writeText(msg.text)');
    expect(chatPanelSource).toContain("onToggleReaction(msg.id, '👍')");
    expect(chatPanelSource).toContain("onToggleReaction(msg.id, '👎')");
    expect(chatPanelSource).toContain('aria-label="Kaynaklara git"');
    expect(chatPanelSource).toContain('aria-label="Yanıtı tekrar dene"');
  });

  it('uses readable mobile conversation typography and a stronger composer', () => {
    expect(shellCss).toContain('font-size: 1.0625rem !important;');
    expect(shellCss).toContain('min-height: 3.85rem !important;');
    expect(shellCss).toContain('[data-testid="workspace-mobile-header"] p');
    expect(shellCss).toContain('[data-testid="message-action-bar"]');
  });

  it('keeps sidebar navigation, section labels and conversation rows visually distinct', () => {
    expect(shellCss).toContain('font-size: 1.0625rem !important;');
    expect(shellCss).toContain('font-size: .9rem !important;');
    expect(shellCss).toContain('font-size: 1.015rem !important;');
    expect(shellCss).toContain('background: var(--theme-bg) !important;');
  });

  it('preserves the live Düşünüyor shimmer after conversation contrast overrides', () => {
    expect(workIndicatorSpeedCss).toContain('.jetwork-conversation-shell .assistant-work:not(.assistant-work--completed) .assistant-work__label');
    expect(workIndicatorSpeedCss).toContain('color: transparent !important;');
    expect(workIndicatorSpeedCss).toContain('-webkit-text-fill-color: transparent !important;');
    expect(workIndicatorSpeedCss).toContain('animation: assistant-work-text-shimmer 2.4s ease-in-out infinite !important;');
  });
});
