import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, Command, Globe, Link2, Search, Brain, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ImagePlus, X, Mic, ArrowRightToLine, SmilePlus, Lightbulb, Wand2, Plus, ArrowUp, ArrowDown, FileText, Bookmark, Eye, RotateCcw, Check, Zap } from 'lucide-react';
import { Message } from '../types';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'motion/react';
import { DiffViewerModal } from './DiffViewerModal';

const stringToColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = '#';
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xFF;
    color += ('00' + value.toString(16)).substr(-2);
  }
  return color;
};

const JetWorkLogo = ({ className, isSpinning, isColorSwapping }: { className?: string, isSpinning?: boolean, isColorSwapping?: boolean }) => {
  return (
    <svg viewBox="0 0 100 100" className={cn("shrink-0", className, isSpinning && "animate-spin")}>
      <rect x="10" y="10" width="80" height="80" className={cn("fill-theme-text", isColorSwapping && "animate-swap-black")} />
      <rect x="30" y="30" width="40" height="40" className={cn("fill-theme-surface", isColorSwapping && "animate-swap-white")} />
      <rect x="42" y="42" width="16" height="16" className={cn("fill-theme-text", isColorSwapping && "animate-swap-black")} />
    </svg>
  );
};

const MonogramSpinner = () => (
  <JetWorkLogo className="w-4 h-4" isColorSwapping={true} />
);

const MessageTimer = ({ isTyping }: { isTyping: boolean }) => {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (isTyping) {
      const timer = setInterval(() => setSeconds(s => s + 1), 1000);
      return () => clearInterval(timer);
    }
  }, [isTyping]);
  
  if (isTyping) {
    return <span>Running for {seconds}s</span>;
  }
  return <span>Took {seconds}s</span>;
};

