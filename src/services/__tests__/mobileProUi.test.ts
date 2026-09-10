import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatPanelSource = readFileSync(new URL('../../components/ChatPanel.tsx', import.meta.url), 'utf8');
const agentWorkHeaderSource = readFileSync(new URL('../../components/AgentWorkHeader.tsx', import.meta.url), 'utf8');
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

  it('preserves a visible Safari-safe Düşünüyor label and phase-locks its sweep to the logo staircase', () => {
    expect(agentWorkHeaderSource).toContain('data-label="Düşünüyor"');
    expect(workIndicatorSpeedCss).toContain('.jetwork-conversation-shell .assistant-work:not(.assistant-work--completed) .assistant-work__label');
    expect(workIndicatorSpeedCss).toContain('color: var(--theme-text) !important;');
    expect(workIndicatorSpeedCss).toContain('-webkit-text-fill-color: currentColor !important;');
    expect(workIndicatorSpeedCss).toContain('.assistant-work__label::after');
    expect(workIndicatorSpeedCss).toContain('content: attr(data-label);');
    expect(workIndicatorSpeedCss).toContain('@keyframes assistant-work-text-shimmer-synced');
    expect(workIndicatorSpeedCss).toContain('clip-path: inset(0 100% 0 0);');
    expect(workIndicatorSpeedCss).toContain('animation: assistant-work-text-shimmer-synced 4.4s ease-in-out 3.344s infinite both !important;');
  });
});
