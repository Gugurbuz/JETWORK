import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, User, Briefcase } from 'lucide-react';
import { doc, updateDoc, db, auth, getDocs, collection } from '../db';

interface OnboardingPageProps {
  user: { uid: string; name: string; role: string; email: string | null; photoURL: string | null; };
  onComplete: (user: { uid: string; name: string; role: string; email: string | null; photoURL: string | null; }) => void;
}

export function OnboardingPage({ user, onComplete }: OnboardingPageProps) {
  const [username, setUsername] = useState(user.name !== 'User' ? user.name : '');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [role, setRole] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const rolesSnap = await getDocs(collection(db, 'roles'));
        const fetchedRoles = rolesSnap.docs.map((d: any) => d.data().name);
        if (fetchedRoles.length > 0) {
          setRoles(fetchedRoles);
          setRole(fetchedRoles[0]);
        } else {
          // Fallback if table is empty
          const fallbackRoles = ['Kıdemli Analist', 'Product Owner', 'Lead Developer', 'UX Designer', 'Test Uzmanı', 'Proje Yöneticisi', 'Kullanıcı'];
          setRoles(fallbackRoles);
          setRole(fallbackRoles[0]);
        }
      } catch (err) {
        console.error("Failed to fetch roles:", err);
        const fallbackRoles = ['Kıdemli Analist', 'Product Owner', 'Lead Developer', 'UX Designer', 'Test Uzmanı', 'Proje Yöneticisi', 'Kullanıcı'];
        setRoles(fallbackRoles);
        setRole(fallbackRoles[0]);
      }
    };
    fetchRoles();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !firstName.trim() || !lastName.trim()) {
      setErrorMsg('Lütfen tüm alanları doldurun.');
      return;
    }

    try {
      setIsSaving(true);
      setErrorMsg('');
      
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        displayName: username, // db.ts'de 'username' sütununa mapleniyor
        name: firstName,
        surname: lastName,
        role: role,
        onboardingCompleted: true
      });

      onComplete({ ...user, name: username, role });
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
                  Kullanıcı Adı
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-theme-bg border border-theme-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-theme-text focus:outline-none focus:border-theme-primary transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-theme-text-muted uppercase tracking-widest mb-2">
                    Ad
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full bg-theme-bg border border-theme-border rounded-lg px-4 py-2.5 text-sm text-theme-text focus:outline-none focus:border-theme-primary transition-colors"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-theme-text-muted uppercase tracking-widest mb-2">
                    Soyad
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full bg-theme-bg border border-theme-border rounded-lg px-4 py-2.5 text-sm text-theme-text focus:outline-none focus:border-theme-primary transition-colors"
                    />
                  </div>
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
                    {roles.map(r => (
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
