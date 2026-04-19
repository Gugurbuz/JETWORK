import React, { useState, useEffect, useRef } from 'react';
import { X, UserPlus, Trash2, LogOut, Search, Loader2, Check, User as UserIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Collaborator } from '../types';
import { supabase } from '../supabase';
import { cn, stringToColor } from '../lib/utils';

interface ManageParticipantsModalProps {
  collaborators: Collaborator[];
  currentUserId: string;
  ownerId: string;
  onClose: () => void;
  onAddParticipant: (name: string, email: string) => void;
  onRemoveParticipant: (id: string) => void;
  onLeaveWorkspace: () => void;
}

export function ManageParticipantsModal({
  collaborators,
  currentUserId,
  ownerId,
  onClose,
  onAddParticipant,
  onRemoveParticipant,
  onLeaveWorkspace
}: ManageParticipantsModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const searchUsers = async () => {
      if (searchQuery.trim().length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        // Search by username (displayName) or email
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .or(`username.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`)
          .limit(5);

        if (error) throw error;
        setSearchResults(data || []);
        setShowResults(true);
      } catch (err) {
        console.error("User search error:", err);
      } finally {
        setIsSearching(false);
      }
    };

    const timer = setTimeout(searchUsers, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectUser = (user: any) => {
    onAddParticipant(user.username || user.email.split('@')[0], user.email);
    setSearchQuery('');
    setSearchResults([]);
    setShowResults(false);
  };

  const handleAddManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.includes('@') && searchQuery.includes('.')) {
      onAddParticipant(searchQuery.split('@')[0], searchQuery);
      setSearchQuery('');
      setSearchResults([]);
      setShowResults(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-theme-surface border border-theme-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-theme-border bg-theme-surface">
          <h2 className="text-lg font-bold text-theme-text tracking-tight flex items-center gap-2">
            <UserPlus size={20} className="text-theme-primary" />
            Katılımcıları Yönet
          </h2>
          <button 
            onClick={onClose}
            className="text-theme-text-muted hover:text-theme-text transition-colors p-1 rounded-md hover:bg-theme-surface-hover"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto bg-theme-bg space-y-6">
          {/* Add Participant Search */}
          <form 
            onSubmit={handleAddManual}
            className="space-y-4 bg-theme-surface p-4 rounded-lg border border-theme-border relative" 
            ref={searchRef}
          >
            <h3 className="text-sm font-bold text-theme-text">Yeni Katılımcı Bul ve Ekle</h3>
            <div className="relative">
              <div className="relative">
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
                  placeholder="İsim, kullanıcı adı veya e-posta..."
                  className="w-full bg-theme-bg border border-theme-border focus:border-theme-primary rounded-md pl-10 pr-3 py-2 text-sm text-theme-text outline-none transition-colors"
                />
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-theme-text-muted" />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-2.5 w-4 h-4 text-theme-primary animate-spin" />
                )}
              </div>

              {/* Search Results Dropdown */}
              <AnimatePresence>
                {showResults && (searchQuery.length >= 2) && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute z-10 left-0 right-0 mt-2 bg-theme-surface border border-theme-border rounded-lg shadow-xl overflow-hidden"
                  >
                    {searchResults.length > 0 ? (
                      <div className="py-1">
                        {searchResults.map((user) => {
                          const isAlreadyIn = collaborators.some(c => c.email === user.email);
                          return (
                            <button
                              key={user.uid}
                              onClick={() => !isAlreadyIn && handleSelectUser(user)}
                              disabled={isAlreadyIn}
                              className={cn(
                                "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                                isAlreadyIn ? "opacity-50 cursor-not-allowed" : "hover:bg-theme-surface-hover"
                              )}
                            >
                              <div className="w-8 h-8 rounded-full bg-theme-primary/10 flex items-center justify-center text-theme-primary overflow-hidden">
                                {user.photo_url ? (
                                  <img src={user.photo_url} alt={user.username} className="w-full h-full object-cover" />
                                ) : (
                                  <UserIcon size={16} />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-theme-text truncate">
                                  {user.username || 'İsimsiz Kullanıcı'}
                                </div>
                                <div className="text-xs text-theme-text-muted truncate">
                                  {user.email}
                                </div>
                              </div>
                              {isAlreadyIn && (
                                <Check size={14} className="text-theme-primary" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : !isSearching ? (
                      <div className="p-4 text-center">
                        <p className="text-sm text-theme-text-muted mb-2">Kullanıcı bulunamadı.</p>
                        {searchQuery.includes('@') && (
                          <button
                            onClick={() => onAddParticipant(searchQuery.split('@')[0], searchQuery)}
                            className="text-xs text-theme-primary hover:underline"
                          >
                            "{searchQuery}" adresini davet et
                          </button>
                        )}
                      </div>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <p className="text-[10px] text-theme-text-muted">
              Database'deki kullanıcıları bulmak için yazmaya başlayın.
            </p>
          </form>

          {/* Participants List */}
          <div>
            <h3 className="text-sm font-bold text-theme-text mb-3">Mevcut Katılımcılar ({collaborators.length})</h3>
            <div className="space-y-2">
              {collaborators.map(collab => (
                <div key={collab.id} className="flex items-center justify-between p-3 bg-theme-surface rounded-lg border border-theme-border">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white overflow-hidden"
                      style={{ backgroundColor: collab.color || stringToColor(collab.name) }}
                    >
                      {collab.avatar && collab.avatar.startsWith('http') ? (
                        <img src={collab.avatar} alt={collab.name} className="w-full h-full object-cover" />
                      ) : (
                        collab.avatar || collab.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-theme-text flex items-center gap-2">
                        {collab.name}
                        {collab.id === ownerId && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-theme-primary/10 text-theme-primary rounded-full">Kurucu</span>
                        )}
                        {collab.id === currentUserId && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-theme-border text-theme-text-muted rounded-full">Sen</span>
                        )}
                      </div>
                      <div className="text-xs text-theme-text-muted flex items-center gap-1">
                        <span>{collab.role}</span>
                        {collab.email && (
                          <>
                            <span>•</span>
                            <span>{collab.email}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Actions */}
                  {collab.id !== ownerId && (
                    currentUserId === ownerId ? (
                      <button
                        onClick={() => onRemoveParticipant(collab.id)}
                        className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
                        title="Katılımcıyı Çıkar"
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : null
                  )}
                </div>
              ))}
            </div>
          </div>
          
          {/* Leave Workspace Button */}
          {currentUserId !== ownerId && (
            <div className="pt-4 border-t border-theme-border">
              <button
                onClick={onLeaveWorkspace}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-red-500 bg-red-500/10 hover:bg-red-500/20 rounded-md text-sm font-semibold transition-colors"
              >
                <LogOut size={16} />
                Çalışma Alanından Ayrıl
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
