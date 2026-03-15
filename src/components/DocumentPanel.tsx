import React, { useState, useEffect } from 'react';
import { FileText, Download, Play, CheckCircle2, Share2, Printer, Edit3, Save, Users, Bold, Italic, List, ListOrdered, Quote, Heading1, Heading2, Code, Undo, Redo, Table as TableIcon, Image as ImageIcon, Palette, Trello, Link2 } from 'lucide-react';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'motion/react';
import { Collaborator, DocumentData, Message } from '../types';
import { useEditor, EditorContent } from '@tiptap/react';
import { BpmnViewer } from './BpmnViewer';
import { Brain, BarChart3, Clock, Coins, MessageSquare } from 'lucide-react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Image from '@tiptap/extension-image';

interface DocumentPanelProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  documentContent: DocumentData | null;
  onGenerate: () => void;
  isGenerating: boolean;
  hasMessages: boolean;
  collaborators?: Collaborator[];
  onUpdateDocument?: (content: DocumentData) => void;
  onSelectionChange?: (text: string) => void;
  score?: number;
  scoreExplanation?: string;
  messages?: Message[];
}

const TABS = ['BA Analiz', 'IT Analiz', 'Test', 'FLOW', 'Review'];

const MenuBar = ({ editor }: { editor: any }) => {
  if (!editor) return null;

  return (
    <div className="flex flex-wrap gap-1 p-2 border-b border-theme-border bg-theme-bg sticky top-0 z-20 transition-colors duration-300">
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={cn("p-2 rounded hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text", editor.isActive('bold') && "bg-theme-surface-hover text-theme-primary")}
        title="Kalın"
      >
        <Bold size={16} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={cn("p-2 rounded hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text", editor.isActive('italic') && "bg-theme-surface-hover text-theme-primary")}
        title="İtalik"
      >
        <Italic size={16} />
      </button>
      <div className="w-px h-6 bg-theme-border mx-1 self-center" />
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={cn("p-2 rounded hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text", editor.isActive('heading', { level: 1 }) && "bg-theme-surface-hover text-theme-primary")}
        title="Başlık 1"
      >
        <Heading1 size={16} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={cn("p-2 rounded hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text", editor.isActive('heading', { level: 2 }) && "bg-theme-surface-hover text-theme-primary")}
        title="Başlık 2"
      >
        <Heading2 size={16} />
      </button>
      <div className="w-px h-6 bg-theme-border mx-1 self-center" />
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={cn("p-2 rounded hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text", editor.isActive('bulletList') && "bg-theme-surface-hover text-theme-primary")}
        title="Madde İşaretli Liste"
      >
        <List size={16} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={cn("p-2 rounded hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text", editor.isActive('orderedList') && "bg-theme-surface-hover text-theme-primary")}
        title="Numaralı Liste"
      >
        <ListOrdered size={16} />
      </button>
      <div className="w-px h-6 bg-theme-border mx-1 self-center" />
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={cn("p-2 rounded hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text", editor.isActive('blockquote') && "bg-theme-surface-hover text-theme-primary")}
        title="Alıntı"
      >
        <Quote size={16} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={cn("p-2 rounded hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text", editor.isActive('codeBlock') && "bg-theme-surface-hover text-theme-primary")}
        title="Kod Bloğu"
      >
        <Code size={16} />
      </button>
      <div className="w-px h-6 bg-theme-border mx-1 self-center" />
      <button
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        className="p-2 rounded hover:bg-theme-surface-hover transition-colors disabled:opacity-50 disabled:hover:bg-transparent text-theme-text-muted hover:text-theme-text"
        title="Geri Al"
      >
        <Undo size={16} />
      </button>
      <button
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        className="p-2 rounded hover:bg-theme-surface-hover transition-colors disabled:opacity-50 disabled:hover:bg-transparent text-theme-text-muted hover:text-theme-text"
        title="İleri Al"
      >
        <Redo size={16} />
      </button>
      <div className="w-px h-6 bg-theme-border mx-1 self-center" />
      <button
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        className="p-2 rounded hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text"
        title="Tablo Ekle"
      >
        <TableIcon size={16} />
      </button>
      <button
        onClick={() => {
          const url = window.prompt('Görsel URL\'sini girin:');
          if (url) {
            editor.chain().focus().setImage({ src: url }).run();
          }
        }}
        className="p-2 rounded hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text"
        title="Görsel Ekle"
      >
        <ImageIcon size={16} />
      </button>
      <div className="relative group/color">
        <button
          className="p-2 rounded hover:bg-theme-surface-hover transition-colors flex items-center gap-1 text-theme-text-muted hover:text-theme-text"
          title="Metin Rengi"
        >
          <Palette size={16} />
        </button>
        <div className="absolute top-full left-0 mt-1 bg-theme-surface border border-theme-border rounded-lg shadow-xl p-2 hidden group-hover/color:flex gap-1 z-50">
          {['#000000', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'].map(color => (
            <button
              key={color}
              className="w-6 h-6 rounded-full border border-theme-border hover:scale-110 transition-transform shadow-sm"
              style={{ backgroundColor: color }}
              onClick={() => editor.chain().focus().setColor(color).run()}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export function DocumentPanel({ 
  activeTab, 
  setActiveTab, 
  documentContent, 
  onGenerate, 
  isGenerating, 
  hasMessages,
  collaborators = [],
  onUpdateDocument,
  onSelectionChange,
  score,
  scoreExplanation,
  messages = []
}: DocumentPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isExportingJira, setIsExportingJira] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const handleJiraExport = async () => {
    if (!documentContent) return;
    setIsExportingJira(true);
    try {
      const response = await fetch('/api/jira/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Yeni Çalışma Alanı Talebi', // In a real app, this would come from the workspace title
          description: documentContent.businessAnalysis
        })
      });
      
      const data = await response.json();
      if (data.success) {
        alert(`Jira'ya başarıyla aktarıldı! Issue: ${data.issueKey}`);
        window.open(data.url, '_blank');
      } else {
        alert(`Hata: ${data.error}`);
      }
    } catch (error) {
      console.error(error);
      alert('Jira aktarımı sırasında bir hata oluştu.');
    } finally {
      setIsExportingJira(false);
    }
  };

  const handleShare = async () => {
    if (!documentContent) return;
    setIsSharing(true);
    try {
      const shareId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: shareId, data: documentContent })
      });
      
      if (response.ok) {
        const shareUrl = `${window.location.origin}?shareId=${shareId}`;
        await navigator.clipboard.writeText(shareUrl);
        alert('Paylaşım bağlantısı panoya kopyalandı!\n\n' + shareUrl);
      }
    } catch (error) {
      console.error(error);
      alert('Paylaşım bağlantısı oluşturulurken hata oluştu.');
    } finally {
      setIsSharing(false);
    }
  };

  const getActiveContent = (data: DocumentData | null, tab: string) => {
    if (!data) return '';
    switch (tab) {
      case 'BA Analiz': return data.businessAnalysis;
      case 'IT Analiz': return data.code;
      case 'Test': return data.test;
      case 'Review': return data.review || '';
      default: return '';
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'İçerik yazmaya başlayın...',
      }),
      Link.configure({
        openOnClick: false,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      TextStyle,
      Color,
      Image,
    ],
    content: getActiveContent(documentContent, activeTab),
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[60vh] p-8 prose-headings:font-semibold prose-headings:text-theme-text prose-a:text-theme-primary prose-a:underline hover:prose-a:no-underline prose-pre:bg-theme-surface prose-pre:text-theme-text prose-pre:border prose-pre:border-theme-border prose-pre:p-4 prose-pre:rounded-lg prose-code:text-theme-text prose-code:bg-theme-surface-hover prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none text-theme-text',
      },
    },
    onSelectionUpdate: ({ editor }) => {
      if (onSelectionChange) {
        const { from, to } = editor.state.selection;
        const text = editor.state.doc.textBetween(from, to, ' ');
        onSelectionChange(text);
      }
    }
  });

  useEffect(() => {
    if (editor && documentContent) {
      const content = getActiveContent(documentContent, activeTab);
      // Only update if content is actually different to avoid cursor jumps
      if (editor.getHTML() !== content) {
        editor.commands.setContent(content);
      }
    }
  }, [documentContent, activeTab, editor]);

  const handleSave = () => {
    if (!documentContent || !editor) return;
    
    const htmlContent = editor.getHTML();
    const newContent = { ...documentContent };
    switch (activeTab) {
      case 'BA Analiz': newContent.businessAnalysis = htmlContent; break;
      case 'IT Analiz': newContent.code = htmlContent; break;
      case 'Test': newContent.test = htmlContent; break;
      case 'Review': newContent.review = htmlContent; break;
    }
    
    onUpdateDocument?.(newContent);
    setIsEditing(false);
  };

  const handleDownload = () => {
    if (!documentContent) return;
    
    if (activeTab === 'FLOW') {
      if (!documentContent.bpmn) return;
      const blob = new Blob([documentContent.bpmn], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `surec_diyagrami.bpmn`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }

    const content = activeTab === 'BA Analiz' ? documentContent.businessAnalysis : activeTab === 'IT Analiz' ? documentContent.code : activeTab === 'Review' ? documentContent.review : documentContent.test;
    
    const htmlBlob = new Blob([`
      <!DOCTYPE html>
      <html lang="tr">
      <head>
        <meta charset="utf-8">
        <title>${activeTab} Dokümanı</title>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
            max-width: 800px; 
            margin: 0 auto; 
            padding: 2rem; 
            line-height: 1.6;
            color: #18181b;
          }
          table { 
            border-collapse: collapse; 
            width: 100%; 
            margin: 1.5rem 0;
          }
          th, td { 
            border: 1px solid #e4e4e7; 
            padding: 12px; 
            text-align: left;
          }
          th {
            background-color: #f4f4f5;
          }
          img {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
          }
          pre {
            background-color: #18181b;
            color: #f8fafc;
            padding: 1rem;
            border-radius: 8px;
            overflow-x: auto;
          }
          code {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          }
          blockquote {
            border-left: 4px solid #e4e4e7;
            margin: 0;
            padding-left: 1rem;
            color: #52525b;
            font-style: italic;
          }
        </style>
      </head>
      <body>
        ${content}
      </body>
      </html>
    `], { type: 'text/html' });
    
    const url = URL.createObjectURL(htmlBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analiz_${activeTab.toLowerCase().replace(' ', '_')}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 flex flex-col bg-theme-bg h-full shrink-0 relative overflow-hidden border-l border-theme-border/50 transition-colors duration-300 z-10">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-8 bg-theme-bg border-b border-theme-border sticky top-0 z-20 transition-colors duration-300 shadow-sm">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors relative rounded-md",
                activeTab === tab ? "text-theme-primary bg-theme-primary/10" : "text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover"
              )}
            >
              {tab}
              {activeTab === tab && (
                <motion.div 
                  layoutId="active-tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-theme-primary rounded-t-sm" 
                />
              )}
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-4">
          {score !== undefined && (
            <div className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold border",
              score >= 90 ? "bg-green-500/10 text-green-500 border-green-500/20" :
              score >= 70 ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
              "bg-red-500/10 text-red-500 border-red-500/20"
            )}>
              <CheckCircle2 size={12} />
              <span>KALİTE PUANI: {score}</span>
            </div>
          )}
          
          {/* Collaborators */}
          <div className="flex -space-x-2 mr-2">
            {collaborators.map((collab) => (
              <div 
                key={collab.id}
                title={`${collab.name} (${collab.role})`}
                className="w-6 h-6 border border-theme-surface flex items-center justify-center text-[8px] font-bold text-theme-primary-fg bg-theme-primary rounded-full shadow-sm"
              >
                {collab.avatar}
              </div>
            ))}
            <div className="w-6 h-6 border border-theme-surface bg-theme-surface-hover flex items-center justify-center text-[8px] font-bold text-theme-text-muted rounded-full shadow-sm">
              +2
            </div>
          </div>

          <div className="h-4 w-px bg-theme-border mx-2" />

          <div className="flex items-center gap-2">
            {documentContent && (
              <>
                {isEditing ? (
                  <button 
                    onClick={handleSave}
                    className="flex items-center gap-2 px-3 py-1.5 bg-theme-primary text-theme-primary-fg text-[10px] font-bold uppercase tracking-widest hover:bg-theme-primary-hover transition-colors rounded-md shadow-sm"
                  >
                    <Save size={12} />
                    Kaydet
                  </button>
                ) : activeTab !== 'FLOW' && (
                  <button 
                    onClick={() => setIsEditing(true)}
                    className="p-1.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover transition-colors rounded-md"
                  >
                    <Edit3 size={14} />
                  </button>
                )}
                <button 
                  onClick={handleShare}
                  disabled={isSharing}
                  className="p-1.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover transition-colors rounded-md"
                  title="Paylaşım Bağlantısı Oluştur"
                >
                  <Share2 size={14} className={isSharing ? "animate-pulse" : ""} />
                </button>
                <button 
                  onClick={handleJiraExport}
                  disabled={isExportingJira}
                  className="ml-2 flex items-center gap-2 px-3 py-1.5 bg-theme-surface text-theme-text text-[10px] font-bold uppercase tracking-widest hover:bg-theme-surface-hover transition-colors border border-theme-border disabled:opacity-50 rounded-md shadow-sm"
                >
                  <Trello size={12} className={isExportingJira ? "animate-bounce" : ""} />
                  {isExportingJira ? "Aktarılıyor..." : "Jira'ya Aktar"}
                </button>
                <button 
                  onClick={handleDownload}
                  className="ml-2 flex items-center gap-2 px-3 py-1.5 bg-theme-primary text-theme-primary-fg text-[10px] font-bold uppercase tracking-widest hover:bg-theme-primary-hover transition-colors rounded-md shadow-sm"
                >
                  <Download size={12} />
                  İndir
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-6 bg-theme-bg transition-colors duration-300">
        <div className="max-w-3xl mx-auto">
          <AnimatePresence mode="wait">
            {!documentContent && !isGenerating ? (
              <motion.div 
                key="empty"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="h-[60vh] flex flex-col items-center justify-center text-center border border-dashed border-theme-border/50 bg-theme-surface group hover:border-theme-primary transition-colors rounded-2xl shadow-sm"
              >
                <div className="w-16 h-16 bg-theme-bg flex items-center justify-center mb-6 border border-theme-border/50 group-hover:bg-theme-primary group-hover:text-theme-primary-fg transition-colors rounded-xl shadow-sm">
                  <FileText size={24} className="text-theme-text-muted group-hover:text-theme-primary-fg transition-colors" />
                </div>
                <h3 className="text-lg font-semibold text-theme-text mb-2 tracking-tight">Çalışma Dokümanı</h3>
                <p className="text-sm text-theme-text-muted mb-8 max-w-sm leading-relaxed">
                  Sohbet üzerinden yeterli bağlamı oluşturduktan sonra profesyonel analiz dokümanınızı üretebilirsiniz.
                </p>
                <button
                  onClick={onGenerate}
                  disabled={!hasMessages}
                  className={cn(
                    "flex items-center gap-2 px-6 py-3 font-bold uppercase tracking-widest text-[10px] transition-colors rounded-lg shadow-sm",
                    hasMessages 
                      ? "bg-theme-primary hover:bg-theme-primary text-theme-primary-fg" 
                      : "bg-theme-surface text-theme-text-muted cursor-not-allowed border border-theme-border/50"
                  )}
                >
                  <Play size={12} fill="currentColor" />
                  Dokümanı Oluştur
                </button>
              </motion.div>
            ) : !documentContent && isGenerating ? (
              <motion.div 
                key="generating"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-[60vh] flex flex-col items-center justify-center text-center"
              >
                <div className="relative w-12 h-12 mb-6">
                  <div className="absolute inset-0 border-2 border-theme-border/50 rounded-full" />
                  <div className="absolute inset-0 border-2 border-theme-primary border-t-transparent animate-spin rounded-full" />
                </div>
                <h3 className="text-lg font-semibold text-theme-text tracking-tight">Doküman Hazırlanıyor</h3>
                <p className="text-sm text-theme-text-muted mt-2">Yapay zeka analizleri derliyor ve yapılandırıyor...</p>
              </motion.div>
            ) : (
              <motion.div 
                key="content"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-theme-surface p-8 border border-theme-border/50 shadow-lg relative rounded-2xl"
              >
                {/* Document Header Decoration */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-theme-primary rounded-t-2xl opacity-80" />
                
                <div className="mb-8 pb-4 border-b border-theme-border/50 flex justify-between items-center">
                  <h2 className="text-2xl font-semibold text-theme-text tracking-tight">{activeTab === 'Review' ? 'Değerlendirme' : activeTab} Raporu</h2>
                  {isGenerating && (
                    <div className="flex items-center gap-2 text-theme-primary text-xs font-medium animate-pulse">
                      <div className="w-4 h-4 rounded-full border-2 border-theme-primary border-t-transparent animate-spin" />
                      Güncelleniyor...
                    </div>
                  )}
                </div>
                
                {activeTab === 'Review' && (
                  <div className="space-y-8 mb-8">
                    {score !== undefined && scoreExplanation && (
                      <div className="p-6 bg-gradient-to-br from-theme-primary/10 to-transparent border border-theme-primary/20 rounded-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-theme-primary/5 rounded-full blur-3xl -mr-10 -mt-10" />
                        <div className="flex items-start gap-5 relative z-10">
                          <div className={cn(
                            "flex items-center justify-center w-14 h-14 rounded-2xl text-xl font-bold shadow-sm border",
                            score >= 90 ? "bg-green-500/10 text-green-500 border-green-500/20" :
                            score >= 70 ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                            "bg-red-500/10 text-red-500 border-red-500/20"
                          )}>
                            {score}
                          </div>
                          <div className="flex-1">
                            <h3 className="text-base font-semibold text-theme-text mb-1 flex items-center gap-2">
                              <CheckCircle2 size={16} className="text-theme-primary" />
                              Kalite Değerlendirmesi
                            </h3>
                            <p className="text-sm text-theme-text-muted leading-relaxed">
                              {scoreExplanation}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {documentContent.conflictAnalysis && (
                      <div className="p-6 bg-theme-surface border border-theme-border rounded-xl">
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-theme-text-muted mb-4">
                          <Brain size={14} className="text-theme-primary" />
                          Çatışma ve Tartışma Analizi
                        </div>
                        <p className="text-sm text-theme-text leading-relaxed italic">
                          {documentContent.conflictAnalysis}
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 bg-theme-surface border border-theme-border rounded-xl">
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-theme-text-muted mb-4">
                          <BarChart3 size={14} className="text-theme-primary" />
                          Ekip Metrikleri
                        </div>
                        <div className="space-y-4">
                          {Object.entries(messages.reduce((acc, msg) => {
                            if (msg.role === 'model' && msg.agentRole) {
                              const role = msg.agentRole;
                              if (!acc[role]) acc[role] = { count: 0, time: 0, tokens: 0, name: msg.senderName };
                              acc[role].count += 1;
                              acc[role].time += msg.thinkingTime || 0;
                              acc[role].tokens += msg.tokenCount || 0;
                            }
                            return acc;
                          }, {} as Record<string, { count: number, time: number, tokens: number, name?: string }>)).map(([role, data]) => (
                            <div key={role} className="flex flex-col gap-1">
                              <div className="flex justify-between items-center">
                                <span className="text-xs font-semibold text-theme-text">{data.name || role}</span>
                                <span className="text-[10px] text-theme-text-muted">{data.count} Mesaj</span>
                              </div>
                              <div className="flex gap-4 text-[10px] text-theme-text-muted">
                                <div className="flex items-center gap-1">
                                  <Clock size={10} />
                                  {data.time}s Düşünme
                                </div>
                                <div className="flex items-center gap-1">
                                  <Coins size={10} />
                                  {data.tokens.toLocaleString()} Token
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="p-4 bg-theme-surface border border-theme-border rounded-xl">
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-theme-text-muted mb-4">
                          <MessageSquare size={14} className="text-theme-primary" />
                          Genel Özet
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-theme-text-muted uppercase">Toplam Mesaj</span>
                            <span className="text-xl font-bold text-theme-text">{messages.length}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-theme-text-muted uppercase">Toplam Token</span>
                            <span className="text-xl font-bold text-theme-text">
                              {messages.reduce((sum, m) => sum + (m.tokenCount || 0), 0).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-theme-text-muted uppercase">Ort. Düşünme</span>
                            <span className="text-xl font-bold text-theme-text">
                              {Math.round(messages.reduce((sum, m) => sum + (m.thinkingTime || 0), 0) / (messages.filter(m => m.role === 'model').length || 1))}s
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {isEditing ? (
                  <div className="bg-theme-surface border border-theme-border/50 rounded-lg overflow-hidden shadow-sm">
                    <MenuBar editor={editor} />
                    <EditorContent editor={editor} />
                  </div>
                ) : activeTab === 'FLOW' ? (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {documentContent.bpmn ? (
                      <BpmnViewer xml={documentContent.bpmn} />
                    ) : (
                      <div className="h-[400px] flex flex-col items-center justify-center text-center border border-dashed border-theme-border/50 bg-theme-bg rounded-xl">
                        <Trello size={32} className="text-theme-text-muted mb-4 opacity-20" />
                        <p className="text-sm text-theme-text-muted">Henüz bir BPMN diyagramı oluşturulmamış.</p>
                        <p className="text-xs text-theme-text-muted/60 mt-1">AI'dan bir süreç diyagramı çizmesini isteyebilirsiniz.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <article className="prose prose-sm max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-theme-text prose-p:text-theme-text prose-p:leading-relaxed prose-strong:text-theme-text prose-a:text-theme-primary prose-a:underline hover:prose-a:no-underline prose-pre:bg-theme-surface-hover prose-pre:text-theme-text prose-pre:border prose-pre:border-theme-border/50 prose-pre:p-6 prose-pre:rounded-lg prose-code:text-theme-text prose-code:bg-theme-surface-hover prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none prose-blockquote:border-l-2 prose-blockquote:border-theme-primary prose-blockquote:bg-theme-surface-hover prose-blockquote:p-6 prose-blockquote:italic prose-blockquote:rounded-r-lg text-theme-text">
                    <div className="document-content-view" dangerouslySetInnerHTML={{ __html: getActiveContent(documentContent, activeTab) }} />
                  </article>
                )}

                {documentContent && documentContent.thoughtProcess && (
                  <div className="mt-12 pt-8 border-t border-theme-border/50">
                    <div className="flex items-center gap-2 text-theme-text-muted text-[10px] font-bold uppercase tracking-widest mb-4">
                      <Palette size={14} className="text-theme-primary" />
                      Yapay Zeka Akıl Yürütme Süreci
                    </div>
                    <div className="bg-theme-surface-hover/50 p-6 rounded-xl border border-theme-border/30 italic text-sm text-theme-text-muted leading-relaxed">
                      {documentContent.thoughtProcess}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