const ReasoningProcess = ({ thinkingText, isTyping, groundingUrls }: { thinkingText: string, isTyping: boolean, groundingUrls?: { uri: string; title: string }[] }) => {
  const getThinkingTitle = () => {
    if (!thinkingText) return isTyping ? "Ajan Düşünüyor..." : "Ajanın Düşünce Süreci";
    const matches = [...thinkingText.matchAll(/\*\*([^*]+)\*\*/g)];
    if (matches.length > 0) {
      return matches[matches.length - 1][1].trim();
    }
    return isTyping ? "Ajan Düşünüyor..." : "Ajanın Düşünce Süreci";
  };

  const cleanThinkingText = thinkingText?.replace(/\*\*([^*]+)\*\*/g, '').trim();

  return (
    <details open={isTyping} className="group/reasoning mb-3 border border-theme-border/50 rounded-lg overflow-hidden bg-theme-surface/50">
      <summary className="flex items-center gap-2 cursor-pointer list-none select-none p-3 bg-theme-surface hover:bg-theme-bg transition-colors [&::-webkit-details-marker]:hidden">
        {isTyping ? (
          <JetWorkLogo className="w-4 h-4" isSpinning={true} />
        ) : (
          <Brain className="w-4 h-4 text-theme-primary" />
        )}
        <span className="font-medium text-sm text-theme-text">
          {getThinkingTitle()}
        </span>
        <ChevronDown className="w-4 h-4 ml-auto text-theme-text-muted transition-transform group-open/reasoning:rotate-180" />
      </summary>
      
      <div className="p-4 border-t border-theme-border/50 text-xs text-theme-text-muted font-mono whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
        {cleanThinkingText}
        
        {/* Grounding URLs (Tools) */}
        {groundingUrls && groundingUrls.length > 0 && (
          <div className="mt-4 pt-4 border-t border-theme-border/30">
            <div className="flex items-center gap-2 font-medium text-sm text-theme-text-muted mb-2">
              <Globe className="w-3.5 h-3.5" />
              Web'de Araştırıldı
            </div>
            <div className="flex flex-col gap-1">
              {groundingUrls.map((url, idx) => (
                <a key={idx} href={url.uri} target="_blank" rel="noopener noreferrer" className="text-xs text-theme-primary hover:underline truncate max-w-full block">
                  {url.title || url.uri}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
};

interface ChatPanelProps {
  messages: Message[];
  onSendMessage: (text: string, attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[]) => void;
  isGenerating?: boolean;
  issueKey?: string;
  status?: string;
  title?: string;
  projectName?: string;
  onBack?: () => void;
  activeUsers?: { id: string; name: string; role: string }[];
  typingUsers?: { userId: string; userName: string }[];
  onTypingStart?: () => void;
  onTypingEnd?: () => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  currentUser?: { name: string; role: string };
  isAiActive?: boolean;
  onToggleAiActive?: () => void;
  aiHandRaised?: string | null;
  onAcceptAiHandRaise?: () => void;
  onDismissAiHandRaise?: () => void;
  selectedDocumentText?: string;
  onRestoreDocument?: (doc: any) => void;
  hasDocument?: boolean;
  isZeroTouchMode?: boolean;
  onToggleZeroTouchMode?: () => void;
}

const SLASH_COMMANDS = [
  { command: '/spike', description: 'Teknik mimari analizi ve PoC' },
  { command: '/thinkmore', description: 'Derinlemesine düşünme ve risk analizi' },
  { command: '/websearch', description: 'İnternette güncel bilgi araması' },
  { command: '/story', description: 'Kullanıcı hikayesi ve kabul kriterleri' },
  { command: '/test', description: 'Test senaryoları üretimi' },
  { command: '/read', description: 'Verilen URL\'yi okuyup analiz etme' },
];

const EMOJIS = ['👍', '👎', '🚀', '👀', '✅', '💡', '🎉', '❤️'];

const getLatestThought = (text: string) => {
  if (!text) return "Düşünüyor...";
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  if (lines.length === 0) return "Düşünüyor...";
  let lastLine = lines[lines.length - 1].trim();
  lastLine = lastLine.replace(/[*#`]/g, '');
  if (lastLine.length > 60) {
    return lastLine.substring(0, 60) + "...";
  }
  return lastLine;
};

export function ChatPanel({ 
  messages, onSendMessage, isGenerating, issueKey, status, title, projectName, 
  onBack, activeUsers, typingUsers, 
  onTypingStart, onTypingEnd, onToggleReaction, currentUser,
  isAiActive, onToggleAiActive, aiHandRaised, onAcceptAiHandRaise, onDismissAiHandRaise,
  selectedDocumentText, onRestoreDocument, hasDocument,
  isZeroTouchMode, onToggleZeroTouchMode
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [selectedAttachments, setSelectedAttachments] = useState<{ url: string; data: string; mimeType: string; name?: string; file?: File }[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [activeReactionMenu, setActiveReactionMenu] = useState<string | null>(null);
  const [isAiHandExpanded, setIsAiHandExpanded] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [diffModalData, setDiffModalData] = useState<{ oldDoc?: any, newDoc?: any } | null>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const suggestionsScrollRef = useRef<HTMLDivElement>(null);

  const dynamicSuggestions = selectedDocumentText 
    ? [
        "Seçili mimariyi/kodu optimize et",
        "Seçili bölümdeki güvenlik risklerini bul",
        "Bu kısım için alternatif bir yaklaşım sun",
        "Seçili metni daha teknik bir dille yaz"
      ]
    : hasDocument
      ? [
          "Bu mimariyi nasıl daha ölçeklenebilir (scalable) yaparız?",
          "Sistemin zayıf noktaları (single point of failure) neler?",
          "Bu entegrasyon için bir Sequence Diagram mantığı kur",
          "Bunu bir BPMN süreç diyagramına dönüştür"
        ]
      : [];

  const scrollSuggestions = () => {
    if (suggestionsScrollRef.current) {
      suggestionsScrollRef.current.scrollBy({ left: 150, behavior: 'smooth' });
    }
  };

  const handleMagicWandClick = () => {
    if (selectedDocumentText) {
      setInput(`Lütfen şu seçili metni değerlendir ve iyileştirme önerileri sun:\n\n"${selectedDocumentText}"`);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    } else {
      setInput("Lütfen dokümanın genel yapısını değerlendir ve iyileştirme önerileri sun.");
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  };

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
    setIsScrolledUp(false);
  };

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    // Use a slightly larger threshold to avoid false positives
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setIsScrolledUp(!isAtBottom);
  };

  useEffect(() => {
    if (!aiHandRaised) {
      setIsAiHandExpanded(false);
    }
  }, [aiHandRaised]);

  useEffect(() => {
    if (!isScrolledUp) {
      scrollToBottom();
    }
  }, [messages, isScrolledUp]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'tr-TR';

        recognition.onresult = (event: any) => {
          let finalTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            }
          }
          if (finalTranscript) {
            setInput(prev => {
              const separator = prev && !prev.endsWith(' ') ? ' ' : '';
              return prev + separator + finalTranscript;
            });
          }
        };

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error', event.error);
          setIsListening(false);
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = recognition;
      }
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (e) {
        console.error("Could not start speech recognition", e);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && selectedAttachments.length === 0) || isGenerating) return;
    onSendMessage(input, selectedAttachments);
    setInput('');
    setSelectedAttachments([]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

        files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        // Extract the base64 data part (remove "data:image/jpeg;base64,")
        const data = base64String.split(',')[1];
        
        setSelectedAttachments(prev => [...prev, {
          url: base64String,
          data: data,
          mimeType: file.type,
          name: file.name,
          file: file
        }]);
      };
      reader.readAsDataURL(file);
    });
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    setSelectedAttachments(prev => {
      const newAttachments = [...prev];
      newAttachments.splice(index, 1);
      return newAttachments;
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    
    if (onTypingStart && onTypingEnd) {
      onTypingStart();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        onTypingEnd();
      }, 2000);
    }
    
    const cursorPosition = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPosition);
    
    // Check if typing a mention
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
    if (mentionMatch) {
      setShowMentionMenu(true);
    } else {
      setShowMentionMenu(false);
    }

    // Check if typing a slash command
    const slashMatch = textBeforeCursor.match(/(^|\s)\/([a-zA-Z0-9-]*)$/);
    if (slashMatch) {
      setShowSlashMenu(true);
      setSlashFilter(slashMatch[2].toLowerCase());
    } else {
      setShowSlashMenu(false);
      setSlashFilter('');
    }
    
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 192)}px`;
  };

  const insertMention = (name: string) => {
    if (!textareaRef.current) return;
    const cursorPosition = textareaRef.current.selectionStart;
    const textBeforeCursor = input.slice(0, cursorPosition);
    const textAfterCursor = input.slice(cursorPosition);
    
    const match = textBeforeCursor.match(/@(\w*)$/);
    if (match) {
      const beforeMention = textBeforeCursor.slice(0, match.index);
      const newText = `${beforeMention}@${name} ${textAfterCursor}`;
      setInput(newText);
      setShowMentionMenu(false);
      
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const newPos = beforeMention.length + name.length + 2;
          textareaRef.current.setSelectionRange(newPos, newPos);
        }
      }, 0);
    }
  };

  const insertSlashCommand = (command: string) => {
    if (!textareaRef.current) return;
    const cursorPosition = textareaRef.current.selectionStart;
    const textBeforeCursor = input.slice(0, cursorPosition);
    const textAfterCursor = input.slice(cursorPosition);
    
    const match = textBeforeCursor.match(/(^|\s)\/([a-zA-Z0-9-]*)$/);
    if (match) {
      const beforeSlash = textBeforeCursor.slice(0, match.index + (match[1] ? 1 : 0));
      const newText = `${beforeSlash}${command} ${textAfterCursor}`;
      setInput(newText);
      setShowSlashMenu(false);
      
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const newPos = beforeSlash.length + command.length + 1;
          textareaRef.current.setSelectionRange(newPos, newPos);
        }
      }, 0);
    }
  };

  const filteredCommands = SLASH_COMMANDS.filter(cmd => 
    cmd.command.toLowerCase().includes(slashFilter) || 
    cmd.description.toLowerCase().includes(slashFilter)
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu) {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filteredCommands.length > 0) {
          insertSlashCommand(filteredCommands[0].command);
        } else {
          setShowSlashMenu(false);
        }
      } else if (e.key === 'Escape') {
        setShowSlashMenu(false);
      }
    } else if (showMentionMenu) {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention('JetWork AI');
      } else if (e.key === 'Escape') {
        setShowMentionMenu(false);
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="w-[500px] shrink-0 flex flex-col bg-theme-bg relative overflow-hidden border-r border-theme-border transition-colors duration-300">
      {/* Header */}
      <header className="h-16 flex items-center px-4 bg-theme-bg border-b border-theme-border sticky top-0 z-10 transition-colors duration-300 shadow-sm">
        <div className="flex items-center gap-3 w-full">
          {onBack && (
            <button 
              onClick={onBack}
              className="p-2 hover:bg-theme-surface-hover rounded-md text-theme-text-muted hover:text-theme-text transition-colors"
              title="Geri Dön"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <div className="w-8 h-8 bg-theme-primary flex items-center justify-center text-theme-primary-fg rounded-md shadow-sm shrink-0">
            <Command size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-theme-text tracking-tight truncate">
                {title || 'proje-analiz-odası'}
              </h1>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                status === 'Completed' ? "bg-theme-primary" : "bg-theme-text-muted animate-pulse"
              )} />
              <span className="text-[10px] text-theme-text-muted font-medium uppercase tracking-widest truncate">
                {projectName ? `${projectName}` : 'Aktif Dinleme Modu'}
              </span>
            </div>
          </div>
          
          {/* Active Users */}
          {activeUsers && activeUsers.length > 0 && (
            <div className="flex items-center -space-x-2 mr-2">
              {activeUsers.slice(0, 3).map((u, i) => (
                <div 
                  key={u.id || i} 
                  className="w-7 h-7 rounded-full border-2 border-theme-surface flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
                  style={{ backgroundColor: stringToColor(u.name), zIndex: 10 - i }}
                  title={`${u.name} (${u.role})`}
                >
                  {u.name.charAt(0).toUpperCase()}
                </div>
              ))}
              {activeUsers.length > 3 && (
                <div className="w-7 h-7 rounded-full border-2 border-theme-surface bg-theme-surface-hover flex items-center justify-center text-[10px] font-bold text-theme-text-muted shadow-sm" style={{ zIndex: 0 }}>
                  +{activeUsers.length - 3}
                </div>
              )}
            </div>
          )}

          {/* Zero-Touch Mode Toggle Button */}
          {onToggleZeroTouchMode && (
            <button
              onClick={onToggleZeroTouchMode}
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 shadow-sm border mr-2",
                isZeroTouchMode 
                  ? "bg-amber-500 text-white border-amber-500 shadow-amber-500/20" 
                  : "bg-theme-surface text-theme-text-muted border-theme-border hover:border-amber-500/50 hover:text-amber-500"
              )}
              title={isZeroTouchMode ? "Zero-Touch Mode Aktif" : "Zero-Touch Mode Pasif"}
            >
              <Zap size={16} className={cn(isZeroTouchMode && "animate-pulse")} />
            </button>
          )}

          {/* AI Toggle Button */}
          <button
            onClick={onToggleAiActive}
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 shadow-sm border",
              isAiActive 
                ? "bg-theme-primary text-theme-primary-fg border-theme-primary shadow-theme-primary/20" 
                : "bg-theme-surface text-theme-text-muted border-theme-border hover:border-theme-primary/50 hover:text-theme-primary"
            )}
            title={isAiActive ? "Yapay Zeka Aktif Katılımda" : "Yapay Zeka Pasif Dinlemede"}
          >
            <Bot size={16} className={cn(isAiActive && "animate-pulse")} />
          </button>
        </div>
      </header>

      {/* Messages */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-8 py-8 relative"
      >
        <div className="max-w-4xl mx-auto space-y-8">
          <AnimatePresence initial={false}>
            {messages.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="h-full flex flex-col items-start justify-center py-20"
              >
                <div className="w-12 h-12 bg-theme-surface flex items-center justify-center mb-6 border border-theme-border rounded-xl shadow-sm">
                  <Bot className="text-theme-primary" size={24} />
                </div>
                <h2 className="text-xl font-semibold text-theme-text mb-2 tracking-tight">Çalışma Alanına Hoş Geldiniz</h2>
                <p className="text-sm text-theme-text-muted mb-8 max-w-md leading-relaxed">
                  Bu kanal proje ekibinizle iletişim kurmanız içindir. JetWork AI arka planda konuşmaları dinler ve gerektiğinde analiz, dokümantasyon veya teknik önerilerle sohbete proaktif olarak dahil olur.
                </p>
              </motion.div>
            ) : (
              messages.map((msg, idx) => (
                <motion.div 
                  key={msg.id + '-' + idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-4 group"
                >
                  <div className="shrink-0 mt-1">
                    {msg.role === 'user' ? (
                      <div 
                        className="w-8 h-8 flex items-center justify-center text-white text-xs font-bold rounded-full shadow-sm"
                        style={{ backgroundColor: msg.senderName ? stringToColor(msg.senderName) : 'var(--theme-primary)' }}
                        title={`${msg.senderName} (${msg.senderRole})`}
                      >
                        {msg.senderName ? msg.senderName.charAt(0).toUpperCase() : <User size={14} />}
                      </div>
                    ) : (
                      <div className={cn(
                        "w-8 h-8 flex items-center justify-center text-white rounded-lg shadow-sm",
                        msg.agentRole === 'BA' ? "bg-blue-500" :
                        msg.agentRole === 'IT' ? "bg-purple-500" :
                        msg.agentRole === 'QA' ? "bg-green-500" :
                        msg.agentRole === 'Orchestrator' ? "bg-amber-500" :
                        "bg-theme-primary text-theme-primary-fg"
                      )}>
                        {msg.agentRole === 'BA' ? <FileText size={14} /> :
                         msg.agentRole === 'IT' ? <Command size={14} /> :
                         msg.agentRole === 'QA' ? <Check size={14} /> :
                         msg.agentRole === 'Orchestrator' ? <Zap size={14} /> :
                         <Bot size={14} />}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-theme-text">
                        {msg.role === 'user' ? (msg.senderName || 'Siz') : 
                         msg.agentRole ? `${msg.agentRole} Agent` : 'JetWork AI'}
                      </span>
                      <span className="text-[10px] font-medium text-theme-text-muted uppercase tracking-widest">
                        {msg.role === 'user' ? msg.senderRole : 
                         msg.agentRole === 'BA' ? 'İş Analisti' :
                         msg.agentRole === 'IT' ? 'Yazılım Mimarı' :
                         msg.agentRole === 'QA' ? 'Test Uzmanı' :
                         msg.agentRole === 'Orchestrator' ? 'Orkestratör' :
                         'Sistem Asistanı'}
                      </span>
                      {msg.score !== undefined && (
                        <span className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded-md ml-1",
                          msg.score >= 90 ? "bg-green-500/10 text-green-500" :
                          msg.score >= 70 ? "bg-amber-500/10 text-amber-500" :
                          "bg-red-500/10 text-red-500"
                        )}>
                          Puan: {msg.score}
                        </span>
                      )}
                      {msg.role === 'model' && (
                        <span className="text-xs text-theme-text-muted ml-2">
                          • <MessageTimer isTyping={!!msg.isTyping} />
                        </span>
                      )}
                    </div>
                    
                    <div className={cn(
                      "text-sm text-theme-text leading-relaxed p-4 rounded-2xl shadow-sm border",
                      msg.role === 'user' 
                        ? "bg-theme-surface border-theme-border/50 rounded-tl-sm" 
                        : "bg-theme-primary/10 border-theme-primary/20 rounded-tr-sm"
                    )}>
                      {msg.isTyping && !msg.text && !msg.thinkingText ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-theme-primary animate-pulse">
                            <MonogramSpinner />
                            <span>Strateji Belirleniyor...</span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3 mt-1">
                          {msg.thinkingText && (
                            <ReasoningProcess 
                              thinkingText={msg.thinkingText} 
                              isTyping={!!msg.isTyping} 
                              groundingUrls={msg.groundingUrls} 
                            />
                          )}
                          
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2">
                              {msg.attachments.map((att, idx) => (
                                att.mimeType.startsWith('image/') ? (
                                  <img key={idx} src={att.url} alt="uploaded" className="max-w-[200px] max-h-[200px] object-cover border border-theme-border/50 rounded-md shadow-sm" />
                                ) : (
                                  <div key={idx} className="flex items-center gap-2 p-2 bg-theme-surface border border-theme-border/50 rounded-md shadow-sm">
                                    <FileText size={16} className="text-theme-primary" />
                                    <span className="text-xs font-bold text-theme-text-muted uppercase">{att.mimeType.split('/')[1] || 'FILE'}</span>
                                    {att.name && <span className="text-xs text-theme-text truncate max-w-[150px]">{att.name}</span>}
                                  </div>
                                )
                              ))}
                            </div>
                          )}
                          
                          {msg.text && (
                            <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-headings:text-theme-text prose-a:text-theme-primary prose-a:underline hover:prose-a:no-underline prose-pre:bg-theme-surface prose-pre:text-theme-text prose-pre:border prose-pre:border-theme-border prose-pre:p-4 prose-pre:rounded-lg prose-code:text-theme-text prose-code:bg-theme-surface-hover prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none">
                              <ReactMarkdown 
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  strong: ({node, ...props}) => {
                                    const childrenArray = React.Children.toArray(props.children);
                                    if (childrenArray.length === 1 && typeof childrenArray[0] === 'string' && childrenArray[0].startsWith('@')) {
                                      return <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-theme-primary/10 text-theme-primary font-semibold text-xs border border-theme-primary/20" {...props} />
                                    }
                                    return <strong {...props} />
                                  }
                                }}
                              >
                                {msg.text.replace(new RegExp(`@(${currentUser?.name || 'Kullanıcı'}|Kullanıcı)`, 'gi'), `**@${currentUser?.name || 'Kullanıcı'}**`)}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {msg.role === 'model' && msg.isTyping && msg.text && (
                        <div className="mt-4 p-4 bg-theme-surface border border-theme-border border-dashed rounded-xl shadow-sm flex items-center gap-3 animate-pulse">
                          <JetWorkLogo className="w-4 h-4" isSpinning={true} />
                          <span className="text-sm font-medium text-theme-text-muted">Dokümanlar versiyonlanıyor...</span>
                        </div>
                      )}

                      {msg.documentActions && msg.documentActions.length > 0 && (
                        <div className="mt-4 p-4 bg-theme-surface border border-theme-border rounded-xl shadow-sm">
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
                            <button className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-theme-text-muted hover:text-theme-primary bg-theme-bg hover:bg-theme-surface-hover transition-colors border border-theme-border rounded-md shadow-sm">
                              <Bookmark size={12} /> Kaydet
                            </button>
                            <button 
                              onClick={() => setDiffModalData({ oldDoc: msg.previousDocumentSnapshot, newDoc: msg.documentSnapshot })}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-theme-text-muted hover:text-theme-primary bg-theme-bg hover:bg-theme-surface-hover transition-colors border border-theme-border rounded-md shadow-sm"
                            >
                              <Eye size={12} /> Farkı Gör
                            </button>
                            {onRestoreDocument && (
                              <button 
                                onClick={() => onRestoreDocument(msg.documentSnapshot)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-theme-text-muted hover:text-theme-primary bg-theme-bg hover:bg-theme-surface-hover transition-colors border border-theme-border rounded-md shadow-sm"
                              >
                                <RotateCcw size={12} /> Geri Yükle
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {msg.groundingUrls && msg.groundingUrls.length > 0 && (
                        <div className="mt-4 pt-3 flex flex-col gap-2 border-t border-theme-border/50">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-theme-text-muted flex items-center gap-1.5">
                            <Globe size={10} /> Kaynaklar
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {msg.groundingUrls.map((url, i) => (
                              <a 
                                key={i} 
                                href={url.uri} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-[10px] flex items-center gap-1.5 bg-theme-surface hover:bg-theme-surface-hover border border-theme-border text-theme-text-muted hover:text-theme-text px-2 py-1 transition-colors truncate max-w-[240px] rounded-md"
                              >
                                <Link2 size={10} className="shrink-0 text-theme-primary" />
                                <span className="truncate font-medium">{url.title}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Reactions */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {msg.reactions && msg.reactions.map((reaction, i) => {
                          const hasReacted = currentUser && reaction.users.includes(currentUser.name);
                          return (
                            <button
                              key={i}
                              onClick={() => onToggleReaction && onToggleReaction(msg.id, reaction.emoji)}
                              className={cn(
                                "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border transition-colors shadow-sm",
                                hasReacted 
                                  ? "bg-theme-primary/20 border-theme-primary/30 text-theme-primary" 
                                  : "bg-theme-surface border-theme-border/50 text-theme-text-muted hover:bg-theme-surface-hover"
                              )}
                              title={reaction.users.join(', ')}
                            >
                              <span>{reaction.emoji}</span>
                              <span className="text-[10px]">{reaction.users.length}</span>
                            </button>
                          );
                        })}
                        
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>
        
        {/* Scroll to bottom button */}
        <AnimatePresence>
          {isScrolledUp && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              onClick={scrollToBottom}
              className="fixed bottom-32 right-1/2 translate-x-1/2 p-2 bg-theme-primary text-theme-primary-fg rounded-full shadow-lg hover:bg-theme-primary-hover transition-colors z-50"
            >
              <ArrowDown size={20} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Input Section */}
      <div className="p-6 bg-theme-bg border-t border-theme-border shrink-0 transition-colors duration-300 shadow-[0_-4px_24px_-12px_rgba(0,0,0,0.1)] z-20 relative">
        
        {/* AI Hand Raised Notification */}
        <AnimatePresence>
          {aiHandRaised && (
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
              className="absolute bottom-full mb-4 left-6 flex items-end gap-3 z-30"
            >
              {/* Pulsing Lightbulb Icon */}
              <button
                onClick={() => setIsAiHandExpanded(!isAiHandExpanded)}
                className="w-12 h-12 rounded-full bg-theme-surface border border-theme-primary/30 flex items-center justify-center shadow-[0_0_15px_rgba(var(--theme-primary),0.2)] hover:shadow-[0_0_25px_rgba(var(--theme-primary),0.4)] hover:scale-105 transition-all relative shrink-0 text-theme-primary"
              >
                <div className="absolute inset-0 rounded-full bg-theme-primary animate-ping opacity-20" style={{ animationDuration: '2s' }} />
                <Lightbulb size={24} className="animate-pulse drop-shadow-[0_0_8px_rgba(var(--theme-primary),0.8)]" style={{ animationDuration: '1s' }} fill="currentColor" />
              </button>

              {/* Expanded Bubble */}
              <AnimatePresence>
                {isAiHandExpanded && (
                  <motion.div
                    initial={{ opacity: 0, width: 0, scale: 0.9, originX: 0, originY: 1 }}
                    animate={{ opacity: 1, width: 'auto', scale: 1 }}
                    exit={{ opacity: 0, width: 0, scale: 0.9 }}
                    className="overflow-hidden pb-2"
                  >
                    <div className="bg-theme-bg border border-theme-primary/30 shadow-2xl rounded-2xl rounded-bl-none p-3.5 flex flex-col gap-2.5 min-w-[280px] max-w-[320px]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-theme-primary text-xs font-bold">
                          <Bot size={14} />
                          <span>JetWork AI'ın bir önerisi var</span>
                        </div>
                        <button
                          onClick={onDismissAiHandRaise}
                          className="text-theme-text-muted hover:text-theme-text transition-colors p-1"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <p className="text-xs text-theme-text leading-relaxed line-clamp-3 opacity-90">
                        "{aiHandRaised}"
                      </p>
                      <button
                        onClick={onAcceptAiHandRaise}
                        className="w-full py-2 mt-1 bg-theme-primary text-theme-primary-fg hover:bg-theme-primary/90 text-xs font-bold rounded-lg transition-colors shadow-sm"
                      >
                        Dinle ve Sohbete Ekle
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Typing Indicator */}
        {typingUsers && typingUsers.length > 0 && (
          <div className="absolute -top-8 left-8 flex items-center gap-2 text-xs text-theme-text-muted font-medium bg-theme-bg px-3 py-1.5 rounded-t-lg border border-b-0 border-theme-border shadow-sm">
            <div className="flex gap-1 items-center h-4">
              <div className="w-1.5 h-1.5 bg-theme-primary animate-pulse rounded-full" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 bg-theme-primary animate-pulse rounded-full" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 bg-theme-primary animate-pulse rounded-full" style={{ animationDelay: '300ms' }} />
            </div>
            {typingUsers.length === 1 
              ? `${typingUsers[0].userName} yazıyor...` 
              : `${typingUsers.length} kişi yazıyor...`}
          </div>
        )}

        <div className="max-w-4xl mx-auto relative">
          <form 
            onSubmit={handleSubmit}
            className="relative"
          >
            {selectedAttachments.length > 0 && (
              <div className="absolute bottom-full mb-2 left-0 right-0 flex gap-2 overflow-x-auto p-2 bg-theme-surface border border-theme-border shadow-sm rounded-lg">
                {selectedAttachments.map((att, idx) => (
                  <div key={idx} className="relative group/img shrink-0">
                    {att.mimeType.startsWith('image/') ? (
                      <img src={att.url} alt="upload preview" className="h-16 w-16 object-cover border border-theme-border/50 rounded-md" />
                    ) : (
                      <div className="h-16 w-16 flex flex-col items-center justify-center bg-theme-surface border border-theme-border/50 rounded-md shadow-sm">
                        <FileText size={16} className="text-theme-primary" />
                        <span className="text-[10px] font-bold text-theme-text-muted uppercase">{att.mimeType.split('/')[1] || 'FILE'}</span>
                        <span className="text-[8px] text-theme-text-muted truncate w-full px-1 text-center mt-1">{att.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(idx)}
                      className="absolute -top-2 -right-2 bg-theme-primary text-theme-primary-fg p-0.5 opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-theme-primary-hover rounded-full shadow-sm"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {showSuggestions && dynamicSuggestions.length > 0 && (
              <div className="flex items-center gap-2 mb-3">
                <div 
                  ref={suggestionsScrollRef}
                  className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide flex-1"
                >
                  <button 
                    type="button" 
                    onClick={handleMagicWandClick}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-theme-border bg-theme-bg text-sm text-theme-text hover:bg-theme-surface-hover whitespace-nowrap shadow-sm shrink-0"
                  >
                    <Sparkles size={14} className="text-blue-500" />
                    AI Features
                  </button>
                  {dynamicSuggestions.map((suggestion, idx) => (
                    <button 
                      key={idx}
                      type="button" 
                      onClick={() => {
                        setInput(suggestion);
                        if (textareaRef.current) textareaRef.current.focus();
                      }}
                      className="px-3 py-1.5 rounded-full border border-theme-border bg-theme-bg text-sm text-theme-text hover:bg-theme-surface-hover whitespace-nowrap shadow-sm shrink-0"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 shrink-0 bg-theme-bg pl-2">
                  <button 
                    type="button" 
                    onClick={scrollSuggestions}
                    className="p-1.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-full"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setShowSuggestions(false)}
                    className="p-1.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-full"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}

            <div className="relative flex flex-col bg-theme-bg border border-theme-border focus-within:border-theme-primary transition-colors rounded-2xl shadow-sm">
              {showMentionMenu && (
                <div className="absolute bottom-full left-4 mb-2 w-64 bg-theme-bg border border-theme-border shadow-xl z-50 overflow-hidden rounded-lg">
                  <div className="px-3 py-2 text-[10px] font-bold text-theme-text-muted uppercase tracking-widest border-b border-theme-border/50 bg-theme-surface-hover">
                    Kişiler
                  </div>
                  <button
                    type="button"
                    onClick={() => insertMention('JetWork AI')}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-theme-surface-hover transition-colors text-left"
                  >
                    <div className="w-6 h-6 bg-theme-primary flex items-center justify-center text-theme-primary-fg shrink-0 rounded-full text-xs shadow-sm">
                      <Bot size={12} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-theme-text">JetWork AI</span>
                      <span className="text-[10px] text-theme-text-muted">Sistem Asistanı</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMention('BA')}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-theme-surface-hover transition-colors text-left"
                  >
                    <div className="w-6 h-6 bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0 rounded-full text-xs shadow-sm">
                      <User size={12} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-theme-text">İş Analisti (BA)</span>
                      <span className="text-[10px] text-theme-text-muted">Gereksinim ve Süreç</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMention('IT')}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-theme-surface-hover transition-colors text-left"
                  >
                    <div className="w-6 h-6 bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0 rounded-full text-xs shadow-sm">
                      <User size={12} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-theme-text">Yazılım Mimarı (IT)</span>
                      <span className="text-[10px] text-theme-text-muted">Mimari ve Entegrasyon</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMention('QA')}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-theme-surface-hover transition-colors text-left"
                  >
                    <div className="w-6 h-6 bg-purple-500/10 flex items-center justify-center text-purple-500 shrink-0 rounded-full text-xs shadow-sm">
                      <User size={12} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-theme-text">Test Uzmanı (QA)</span>
                      <span className="text-[10px] text-theme-text-muted">Kalite ve Edge Case</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMention('PO')}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-theme-surface-hover transition-colors text-left"
                  >
                    <div className="w-6 h-6 bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0 rounded-full text-xs shadow-sm">
                      <User size={12} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-theme-text">Product Owner (PO)</span>
                      <span className="text-[10px] text-theme-text-muted">İş Değeri ve MVP</span>
                    </div>
                  </button>
                </div>
              )}
              {showSlashMenu && filteredCommands.length > 0 && (
                <div className="absolute bottom-full left-4 mb-2 w-72 bg-theme-bg border border-theme-border shadow-xl z-50 overflow-hidden rounded-lg">
                  <div className="px-3 py-2 text-[10px] font-bold text-theme-text-muted uppercase tracking-widest border-b border-theme-border/50 bg-theme-surface-hover">
                    Hızlı Komutlar
                  </div>
                  {filteredCommands.map((cmd, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => insertSlashCommand(cmd.command)}
                      className={cn(
                        "w-full flex flex-col px-3 py-2 transition-colors text-left border-b border-theme-border/50 last:border-0",
                        idx === 0 ? "bg-theme-surface-hover" : "hover:bg-theme-surface-hover"
                      )}
                    >
                      <span className="text-xs font-bold text-theme-primary">{cmd.command}</span>
                      <span className="text-[10px] text-theme-text-muted">{cmd.description}</span>
                    </button>
                  ))}
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={isAiActive ? "AI aktif dinlemede... Ne yapmak istersiniz?" : "Değişiklik yapın, yeni özellikler ekleyin, herhangi bir şey sorun..."}
                className="flex-1 max-h-48 min-h-[80px] bg-transparent border-none focus:ring-0 focus:outline-none focus-visible:outline-none resize-none p-4 text-base text-theme-text placeholder:text-theme-text-muted"
                rows={1}
              />
              
              <div className="flex items-center justify-end px-3 py-3 gap-2">
                <input 
                  type="file" 
                  accept="image/*,application/pdf" 
                  multiple 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                />
                
                <button
                  type="button"
                  onClick={handleMagicWandClick}
                  className={cn(
                    "w-8 h-8 flex items-center justify-center rounded-full border transition-colors",
                    selectedDocumentText 
                      ? "border-blue-500 text-blue-500 bg-blue-500/10 hover:bg-blue-500/20" 
                      : "border-theme-border text-theme-text-muted hover:text-theme-text hover:bg-theme-surface"
                  )}
                  title={selectedDocumentText ? "Seçili metni değerlendir" : "AI Features"}
                >
                  <Wand2 size={14} />
                </button>

                {recognitionRef.current && (
                  <button
                    type="button"
                    onClick={toggleListening}
                    className={cn(
                      "w-8 h-8 flex items-center justify-center rounded-full border border-theme-border transition-colors",
                      isListening ? "text-red-500 border-red-500 bg-red-500/10 animate-pulse" : "text-theme-text-muted hover:text-theme-text hover:bg-theme-surface"
                    )}
                    title={isListening ? "Dinlemeyi Durdur" : "Sesle Yaz"}
                  >
                    <Mic size={14} />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-8 h-8 flex items-center justify-center rounded-full border border-theme-border text-theme-text-muted hover:text-theme-text hover:bg-theme-surface transition-colors"
                  title="Ekle"
                >
                  <Plus size={14} />
                </button>

                <button 
                  type="submit" 
                  disabled={(!input.trim() && selectedAttachments.length === 0) || isGenerating}
                  className="w-8 h-8 flex items-center justify-center rounded-full border border-theme-border text-theme-text-muted hover:text-theme-text hover:bg-theme-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ArrowUp size={14} />
                </button>
              </div>
            </div>
          </form>
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
