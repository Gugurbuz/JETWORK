import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, FolderPlus } from 'lucide-react';

interface NewProjectModalProps {
  onClose: () => void;
  onSubmit: (data: { name: string; description: string }) => void;
}

export function NewProjectModal({ onClose, onSubmit }: NewProjectModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit({ name, description });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-theme-bg/80">
      <motion.div 
        initial={{ opacity: 0, scale: 0.98, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 10 }}
        className="bg-theme-surface shadow-2xl w-full max-w-lg overflow-hidden border border-theme-border rounded-xl"
      >
        <div className="flex items-center justify-between p-6 border-b border-theme-border bg-theme-surface">
          <h2 className="text-lg font-semibold text-theme-text flex items-center gap-2 tracking-tight">
            <FolderPlus size={18} className="text-theme-primary" />
            Yeni Proje Oluştur
          </h2>
          <button 
            onClick={onClose}
            className="p-1.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-md transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-5">
            <div>
              <label className="block text-[10px] font-bold text-theme-text-muted mb-2 uppercase tracking-widest">
                Proje Adı
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Örn: E-Ticaret Yenileme"
                required
                className="w-full px-4 py-3 bg-theme-bg border border-theme-border focus:outline-none focus:border-theme-primary focus:bg-theme-surface transition-colors text-sm rounded-md text-theme-text placeholder:text-theme-text-muted/50"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-theme-text-muted mb-2 uppercase tracking-widest">
                Açıklama (İsteğe Bağlı)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Projenin amacı ve kapsamı..."
                rows={3}
                className="w-full px-4 py-3 bg-theme-bg border border-theme-border focus:outline-none focus:border-theme-primary focus:bg-theme-surface transition-colors text-sm rounded-md text-theme-text placeholder:text-theme-text-muted/50 resize-none"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-theme-border flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-semibold text-theme-text-muted hover:text-theme-text transition-colors"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-6 py-2.5 bg-theme-primary hover:bg-theme-primary-hover text-theme-primary-fg text-sm font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              Proje Oluştur
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
