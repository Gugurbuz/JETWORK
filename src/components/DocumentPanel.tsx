import React, { useState, useEffect, useRef } from 'react';
import { FileText, Download, Play, CheckCircle2, Share2, Printer, Edit3, Save, Users, Bold, Italic, List, ListOrdered, Quote, Heading1, Heading2, Code, Undo, Redo, Table as TableIcon, Image as ImageIcon, Palette, Trello, Link2, Activity, Bot, User, Briefcase, Bug, Sparkles, Terminal, AlertTriangle, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'motion/react';
import { Collaborator, DocumentData, Message, SectionData } from '../types';
import { useEditor, EditorContent } from '@tiptap/react';
import { BpmnViewer } from './BpmnViewer';
import { Brain, BarChart3, Clock, Coins, MessageSquare, Bookmark, Eye, RotateCcw } from 'lucide-react';
import { DiffViewerModal } from './DiffViewerModal';
import StarterKit from '@tiptap/starter-kit';
import { HeadingWithId } from '../lib/heading-with-id';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { ImageWithSize } from '../lib/image-with-size';
import { useStore } from '../store/useStore';

interface DocumentPanelProps {
  onGenerate: () => void;
  hasMessages: boolean;
  collaborators?: Collaborator[];
  onUpdateDocument?: (content: DocumentData) => void;
  score?: number;
  scoreExplanation?: string;
  messages?: Message[];
  onRestoreDocument?: (doc: any) => void;
  onManageParticipants?: () => void;
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

const stringToColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    '#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea',
    '#4f46e5', '#0891b2', '#0d9488', '#be123c', '#c026d3',
  ];
  return colors[Math.abs(hash) % colors.length];
};

