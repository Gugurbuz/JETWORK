import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDestructive?: boolean;
  expectedConfirmationText?: string;
}

export function ConfirmModal({ 
  title, 
  message, 
  confirmText = "Onayla", 
  cancelText = "İptal", 
  onConfirm, 
  onCancel,
  isDestructive = true,
  expectedConfirmationText
}: ConfirmModalProps) {
  const [confirmationInput, setConfirmationInput] = useState('');

  const isConfirmDisabled = expectedConfirmationText 
    ? confirmationInput !== expectedConfirmationText 
    : false;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter' && !isConfirmDisabled) {
        onConfirm();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, onConfirm, isConfirmDisabled]);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-theme-bg w-full max-w-md rounded-2xl shadow-xl overflow-hidden border border-theme-border"
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isDestructive ? 'bg-red-500/10 text-red-500' : 'bg-theme-primary/10 text-theme-primary'}`}>
              <AlertTriangle size={20} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-theme-text mb-2">{title}</h3>
              <p className="text-sm text-theme-text-muted mb-4">{message}</p>
              
              {expectedConfirmationText && (
                <div className="mt-4">
                  <label className="block text-xs font-medium text-theme-text-muted mb-2">
                    Lütfen onaylamak için <span className="font-bold text-theme-text select-all">{expectedConfirmationText}</span> yazın:
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={confirmationInput}
                    onChange={(e) => setConfirmationInput(e.target.value)}
                    className="w-full bg-theme-surface border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text focus:outline-none focus:border-red-500 transition-colors"
                    placeholder={expectedConfirmationText}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="p-4 border-t border-theme-border bg-theme-surface flex justify-end gap-3">
          <button 
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-theme-text-muted hover:text-theme-text transition-colors"
          >
            {cancelText}
          </button>
          <button 
            onClick={onConfirm}
            disabled={isConfirmDisabled}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isDestructive 
                ? 'bg-red-500 hover:bg-red-600 text-white' 
                : 'bg-theme-primary hover:bg-theme-primary/90 text-white'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
