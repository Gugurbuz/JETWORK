import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, Folder } from 'lucide-react';

interface EditProjectModalProps {
  project: { id: string; name: string; description: string };
  onClose: () => void;
  onSubmit: (id: string, name: string, description: string) => void;
}

export function EditProjectModal({ project, onClose, onSubmit }: EditProjectModalProps) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(project.id, name, description);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-theme-bg w-full max-w-md rounded-2xl shadow-xl overflow-hidden border border-theme-border"
      >
        <div className="flex items-center justify-between p-4 border-b border-theme-border bg-theme-surface">
          <div className="flex items-center gap-2 text-theme-text font-bold">
            <Folder size={18} className="text-theme-primary" />
            Projeyi Düzenle
          </div>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-theme-text-muted uppercase tracking-wider mb-2">
              Proje Adı
            </label>
            <input 
              type="text" 
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-theme-surface border border-theme-border rounded-lg px-4 py-2.5 text-sm text-theme-text focus:border-theme-primary outline-none transition-colors"
              placeholder="Örn: E-Ticaret Yenileme"
              autoFocus
            />
          </div>
          
          <div>
            <label className="block text-xs font-bold text-theme-text-muted uppercase tracking-wider mb-2">
              Açıklama
            </label>
            <textarea 
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-theme-surface border border-theme-border rounded-lg px-4 py-2.5 text-sm text-theme-text focus:border-theme-primary outline-none transition-colors min-h-[100px] resize-none"
              placeholder="Projenin amacı ve kapsamı..."
            />
          </div>
          
          <div className="pt-4 flex justify-end gap-3">
            <button 
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-theme-text-muted hover:text-theme-text transition-colors"
            >
              İptal
            </button>
            <button 
              type="submit"
              disabled={!name.trim()}
              className="px-6 py-2 bg-theme-primary hover:bg-theme-primary/90 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Kaydet
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