const getRoleConfig = (role?: string) => {
  switch (role) {
    case 'Moderatör': return { icon: Brain, color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
    case 'İş Analisti': return { icon: Briefcase, color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' };
    case 'Yazılım Mimarı': return { icon: Code, color: 'text-purple-500', bg: 'bg-purple-500/10', border: 'border-purple-500/20' };
    case 'Test Uzmanı': return { icon: Bug, color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20' };
    case 'Product Owner': return { icon: Briefcase, color: 'text-theme-primary', bg: 'bg-theme-primary/10', border: 'border-theme-primary/20' };
    case 'Scrum Master': return { icon: Users, color: 'text-theme-primary', bg: 'bg-theme-primary/10', border: 'border-theme-primary/20' };
    case 'Kullanıcı': return { icon: User, color: 'text-theme-primary', bg: 'bg-theme-primary/10', border: 'border-theme-primary/20' };
    default: return { icon: Bot, color: 'text-theme-text-muted', bg: 'bg-theme-surface-hover', border: 'border-theme-border' };
  }
};

const getActiveSectionObject = (data: DocumentData | null, tab: string): SectionData | string | null | undefined => {
  if (!data) return null;
  switch (tab) {
    case 'BA Analiz': return data.businessAnalysis;
    case 'IT Analiz': return data.code;
    case 'Test': return data.test;
    case 'FLOW': return data.bpmn;
    case 'Review': return data.review;
    default: return null;
  }
};

const getActiveContent = (data: DocumentData | null, tab: string): string => {
  const section = getActiveSectionObject(data, tab);
  if (!section) return '';
  // Geriye dönük uyumluluk: Eğer hala string ise direkt dön, objeyse content'i dön
  return typeof section === 'string' ? section : (section.content || '');
};

const getDocumentTitle = (tab: string) => {
  switch (tab) {
    case 'BA Analiz': return 'İş Analizi';
    case 'IT Analiz': return 'IT Analizi';
    case 'Test': return 'Test';
    case 'Review': return 'Değerlendirme';
    default: return tab;
  }
};

const CoverPage = ({ activeTab }: { activeTab: string }) => (
  <div className="bg-white rounded-xl shadow-sm border border-theme-border/50 p-12 mb-12 flex flex-col items-center select-none printable-cover">
    {/* ENERJİSA Logo Placeholder */}
    <div className="mb-24 mt-8">
      <div className="text-4xl font-black tracking-tighter text-[#1e1e1e] flex items-center">
        ENERJİ<span className="bg-[#1a237e] text-white px-3 py-1 rounded-full text-[22px] leading-none tracking-normal ml-1 mb-1 font-medium">SA</span>
      </div>
    </div>

    <div className="w-full flex items-center justify-center max-w-2xl mx-auto">
       <div className="flex-[0.5] flex justify-end border-r-2 border-gray-400 pr-8 py-2">
         <h1 className="text-4xl font-light text-[#0f172a] leading-[1.2] m-0 text-right">
           {getDocumentTitle(activeTab)}<br/>Dokümanı
         </h1>
       </div>
       <div className="flex-[0.5] text-left pl-8 flex flex-col justify-center gap-1">
         <div className="text-xl text-[#0f172a] font-light">Talep Adı: <span className="font-normal">P4F Ürünü</span></div>
         <div className="text-xl text-[#0f172a] font-light">19.04.2026</div>
       </div>
    </div>

    <div className="w-full max-w-2xl mx-auto mt-24 mb-4">
      <hr className="border-t border-gray-400" />
    </div>

    <div className="w-full max-w-2xl mx-auto text-left text-sm text-[#0f172a]">
      Talep No: <a href="#" className="text-blue-600 underline font-normal">UA-437</a>
    </div>
  </div>
);

export function DocumentPanel({ 
  onGenerate, 
  hasMessages,
  collaborators = [],
  onUpdateDocument,
  score,
  scoreExplanation,
  messages = [],
  onRestoreDocument,
  onManageParticipants
}: DocumentPanelProps) {
  const activeTab = useStore(state => state.activeTab);
  const setActiveTab = useStore(state => state.setActiveTab);
  const documentContent = useStore(state => state.documentContent);
  const isGenerating = useStore(state => state.isGenerating);
  const isLoadingWorkspace = useStore(state => state.isLoadingWorkspace);
  const setSelectedDocumentText = useStore(state => state.setSelectedDocumentText);

  // Always declare these hooks first, at the top level
  const [isEditing, setIsEditing] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [diffModalData, setDiffModalData] = useState<{ oldDoc?: any, newDoc?: any } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);

  // The helper functions that don't use hooks can remain here
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setIsAutoScrollEnabled(isNearBottom);
  };

  useEffect(() => {
    if (activeTab === 'Review' && isAutoScrollEnabled) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab, isAutoScrollEnabled]);

  const handleShare = async () => {
    if (!documentContent) return;
    setIsSharing(true);
    try {
      const shareId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
      const { doc, setDoc, serverTimestamp, db } = await import('../db');
      
      await setDoc(doc(db, 'shared_analyses', shareId), {
        data: documentContent,
        createdAt: serverTimestamp()
      });
      
      const shareUrl = `${window.location.origin}?shareId=${shareId}`;
      await navigator.clipboard.writeText(shareUrl);
      alert('Paylaşım bağlantısı panoya kopyalandı!\n\n' + shareUrl);
    } catch (error) {
      console.error(error);
      alert('Paylaşım bağlantısı oluşturulurken hata oluştu.');
    } finally {
      setIsSharing(false);
    }
  };

  // UI İçin Status ve Flags okuma
  const activeSectionObj = getActiveSectionObject(documentContent, activeTab);
  const isStateObject = activeSectionObj && typeof activeSectionObj === 'object';
  const currentStatus = isStateObject ? (activeSectionObj as SectionData).status : null;
  const currentFlags = isStateObject ? (activeSectionObj as SectionData).flags : [];

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      HeadingWithId,
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
      ImageWithSize,
    ],
    content: getActiveContent(documentContent, activeTab),
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[60vh] p-8',
      },
      handleClick: (view, pos, event) => {
        const target = event.target as Node;
        const element = target.nodeType === Node.TEXT_NODE ? target.parentElement : target as Element;
        const aTag = element?.closest('a');
        if (aTag) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
    onSelectionUpdate: ({ editor }) => {
      if (setSelectedDocumentText) {
        const { from, to } = editor.state.selection;
        const text = editor.state.doc.textBetween(from, to, ' ');
        setSelectedDocumentText(text);
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
    
    // YENİ MİMARİ: Kaydederken objenin content kısmını güncelle
    const updateSection = (sectionKey: keyof DocumentData) => {
      const section = newContent[sectionKey];
      if (typeof section === 'object' && section !== null) {
        (newContent[sectionKey] as any) = { ...section, content: htmlContent };
      } else {
        // Eski string tipindeyse onu objeye dönüştürerek kaydet
        (newContent[sectionKey] as any) = { content: htmlContent, status: 'DRAFT', flags: [] };
      }
    };

    switch (activeTab) {
      case 'BA Analiz': updateSection('businessAnalysis'); break;
      case 'IT Analiz': updateSection('code'); break;
      case 'Test': updateSection('test'); break;
      case 'Review': updateSection('review'); break;
    }
    
    onUpdateDocument?.(newContent);
    setIsEditing(false);
  };

  const handleDownload = () => {
    if (!documentContent) return;
    
    if (activeTab === 'FLOW') {
      const bpmnContent = getActiveContent(documentContent, 'FLOW');
      if (!bpmnContent) return;
      const blob = new Blob([bpmnContent], { type: 'application/xml' });
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

    const content = getActiveContent(documentContent, activeTab);
    
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
          /* Cover Page Print Styles */
          .cover-page {
            display: flex;
            flex-direction: column;
            margin-bottom: 4rem;
            padding: 4rem;
            border: 1px solid #e4e4e7;
            border-radius: 12px;
            background: #fff;
            page-break-after: always;
          }
          .cover-logo {
            text-align: center;
            font-size: 2.5rem;
            font-weight: 900;
            letter-spacing: -0.05em;
            margin-bottom: 6rem;
            margin-top: 2rem;
            color: #1e1e1e;
          }
          .cover-logo span {
            background: #1a237e;
            color: #fff;
            border-radius: 50%;
            padding: 6px 14px;
            font-weight: 500;
            letter-spacing: normal;
            margin-left: 4px;
            font-size: 1.5rem;
            vertical-align: middle;
          }
          .cover-container {
            display: flex;
            max-width: 800px;
            margin: 0 auto;
            width: 100%;
          }
          .cover-left {
            flex: 0.5;
            padding-right: 2rem;
            text-align: right;
            border-right: 2px solid #9ca3af;
          }
          .cover-right {
            flex: 0.5;
            padding-left: 2rem;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }
          .cover-title {
            font-size: 2.5rem;
            color: #0f172a;
            font-weight: 300;
            margin: 0;
            line-height: 1.2;
          }
          .cover-meta {
            font-size: 1.25rem;
            color: #0f172a;
            font-weight: 300;
            margin-bottom: 0.5rem;
          }
          .cover-meta strong {
            font-weight: 400;
          }
          .cover-date {
            font-size: 1.25rem;
            color: #0f172a;
            font-weight: 300;
          }
          .cover-divider {
            margin-top: 6rem;
            margin-bottom: 1rem;
            border: 0;
            border-top: 1px solid #9ca3af;
            width: 100%;
            max-width: 800px;
          }
          .cover-footer {
            font-size: 0.875rem;
            color: #0f172a;
            max-width: 800px;
            margin: 0 auto;
            width: 100%;
          }
          .cover-footer a {
            color: #2563eb;
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        ${activeTab !== 'Review' ? `
        <div class="cover-page">
          <div class="cover-logo">ENERJİ<span>SA</span></div>
          <div class="cover-container">
            <div class="cover-left">
              <h1 class="cover-title">${getDocumentTitle(activeTab)}<br/>Dokümanı</h1>
            </div>
            <div class="cover-right">
              <div class="cover-meta">Talep Adı: <strong>P4F Ürünü</strong></div>
              <div class="cover-date">19.04.2026</div>
            </div>
          </div>
          <hr class="cover-divider" />
          <div class="cover-footer">
            Talep No: <a href="#">UA-437</a>
          </div>
        </div>
        ` : ''}
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
          {TABS.map((tab) => {
            // Tablardaki bildirim/statü işaretçileri için
            const tabSection = getActiveSectionObject(documentContent, tab);
            const isTabObj = tabSection && typeof tabSection === 'object';
            const hasError = isTabObj && (tabSection as SectionData).status === 'NEEDS_REVISION';
            
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors relative rounded-md flex items-center gap-2",
                  activeTab === tab ? "text-theme-primary bg-theme-primary/10" : "text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover"
                )}
              >
                {tab}
                {hasError && <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" title="Revizyon Bekliyor" />}
                {activeTab === tab && (
                  <motion.div 
                    layoutId="active-tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-theme-primary rounded-t-sm" 
                  />
                )}
              </button>
            )
          })}
        </div>
        
        <div className="flex items-center gap-4">
          {score !== undefined && score > 0 && (
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
          
          <div className="h-4 w-px bg-theme-border mx-2" />

          <div className="flex items-center gap-2">
            {documentContent && (
              <>
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        if (editor && documentContent) {
                          editor.commands.setContent(getActiveContent(documentContent, activeTab));
                        }
                        setIsEditing(false);
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 bg-theme-surface-hover text-theme-text text-[10px] font-bold uppercase tracking-widest hover:bg-theme-border transition-colors rounded-md shadow-sm"
                    >
                      İptal
                    </button>
                    <button 
                      onClick={handleSave}
                      className="flex items-center gap-2 px-3 py-1.5 bg-theme-primary text-theme-primary-fg text-[10px] font-bold uppercase tracking-widest hover:bg-theme-primary-hover transition-colors rounded-md shadow-sm"
                    >
                      <Save size={12} />
                      Kaydet
                    </button>
                  </div>
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
            {isLoadingWorkspace ? (
              <motion.div 
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-8 animate-pulse p-8 bg-theme-surface border border-theme-border/50 rounded-2xl shadow-sm"
              >
                <div className="h-8 w-1/3 bg-theme-border/50 rounded-lg" />
                <div className="space-y-4">
                  <div className="h-4 w-full bg-theme-border/30 rounded" />
                  <div className="h-4 w-5/6 bg-theme-border/30 rounded" />
                  <div className="h-4 w-4/6 bg-theme-border/30 rounded" />
                </div>
                <div className="space-y-4 pt-8">
                  <div className="h-4 w-full bg-theme-border/30 rounded" />
                  <div className="h-4 w-full bg-theme-border/30 rounded" />
                  <div className="h-4 w-3/6 bg-theme-border/30 rounded" />
                </div>
              </motion.div>
            ) : !documentContent && !isGenerating && activeTab !== 'Review' ? (
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
                <h3 className="text-lg font-semibold text-theme-text tracking-tight">
                  Doküman Hazırlanıyor
                </h3>
                <p className="text-sm text-theme-text-muted mt-2">
                  Yapay zeka analizleri derliyor ve yapılandırıyor...
                </p>
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
                
                {/* YENİ UI: Status ve Badge Gösterimi */}
                <div className="mb-8 pb-4 border-b border-theme-border/50 flex justify-between items-center">
                  <h2 className="text-2xl font-semibold text-theme-text tracking-tight flex items-center gap-3">
                    {activeTab === 'Review' ? 'Değerlendirme' : activeTab} Raporu
                    
                    {/* Statü Rozeti */}
                    {currentStatus && (
                      <span className={cn(
                        "text-[10px] px-3 py-1 font-bold uppercase tracking-widest rounded-full border",
                        currentStatus === 'APPROVED' ? "bg-green-500/10 text-green-500 border-green-500/20" :
                        currentStatus === 'NEEDS_REVISION' ? "bg-red-500/10 text-red-500 border-red-500/20" :
                        "bg-gray-500/10 text-gray-500 border-gray-500/20"
                      )}>
                        {currentStatus === 'APPROVED' ? 'Onaylandı' : currentStatus === 'NEEDS_REVISION' ? 'Revizyon Bekliyor' : 'Taslak'}
                      </span>
                    )}
                  </h2>
                  
                  {isGenerating && (
                    <div className="flex items-center gap-2 text-theme-primary text-xs font-medium animate-pulse">
                      <div className="w-4 h-4 rounded-full border-2 border-theme-primary border-t-transparent animate-spin" />
                      Güncelleniyor...
                    </div>
                  )}
                </div>

                {/* YENİ UI: İtirazlar (Flags) Listesi */}
                {currentFlags && currentFlags.length > 0 && (
                  <div className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <h4 className="flex items-center gap-2 text-red-500 font-bold text-sm mb-3">
                      <AlertTriangle size={16} />
                      Ekip Tarafından Bildirilen Sorunlar
                    </h4>
                    <ul className="space-y-2">
                      {currentFlags.map((flag: string, idx: number) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-theme-text opacity-90">
                          <AlertCircle size={14} className="mt-0.5 text-red-400 shrink-0" />
                          <span>{flag}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {activeTab === 'Review' && (
                  <div className="space-y-8 mb-8">
                    {score !== undefined && score > 0 && scoreExplanation && (
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

                    {/* Live Discussion Feed */}
                    <div className="mt-8 bg-theme-surface rounded-2xl border border-theme-border/50 shadow-lg relative overflow-hidden">
                      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-theme-primary via-purple-500 to-theme-primary opacity-80" />
                      
                      <div className="p-6 border-b border-theme-border/50 flex items-center justify-between bg-theme-surface-hover/30">
                        <h3 className="text-lg font-semibold text-theme-text flex items-center gap-2">
                          <Activity className="text-theme-primary" size={20} />
                          Ajan Etkileşim Özeti
                        </h3>
                      </div>

                      <div 
                        ref={scrollContainerRef}
                        onScroll={handleScroll}
                        className="p-6 max-h-[600px] overflow-y-auto custom-scrollbar"
                      >
                        <div className="relative border-l-2 border-theme-border/30 ml-4 space-y-8 pb-4">
                          <AnimatePresence initial={false}>
                            {messages.map((msg) => {
                              const isUser = msg.role === 'user';
                              const config = getRoleConfig(msg.senderRole || (isUser ? 'Kullanıcı' : undefined));
                              const Icon = config.icon;
                              const currentUser = useStore(state => state.user);
                              const userColor = isUser 
                                ? (msg.senderName === currentUser?.name && currentUser?.color ? currentUser.color : (msg.senderName ? stringToColor(msg.senderName) : undefined))
                                : undefined;
                              
                              return (
                                <motion.div 
                                  key={msg.id}
                                  initial={{ opacity: 0, x: -20, y: 10 }}
                                  animate={{ opacity: 1, x: 0, y: 0 }}
                                  className="relative pl-8"
                                >
                                  {/* Timeline Dot */}
                                  <div 
                                    className={cn("absolute -left-[17px] top-1 w-8 h-8 rounded-full flex items-center justify-center border-2 bg-theme-surface shadow-sm", !userColor && config.border, !userColor && config.color)}
                                    style={userColor ? { borderColor: `${userColor}33`, color: userColor } : undefined}
                                  >
                                    <Icon size={14} />
                                  </div>
                                  
                                  {/* Content Card */}
                                  <div 
                                    className={cn("p-4 rounded-xl border shadow-sm transition-all hover:shadow-md", !userColor && config.bg, !userColor && config.border)}
                                    style={userColor ? { backgroundColor: `${userColor}1a`, borderColor: `${userColor}33` } : undefined}
                                  >
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-2">
                                        <span 
                                          className={cn("font-semibold text-sm", !userColor && config.color)}
                                          style={userColor ? { color: userColor } : undefined}
                                        >
                                          {msg.senderName || (isUser ? 'Siz' : 'Yapay Zeka')}
                                        </span>
                                        {msg.senderRole && (
                                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-theme-surface/80 text-theme-text-muted border border-theme-border/50 font-medium uppercase tracking-wider">
                                            {msg.senderRole}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-3 text-[10px] text-theme-text-muted font-medium">
                                        {msg.thinkingTime && (
                                          <span className="flex items-center gap-1" title="Düşünme Süresi">
                                            <Clock size={12} />
                                            {msg.thinkingTime}s
                                          </span>
                                        )}
                                        {msg.tokenCount && (
                                          <span className="flex items-center gap-1" title="Token Sayısı">
                                            <Coins size={12} />
                                            {msg.tokenCount}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="text-sm text-theme-text">
                                      {msg.actionSummary ? (
                                        <p className="font-medium leading-relaxed">{msg.actionSummary}</p>
                                      ) : (
                                        <div className="prose prose-sm max-w-none prose-p:leading-relaxed line-clamp-2 opacity-80">
                                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {msg.text}
                                          </ReactMarkdown>
                                        </div>
                                      )}
                                    </div>
                                    
                                    {msg.documentActions && msg.documentActions.length > 0 && (
                                      <div className="mt-4 p-4 bg-theme-bg/50 border border-theme-border rounded-xl shadow-sm">
                                        <div className="flex items-center gap-2 mb-3 text-[10px] font-bold uppercase tracking-widest text-theme-text-muted">
                                          <FileText size={14} className="text-theme-primary" /> İşlem Geçmişi
                                        </div>
                                        <ul className="space-y-2 mb-4">
                                          {msg.documentActions.map((action, i) => (
                                            <li key={i} className="flex items-start gap-2 text-sm text-theme-text">
                                              <span className="text-theme-primary mt-1">•</span>
                                              <span>{action}</span>
                                            </li>
                                          ))}
                                        </ul>
                                        <div className="flex flex-wrap gap-2 border-t border-theme-border/50 pt-3">
                                          <button 
                                            onClick={() => setDiffModalData({ oldDoc: msg.previousDocumentSnapshot, newDoc: msg.documentSnapshot })}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-theme-text-muted hover:text-theme-primary bg-theme-surface hover:bg-theme-surface-hover transition-colors border border-theme-border rounded-md shadow-sm"
                                          >
                                            <Eye size={12} /> Farkı Gör
                                          </button>
                                          {onRestoreDocument && (
                                            <button 
                                              onClick={() => onRestoreDocument(msg.documentSnapshot)}
                                              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-theme-text-muted hover:text-theme-primary bg-theme-surface hover:bg-theme-surface-hover transition-colors border border-theme-border rounded-md shadow-sm"
                                            >
                                              <RotateCcw size={12} /> Geri Yükle
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </motion.div>
                              );
                            })}
                          </AnimatePresence>
                          <div ref={messagesEndRef} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                <AnimatePresence mode="wait">
                  {isEditing ? (
                    <motion.div 
                      key="editor"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="bg-theme-surface border border-theme-border/50 rounded-lg overflow-hidden shadow-sm"
                    >
                      <MenuBar editor={editor} />
                      <EditorContent editor={editor} />
                    </motion.div>
                  ) : activeTab === 'FLOW' ? (
                    <motion.div 
                      key="flow"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                    >
                      {getActiveContent(documentContent, 'FLOW') ? (
                        <BpmnViewer xml={getActiveContent(documentContent, 'FLOW')} />
                      ) : (
                        <div className="h-[400px] flex flex-col items-center justify-center text-center border border-dashed border-theme-border/50 bg-theme-bg rounded-xl">
                          <Trello size={32} className="text-theme-text-muted mb-4 opacity-20" />
                          <p className="text-sm text-theme-text-muted">Henüz bir BPMN diyagramı oluşturulmamış.</p>
                          <p className="text-xs text-theme-text-muted/60 mt-1">AI'dan bir süreç diyagramı çizmesini isteyebilirsiniz.</p>
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    <motion.article 
                      key="reader"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="prose prose-sm md:prose-base max-w-none prose-p:leading-relaxed prose-blockquote:border-l-4 prose-blockquote:border-theme-primary prose-blockquote:bg-theme-surface-hover/50 prose-blockquote:p-4 prose-blockquote:italic prose-blockquote:rounded-r-lg prose-headings:text-theme-text prose-headings:font-bold prose-headings:tracking-tight prose-a:text-theme-primary prose-a:no-underline hover:prose-a:underline prose-strong:text-theme-text prose-strong:font-bold prose-table:border-collapse prose-th:bg-theme-surface-hover prose-th:p-3 prose-td:p-3 prose-td:border-b prose-td:border-theme-border/50"
                    >
                      {activeTab !== 'Review' && (
                        <CoverPage activeTab={activeTab} />
                      )}
                      <div 
                        className="document-content-view" 
                        dangerouslySetInnerHTML={{ __html: getActiveContent(documentContent, activeTab) }} 
                        onClick={(e) => {
                          const target = e.target as Node;
                          const element = target.nodeType === Node.TEXT_NODE ? target.parentElement : target as Element;
                          const aTag = element?.closest('a');
                          if (aTag) {
                            e.preventDefault();
                          }
                        }}
                      />
                    </motion.article>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {diffModalData && (
        <DiffViewerModal
          oldDoc={diffModalData.oldDoc}
          newDoc={diffModalData.newDoc}
          onClose={() => setDiffModalData(null)}
          onRestore={() => {
            if (onRestoreDocument && diffModalData.newDoc) {
              onRestoreDocument(diffModalData.newDoc);
            }
          }}
        />
      )}
    </div>
  );
}