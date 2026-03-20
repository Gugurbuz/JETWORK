import React, { useState } from 'react';
import { X, UserPlus, Trash2, LogOut } from 'lucide-react';
import { motion } from 'motion/react';
import { Collaborator } from '../types';

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
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName.trim() && newEmail.trim()) {
      onAddParticipant(newName, newEmail);
      setNewName('');
      setNewEmail('');
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
          {/* Add Participant Form */}
          <form onSubmit={handleAdd} className="space-y-4 bg-theme-surface p-4 rounded-lg border border-theme-border">
            <h3 className="text-sm font-bold text-theme-text">Yeni Katılımcı Ekle</h3>
            <div className="space-y-3">
              <div>
                <input 
                  type="text" 
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ad Soyad"
                  className="w-full bg-theme-bg border border-theme-border focus:border-theme-primary rounded-md px-3 py-2 text-sm text-theme-text outline-none transition-colors"
                  required
                />
              </div>
              <div className="flex gap-2">
                <input 
                  type="email" 
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="E-posta Adresi"
                  className="flex-1 bg-theme-bg border border-theme-border focus:border-theme-primary rounded-md px-3 py-2 text-sm text-theme-text outline-none transition-colors"
                  required
                />
                <button 
                  type="submit"
                  className="px-4 py-2 bg-theme-primary hover:bg-theme-primary-hover text-theme-primary-fg rounded-md text-sm font-semibold transition-colors"
                >
                  Ekle
                </button>
              </div>
            </div>
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
                      style={{ backgroundColor: collab.color || '#4f46e5' }}
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
