import React, { useState } from 'react';
import { X, User, Settings as SettingsIcon, Save } from 'lucide-react';
import { motion } from 'motion/react';

interface SettingsModalProps {
  user: { name: string; role: string } | null;
  onClose: () => void;
  onUpdateUser: (user: { name: string; role: string }) => void;
}

export function SettingsModal({ user, onClose, onUpdateUser }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'preferences'>('profile');
  const [name, setName] = useState(user?.name || '');
  const [role, setRole] = useState(user?.role || '');

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && role.trim()) {
      onUpdateUser({ name, role });
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-theme-surface border border-theme-border rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-theme-border bg-theme-surface">
          <h2 className="text-lg font-bold text-theme-text tracking-tight flex items-center gap-2">
            <SettingsIcon size={20} className="text-theme-primary" />
            Hesap ve Ayarlar
          </h2>
          <button 
            onClick={onClose}
            className="text-theme-text-muted hover:text-theme-text transition-colors p-1 rounded-md hover:bg-theme-surface-hover"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 border-r border-theme-border bg-theme-surface p-4 flex flex-col gap-2 shrink-0">
            <button
              onClick={() => setActiveTab('profile')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'profile' 
                  ? 'bg-theme-primary/10 text-theme-primary' 
                  : 'text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover'
              }`}
            >
              <User size={16} />
              Profil
            </button>
            <button
              onClick={() => setActiveTab('preferences')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'preferences' 
                  ? 'bg-theme-primary/10 text-theme-primary' 
                  : 'text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover'
              }`}
            >
              <SettingsIcon size={16} />
              Tercihler
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto bg-theme-bg">
            {activeTab === 'profile' && (
              <form onSubmit={handleSaveProfile} className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-theme-text uppercase tracking-widest mb-4">Profil Bilgileri</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-theme-text-muted mb-1.5 uppercase tracking-wider">Ad Soyad</label>
                      <input 
                        type="text" 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full bg-theme-surface border border-theme-border focus:border-theme-primary rounded-md px-3 py-2 text-sm text-theme-text outline-none transition-colors"
                        placeholder="Örn: Ahmet Yılmaz"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-theme-text-muted mb-1.5 uppercase tracking-wider">Rol / Ünvan</label>
                      <input 
                        type="text" 
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="w-full bg-theme-surface border border-theme-border focus:border-theme-primary rounded-md px-3 py-2 text-sm text-theme-text outline-none transition-colors"
                        placeholder="Örn: Product Owner"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-theme-border flex justify-end">
                  <button 
                    type="submit"
                    className="flex items-center gap-2 px-4 py-2 bg-theme-primary hover:bg-theme-primary-hover text-theme-primary-fg rounded-md text-sm font-semibold transition-colors shadow-sm"
                  >
                    <Save size={16} />
                    Kaydet
                  </button>
                </div>
              </form>
            )}

            {activeTab === 'preferences' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-theme-text uppercase tracking-widest mb-4">Uygulama Tercihleri</h3>
                  <p className="text-sm text-theme-text-muted mb-4">
                    Jira entegrasyonu ve diğer API ayarları şu anda sistem yöneticisi tarafından <code className="bg-theme-surface px-1.5 py-0.5 rounded border border-theme-border">.env</code> dosyası üzerinden yönetilmektedir.
                  </p>
                  <div className="p-4 bg-theme-surface border border-theme-border rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-theme-text">Jira Entegrasyonu</div>
                        <div className="text-xs text-theme-text-muted mt-1">Sistem genelinde yapılandırıldı</div>
                      </div>
                      <div className="px-2 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded text-xs font-bold uppercase tracking-widest">
                        Aktif
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
