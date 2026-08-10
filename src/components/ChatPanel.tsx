import React, { useState, useRef, useEffect, useLayoutEffect, memo } from 'react';
import * as mammoth from 'mammoth';
import { Send, User, Sparkles, Command, Globe, Link2, Search, Brain, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ImagePlus, X, Mic, ArrowRightToLine, SmilePlus, Lightbulb, Wand as Wand2, Plus, ArrowUp, ArrowDown, FileText, Bookmark, Eye, RotateCcw, Check, Zap, Upload, Database, CloudOff, Loader2 } from 'lucide-react';
import { Message, MessageAttachment, MessageSendOptions, Question } from '../types';
import { cn, stringToColor } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'motion/react';
import { DiffViewerModal } from './DiffViewerModal';
import { ZERO_TOUCH_AGENTS } from '../constants';
import { useDataStore } from '../store/useDataStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { FEATURE_FLAGS } from '../lib/featureFlags';
import { KnowledgeBankModal } from './KnowledgeBankModal';
import { JetWorkLogo } from './JetWorkLogo';

const contextualQuestionOptions = (question: Question): string[] => {
  return (question.options || [])
    .map(option => String(option || '').trim())
    .filter(Boolean);
};

const InteractiveQuestions = ({ questions, onSubmit }: { questions: Question[], onSubmit: (answer: string) => void }) => {
  const [answers, setAnswers] = useState<Record<string, { type: 'option' | 'custom', value: string }>>({});

  const handleSubmit = () => {
    let responseText = "";
    questions.forEach((q, i) => {
      const ans = answers[q.id];
      if (ans) {
        responseText += `**Soru ${i+1}:** ${q.text}\n**Cevap:** ${ans.value}\n\n`;
      } else {
        responseText += `**Soru ${i+1}:** ${q.text}\n**Cevap:** Cevaplanmadı\n\n`;
      }
    });
    onSubmit(responseText.trim());
  };

  return (
    <div data-testid="interactive-questions" className="mt-4 space-y-3 border border-theme-border/50 bg-theme-surface/50 p-3 rounded-xl">
      <h4 className="font-semibold text-theme-text text-sm flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-theme-primary" />
        Lütfen aşağıdaki soruları yanıtlayın:
      </h4>
      {questions.map((q, i) => {
        const visibleOptions = contextualQuestionOptions(q);

        return (
        <div key={q.id} className="space-y-2 p-2.5 bg-theme-bg border border-theme-border rounded-lg">
          <p data-testid="question-prompt" className="text-sm font-medium text-theme-text">{i + 1}. {q.text}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {visibleOptions.map(opt => (
              <button
                key={opt}
                data-testid="question-option"
                onClick={() => setAnswers(prev => ({ ...prev, [q.id]: { type: 'option', value: opt } }))}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-lg border transition-colors",
                  answers[q.id]?.value === opt && answers[q.id]?.type === 'option' 
                    ? "bg-theme-primary text-theme-primary-fg border-theme-primary" 
                    : "bg-theme-surface text-theme-text-muted border-theme-border hover:border-theme-primary/50"
                )}
              >
                {opt}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Veya kendi cevabınızı yazın..."
            className="w-full mt-2 text-sm px-3 py-2 rounded-lg border border-theme-border bg-theme-surface text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-primary/20 focus:border-theme-primary transition-all"
            value={answers[q.id]?.type === 'custom' ? answers[q.id]?.value : ''}
            onChange={(e) => setAnswers(prev => ({ ...prev, [q.id]: { type: 'custom', value: e.target.value } }))}
            onClick={() => {
              if (answers[q.id]?.type !== 'custom') {
                setAnswers(prev => ({ ...prev, [q.id]: { type: 'custom', value: '' } }));
              }
            }}
          />
        </div>
        );
      })}
      <button
        onClick={handleSubmit}
        disabled={Object.keys(answers).length === 0}
        className="w-full py-2.5 bg-theme-primary text-theme-primary-fg rounded-lg text-sm font-semibold hover:bg-theme-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        <Send className="w-4 h-4" />
        Cevapları Gönder
      </button>
      <button
        onClick={() => onSubmit('Varsayımlarla devam et. Bilinmeyenleri açık konu olarak işaretle.')}
        className="w-full px-3 py-2 text-xs rounded-lg border border-theme-border bg-theme-surface text-theme-text hover:border-theme-primary/60 transition-colors"
      >
        Varsayımlarla devam et
      </button>
    </div>
  );
};

const ThinkingIndicator = ({ label = 'Düşünüyor' }: { label?: string }) => (
  <div
    className="jetwork-thinking relative inline-flex w-fit items-center gap-2 overflow-hidden rounded-full border border-theme-primary/20 bg-theme-primary/5 px-3 py-1.5 pr-4 text-theme-primary shadow-sm"
    aria-live="polite"
  >
    <span className="jetwork-thinking-logo pointer-events-none absolute left-3 top-1/2 z-10">
      <JetWorkLogo className="h-4 w-4 animate-spin drop-shadow-[0_0_8px_rgba(255,193,7,0.45)]" />
    </span>
    <span className="h-4 w-4 shrink-0 opacity-0" aria-hidden="true" />
    <span className="jetwork-thinking-text relative text-xs font-semibold tracking-tight">
      {label}
    </span>
  </div>
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
    if (!thinkingText) return isTyping ? "Düşünüyor..." : "Düşünce Süreci";
    const matches = [...thinkingText.matchAll(/\*\*([^*]+)\*\*/g)];
    if (matches.length > 0) {
      return matches[matches.length - 1][1].trim();
    }
    return isTyping ? "Düşünüyor..." : "Düşünce Süreci";
  };

  return (
    <details className="group/reasoning mb-3 border border-theme-border/50 rounded-lg overflow-hidden bg-theme-surface/50">
      <summary className="flex items-center gap-2 cursor-pointer list-none select-none p-3 bg-theme-surface hover:bg-theme-bg transition-colors [&::-webkit-details-marker]:hidden">
        {isTyping && (
          <JetWorkLogo className="w-4 h-4" isSpinning={true} />
        )}
        <span className="font-medium text-sm text-theme-text">
          {getThinkingTitle()}
        </span>
        <ChevronDown className="w-4 h-4 ml-auto text-theme-text-muted transition-transform group-open/reasoning:rotate-180" />
      </summary>
      
      <div className="p-4 border-t border-theme-border/50 text-xs text-theme-text-muted font-mono whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
        {thinkingText}
        
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
  onSendMessage: (
    text: string,
    attachments?: MessageAttachment[],
    options?: MessageSendOptions,
  ) => void;
  isGenerating?: boolean;
  issueKey?: string;
  status?: string;
  title?: string;
  projectName?: string;
  activeUsers?: { id: string; name: string; role: string }[];
  collaborators?: { id: string; name: string; role: string; avatar?: string; color?: string }[];
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
  activeZeroTouchRoles?: string[];
  setActiveZeroTouchRoles?: (roles: string[]) => void;
  isLoadingWorkspace?: boolean;
  messageLoadError?: string | null;
  onRetryMessageLoad?: () => void;
  onManageParticipants?: () => void;
  fullWidth?: boolean;
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
const MAX_CHAT_ATTACHMENTS = 3;

const supportsKnowledgeBank = (attachment: Pick<MessageAttachment, 'name' | 'mimeType'>) =>
  /\.(txt|md)$/i.test(attachment.name || '')
  && ['text/plain', 'text/markdown', ''].includes(attachment.mimeType || '');

const defaultAttachmentPurpose = (): MessageAttachment['purpose'] => 'chat_only';

const ingestionLabel = (attachment: MessageAttachment): string | null => {
  const ingestion = attachment.ingestion;
  if (!ingestion) return null;
  if (ingestion.status === 'queued') return 'Sırada';
  if (ingestion.status === 'uploading') return 'Yükleniyor';
  if (ingestion.status === 'processing') return 'İşleniyor';
  if (ingestion.status === 'failed') return 'Yükleme başarısız';
  if (ingestion.publicationStatus === 'published') return 'Bilgi bankasında';
  return 'Taslak hazır';
};

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

const MessageItem = memo(({ 
  msg, 
  idx, 
  currentUser, 
  onRestoreDocument, 
  setDiffModalData, 
  onToggleReaction,
  onRetryMessage,
  retryDisabled,
  isLastMessage
}: { 
  msg: Message, 
  idx: number, 
  currentUser: any, 
  onRestoreDocument?: (doc: any) => void, 
  setDiffModalData: (data: any) => void, 
  onToggleReaction?: (id: string, emoji: string) => void,
  onRetryMessage?: (payload: NonNullable<Message['retryPayload']>) => void,
  retryDisabled?: boolean,
  isLastMessage?: boolean
}) => {
  const storeUser = useDataStore(state => state.user);

  if (msg.senderRole === 'System') {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-center py-2"
      >
        <div className="bg-theme-surface/50 border border-theme-border/50 px-4 py-1.5 rounded-full shadow-sm">
          <span className="text-[11px] font-medium text-theme-text-muted flex items-center gap-2">
            {msg.text}
          </span>
        </div>
      </motion.div>
    );
  }

  const userColor = msg.role === 'user' 
    ? (msg.senderColor || (msg.senderName === storeUser?.name && storeUser?.color ? storeUser.color : (msg.senderName ? stringToColor(msg.senderName) : null)))
    : null;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-4 group"
    >
      <div className="shrink-0 mt-1">
        {msg.role === 'user' ? (
          <div 
            className="w-8 h-8 flex items-center justify-center text-white text-xs font-bold rounded-full shadow-sm"
            style={{ backgroundColor: userColor || 'var(--theme-primary)' }}
            title={`${msg.senderName} (${msg.senderRole})`}
          >
            {msg.senderName ? msg.senderName.charAt(0).toUpperCase() : <User size={14} />}
          </div>
        ) : (
          <div className="w-8 h-8 flex items-center justify-center">
            <JetWorkLogo className="w-8 h-8" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-baseline gap-2">
          <span 
            className="text-sm font-semibold text-theme-text"
            style={{ color: userColor || undefined }}
          >
            {msg.role === 'user' ? (msg.senderName || 'Siz') : 
             msg.agentRole ? `${msg.agentRole} Agent` : 'JetWork AI'}
          </span>
          <span className="text-[10px] font-medium text-theme-text-muted uppercase tracking-widest">
            {msg.role === 'user' ? msg.senderRole : 
             msg.agentRole === 'BA' ? 'İş Analisti' :
             msg.agentRole === 'IT' ? 'Yazılım Mimarı' :
             msg.agentRole === 'QA' ? 'Test Uzmanı' :
             msg.agentRole === 'Orchestrator' ? 'Moderatör' :
             'Sistem Asistanı'}
          </span>
          {msg.score !== undefined && msg.score > 0 && (
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
          {msg.isError && (
            <span className="ml-1 rounded-md bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
              Yanıt tamamlanamadı
            </span>
          )}
          {msg.persistenceStatus === 'pending' && (
            <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-medium text-theme-text-muted">
              <Loader2 size={10} className="animate-spin" /> Kaydediliyor
            </span>
          )}
          {msg.persistenceStatus === 'failed' && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-md bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
              <CloudOff size={10} /> Kaydedilemedi
            </span>
          )}
          {msg.role === 'model' && msg.provider && (
            <span className="ml-1 rounded-md border border-theme-border bg-theme-surface px-1.5 py-0.5 text-[10px] font-medium text-theme-text-muted" title={msg.responseModel || msg.provider}>
              {msg.provider === 'gemini' ? 'Gemini' : 'OpenAI'}{msg.fallbackUsed ? ' · Yedek' : ''}
            </span>
          )}
        </div>
        
        <div 
          data-testid="chat-message"
          data-message-role={msg.role}
          className={cn(
            "text-sm text-theme-text leading-relaxed p-3 rounded-2xl shadow-sm border",
            msg.isError
              ? "bg-red-500/5 border-red-500/30 rounded-tr-sm"
              : msg.role === 'user'
                ? "bg-theme-surface rounded-tl-sm"
                : "bg-theme-primary/10 border-theme-primary/20 rounded-tr-sm"
          )}
          style={msg.role === 'user' && userColor ? { 
            borderColor: `${userColor}40`,
            backgroundColor: `${userColor}08`
          } : undefined}
        >
          {msg.isTyping && !msg.text && !msg.thinkingText ? (
            <div className="flex flex-col gap-2">
              <ThinkingIndicator />
              {msg.phase && (
                <div className="flex items-center gap-1.5 mt-1 w-full max-w-[220px]">
                  {(['PLAN', 'RESEARCH', 'REFLECT', 'ACT'] as const).map((p) => {
                    const order: Record<string, number> = { PLAN: 0, RESEARCH: 1, REFLECT: 2, ACT: 3 };
                    const currentIdx = order[msg.phase as string] ?? -1;
                    const thisIdx = order[p];
                    const isActive = thisIdx === currentIdx;
                    const isDone = thisIdx < currentIdx;
                    return (
                      <div
                        key={p}
                        className={cn(
                          "h-1 flex-1 rounded-full transition-all duration-300",
                          isDone && "bg-theme-primary",
                          isActive && "bg-theme-primary/60 animate-pulse",
                          !isDone && !isActive && "bg-theme-border"
                        )}
                      />
                    );
                  })}
                </div>
              )}
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
                      <div key={idx} className="flex items-center gap-2 p-2 bg-theme-surface border border-theme-border/50 rounded-md shadow-sm overflow-hidden max-w-[240px]">
                        <FileText size={16} className="text-theme-primary shrink-0" />
                        <span className="text-xs font-bold text-theme-text-muted uppercase shrink-0">{att.name?.split('.').pop() || 'FILE'}</span>
                        <div className="min-w-0">
                          {att.name && <div className="text-xs text-theme-text truncate">{att.name}</div>}
                          {ingestionLabel(att) && (
                            <div className={cn(
                              'mt-0.5 text-[10px] font-medium',
                              att.ingestion?.status === 'failed'
                                ? 'text-red-500'
                                : att.ingestion?.status === 'ready'
                                  ? 'text-emerald-600'
                                  : 'text-theme-primary',
                            )}>
                              {ingestionLabel(att)}
                              {att.ingestion?.status === 'ready' && att.ingestion.objectCount !== undefined
                                ? ` · ${att.ingestion.objectCount} nesne`
                                : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  ))}
                </div>
              )}
              
              {msg.text && (
                <div className="prose prose-sm max-w-none">
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
                    {msg.text.replace(new RegExp(`@(${(currentUser?.name || 'Kullanıcı').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|Kullanıcı)`, 'gi'), `**@${currentUser?.name || 'Kullanıcı'}**`)}
                  </ReactMarkdown>
                </div>
              )}

              {msg.role === 'model' && msg.actionSummary && !msg.isTyping && (
                <div className="flex items-start gap-2 rounded-lg border border-theme-primary/20 bg-theme-primary/5 px-3 py-2 text-xs text-theme-text">
                  <Check size={13} className="mt-0.5 shrink-0 text-theme-primary" />
                  <div className="leading-relaxed">
                    <span className="font-semibold text-theme-text">Ne yaptım? </span>
                    <span className="text-theme-text-muted">{msg.actionSummary}</span>
                  </div>
                </div>
              )}
              
              {msg.questions && msg.questions.length > 0 && !msg.isTyping && (
                <InteractiveQuestions 
                  questions={msg.questions} 
                  onSubmit={(answerText) => {
                    // Find the parent component's onSendMessage and pass the answer
                    // We need to pass this down from ChatPanel
                    const customEvent = new CustomEvent('submit-interactive-answer', { detail: answerText });
                    window.dispatchEvent(customEvent);
                  }} 
                />
              )}
            </div>
          )}
          
          {msg.role === 'model' && msg.isTyping && msg.text && (
            <div className="mt-4 rounded-xl border border-dashed border-theme-border bg-theme-surface p-4 shadow-sm">
              <ThinkingIndicator
                label={FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
                  ? 'Yanıt hazırlanıyor'
                  : 'Dokümanlar versiyonlanıyor'}
              />
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

          {msg.knowledgeSources && msg.knowledgeSources.length > 0 && (
            <details className="group mt-4 border-t border-theme-border/50 pt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-theme-text-muted transition-colors hover:text-theme-text [&::-webkit-details-marker]:hidden">
                <Database size={10} />
                {Math.min(msg.knowledgeSources.length, 3)} kurumsal kaynak kullanıldı
                <ChevronDown
                  size={12}
                  className="ml-auto transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="mt-2 flex flex-col gap-1.5">
                {msg.knowledgeSources.slice(0, 3).map((source, index) => (
                  <div
                    key={`${source.sourceId || source.sourceName}-${source.canonicalKey || index}`}
                    className="flex items-start gap-2 rounded-lg border border-theme-border bg-theme-surface px-3 py-2 text-xs text-theme-text-muted"
                  >
                    <span className="font-bold text-theme-primary">[{index + 1}]</span>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-theme-text">
                        {source.title || source.sourceName}
                      </div>
                      {source.title && source.title !== source.sourceName && (
                        <div className="truncate text-[10px]">{source.sourceName}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {msg.isError && msg.retryPayload && onRetryMessage && (
            <button
              type="button"
              onClick={() => onRetryMessage(msg.retryPayload!)}
              disabled={retryDisabled}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw size={13} />
              Tekrar dene
            </button>
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
  );
});

export function ChatPanel({ 
  messages, onSendMessage, isGenerating, issueKey, status, title, projectName, 
  activeUsers, collaborators, typingUsers, 
  onTypingStart, onTypingEnd, onToggleReaction, currentUser,
  isAiActive, onToggleAiActive, aiHandRaised, onAcceptAiHandRaise, onDismissAiHandRaise,
  selectedDocumentText, onRestoreDocument, hasDocument,
  isZeroTouchMode, onToggleZeroTouchMode,
  activeZeroTouchRoles, setActiveZeroTouchRoles,
  isLoadingWorkspace,
  messageLoadError,
  onRetryMessageLoad,
  onManageParticipants,
  fullWidth = false,
}: ChatPanelProps) {
  const setCurrentWorkspaceId = useDataStore(state => state.setCurrentWorkspaceId);
  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);
  const selectedModel = useSettingsStore(state => state.selectedModel);
  const setSelectedModel = useSettingsStore(state => state.setSelectedModel);
  const [input, setInput] = useState('');
  const [selectedAttachments, setSelectedAttachments] = useState<MessageAttachment[]>([]);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [activeReactionMenu, setActiveReactionMenu] = useState<string | null>(null);
  const [isAiHandExpanded, setIsAiHandExpanded] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [diffModalData, setDiffModalData] = useState<{ oldDoc?: any, newDoc?: any } | null>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showZeroTouchSettings, setShowZeroTouchSettings] = useState(false);
  const [showKnowledgeBank, setShowKnowledgeBank] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const suggestionsScrollRef = useRef<HTMLDivElement>(null);

  const dynamicSuggestions = selectedDocumentText
    ? [
        'Seçili metni daha açık ve kurumsal bir dille güncelle.',
        'Seçili metindeki eksik iş kuralı ve belirsizlikleri bul.',
      ]
    : hasDocument
      ? [
          'Mevcut analizi değerlendir; dokümanı değiştirmeden eksikleri söyle.',
          'Açık konuları ve riskleri kısa bir listede göster; dokümanı değiştirme.',
          'Dokümanı Enerjisa ihtiyaç analizi şablonuna göre güncelle.',
        ]
      : [];

  const starterPrompts = FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
    ? [
        'Bir talebim var; proje mi support konusu mu olduğunu birlikte netleştirelim.',
        'ZCRM2-545 hangi koşulda alınır?',
        'CHECK_ZTKS hangi mesajları üretiyor?',
        'Bir TXT veya MD kaynağını bilgi bankasına eklemek istiyorum.',
      ]
    : [
        'Yeni bir iş analizi dokümanı başlatmak istiyorum. Talebi birlikte olgunlaştıralım.',
        'Aşağıdaki ham notları yapısal bir dokümana dönüştürmeni istiyorum. Gerekirse sorular sor.',
        'Mevcut analizimin olgunluk seviyesini değerlendirip eksik noktaları bulur musun?',
        'Exper Modu’nu aktifleştir. Bu konuyu analizden teste kadar uçtan uca tamamla.',
      ];

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
    setInput('');
    setSelectedAttachments([]);
    setShowKnowledgeBank(false);
  }, [currentWorkspaceId]);

  useLayoutEffect(() => {
    if (!isScrolledUp) {
      scrollToBottom();
    }
  }, [messages, isScrolledUp]);

  useEffect(() => {
    const handleInteractiveSubmit = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail && !isGenerating) {
        onSendMessage(customEvent.detail, []);
      }
    };
    
    window.addEventListener('submit-interactive-answer', handleInteractiveSubmit);
    return () => window.removeEventListener('submit-interactive-answer', handleInteractiveSubmit);
  }, [onSendMessage, isGenerating]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && selectedAttachments.length === 0) || isGenerating) return;
    onSendMessage(input, selectedAttachments);
    setInput('');
    setSelectedAttachments([]);
  };

  const isSupportedFileType = (file: File) => {
    if (FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME) {
      return /\.(txt|md)$/i.test(file.name)
        && ['text/plain', 'text/markdown', ''].includes(file.type || '');
    }
    const supportedTypes = [
      'application/pdf', 
      'text/plain', 
      'text/csv', 
      'text/html', 
      'text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    return file.type.startsWith('image/')
      || supportedTypes.includes(file.type)
      || /\.(docx|txt|md)$/i.test(file.name);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const requestedFiles: File[] = e.target.files ? Array.from(e.target.files) : [];
    const availableChatSlots = FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
      ? Math.max(
          0,
          MAX_CHAT_ATTACHMENTS
            - selectedAttachments.filter(attachment => attachment.purpose === 'chat_only').length,
        )
      : requestedFiles.length;
    const files = requestedFiles.slice(0, availableChatSlots);
    if (files.length < requestedFiles.length) {
      alert(`Bir mesajda en fazla ${MAX_CHAT_ATTACHMENTS} sohbet eki kullanılabilir.`);
    }
    if (files.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    for (const file of files) {
      if (!isSupportedFileType(file)) {
        alert(
          FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
            ? `Desteklenmeyen dosya türü: ${file.name}. İlk bilgi bankası sürümü TXT ve MD dosyalarını destekliyor.`
            : `Desteklenmeyen dosya türü: ${file.name}. Görsel, PDF, TXT, MD, CSV ve DOCX dosyaları desteklenmektedir.`,
        );
        continue;
      }

      if (file.name.toLowerCase().endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          const text = result.value;
          
          // Convert text to base64 safely
          const bytes = new TextEncoder().encode(text);
          const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
          const base64Text = btoa(binString);
          
          setSelectedAttachments(prev => [...prev, {
            url: `data:text/plain;base64,${base64Text}`,
            data: base64Text,
            mimeType: 'text/plain',
            name: file.name,
            file: file,
            attachmentId: crypto.randomUUID(),
            purpose: 'chat_only',
          }]);
        } catch (err) {
          console.error("Error parsing DOCX:", err);
          alert(`${file.name} dosyası okunurken bir hata oluştu.`);
        }
      } else {
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
            file: file,
            attachmentId: crypto.randomUUID(),
            purpose: defaultAttachmentPurpose(),
          }]);
        };
        reader.readAsDataURL(file);
      }
    }
    
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

  const toggleAttachmentPurpose = (index: number) => {
    const target = selectedAttachments[index];
    if (
      target?.purpose === 'knowledge_bank'
      && selectedAttachments.filter(attachment => attachment.purpose === 'chat_only').length
        >= MAX_CHAT_ATTACHMENTS
    ) {
      alert(`Bir mesajda en fazla ${MAX_CHAT_ATTACHMENTS} sohbet eki kullanılabilir.`);
      return;
    }
    setSelectedAttachments(previous => previous.map((attachment, attachmentIndex) => (
      attachmentIndex === index
        ? {
            ...attachment,
            purpose: attachment.purpose === 'knowledge_bank' ? 'chat_only' : 'knowledge_bank',
          }
        : attachment
    )));
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
    
    if (FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME) {
      setShowMentionMenu(false);
      setShowSlashMenu(false);
      setSlashFilter('');
    } else {
      const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
      setShowMentionMenu(!!mentionMatch);

      const slashMatch = textBeforeCursor.match(/(^|\s)\/([a-zA-Z0-9-]*)$/);
      if (slashMatch) {
        setShowSlashMenu(true);
        setSlashFilter(slashMatch[2].toLowerCase());
      } else {
        setShowSlashMenu(false);
        setSlashFilter('');
      }
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we're leaving the main container
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const requestedFiles: File[] = Array.from(e.dataTransfer.files);
    const availableChatSlots = FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
      ? Math.max(
          0,
          MAX_CHAT_ATTACHMENTS
            - selectedAttachments.filter(attachment => attachment.purpose === 'chat_only').length,
        )
      : requestedFiles.length;
    const files = requestedFiles.slice(0, availableChatSlots);
    if (files.length < requestedFiles.length) {
      alert(`Bir mesajda en fazla ${MAX_CHAT_ATTACHMENTS} sohbet eki kullanılabilir.`);
    }
    if (files.length === 0) return;

    for (const file of files) {
      if (!isSupportedFileType(file)) {
        alert(
          FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
            ? `Desteklenmeyen dosya türü: ${file.name}. İlk bilgi bankası sürümü TXT ve MD dosyalarını destekliyor.`
            : `Desteklenmeyen dosya türü: ${file.name}. Görsel, PDF, TXT, MD, CSV ve DOCX dosyaları desteklenmektedir.`,
        );
        continue;
      }

      if (file.name.toLowerCase().endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          const text = result.value;
          
          const bytes = new TextEncoder().encode(text);
          const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
          const base64Text = btoa(binString);
          
          setSelectedAttachments(prev => [...prev, {
            url: `data:text/plain;base64,${base64Text}`,
            data: base64Text,
            mimeType: 'text/plain',
            name: file.name,
            file: file,
            attachmentId: crypto.randomUUID(),
            purpose: 'chat_only',
          }]);
        } catch (err) {
          console.error("Error parsing DOCX:", err);
          alert(`${file.name} dosyası okunurken bir hata oluştu.`);
        }
      } else {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result as string;
          const data = base64String.split(',')[1];
          
          setSelectedAttachments(prev => [...prev, {
            url: base64String,
            data: data,
            mimeType: file.type,
            name: file.name,
            file: file,
            attachmentId: crypto.randomUUID(),
            purpose: defaultAttachmentPurpose(),
          }]);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  return (
    <div 
      className={cn(
        "flex flex-col bg-theme-bg relative overflow-hidden transition-colors duration-300",
        fullWidth
          ? "flex-1 min-w-0 w-full"
          : "w-[650px] shrink-0 border-r border-theme-border",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] bg-theme-primary/10 backdrop-blur-sm border-2 border-dashed border-theme-primary flex items-center justify-center"
          >
            <div className="bg-theme-bg p-6 rounded-2xl shadow-xl flex flex-col items-center gap-4 border border-theme-border pointer-events-none">
              <div className="w-16 h-16 bg-theme-primary/10 rounded-full flex items-center justify-center text-theme-primary">
                <Upload size={32} />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-bold text-theme-text mb-1">Dosyaları Buraya Bırakın</h3>
                <p className="text-sm text-theme-text-muted">
                  {FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
                    ? 'Bilgi bankası için TXT veya MD dosyası ekleyebilirsiniz'
                    : 'Görsel, PDF, TXT, CSV ve DOCX belgeleri ekleyebilirsiniz'}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="h-16 flex items-center px-4 bg-theme-bg border-b border-theme-border sticky top-0 z-10 transition-colors duration-300 shadow-sm">
        <div className="flex items-center gap-3 w-full">
          <button 
            onClick={() => setCurrentWorkspaceId(null)}
            className="p-2 hover:bg-theme-surface-hover rounded-md text-theme-text-muted hover:text-theme-text transition-colors"
            title="Geri Dön"
          >
            <ChevronLeft size={18} />
          </button>
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
                {projectName ? `${projectName}` : 'Kıdemli İş Analisti'}
              </span>
            </div>
          </div>

          <select
            aria-label="Yapay zeka modeli"
            title="Sonraki mesajlarda kullanılacak yapay zeka modeli"
            value={selectedModel}
            onChange={event => setSelectedModel(event.target.value)}
            disabled={isGenerating}
            className="max-w-[112px] shrink-0 rounded-md border border-theme-border bg-theme-surface px-2 py-1.5 text-[11px] font-medium text-theme-text outline-none focus:border-theme-primary disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-[190px] sm:text-xs"
          >
            <option value="auto">Otomatik · OpenAI + Gemini</option>
            <option value="gpt-5.6-sol">OpenAI · GPT-5.6 Sol</option>
            <option value="gpt-5.6">OpenAI · GPT-5.6</option>
            <option value="gemini-3-flash-preview">Gemini · 3 Flash</option>
            <option value="gemini-3.1-pro-preview">Gemini · 3.1 Pro</option>
            <option value="gemini-3.1-flash-lite-preview">Gemini · 3.1 Flash Lite</option>
          </select>
          
          {/* Collaborators */}
          {collaborators && collaborators.length > 0 && (
            <div 
              className="flex -space-x-2 mr-4 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={onManageParticipants}
              title="Katılımcıları Yönet"
            >
              {collaborators.slice(0, 3).map((collab) => (
                <div 
                  key={collab.id}
                  title={`${collab.name} (${collab.role})`}
                  className="w-8 h-8 border-2 border-theme-bg flex items-center justify-center text-[10px] font-bold text-white rounded-full shadow-sm overflow-hidden"
                  style={{ backgroundColor: collab.color || stringToColor(collab.name) }}
                >
                  {collab.avatar && collab.avatar.startsWith('http') ? (
                    <img src={collab.avatar} alt={collab.name} className="w-full h-full object-cover" />
                  ) : (
                    collab.avatar || collab.name.charAt(0).toUpperCase()
                  )}
                </div>
              ))}
              {collaborators.length > 3 && (
                <div className="w-8 h-8 border-2 border-theme-bg bg-theme-surface-hover flex items-center justify-center text-[10px] font-bold text-theme-text-muted rounded-full shadow-sm">
                  +{collaborators.length - 3}
                </div>
              )}
            </div>
          )}

          {/* Zero-Touch Mode Toggle Button */}
          {FEATURE_FLAGS.ZERO_TOUCH && onToggleZeroTouchMode && (
            <button
              onClick={() => setShowZeroTouchSettings(true)}
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

          <div
            className="w-8 h-8 rounded-full flex items-center justify-center bg-theme-surface border border-theme-border shadow-sm"
            title="Kıdemli İş Analisti"
          >
            <JetWorkLogo className="w-4 h-4" />
          </div>
        </div>
      </header>

      {/* Messages */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-8 py-8 relative chat-scroll-container"
      >
        <div className="max-w-4xl mx-auto space-y-8">
          {messageLoadError ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center">
              <CloudOff size={28} className="mb-3 text-red-600" />
              <h2 className="text-base font-semibold text-theme-text">Mesajlar yüklenemedi</h2>
              <p className="mt-1 max-w-md text-sm text-theme-text-muted">{messageLoadError}</p>
              <button type="button" onClick={onRetryMessageLoad} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-theme-border bg-theme-surface px-4 py-2 text-sm font-semibold text-theme-text hover:bg-theme-surface-hover">
                <RotateCcw size={14} /> Tekrar dene
              </button>
            </div>
          ) : isLoadingWorkspace ? (
            <div className="space-y-6 animate-pulse">
              {[...Array(4)].map((_, i) => (
                <div key={i} className={`flex gap-4 ${i % 2 !== 0 ? 'flex-row-reverse' : ''}`}>
                  <div className="w-10 h-10 rounded-full bg-theme-border/50 shrink-0" />
                  <div className={`space-y-2 max-w-[70%] ${i % 2 !== 0 ? 'items-end' : 'items-start'} flex flex-col`}>
                    <div className="h-4 w-24 bg-theme-border/50 rounded" />
                    <div className={`h-20 w-full bg-theme-border/30 rounded-2xl ${i % 2 !== 0 ? 'rounded-tr-sm' : 'rounded-tl-sm'}`} style={{ width: `${[72, 58, 84, 66][i]}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {messages.length === 0 ? (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="h-full flex flex-col items-start justify-center py-20"
                >
                  <div className="w-12 h-12 bg-theme-surface flex items-center justify-center mb-6 border border-theme-border rounded-xl shadow-sm">
                    <JetWorkLogo className="w-6 h-6 text-theme-primary" />
                  </div>
                  <h2 className="text-xl font-semibold text-theme-text mb-2 tracking-tight">İş analizi talebini birlikte netleştirelim</h2>
                  <p className="text-sm text-theme-text-muted mb-6 max-w-xl leading-relaxed">
                    Talebini yaz. Önce gerekli noktaları netleştiririm; yalnız istediğinde doküman oluştururum.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
                    {starterPrompts.map(prompt => (
                      <button
                        key={prompt}
                        type="button"
                        disabled={isGenerating}
                        onClick={() => onSendMessage(prompt, [])}
                        className="p-4 text-left text-sm leading-relaxed rounded-xl border border-theme-border bg-theme-surface/60 text-theme-text hover:border-theme-primary/50 hover:bg-theme-surface transition-colors disabled:opacity-50"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </motion.div>
              ) : (
                messages.map((msg, idx) => (
                  <MessageItem 
                    key={msg.id} 
                    msg={msg} 
                    idx={idx} 
                    currentUser={currentUser} 
                    onRestoreDocument={onRestoreDocument} 
                     setDiffModalData={setDiffModalData}
                     onToggleReaction={onToggleReaction}
                     onRetryMessage={payload => {
                       void onSendMessage(payload.text, payload.attachments, {
                         replyToId: payload.replyToId,
                         retryMessageId: payload.messageId,
                         retryAiMessageId: payload.assistantMessageId,
                       });
                     }}
                     retryDisabled={isGenerating}
                     isLastMessage={idx === messages.length - 1}
                  />
                ))
              )}
            </AnimatePresence>
          )}
          <div ref={messagesEndRef} className="chat-scroll-anchor" />
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
                          <JetWorkLogo className="w-3.5 h-3.5" />
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
                  <div key={att.attachmentId || idx} className="relative group/img flex shrink-0 items-center gap-2 pr-1">
                    {att.mimeType.startsWith('image/') ? (
                      <img src={att.url} alt="upload preview" className="h-16 w-16 object-cover border border-theme-border/50 rounded-md" />
                    ) : (
                      <div className="h-16 w-16 flex flex-col items-center justify-center bg-theme-surface border border-theme-border/50 rounded-md shadow-sm overflow-hidden p-1">
                        <FileText size={16} className="text-theme-primary shrink-0" />
                        <span className="text-[9px] font-bold text-theme-text-muted uppercase truncate w-full text-center mt-1">
                          {att.name?.split('.').pop() || 'FILE'}
                        </span>
                        <span className="text-[8px] text-theme-text-muted truncate w-full text-center mt-0.5">
                          {att.name}
                        </span>
                      </div>
                    )}
                    {FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME && supportsKnowledgeBank(att) && (
                      <button
                        type="button"
                        onClick={() => toggleAttachmentPurpose(idx)}
                        className={cn(
                          'rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold transition-colors',
                          att.purpose === 'knowledge_bank'
                            ? 'border-theme-primary/40 bg-theme-primary/10 text-theme-primary'
                            : 'border-theme-border bg-theme-bg text-theme-text-muted',
                        )}
                        title="Bu dosyanın kalıcı bilgi bankasına mı yoksa yalnızca bu sohbete mi ekleneceğini seç"
                      >
                        {att.purpose === 'knowledge_bank' ? 'Bilgi bankası' : 'Yalnızca sohbet'}
                      </button>
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
            
            {!FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME && showSuggestions && dynamicSuggestions.length > 0 && (
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
                    Yazım desteği
                  </button>
                  {dynamicSuggestions.map((suggestion, idx) => (
                    <button 
                      key={idx}
                      type="button" 
                      onClick={() => {
                        setInput(suggestion);
                        if (textareaRef.current) textareaRef.current.focus();
                      }}
                      title={suggestion}
                      className="px-3 py-1.5 rounded-full border border-theme-border bg-theme-bg text-sm text-theme-text hover:bg-theme-surface-hover whitespace-nowrap shadow-sm shrink-0"
                    >
                      {suggestion.split('.')[0]}
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
              {!FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME && showMentionMenu && (
                <div className="absolute bottom-full left-4 mb-2 w-64 bg-theme-bg border border-theme-border shadow-xl z-50 overflow-hidden rounded-lg">
                  <div className="px-3 py-2 text-[10px] font-bold text-theme-text-muted uppercase tracking-widest border-b border-theme-border/50 bg-theme-surface-hover">
                    Kişiler
                  </div>
                  <button
                    type="button"
                    onClick={() => insertMention('JetWork AI')}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-theme-surface-hover transition-colors text-left"
                  >
                    <div className="w-6 h-6 flex items-center justify-center shrink-0">
                      <JetWorkLogo className="w-6 h-6" />
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
                    <div className="w-6 h-6 flex items-center justify-center shrink-0">
                      <JetWorkLogo className="w-6 h-6" />
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
                    <div className="w-6 h-6 flex items-center justify-center shrink-0">
                      <JetWorkLogo className="w-6 h-6" />
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
                    <div className="w-6 h-6 flex items-center justify-center shrink-0">
                      <JetWorkLogo className="w-6 h-6" />
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
                    <div className="w-6 h-6 flex items-center justify-center shrink-0">
                      <JetWorkLogo className="w-6 h-6" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-theme-text">Product Owner (PO)</span>
                      <span className="text-[10px] text-theme-text-muted">İş Değeri ve MVP</span>
                    </div>
                  </button>
                </div>
              )}
              {!FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME && showSlashMenu && filteredCommands.length > 0 && (
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
                data-testid="chat-input"
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Talebini, sorunu veya incelememi istediğin notları yaz..."
                className="flex-1 max-h-48 min-h-[80px] bg-transparent border-none focus:ring-0 focus:outline-none focus-visible:outline-none resize-none p-4 text-base text-theme-text placeholder:text-theme-text-muted"
                rows={1}
              />
              
              <div className="flex items-center justify-end px-3 py-3 gap-2">
                <input 
                  type="file" 
                  accept={FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
                    ? 'text/plain,text/markdown,.txt,.md'
                    : 'image/*,application/pdf,text/plain,text/markdown,.md,text/csv,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
                  multiple 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                />
                
                {!FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME && (
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
                )}

                {FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME && (
                  <button
                    type="button"
                    onClick={() => setShowKnowledgeBank(true)}
                    disabled={!currentWorkspaceId}
                    className="w-8 h-8 flex items-center justify-center rounded-full border border-theme-border text-theme-text-muted hover:text-theme-text hover:bg-theme-surface transition-colors disabled:opacity-40"
                    title="Bilgi Bankası"
                  >
                    <Database size={14} />
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
                  data-testid="chat-send"
                  aria-label="Mesaj gonder"
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

      {FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME && showKnowledgeBank && currentWorkspaceId && (
        <KnowledgeBankModal
          workspaceId={currentWorkspaceId}
          onClose={() => setShowKnowledgeBank(false)}
        />
      )}

      {FEATURE_FLAGS.ZERO_TOUCH && showZeroTouchSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-theme-bg border border-theme-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col"
          >
            <div className="p-4 border-b border-theme-border flex items-center justify-between bg-theme-surface">
              <div className="flex items-center gap-2 text-amber-500">
                <Zap size={18} className="animate-pulse" />
                <h3 className="font-semibold text-theme-text">Zero-Touch Mode Ayarları</h3>
              </div>
              <button 
                onClick={() => setShowZeroTouchSettings(false)}
                className="text-theme-text-muted hover:text-theme-text transition-colors p-1 rounded-md hover:bg-theme-surface-hover"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              <p className="text-sm text-theme-text-muted mb-4">
                Toplantıya katılacak AI ajanlarını seçin. Seçilen ajanlar toplantı boyunca aktif olarak tartışmaya katılacaktır.
              </p>
              
              <div className="space-y-2">
                {ZERO_TOUCH_AGENTS.map(agent => {
                  const isMandatory = agent.role === 'Orchestrator';
                  const isSelected = isMandatory || (activeZeroTouchRoles?.includes(agent.role) ?? false);
                  
                  return (
                    <label 
                      key={agent.role} 
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border transition-all",
                        isMandatory ? "cursor-not-allowed opacity-80" : "cursor-pointer",
                        isSelected 
                          ? "border-amber-500/50 bg-amber-500/5" 
                          : "border-theme-border bg-theme-surface hover:border-theme-border/80"
                      )}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded flex items-center justify-center border transition-colors",
                        isSelected ? "bg-amber-500 border-amber-500 text-white" : "border-theme-border bg-theme-bg"
                      )}>
                        {isSelected && <Check size={14} />}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-sm text-theme-text flex items-center gap-2">
                          {agent.name}
                          {isMandatory && <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-500 rounded-full">Zorunlu</span>}
                        </div>
                        <div className="text-xs text-theme-text-muted">{agent.role}</div>
                      </div>
                      <input 
                        type="checkbox" 
                        className="hidden"
                        checked={isSelected}
                        disabled={isMandatory}
                        onChange={() => {
                          if (!setActiveZeroTouchRoles || !activeZeroTouchRoles || isMandatory) return;
                          if (isSelected) {
                            setActiveZeroTouchRoles(activeZeroTouchRoles.filter(r => r !== agent.role));
                          } else {
                            setActiveZeroTouchRoles([...activeZeroTouchRoles, agent.role]);
                          }
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
            
            <div className="p-4 border-t border-theme-border bg-theme-surface flex justify-between items-center">
              <div className="text-xs text-theme-text-muted">
                {new Set([...(activeZeroTouchRoles || []), 'Orchestrator']).size} ajan seçili
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setShowZeroTouchSettings(false)}
                  className="px-4 py-2 text-sm font-medium text-theme-text-muted hover:text-theme-text transition-colors"
                >
                  Kapat
                </button>
                <button 
                  onClick={() => {
                    if (onToggleZeroTouchMode) {
                      onToggleZeroTouchMode();
                    }
                    setShowZeroTouchSettings(false);
                  }}
                  className={cn(
                    "px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2",
                    isZeroTouchMode 
                      ? "bg-red-500/10 text-red-500 hover:bg-red-500/20" 
                      : "bg-amber-500 text-white hover:bg-amber-600"
                  )}
                >
                  <Zap size={16} />
                  {isZeroTouchMode ? "Modu Kapat" : "Modu Başlat"}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
