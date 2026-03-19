import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, User, Briefcase } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';

interface OnboardingPageProps {
  user: { uid: string; name: string; role: string };
  onComplete: (user: { uid: string; name: string; role: string }) => void;
}

const ROLES = [
  'Kıdemli Analist',
  'Product Owner',
  'Lead Developer',
  'UX Designer',
  'Test Uzmanı',
  'Proje Yöneticisi',
  'Kullanıcı'
];

export function OnboardingPage({ user, onComplete }: OnboardingPageProps) {
  const [name, setName] = useState(user.name !== 'User' ? user.name : '');
  const [role, setRole] = useState(ROLES[0]);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Lütfen adınızı ve soyadınızı girin.');
      return;
    }

    try {
      setIsSaving(true);
      setErrorMsg('');
      
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        displayName: name,
        role: role,
        onboardingCompleted: true
      });

      onComplete({ ...user, name, role });
    } catch (error: any) {
      console.error("Onboarding save failed", error);
      setErrorMsg('Bilgileriniz kaydedilirken bir hata oluştu.');
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-theme-bg text-theme-text flex flex-col font-sans relative selection:bg-theme-primary/20 transition-colors duration-300">
      <div className="absolute inset-0 bg-[radial-gradient(var(--theme-border)_1px,transparent_1px)] [background-size:24px_24px] opacity-70 pointer-events-none" />

      <main className="relative z-10 flex-1 flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full max-w-[400px]"
        >
          <div className="bg-theme-surface border border-theme-border p-10 shadow-lg rounded-2xl transition-colors duration-300">
            
            <div className="mb-8">
              <h1 className="text-2xl font-semibold tracking-tight text-theme-text mb-2">
                Hoş Geldiniz
              </h1>
              <p className="text-sm text-theme-text-muted leading-relaxed">
                JetWork'ü kullanmaya başlamadan önce lütfen profil bilgilerinizi tamamlayın.
              </p>
            </div>

            {errorMsg && (
              <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-xs leading-relaxed">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-5">
              <div>
                <label className="block text-xs font-medium text-theme-text-muted uppercase tracking-widest mb-2">
                  Ad Soyad
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-theme-bg border border-theme-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-theme-text focus:outline-none focus:border-theme-primary transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-theme-text-muted uppercase tracking-widest mb-2">
                  Rolünüz
                </label>
                <div className="relative">
                  <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full bg-theme-bg border border-theme-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-theme-text focus:outline-none focus:border-theme-primary transition-colors appearance-none"
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <button
                type="submit"
                disabled={isSaving}
                className="w-full flex items-center justify-center gap-2 bg-theme-primary hover:bg-theme-primary-hover text-theme-primary-fg text-sm font-medium px-6 py-3 mt-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm"
              >
                {isSaving ? 'Kaydediliyor...' : 'Devam Et'}
                <ArrowRight size={16} />
              </button>
            </form>

          </div>
        </motion.div>
      </main>
    </div>
  );
}
