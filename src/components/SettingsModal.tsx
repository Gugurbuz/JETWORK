import React, { useState, useEffect } from 'react';
import { X, User, Settings as SettingsIcon, Save, Palette, BrainCircuit, ExternalLink, DollarSign } from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../supabase';
import { stringToColor } from '../lib/utils';
import { FEATURE_FLAGS } from '../lib/featureFlags';
import { useDataStore } from '../store/useDataStore';
import { ReasoningDebugModal } from './ReasoningDebugModal';
import { AICostDashboard } from './AICostDashboard';

interface SettingsModalProps {
  user: { name: string; role: string; color?: string } | null;
  onClose: () => void;
  onUpdateUser: (user: { name: string; role: string; color?: string }) => void;
  selectedModel: string;
  onUpdateModel: (model: string) => void;
}

const PREDEFINED_COLORS = [
  '#2563eb', // blue-600
  '#dc2626', // red-600
  '#16a34a', // green-600
  '#d97706', // amber-600
  '#9333ea', // purple-600
  '#4f46e5', // indigo-600
  '#0891b2', // cyan-600
  '#0d9488', // teal-600
  '#be123c', // rose-600
  '#c026d3', // fuchsia-600
];

export function SettingsModal({ user, onClose, onUpdateUser, selectedModel, onUpdateModel }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'preferences' | 'reasoning' | 'cost'>('profile');
  const [name, setName] = useState(user?.name || '');
  const [role, setRole] = useState(user?.role || '');
  const [color, setColor] = useState(user?.color || (user?.name ? stringToColor(user.name) : PREDEFINED_COLORS[0]));
  const [roles, setRoles] = useState<string[]>([]);
  const [model, setModel] = useState(selectedModel);
  const [showReasoningDebug, setShowReasoningDebug] = useState(false);
  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);

  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const { data, error } = await supabase.from('roles').select('name');
        if (error) throw error;
        const fetchedRoles = (data || []).map((d: any) => d.name);
        if (fetchedRoles.length > 0) {
          setRoles(fetchedRoles);
          if (!role) setRole(fetchedRoles[0]);
        } else {
          const fallbackRoles = ['Kıdemli Analist', 'Product Owner', 'Lead Developer', 'UX Designer', 'Test Uzmanı', 'Proje Yöneticisi', 'Kullanıcı'];
          setRoles(fallbackRoles);
          if (!role) setRole(fallbackRoles[0]);
        }
      } catch (err) {
        console.error("Failed to fetch roles:", err);
        const fallbackRoles = ['Kıdemli Analist', 'Product Owner', 'Lead Developer', 'UX Designer', 'Test Uzmanı', 'Proje Yöneticisi', 'Kullanıcı'];
        setRoles(fallbackRoles);
        if (!role) setRole(fallbackRoles[0]);
      }
    };
    fetchRoles();
  }, [role]);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && role.trim()) {
      onUpdateUser({ name, role, color });
      onUpdateModel(model);
      onClose();
    }
  };

  const handleSavePreferences = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateModel(model);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="bg-theme-surface border border-theme-border rounded-xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[88vh]"
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

          <div className="flex flex-1 overflow-hidden max-sm:flex-col">
            {/* Sidebar */}
            <div className="w-52 border-r border-theme-border bg-theme-surface p-4 flex flex-col gap-2 shrink-0 max-sm:w-full max-sm:flex-row max-sm:overflow-x-auto max-sm:border-r-0 max-sm:border-b">
              <button
                onClick={() => setActiveTab('profile')}
                className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
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
                className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'preferences' 
                    ? 'bg-theme-primary/10 text-theme-primary' 
                    : 'text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover'
                }`}
              >
                <SettingsIcon size={16} />
                Tercihler
              </button>
              <button
                onClick={() => setActiveTab('reasoning')}
                className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'reasoning'
                    ? 'bg-theme-primary/10 text-theme-primary'
                    : 'text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover'
                }`}
              >
                <BrainCircuit size={16} />
                Reasoning Debug
              </button>
              <button
                onClick={() => setActiveTab('cost')}
                className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'cost'
                    ? 'bg-theme-primary/10 text-theme-primary'
                    : 'text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover'
                }`}
                data-testid="open-ai-cost-dashboard"
              >
                <DollarSign size={16} />
                AI Maliyeti
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 p-6 overflow-y-auto bg-theme-bg max-sm:p-4">
              {activeTab === 'profile' && (
                <form onSubmit={handleSaveProfile} className="space-y-6 max-w-2xl">
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
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-theme-text-muted mb-1.5 uppercase tracking-wider">Rol / Ünvan</label>
                        <select 
                          value={role}
                          onChange={(e) => setRole(e.target.value)}
                          className="w-full bg-theme-surface border border-theme-border focus:border-theme-primary rounded-md px-3 py-2 text-sm text-theme-text outline-none transition-colors appearance-none"
                          required
                        >
                          {roles.map(r => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-theme-text-muted mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
                          <Palette size={14} />
                          Profil Rengi
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {PREDEFINED_COLORS.map(c => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setColor(c)}
                              className={`w-8 h-8 rounded-full border-2 transition-all ${color === c ? 'border-theme-text scale-110 shadow-md' : 'border-transparent hover:scale-105'}`}
                              style={{ backgroundColor: c }}
                              title="Renk Seç"
                            />
                          ))}
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                          <div 
                            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow-sm"
                            style={{ backgroundColor: color }}
                          >
                            {name ? name.charAt(0).toUpperCase() : 'U'}
                          </div>
                          <span className="text-sm text-theme-text-muted">Önizleme</span>
                        </div>
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
                <form onSubmit={handleSavePreferences} className="space-y-6 max-w-2xl">
                  <div>
                    <h3 className="text-sm font-bold text-theme-text uppercase tracking-widest mb-4">Uygulama Tercihleri</h3>
                    <div className="space-y-4">
                      {FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME ? (
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-theme-text-muted">
                            Yapay Zeka Modeli
                          </label>
                          <select
                            value={model}
                            onChange={(event) => setModel(event.target.value)}
                            className="w-full rounded-md border border-theme-border bg-theme-surface px-3 py-2 text-sm text-theme-text outline-none transition-colors focus:border-theme-primary"
                          >
                            <option value="auto">Otomatik — OpenAI, gerekirse Gemini (Önerilen)</option>
                            <option value="gpt-5.6-sol">OpenAI GPT-5.6 Sol</option>
                            <option value="gpt-5.6">OpenAI GPT-5.6</option>
                            <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite — Ekonomik</option>
                            <option value="gemini-3.5-flash">Gemini 3.5 Flash — Dengeli</option>
                            <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview — Karmaşık / yüksek maliyet</option>
                          </select>
                          <p className="mt-2 text-xs text-theme-text-muted">
                            Cost Guard araştırma ve tool kararlarını otomatik olarak düşük maliyetli Flash-Lite modeliyle yürütür; seçtiğiniz güçlü model yalnız gerektiğinde nihai sentez için kullanılır.
                          </p>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs font-semibold text-theme-text-muted mb-1.5 uppercase tracking-wider">Yapay Zeka Modeli</label>
                          <select
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            className="w-full bg-theme-surface border border-theme-border focus:border-theme-primary rounded-md px-3 py-2 text-sm text-theme-text outline-none transition-colors"
                          >
                            <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite (Ekonomik)</option>
                            <option value="gemini-3.5-flash">Gemini 3.5 Flash (Dengeli)</option>
                            <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview (Karmaşık Görevler)</option>
                          </select>
                          <p className="text-xs text-theme-text-muted mt-2">
                            Flash-Lite yüksek hacimli günlük kullanım için en düşük maliyetli seçenektir; Pro yalnız gerçekten karmaşık sentezlerde tercih edilmelidir.
                          </p>
                        </div>
                      )}
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

              {activeTab === 'reasoning' && (
                <div className="space-y-5 max-w-2xl">
                  <div>
                    <h3 className="text-sm font-bold text-theme-text uppercase tracking-widest mb-2">Reasoning Observability</h3>
                    <p className="text-sm leading-relaxed text-theme-text-muted">
                      Her AI turn için intent, complexity, knowledge/web kullanımı, tool çağrıları, verification, model/provider,
                      fallback, latency/token, hata ve artifact task durumunu tek ekranda inceleyin.
                    </p>
                  </div>

                  <div className="rounded-xl border border-theme-border bg-theme-surface p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-theme-text">
                      <BrainCircuit size={17} className="text-theme-primary" />
                      Neden böyle cevap verdi?
                    </div>
                    <p className="text-xs leading-relaxed text-theme-text-muted">
                      Debug ekranı yalnızca operasyonel trace ve kaynak metadatasını gösterir. Sistem promptu ve gizli chain-of-thought gösterilmez.
                      Görüntüleme kendi erişebildiğiniz çalışma alanlarındaki kendi AI turn'lerinizle sınırlıdır.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowReasoningDebug(true)}
                      className="mt-4 inline-flex items-center gap-2 rounded-md bg-theme-primary px-4 py-2 text-sm font-semibold text-theme-primary-fg transition-colors hover:bg-theme-primary-hover"
                      data-testid="open-reasoning-debug"
                    >
                      Reasoning Debug'u Aç <ExternalLink size={15} />
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'cost' && <AICostDashboard />}
            </div>
          </div>
        </motion.div>
      </div>

      <ReasoningDebugModal
        open={showReasoningDebug}
        onClose={() => setShowReasoningDebug(false)}
        currentWorkspaceId={currentWorkspaceId}
      />
    </>
  );
}