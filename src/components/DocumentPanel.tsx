import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Edit3, FileText, Save, Share2, Wand2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { Collaborator, DocumentData, Message, SectionData } from '../types';
import { useDataStore } from '../store/useDataStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { sanitizeDocumentHtml } from '../lib/sanitizeHtml';
import { createDocumentShare, revokeDocumentShare } from '../services/documentShareRepository';

interface DocumentPanelProps {
  onGenerate: () => void;
  hasMessages: boolean;
  collaborators?: Collaborator[];
  onUpdateDocument?: (content: DocumentData) => void;
  onQuickAction?: (prompt: string) => void;
  score?: number;
  scoreExplanation?: string;
  messages?: Message[];
  onRestoreDocument?: (doc: any) => void;
  onManageParticipants?: () => void;
}

const TABS = ['BA Analiz', 'Review'];
const EMPTY_SECTION: SectionData = { content: '', status: 'DRAFT', flags: [] };

const getSectionByTab = (data: DocumentData | null, tab: string): SectionData | undefined => {
  if (!data) return undefined;
  if (tab === 'Review') return data.review;
  return data.businessAnalysis;
};

const getContentByTab = (data: DocumentData | null, tab: string): string => getSectionByTab(data, tab)?.content || '';

const getStatusLabel = (status?: SectionData['status']) => {
  if (status === 'APPROVED') return 'Onaylandı';
  if (status === 'NEEDS_REVISION') return 'Revizyon Bekliyor';
  return 'Taslak';
};

const getStatusClass = (status?: SectionData['status']) => {
  if (status === 'APPROVED') return 'bg-green-500/10 text-green-600 border-green-500/20';
  if (status === 'NEEDS_REVISION') return 'bg-red-500/10 text-red-600 border-red-500/20';
  return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
};

const buildQuickActionPrompt = (action: string): string => {
  const normalized = action.toLocaleLowerCase('tr-TR');
  if (normalized.includes('sablon') || normalized.includes('şablon')) {
    return 'Mevcut dokumani secili kurumsal Word kavramsal tasarim profiline gore duzelt. Baslik adlarini ve sirasini canonical profile gore koru; kaynakta olmayan surec, rol, sistem, KPI veya onay bilgisi uydurma. Degisikligi once onizleme olarak hazirla.';
  }
  if (normalized.includes('runtime') || normalized.includes('karar izi')) {
    return 'Review icindeki eski Copilot Runtime State Machine veya ic karar izi bloklarini kullanici dokumanindan kaldirmak icin onizleme hazirla. Is icerigini koru; ic telemetriyi dokumana yeniden ekleme.';
  }
  if (normalized.includes('tamamlanacak') || normalized.includes('kalite raporu')) {
    return 'Mevcut dokumanin salt okunur kalite bulgularini incele ve yalniz kaynak veya acik kullanici karariyla desteklenen eksikler icin repair onizlemesi hazirla. Sabit bolum veya satir sayisi dayatma; bilinmeyenleri [VARSAYIM] ya da [ACIK KONU] olarak ayir.';
  }
  if (normalized.includes('kaynak dogrulama') || normalized.includes('dogrulama matrisi')) {
    return 'Review bolumundeki Kaynak ve Dogrulama Matrisi alanini guncelle. Her kritik mevzuat, API, entegrasyon ve is kuralini DOGRULANDI / VARSAYIM / ACIK KONU olarak ayir; kaynak yoksa kesin hukum yazma ve aksiyon listesine ekle.';
  }
  if (normalized.includes('süreç') || normalized.includes('surec')) {
    return 'Kaynakta açıkça tanımlanan süreçleri bul ve yalnız bu süreçler için seçili artifact profile uygun repair önizlemesi hazırla. Kaynakta süreç yoksa genel süreç adı uydurma; eksik kararı [AÇIK KONU] olarak raporla.';
  }
  if (normalized.includes('evrak') || normalized.includes('belge') || normalized.includes('doküman') || normalized.includes('dokuman')) {
    return 'Zorunlu evrak ve doküman yönetimi matrisini detaylandır. Her süreç için belge adı, zorunluluk, sahip rol, yükleme/kontrol kuralı, tamamlanmamış belge davranışı, saklama sistemi ve kabul kriterlerini BA Analiz içine ekle.';
  }
  if (normalized.includes('dashboard')) {
    return 'Kaynakta veya kullanıcı talebinde bulunan dashboard ihtiyacını ekran amacı, kullanıcı aksiyonları, state, filtre, ölçüm, yetki, boş ve hata durumları açısından detaylandır. Kaynakta olmayan kart, KPI veya rolü varsayma.';
  }
  if (normalized.includes('entegrasyon')) {
    return 'Kaynakta adı geçen entegrasyonlar için kaynak, hedef, tetikleyici, veri, başarı/hata davranışı, güvenlik ve gözlemlenebilirlik boşluklarını değerlendir. Kaynakta bulunmayan sistem veya teknoloji ekleme; değişikliği onizleme olarak hazırla.';
  }
  if (normalized.includes('review') || normalized.includes('açık') || normalized.includes('acik')) {
    return 'Review bölümündeki açık konuları kapatmak için belgeyi gözden geçir. Doğrulandı / Varsayım / Açık Konu ayrımını yap, riskleri önceliklendir ve kapatılması gereken maddeleri aksiyon sahipleriyle listele.';
  }
  if (normalized.includes('word') || normalized.includes('format')) {
    return 'Mevcut BA Analiz dokümanını canonical şirket Word kavramsal tasarım profiline göre düzelt. Profil başlıklarını ve sırasını koru; gerçek katılımcı, onay, süreç veya KPI bilgisi yoksa [AÇIK KONU] kullan. Değişikliği önce onizleme olarak hazırla.';
  }
  return `${action}. Bu aksiyonu mevcut dokümana uygula; yeni soru sorma, tamamlanacak bilgileri [VARSAYIM] veya [AÇIK KONU] olarak işaretle.`;
};

