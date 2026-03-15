import React, { useState } from 'react';
import { X, FileText, Code, CheckSquare } from 'lucide-react';
import { diffLines } from 'diff';
import { DocumentData } from '../types';
import { cn } from '../lib/utils';

interface DiffViewerModalProps {
  oldDoc?: DocumentData;
  newDoc?: DocumentData;
  onClose: () => void;
  onRestore: () => void;
}

export function DiffViewerModal({ oldDoc, newDoc, onClose, onRestore }: DiffViewerModalProps) {
  const [activeTab, setActiveTab] = useState<'businessAnalysis' | 'code' | 'test' | 'bpmn'>('businessAnalysis');

  const renderDiff = (oldText: string = '', newText: string = '') => {
    if (oldText === newText) {
      return <div className="p-4 text-theme-text-muted text-sm italic">Bu bölümde değişiklik yapılmamış.</div>;
    }

    const diffs = diffLines(oldText, newText);

    return (
      <div className="font-mono text-sm whitespace-pre-wrap p-4">
        {diffs.map((part, index) => {
          const colorClass = part.added
            ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
            : part.removed
            ? 'bg-rose-500/20 text-rose-700 dark:text-rose-400 line-through opacity-70'
            : 'text-theme-text';

          return (
            <span key={index} className={cn("rounded-sm px-1 py-0.5", colorClass)}>
              {part.value}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-theme-bg w-full max-w-4xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-theme-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-theme-border bg-theme-surface">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-theme-primary/10 flex items-center justify-center text-theme-primary">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-theme-text">Değişiklikleri Görüntüle</h2>
              <p className="text-xs text-theme-text-muted">AI'ın dokümanda yaptığı güncellemeler</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-theme-surface-hover text-theme-text-muted transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 p-2 border-b border-theme-border bg-theme-surface/50">
          <button
            onClick={() => setActiveTab('businessAnalysis')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === 'businessAnalysis' 
                ? "bg-theme-primary text-theme-primary-fg shadow-sm" 
                : "text-theme-text-muted hover:text-theme-text hover:bg-theme-surface"
            )}
          >
            <FileText size={16} /> BA Analiz
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === 'code' 
                ? "bg-theme-primary text-theme-primary-fg shadow-sm" 
                : "text-theme-text-muted hover:text-theme-text hover:bg-theme-surface"
            )}
          >
            <Code size={16} /> IT Analiz
          </button>
          <button
            onClick={() => setActiveTab('test')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === 'test' 
                ? "bg-theme-primary text-theme-primary-fg shadow-sm" 
                : "text-theme-text-muted hover:text-theme-text hover:bg-theme-surface"
            )}
          >
            <CheckSquare size={16} /> Test
          </button>
          <button
            onClick={() => setActiveTab('bpmn')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === 'bpmn' 
                ? "bg-theme-primary text-theme-primary-fg shadow-sm" 
                : "text-theme-text-muted hover:text-theme-text hover:bg-theme-surface"
            )}
          >
            <FileText size={16} /> FLOW
          </button>
        </div>

        {/* Diff Content */}
        <div className="flex-1 overflow-y-auto bg-theme-surface/30">
          {activeTab === 'businessAnalysis' && renderDiff(oldDoc?.businessAnalysis, newDoc?.businessAnalysis)}
          {activeTab === 'code' && renderDiff(oldDoc?.code, newDoc?.code)}
          {activeTab === 'test' && renderDiff(oldDoc?.test, newDoc?.test)}
          {activeTab === 'bpmn' && renderDiff(oldDoc?.bpmn, newDoc?.bpmn)}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-theme-border bg-theme-surface flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors border border-theme-border"
          >
            Kapat
          </button>
          <button
            onClick={() => {
              onRestore();
              onClose();
            }}
            className="px-4 py-2 text-sm font-medium text-white bg-theme-primary hover:bg-theme-primary/90 rounded-lg transition-colors shadow-sm"
          >
            Bu Versiyona Geri Yükle
          </button>
        </div>
      </div>
    </div>
  );
}
