import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Users, Briefcase, FileText, Search, Check, Folder } from 'lucide-react';
import { supabase } from '../supabase';
import { Project } from '../types';

interface NewItemModalProps {
  projects: Project[];
  currentProjectId?: string | null;
  onClose: () => void;
  onSubmit: (data: { projectId: string; itemNumber: string; title: string; team: { id: string; name: string; role: string; email: string }[] }) => void | Promise<void>;
}

interface DbUser {
  id: string;
  name: string;
  role: string;
  email: string;
}

export function NewItemModal({ projects, currentProjectId, onClose, onSubmit }: NewItemModalProps) {
  const [projectId, setProjectId] = useState(currentProjectId || (projects.length > 0 ? projects[0].id : ''));
  const [itemNumber, setItemNumber] = useState('');
  const [title, setTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dbUsers, setDbUsers] = useState<DbUser[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<DbUser[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch users and roles from Firestore
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [usersRes, rolesRes] = await Promise.all([
          supabase.from('users').select('*'),
          supabase.from('roles').select('name'),
        ]);

        const usersList: DbUser[] = (usersRes.data || []).map((u: any) => {
          const fullName = `${u.name || ''} ${u.surname || ''}`.trim();
          return {
            id: u.uid,
            name: fullName || u.username || u.email || 'İsimsiz Kullanıcı',
            role: u.role || 'Kullanıcı',
            email: u.email || '',
          };
        });
        setDbUsers(usersList);

        const fetchedRoles = (rolesRes.data || []).map((d: any) => d.name);
        if (fetchedRoles.length > 0) {
          setRoles(fetchedRoles);
        } else {
          setRoles(['İş Analisti', 'Fonksiyonel Analist', 'Kıdemli Analist', 'Developer', 'Lead Developer', 'Test Uzmanı', 'Proje Yöneticisi', 'Product Owner', 'UX Designer']);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        setRoles(['İş Analisti', 'Fonksiyonel Analist', 'Kıdemli Analist', 'Developer', 'Lead Developer', 'Test Uzmanı', 'Proje Yöneticisi', 'Product Owner', 'UX Designer']);
      } finally {
        setIsLoadingUsers(false);
      }
    };
    fetchData();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredUsers = dbUsers.filter(user => 
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleUser = (user: DbUser) => {
    setSelectedUsers(prev => 
      prev.some(u => u.id === user.id)
        ? prev.filter(u => u.id !== user.id)
        : [...prev, user]
    );
    setSearchQuery('');
    setIsDropdownOpen(false);
  };

  const updateRole = (userId: string, newRole: string) => {
    setSelectedUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
  };

  const canSubmit = Boolean(projectId && itemNumber.trim() && title.trim());

  const submitWorkspace = async () => {
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit({
        projectId,
        itemNumber,
        title,
        team: selectedUsers.map(u => ({ id: u.id, name: u.name, role: u.role, email: u.email }))
      });
    } catch (error) {
      console.error('Failed to submit workspace:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitWorkspace();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 bg-theme-bg/80 sm:items-center">
      <motion.div 
        initial={{ opacity: 0, scale: 0.98, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 10 }}
        className="bg-theme-surface shadow-2xl w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto border border-theme-border rounded-xl"
      >
        <div className="flex items-center justify-between p-6 border-b border-theme-border bg-theme-surface">
          <h2 className="text-lg font-semibold text-theme-text flex items-center gap-2 tracking-tight">
            <FileText size={18} className="text-theme-primary" />
            Yeni Çalışma Alanı Başlat
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
                Proje
              </label>
              <div className="relative">
                <Folder size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-theme-text-muted" />
                <select
                  data-testid="new-workspace-project"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  required
                  className="w-full pl-12 pr-4 py-3 bg-theme-bg border border-theme-border focus:outline-none focus:border-theme-primary focus:bg-theme-surface transition-colors text-sm rounded-md text-theme-text appearance-none"
                >
                  <option value="" disabled>Proje Seçin</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-theme-text-muted mb-2 uppercase tracking-widest">
                Görev / Bilet Numarası
              </label>
              <div className="relative">
                <Briefcase size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-theme-text-muted" />
                <input
                  type="text"
                  data-testid="new-workspace-item-number"
                  value={itemNumber}
                  onChange={(e) => setItemNumber(e.target.value)}
                  placeholder="Örn: JET-1042"
                  required
                  className="w-full pl-12 pr-4 py-3 bg-theme-bg border border-theme-border focus:outline-none focus:border-theme-primary focus:bg-theme-surface transition-colors font-mono text-sm rounded-md text-theme-text placeholder:text-theme-text-muted/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-theme-text-muted mb-2 uppercase tracking-widest">
                Çalışma Alanı Başlığı
              </label>
              <input
                type="text"
                data-testid="new-workspace-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Örn: Kredi Kartı Ödeme Entegrasyonu"
                required
                className="w-full px-4 py-3 bg-theme-bg border border-theme-border focus:outline-none focus:border-theme-primary focus:bg-theme-surface transition-colors text-sm rounded-md text-theme-text placeholder:text-theme-text-muted/50"
              />
            </div>

            <div className="relative" ref={dropdownRef}>
              <label className="block text-[10px] font-bold text-theme-text-muted mb-3 uppercase tracking-widest flex items-center gap-2">
                <Users size={14} />
                Çalışma Ekibi (Kişiler) <span className="text-theme-text-muted/70 normal-case tracking-normal font-normal">— opsiyonel</span>
              </label>
              
              <div className="flex flex-col gap-2 mb-3">
                {selectedUsers.map(user => (
                  <div key={user.id} className="flex items-center justify-between bg-theme-primary/10 text-theme-primary px-3 py-2 rounded-md text-xs font-medium border border-theme-primary/20">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-theme-primary text-theme-primary-fg flex items-center justify-center text-[10px] font-bold">
                        {user.name.charAt(0)}
                      </div>
                      <span className="text-sm">{user.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={user.role}
                        onChange={(e) => updateRole(user.id, e.target.value)}
                        className="bg-theme-surface border border-theme-border text-theme-text text-xs rounded px-2 py-1 focus:outline-none focus:border-theme-primary"
                      >
                        {roles.map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <button 
                        type="button" 
                        onClick={() => toggleUser(user)}
                        className="p-1 hover:text-theme-primary-hover hover:bg-theme-primary/20 rounded"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setIsDropdownOpen(true);
                  }}
                  onFocus={() => setIsDropdownOpen(true)}
                  placeholder="İsim veya unvan yazarak kişi ara..."
                  className="w-full pl-10 pr-4 py-2.5 bg-theme-bg border border-theme-border focus:outline-none focus:border-theme-primary focus:bg-theme-surface transition-colors text-sm rounded-md text-theme-text placeholder:text-theme-text-muted/50"
                />
              </div>

              <AnimatePresence>
                {isDropdownOpen && (
                  <motion.div 
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="absolute z-10 w-full mt-1 bg-theme-surface border border-theme-border rounded-md shadow-lg max-h-48 overflow-y-auto"
                  >
                    {isLoadingUsers ? (
                      <div className="p-4 text-center text-sm text-theme-text-muted">
                        Kullanıcılar yükleniyor...
                      </div>
                    ) : filteredUsers.length > 0 ? (
                      filteredUsers.map(user => {
                        const isSelected = selectedUsers.some(u => u.id === user.id);
                        return (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => toggleUser(user)}
                            className="w-full flex items-center justify-between px-4 py-2 hover:bg-theme-surface-hover transition-colors text-left"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-6 h-6 rounded-full bg-theme-primary/20 text-theme-primary flex items-center justify-center text-[10px] font-bold">
                                {user.name.charAt(0)}
                              </div>
                              <div>
                                <div className="text-sm font-medium text-theme-text">{user.name}</div>
                                <div className="text-[10px] text-theme-text-muted">{user.role}</div>
                              </div>
                            </div>
                            {isSelected && <Check size={16} className="text-theme-primary" />}
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-4 py-3 text-sm text-theme-text-muted text-center">
                        Kişi bulunamadı.
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="sticky bottom-0 -mx-8 -mb-8 mt-2 flex justify-end gap-3 border-t border-theme-border bg-theme-surface px-8 py-4">
            <button
              type="button"
              data-testid="new-workspace-submit"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-semibold text-theme-text-muted hover:text-theme-text transition-colors"
            >
              İptal
            </button>
            <button
              type="button"
              onClick={() => { void submitWorkspace(); }}
              disabled={!canSubmit || isSubmitting}
              aria-busy={isSubmitting}
              className="px-6 py-2.5 bg-theme-primary hover:bg-theme-primary-hover text-theme-primary-fg text-sm font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {isSubmitting ? 'Başlatılıyor...' : 'Çalışma Alanı Başlat'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