export function DocumentPanel({
  hasMessages,
  onUpdateDocument,
  onQuickAction,
  score,
  scoreExplanation,
}: DocumentPanelProps) {
  const activeTab = useDocumentStore(state => state.activeTab);
  const setActiveTab = useDocumentStore(state => state.setActiveTab);
  const documentContent = useDocumentStore(state => state.documentContent);
  const isGenerating = useDocumentStore(state => state.isGenerating);
  const isGeneratingDocument = useDocumentStore(state => state.isGeneratingDocument);
  const isDiscussing = useDocumentStore(state => state.isDiscussing);
  const isLoadingWorkspace = useDataStore(state => state.isLoadingWorkspace);
  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);
  const user = useDataStore(state => state.user);
  const setSelectedDocumentText = useDocumentStore(state => state.setSelectedDocumentText);

  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [activeShareId, setActiveShareId] = useState<string | null>(null);

  const safeActiveTab = TABS.includes(activeTab) ? activeTab : 'BA Analiz';
  const activeSection = getSectionByTab(documentContent, safeActiveTab);
  const activeContent = getContentByTab(documentContent, safeActiveTab);
  const safeActiveContent = useMemo(() => sanitizeDocumentHtml(activeContent), [activeContent]);
  const currentFlags = activeSection?.flags || [];
  const currentStatus = activeSection?.status || 'DRAFT';
  const effectiveScore = documentContent?.score ?? score;
  const effectiveScoreExplanation = documentContent?.scoreExplanation ?? scoreExplanation;
  const quickActions = (documentContent?.suggestions || []).slice(0, 8);

  const tabStatusMap = useMemo(() => Object.fromEntries(TABS.map(tab => [tab, getSectionByTab(documentContent, tab)?.status || 'DRAFT'])), [documentContent]);

  useEffect(() => {
    if (!TABS.includes(activeTab)) setActiveTab('BA Analiz');
  }, [activeTab, setActiveTab]);

  useEffect(() => {
    setDraftContent(activeContent);
  }, [activeContent, safeActiveTab]);

  const updateActiveSection = (content: string) => {
    if (!documentContent) return;
    const updated: DocumentData = {
      ...documentContent,
      businessAnalysis: documentContent.businessAnalysis || EMPTY_SECTION,
    };

    const nextSection: SectionData = {
      ...(activeSection || EMPTY_SECTION),
      content: sanitizeDocumentHtml(content),
      status: activeSection?.status || 'DRAFT',
      flags: activeSection?.flags || [],
    };

    if (safeActiveTab === 'Review') updated.review = nextSection;
    else updated.businessAnalysis = nextSection;

    onUpdateDocument?.(updated);
    setIsEditing(false);
  };

  const handleShare = async () => {
    if (!documentContent || !currentWorkspaceId || !user) return;
    setIsSharing(true);
    try {
      const share = await createDocumentShare(currentWorkspaceId, user.uid, documentContent);
      const shareUrl = `${window.location.origin}?share=${encodeURIComponent(share.token)}`;
      await navigator.clipboard.writeText(shareUrl);
      setActiveShareId(share.id);
      alert(`Paylaşım bağlantısı panoya kopyalandı!\n\n${shareUrl}`);
    } catch (error) {
      console.error(error);
      alert('Paylaşım bağlantısı oluşturulurken hata oluştu.');
    } finally {
      setIsSharing(false);
    }
  };

  const handleRevokeShare = async () => {
    if (!activeShareId) return;
    setIsSharing(true);
    try {
      await revokeDocumentShare(activeShareId);
      setActiveShareId(null);
      alert('Paylaşım bağlantısı iptal edildi.');
    } catch (error) {
      console.error(error);
      alert('Paylaşım iptal edilirken hata oluştu.');
    } finally {
      setIsSharing(false);
    }
  };

  const handleDownload = () => {
    if (!documentContent) return;
    const blob = new Blob([
      `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>${safeActiveTab}</title><style>body{font-family:Arial,sans-serif;line-height:1.6;max-width:960px;margin:0 auto;padding:32px;color:#111827}table{border-collapse:collapse;width:100%;margin:18px 0}th,td{border:1px solid #d1d5db;padding:10px;text-align:left}th{background:#f3f4f6}h1,h2,h3{color:#111827}pre{background:#111827;color:#f9fafb;padding:16px;border-radius:8px;overflow:auto}</style></head><body>${safeActiveContent}</body></html>`
    ], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeActiveTab === 'Review' ? 'analiz_review.html' : 'analiz_ba_analiz.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSelect = () => {
    const selection = window.getSelection()?.toString() || '';
    if (selection.trim()) setSelectedDocumentText(selection.trim());
  };

  const renderActiveContent = () => {
    if (isEditing) {
      return (
        <div className="space-y-4">
          <textarea
            value={draftContent}
            onChange={(event) => setDraftContent(event.target.value)}
            className="w-full min-h-[65vh] rounded-xl border border-theme-border bg-theme-bg p-5 font-mono text-sm text-theme-text outline-none focus:ring-2 focus:ring-theme-primary/30"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setDraftContent(activeContent); setIsEditing(false); }} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-theme-border text-theme-text hover:bg-theme-surface-hover">
              <X size={14} /> İptal
            </button>
            <button onClick={() => updateActiveSection(draftContent)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-theme-primary text-theme-primary-fg hover:bg-theme-primary-hover">
              <Save size={14} /> Kaydet
            </button>
          </div>
        </div>
      );
    }

    if (!activeContent) return <EmptyContent />;

    return (
      <div
        onMouseUp={handleSelect}
        className="jetwork-doc prose prose-slate max-w-none prose-headings:font-semibold prose-table:text-sm prose-th:bg-slate-100 prose-th:p-3 prose-td:p-3 prose-td:border prose-th:border prose-table:w-full"
        dangerouslySetInnerHTML={{ __html: safeActiveContent }}
      />
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-theme-bg h-full shrink-0 relative overflow-hidden border-l border-theme-border/50 transition-colors duration-300 z-10">
      <header className="h-16 flex items-center justify-between px-8 bg-theme-bg border-b border-theme-border sticky top-0 z-20 transition-colors duration-300 shadow-sm">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => {
            const status = tabStatusMap[tab] as SectionData['status'];
            const hasError = status === 'NEEDS_REVISION';
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn('px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors relative rounded-md flex items-center gap-2', safeActiveTab === tab ? 'text-theme-primary bg-theme-primary/10' : 'text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover')}
              >
                {tab}
                {hasError && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" title="Revizyon Bekliyor" />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          {effectiveScore !== undefined && effectiveScore > 0 && (
            <div title={effectiveScoreExplanation} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold border', effectiveScore >= 90 ? 'bg-green-500/10 text-green-600 border-green-500/20' : effectiveScore >= 70 ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' : 'bg-red-500/10 text-red-600 border-red-500/20')}>
              <CheckCircle2 size={12} />
              <span>KALİTE PUANI: {effectiveScore}</span>
            </div>
          )}

          {documentContent && !isEditing && (
            <button onClick={() => setIsEditing(true)} className="p-1.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-md" title="Düzenle">
              <Edit3 size={14} />
            </button>
          )}
          {documentContent && (
            <>
              <button data-testid="share-document" onClick={handleShare} disabled={isSharing} className="p-1.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-md" title="Paylaş">
                <Share2 size={14} className={isSharing ? 'animate-pulse' : ''} />
              </button>
              {activeShareId && (
                <button data-testid="revoke-document-share" onClick={handleRevokeShare} disabled={isSharing} className="p-1.5 text-theme-text-muted hover:text-red-600 hover:bg-red-500/10 rounded-md" title="Paylaşımı iptal et">
                  <X size={14} />
                </button>
              )}
              <button onClick={handleDownload} className="flex items-center gap-2 px-3 py-1.5 bg-theme-primary text-theme-primary-fg text-[10px] font-bold uppercase tracking-widest hover:bg-theme-primary-hover rounded-md shadow-sm">
                <Download size={12} /> İndir
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 bg-theme-bg transition-colors duration-300">
        <div className="max-w-5xl mx-auto">
          <AnimatePresence mode="wait">
            {isLoadingWorkspace ? (
              <LoadingState />
            ) : !documentContent && !isGeneratingDocument && !isDiscussing ? (
              <ChatFirstEmptyState hasMessages={hasMessages} />
            ) : !documentContent && (isGeneratingDocument || isDiscussing) ? (
              <GeneratingState isDiscussing={isDiscussing} />
            ) : (
              <motion.div data-testid="document-panel-content" key={safeActiveTab} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="bg-theme-surface p-8 border border-theme-border/50 shadow-lg relative rounded-2xl">
                <div className="absolute top-0 left-0 right-0 h-1 bg-theme-primary rounded-t-2xl opacity-80" />
                <div className="mb-8 pb-4 border-b border-theme-border/50 flex justify-between items-start gap-4">
                  <div>
                    <h2 className="text-2xl font-semibold text-theme-text tracking-tight flex items-center gap-3">
                      {safeActiveTab === 'Review' ? 'Değerlendirme' : 'BA Analiz'} Raporu
                      <span className={cn('text-[10px] px-3 py-1 font-bold uppercase tracking-widest rounded-full border', getStatusClass(currentStatus))}>
                        {getStatusLabel(currentStatus)}
                      </span>
                    </h2>
                    {effectiveScoreExplanation && <p className="mt-3 text-sm text-theme-text-muted leading-relaxed">{effectiveScoreExplanation}</p>}
                  </div>
                  {(isGenerating || isDiscussing) && (
                    <div className="flex items-center gap-2 text-theme-primary text-xs font-medium animate-pulse">
                      <div className="w-4 h-4 rounded-full border-2 border-theme-primary border-t-transparent animate-spin" />
                      {isDiscussing ? 'Tartışılıyor...' : 'Güncelleniyor...'}
                    </div>
                  )}
                </div>

                {currentFlags.length > 0 && (
                  <div className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <h4 className="flex items-center gap-2 text-red-600 font-bold text-sm mb-3"><AlertTriangle size={16} /> Kalite Kapısı / Revizyon Notları</h4>
                    <ul className="space-y-2">
                      {currentFlags.map((flag, idx) => <li key={idx} className="text-sm text-theme-text opacity-90">• {flag}</li>)}
                    </ul>
                  </div>
                )}

                {quickActions.length > 0 && onQuickAction && (
                  <div className="mb-8 border-b border-theme-border/50 pb-5">
                    <div className="flex items-center gap-2 mb-3 text-[10px] font-bold uppercase tracking-widest text-theme-text-muted">
                      <Wand2 size={14} className="text-theme-primary" />
                      Hızlı Aksiyonlar
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {quickActions.map((action, idx) => (
                        <button
                          key={`${action}-${idx}`}
                          type="button"
                          onClick={() => onQuickAction(buildQuickActionPrompt(action))}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-theme-border bg-theme-bg text-theme-text hover:border-theme-primary/60 hover:bg-theme-surface-hover transition-colors"
                          title={action}
                        >
                          <Wand2 size={12} className="text-theme-primary" />
                          <span className="max-w-[220px] truncate">{action}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {renderActiveContent()}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function EmptyContent() {
  return <div className="rounded-xl border border-dashed border-theme-border p-8 text-center text-sm text-theme-text-muted">Bu bölüm henüz doldurulmadı. Chat üzerinden Jetwork AI'dan BA analiz veya review bölümünü detaylandırmasını isteyebilirsiniz.</div>;
}

function ChatFirstEmptyState({ hasMessages }: { hasMessages: boolean }) {
  return (
    <motion.div key="empty" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="h-[60vh] flex flex-col items-center justify-center text-center border border-dashed border-theme-border/50 bg-theme-surface rounded-2xl shadow-sm">
      <div className="w-16 h-16 bg-theme-bg flex items-center justify-center mb-6 border border-theme-border/50 rounded-xl shadow-sm"><FileText size={24} className="text-theme-text-muted" /></div>
      <h3 className="text-lg font-semibold text-theme-text mb-2 tracking-tight">Chat ile BA Analiz Oluşturun</h3>
      <p className="text-sm text-theme-text-muted max-w-md leading-relaxed">Şimdilik sadece BA Analiz ve Review bölümleri aktiftir. IT Analiz, Test ve FLOW bölümleri kaldırıldı.</p>
      {!hasMessages && <p className="mt-4 text-xs text-theme-text-muted">Başlamak için sol taraftaki chat alanına talebinizi yazın.</p>}
    </motion.div>
  );
}

function LoadingState() {
  return <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8 animate-pulse p-8 bg-theme-surface border border-theme-border/50 rounded-2xl shadow-sm"><div className="h-8 w-1/3 bg-theme-border/50 rounded-lg" /><div className="space-y-4"><div className="h-4 w-full bg-theme-border/30 rounded" /><div className="h-4 w-5/6 bg-theme-border/30 rounded" /><div className="h-4 w-4/6 bg-theme-border/30 rounded" /></div></motion.div>;
}

function GeneratingState({ isDiscussing }: { isDiscussing: boolean }) {
  return (
    <motion.div key="generating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-[60vh] flex flex-col items-center justify-center text-center">
      <div className="relative w-12 h-12 mb-6"><div className="absolute inset-0 border-2 border-theme-border/50 rounded-full" /><div className="absolute inset-0 border-2 border-theme-primary border-t-transparent animate-spin rounded-full" /></div>
      <h3 className="text-lg font-semibold text-theme-text tracking-tight">{isDiscussing ? 'Analiz Ediliyor' : 'BA Analiz Hazırlanıyor'}</h3>
      <p className="text-sm text-theme-text-muted mt-2">Jetwork AI konuşma bağlamını analiz ediyor ve BA analiz bölümünü yapılandırıyor...</p>
    </motion.div>
  );
}
