import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';

interface LandingPageProps {
  onLogin: (user: { name: string; role: string }) => void;
}

const ROLES = [
  'İş Analisti',
  'Fonksiyonel Analist',
  'Yazılım Geliştirici',
  'Test Uzmanı',
  'Proje Yöneticisi'
];

// Minimalist Swiss Logo
const SwissLogo = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" fill="#09090B" />
    <rect x="8" y="8" width="16" height="16" fill="white" />
    <rect x="12" y="12" width="8" height="8" fill="#09090B" />
  </svg>
);

export function LandingPage({ onLogin }: LandingPageProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState(ROLES[0]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onLogin({ name: name.trim(), role });
    }
  };

  return (
    <div className="min-h-screen bg-theme-bg text-theme-text flex flex-col font-sans relative selection:bg-theme-primary/20 transition-colors duration-300">
      {/* Subtle Dot Matrix Background */}
      <div className="absolute inset-0 bg-[radial-gradient(var(--theme-border)_1px,transparent_1px)] [background-size:24px_24px] opacity-70 pointer-events-none" />

      {/* Top Navigation Bar */}
      <header className="relative z-10 flex items-center justify-between px-8 py-6 border-b border-theme-border bg-theme-bg transition-colors duration-300">
        <div className="flex items-center gap-3">
          <SwissLogo />
          <span className="text-xl font-display font-bold tracking-tight text-theme-text">JetWork</span>
        </div>
        <div className="hidden sm:block text-xs font-medium tracking-widest uppercase text-theme-text-muted">
          Enterprise Analysis Platform
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full max-w-[400px]"
        >
          <div className="bg-theme-surface border border-theme-border p-10 shadow-lg rounded-2xl transition-colors duration-300">
            
            <div className="mb-10">
              <h1 className="text-2xl font-semibold tracking-tight text-theme-text mb-2">
                Sisteme Giriş
              </h1>
              <p className="text-sm text-theme-text-muted leading-relaxed">
                JetWork çalışma alanınıza erişmek için lütfen kimlik bilgilerinizi doğrulayın.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-theme-text uppercase tracking-widest">
                  Ad Soyad
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Örn: Ahmet Yılmaz"
                  required
                  className="w-full bg-transparent border-b-2 border-theme-border text-theme-text text-base py-3 focus:outline-none focus:border-theme-primary transition-colors placeholder:text-theme-text-muted/50 rounded-none"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-theme-text uppercase tracking-widest">
                  Kurumsal Rol
                </label>
                <div className="relative">
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full bg-transparent border-b-2 border-theme-border text-theme-text text-base py-3 focus:outline-none focus:border-theme-primary transition-colors appearance-none cursor-pointer rounded-none"
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r} className="bg-theme-surface text-theme-text">{r}</option>
                    ))}
                  </select>
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-theme-text">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </div>
                </div>
              </div>

              <div className="pt-6">
                <button
                  type="submit"
                  disabled={!name.trim()}
                  className="w-full flex items-center justify-between bg-theme-primary hover:bg-theme-primary-hover text-theme-primary-fg text-sm font-medium px-6 py-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group rounded-lg shadow-sm"
                >
                  <span>Devam Et</span>
                  <ArrowRight size={18} className="transform group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </form>

          </div>

          {/* Footer Links */}
          <div className="mt-8 flex justify-between items-center text-[10px] font-medium text-theme-text-muted uppercase tracking-widest">
            <span>© 2026 JetWork Inc.</span>
            <div className="flex gap-4">
              <a href="#" className="hover:text-theme-text transition-colors">Gizlilik</a>
              <a href="#" className="hover:text-theme-text transition-colors">Şartlar</a>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
