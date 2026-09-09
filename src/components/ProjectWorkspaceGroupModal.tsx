import React from 'react';
import { FolderKanban, X } from 'lucide-react';
import { motion } from 'motion/react';

interface ProjectWorkspaceGroupModalProps {
  open: boolean;
  initialName?: string;
  mode: 'create' | 'rename';
  onClose: () => void;
  onSubmit: (name: string) => void | Promise<void>;
}

export function ProjectWorkspaceGroupModal({
  open,
  initialName = '',
  mode,
  onClose,
  onSubmit,
}: ProjectWorkspaceGroupModalProps) {
  const [name, setName] = React.useState(initialName);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (open) setName(initialName);
  }, [initialName, open]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-sm rounded-2xl border border-theme-border/70 bg-theme-bg shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-workspace-group-title"
      >
        <div className="flex items-center justify-between border-b border-theme-border/60 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-theme-surface-hover text-theme-text">
              <FolderKanban size={17} />
            </div>
            <div>
              <h2 id="project-workspace-group-title" className="text-sm font-semibold text-theme-text">
                {mode === 'create' ? 'Yeni çalışma alanı' : 'Çalışma alanını yeniden adlandır'}
              </h2>
              <p className="mt-0.5 text-[11px] text-theme-text-muted">Proje içindeki sohbetleri düzenlemek için.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text" aria-label="Kapat">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-5">
          <label htmlFor="project-workspace-group-name" className="mb-2 block text-xs font-medium text-theme-text">
            Çalışma alanı adı
          </label>
          <input
            id="project-workspace-group-name"
            autoFocus
            value={name}
            onChange={event => setName(event.target.value)}
            maxLength={120}
            placeholder="Örn. Analiz, Geliştirme, UAT"
            className="w-full rounded-xl border border-theme-border bg-theme-surface px-3.5 py-2.5 text-sm text-theme-text outline-none transition focus:border-theme-primary"
          />

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-xs font-medium text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text">
              İptal
            </button>
            <button
              type="submit"
              disabled={!name.trim() || pending}
              className="rounded-lg bg-theme-primary px-4 py-2 text-xs font-semibold text-theme-primary-fg transition hover:bg-theme-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? 'Kaydediliyor…' : mode === 'create' ? 'Oluştur' : 'Kaydet'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
