import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Mail, Lock, User } from 'lucide-react';
import { signInWithGoogle, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, auth } from '../firebase';

interface LandingPageProps {
  onLogin: (user: { uid: string; name: string; role: string }) => void;
}

// Minimalist Swiss Logo
const SwissLogo = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" fill="#09090B" />
    <rect x="8" y="8" width="16" height="16" fill="white" />
    <rect x="12" y="12" width="8" height="8" fill="#09090B" />
  </svg>
);

export function LandingPage({ onLogin }: LandingPageProps) {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleGoogleLogin = async () => {
    try {
      setIsLoggingIn(true);
      setErrorMsg('');
      await signInWithGoogle();
      // App.tsx's onAuthStateChanged will handle the rest
    } catch (error: any) {
      console.error("Login failed", error);
      setErrorMsg(error.message || 'Google ile giriş başarısız oldu.');
      setIsLoggingIn(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMsg('Lütfen e-posta ve şifre girin.');
      return;
    }
    
    try {
      setIsLoggingIn(true);
      setErrorMsg('');
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error: any) {
      console.error("Auth failed", error);
      setErrorMsg(error.message || 'Giriş/Kayıt başarısız oldu. Firebase Console üzerinden Email/Password sağlayıcısını etkinleştirdiğinizden emin olun.');
      setIsLoggingIn(false);
    }
  };

  const handleGuestLogin = async () => {
    try {
      setIsLoggingIn(true);
      setErrorMsg('');
      await signInAnonymously(auth);
    } catch (error: any) {
      console.error("Guest login failed", error);
      setErrorMsg(error.message || 'Misafir girişi başarısız oldu. Firebase Console üzerinden Anonymous sağlayıcısını etkinleştirdiğinizden emin olun.');
      setIsLoggingIn(false);
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
            
            <div className="mb-8">
              <h1 className="text-2xl font-semibold tracking-tight text-theme-text mb-2">
                Sisteme Giriş
              </h1>
              <p className="text-sm text-theme-text-muted leading-relaxed">
                JetWork çalışma alanınıza erişmek için lütfen kimlik bilgilerinizi doğrulayın.
              </p>
            </div>

            {errorMsg && (
              <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-xs leading-relaxed">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleEmailAuth} className="space-y-4 mb-6">
              <div>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
                  <input
                    type="email"
                    placeholder="E-posta adresi"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-theme-bg border border-theme-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-theme-text focus:outline-none focus:border-theme-primary transition-colors"
                  />
                </div>
              </div>
              <div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
                  <input
                    type="password"
                    placeholder="Şifre"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-theme-bg border border-theme-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-theme-text focus:outline-none focus:border-theme-primary transition-colors"
                  />
                </div>
              </div>
              
              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full flex items-center justify-center bg-theme-primary hover:bg-theme-primary-hover text-theme-primary-fg text-sm font-medium px-6 py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm"
              >
                {isLoggingIn ? 'İşleniyor...' : (isSignUp ? 'Kayıt Ol' : 'E-posta ile Giriş Yap')}
              </button>
              
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setIsSignUp(!isSignUp)}
                  className="text-xs text-theme-text-muted hover:text-theme-text transition-colors"
                >
                  {isSignUp ? 'Zaten hesabınız var mı? Giriş yapın' : 'Hesabınız yok mu? Kayıt olun'}
                </button>
              </div>
            </form>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-theme-border"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-theme-surface px-2 text-theme-text-muted uppercase tracking-widest">Veya</span>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleGoogleLogin}
                disabled={isLoggingIn}
                className="w-full flex items-center justify-center gap-2 bg-theme-bg border border-theme-border hover:bg-theme-border/50 text-theme-text text-sm font-medium px-6 py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Google ile Devam Et
              </button>

              <button
                onClick={handleGuestLogin}
                disabled={isLoggingIn}
                className="w-full flex items-center justify-center gap-2 bg-theme-bg border border-theme-border hover:bg-theme-border/50 text-theme-text text-sm font-medium px-6 py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
              >
                <User className="w-4 h-4" />
                Misafir Olarak Devam Et
              </button>
            </div>

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
