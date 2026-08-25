import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { cn } from '../lib/utils';

const OPTIONS = [
  { value: 'auto', label: 'Otomatik', detail: 'JetWork en uygun modeli seçer' },
  { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', detail: 'OpenAI' },
  { value: 'gpt-5.6', label: 'GPT-5.6', detail: 'OpenAI' },
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', detail: 'Google' },
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', detail: 'Google' },
  { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite', detail: 'Google' },
];

export function CompactModelControl({ disabled = false }: { disabled?: boolean }) {
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

  return (
    <div ref={rootRef} className="relative hidden lg:block">
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
              onClick={() => {
                setSelectedModel(option.value);
                setOpen(false);
              }}
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
