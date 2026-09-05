import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu } from 'lucide-react';
import { PUBLIC_GEMINI_MODEL, useSettingsStore } from '../store/useSettingsStore';
import { cn } from '../lib/utils';

const OPTIONS = [
  { value: 'auto', label: 'Otomatik', detail: 'JetWork en uygun modeli seçer' },
  { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', detail: 'OpenAI' },
  { value: 'gpt-5.6', label: 'GPT-5.6', detail: 'OpenAI' },
  { value: PUBLIC_GEMINI_MODEL, label: 'Gemini 3.8 Flash', detail: 'Google' },
  { value: 'ollama:qwen3:4b-instruct', label: 'Qwen3 4B (Local)', detail: 'Ollama • self-hosted' },
];

type CompactModelControlProps = {
  disabled?: boolean;
  mobile?: boolean;
};

export function CompactModelControl({ disabled = false, mobile = false }: CompactModelControlProps) {
  const selectedModel = useSettingsStore(state => state.selectedModel);
  const setSelectedModel = useSettingsStore(state => state.setSelectedModel);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = OPTIONS.find(option => option.value === selectedModel) || OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  const chooseModel = (value: string) => {
    setSelectedModel(value);
    setOpen(false);
  };

  if (mobile) {
    return (
      <div ref={rootRef} className="relative block">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(value => !value)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-theme-text-muted transition hover:bg-theme-surface-hover hover:text-theme-text disabled:opacity-45"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Yapay zeka modeli: ${selected.label}`}
          title={`Model: ${selected.label}`}
        >
          <Cpu size={18} />
        </button>
        {open && (
          <>
            <button
              type="button"
              aria-label="Model seçimini kapat"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[89] bg-black/25 backdrop-blur-[1px]"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Yapay zeka modeli seç"
              className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-[90] max-h-[70vh] overflow-y-auto rounded-2xl border border-theme-border/70 bg-theme-bg p-2 shadow-2xl"
            >
              <div className="px-2.5 pb-2 pt-1">
                <p className="text-sm font-semibold text-theme-text">Model seç</p>
                <p className="mt-0.5 text-[11px] text-theme-text-muted">Şu an: {selected.label}</p>
              </div>
              <div role="menu" className="space-y-0.5">
                {OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedModel === option.value}
                    onClick={() => chooseModel(option.value)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-theme-surface-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-theme-text">{option.label}</span>
                      <span className="mt-0.5 block text-[11px] text-theme-text-muted">{option.detail}</span>
                    </span>
                    {selectedModel === option.value && <Check size={16} className="shrink-0 text-theme-text" />}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(value => !value)}
        className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[11px] font-medium text-theme-text-muted transition hover:bg-theme-surface-hover hover:text-theme-text disabled:opacity-45"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Yapay zeka modeli"
      >
        {selected.label}<ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-[70] w-64 rounded-xl border border-theme-border/70 bg-theme-bg p-1.5 shadow-xl">
          {OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={selectedModel === option.value}
              onClick={() => chooseModel(option.value)}
              className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-theme-surface-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-theme-text">{option.label}</span>
                <span className="mt-0.5 block text-[10px] text-theme-text-muted">{option.detail}</span>
              </span>
              {selectedModel === option.value && <Check size={14} className="shrink-0 text-theme-text" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
