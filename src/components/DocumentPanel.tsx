import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Edit3,
  FileText,
  History,
  Loader2,
  Save,
  Share2,
  Wand2,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import type { Collaborator, DocumentData, Message, SectionData } from '../types';
import { useDataStore } from '../store/useDataStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { sanitizeDocumentHtml } from '../lib/sanitizeHtml';
import { createDocumentShare, revokeDocumentShare } from '../services/documentShareRepository';
import {
  deleteDocumentDraft,
  DocumentVersionConflictError,
  loadDocumentDraft,
  saveDocumentDraft,
  type DocumentVersionRecord,
} from '../services/documentVersionRepository';
import { useDocumentVersions } from '../hooks/useDocumentVersions';
import { DocumentEditor, type EditorSelectionRange } from './editor/DocumentEditor';
import { DocumentVersionHistory } from './DocumentVersionHistory';

interface DocumentPanelProps {
  onGenerate: () => void;
  hasMessages: boolean;
  collaborators?: Collaborator[];
  onUpdateDocument?: (content: DocumentData) => void;
  onQuickAction?: (prompt: string) => void;
  score?: number;
  scoreExplanation?: string;
  messages?: Message[];
  onRestoreDocument?: (doc: DocumentData) => void;
  onManageParticipants?: () => void;
}

type DocumentTab = 'BA Analiz' | 'Review';
type EditableSectionKey = 'businessAnalysis' | 'review';
type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const TABS: DocumentTab[] = ['BA Analiz', 'Review'];
const EMPTY_SECTION: SectionData = { content: '', status: 'DRAFT', flags: [] };

const sectionKeyForTab = (tab: DocumentTab): EditableSectionKey => (
  tab === 'Review' ? 'review' : 'businessAnalysis'
);

const getSectionByTab = (data: DocumentData | null, tab: DocumentTab): SectionData | undefined => {
  if (!data) return undefined;
  return tab === 'Review' ? data.review : data.businessAnalysis;
};

const getContentByTab = (data: DocumentData | null, tab: DocumentTab): string => (
  getSectionByTab(data, tab)?.content || ''
);

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

function createManualRevision(
  document: DocumentData,
  sectionKey: EditableSectionKey,
  section: SectionData,
  summary: string,
  sourceId: string,
): DocumentData {
  const now = new Date().toISOString();
  const next: DocumentData = {
    ...document,
    businessAnalysis: document.businessAnalysis || EMPTY_SECTION,
    artifactMeta: {
      revisionId: crypto.randomUUID(),
      parentRevisionId: document.artifactMeta?.revisionId,
      sourceMessageIds: Array.from(new Set([
        ...(document.artifactMeta?.sourceMessageIds || []),
        sourceId,
      ])).slice(-20),
      changeSummary: summary,
      changedSections: [sectionKey],
      updatedAt: now,
    },
  };

  if (sectionKey === 'review') next.review = section;
  else next.businessAnalysis = section;

  return next;
}

export function DocumentPanel({
  hasMessages,
  onQuickAction,
  score,
  scoreExplanation,
}: DocumentPanelProps) {
  const activeTabValue = useDocumentStore(state => state.activeTab);
  const setActiveTab = useDocumentStore(state => state.setActiveTab);
  const documentContent = useDocumentStore(state => state.documentContent);
  const setDocumentContent = useDocumentStore(state => state.setDocumentContent);
  const isGenerating = useDocumentStore(state => state.isGenerating);
  const isGeneratingDocument = useDocumentStore(state => state.isGeneratingDocument);
  const isDiscussing = useDocumentStore(state => state.isDiscussing);
  const setSelectedDocumentText = useDocumentStore(state => state.setSelectedDocumentText);
  const isLoadingWorkspace = useDataStore(state => state.isLoadingWorkspace);
  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);
  const user = useDataStore(state => state.user);

  const safeActiveTab: DocumentTab = TABS.includes(activeTabValue as DocumentTab)
    ? activeTabValue as DocumentTab
    : 'BA Analiz';
  const activeSectionKey = sectionKeyForTab(safeActiveTab);
  const activeSection = getSectionByTab(documentContent, safeActiveTab);
  const activeContent = getContentByTab(documentContent, safeActiveTab);

  const {
    head,
    versions,
    isLoading: isVersionLoading,
    error: versionError,
    refresh: refreshVersions,
    commit,
  } = useDocumentVersions(currentWorkspaceId);

  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [baseContent, setBaseContent] = useState('');
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = useState<DraftSaveStatus>('idle');
  const [isSavingVersion, setIsSavingVersion] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [activeShareId, setActiveShareId] = useState<string | null>(null);
  const editingStartDocumentRef = useRef<DocumentData | null>(null);

  const safeActiveContent = useMemo(() => sanitizeDocumentHtml(activeContent), [activeContent]);
  const currentFlags = activeSection?.flags || [];
  const currentStatus = activeSection?.status || 'DRAFT';
  const effectiveScore = documentContent?.score ?? score;
  const effectiveScoreExplanation = documentContent?.scoreExplanation ?? scoreExplanation;
  const quickActions = (documentContent?.suggestions || []).slice(0, 8);
  const remoteVersionAvailable = Boolean(
    isEditing
    && head.currentVersionId
    && head.currentVersionId !== baseVersionId,
  );

  const tabStatusMap = useMemo(
    () => Object.fromEntries(
      TABS.map(tab => [tab, getSectionByTab(documentContent, tab)?.status || 'DRAFT']),
    ),
    [documentContent],
  );

  useEffect(() => {
    if (!TABS.includes(activeTabValue as DocumentTab)) setActiveTab('BA Analiz');
  }, [activeTabValue, setActiveTab]);

  useEffect(() => {
    if (!isEditing) {
      setDraftContent(safeActiveContent);
      setBaseContent(safeActiveContent);
      setIsDirty(false);
    }
  }, [isEditing, safeActiveContent, safeActiveTab]);

  useEffect(() => {
    if (!isEditing || !currentWorkspaceId) return;
    if (documentContent === editingStartDocumentRef.current) return;
    void refreshVersions().catch(() => undefined);
  }, [currentWorkspaceId, documentContent, isEditing, refreshVersions]);

  useEffect(() => {
    if (!isEditing || !isDirty || !currentWorkspaceId) return;

    setDraftSaveStatus('saving');
    const timeout = window.setTimeout(() => {
      void saveDocumentDraft({
        workspaceId: currentWorkspaceId,
        sectionKey: activeSectionKey,
        baseVersionId,
        content: sanitizeDocumentHtml(draftContent),
      })
        .then(() => setDraftSaveStatus('saved'))
        .catch((error) => {
          console.error('Draft autosave failed:', error);
          setDraftSaveStatus('error');
        });
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [activeSectionKey, baseVersionId, currentWorkspaceId, draftContent, isDirty, isEditing]);

  const enterEditMode = async () => {
    if (!documentContent || !currentWorkspaceId) return;

    setSaveError(null);
    try {
      const snapshot = await refreshVersions();
      const storedDraft = await loadDocumentDraft({
        workspaceId: currentWorkspaceId,
        sectionKey: activeSectionKey,
      });

      let nextDraft = safeActiveContent;
      if (storedDraft && storedDraft.content !== safeActiveContent) {
        const sameBase = storedDraft.baseVersionId === snapshot.head.currentVersionId;
        const recover = window.confirm(
          sameBase
            ? 'Bu bölüm için kaydedilmemiş bir taslak bulundu. Taslak geri yüklensin mi?'
            : 'Daha eski bir doküman sürümüne ait kaydedilmemiş taslak bulundu. Yine de geri yüklensin mi?',
        );

        if (recover) {
          nextDraft = sanitizeDocumentHtml(storedDraft.content);
        } else {
          await deleteDocumentDraft({
            workspaceId: currentWorkspaceId,
            sectionKey: activeSectionKey,
          });
        }
      }

      editingStartDocumentRef.current = documentContent;
      setBaseContent(safeActiveContent);
      setDraftContent(nextDraft);
      setBaseVersionId(snapshot.head.currentVersionId);
      setIsDirty(nextDraft !== safeActiveContent);
      setDraftSaveStatus('idle');
      setIsEditing(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveError(message);
      toast.error('Düzenleme modu başlatılamadı.');
    }
  };

  const cancelEditing = async (skipConfirmation = false) => {
    if (isDirty && !skipConfirmation) {
      const accepted = window.confirm('Kaydedilmemiş değişiklikler silinecek. Devam edilsin mi?');
      if (!accepted) return;
    }

    if (currentWorkspaceId) {
      await deleteDocumentDraft({
        workspaceId: currentWorkspaceId,
        sectionKey: activeSectionKey,
      }).catch(() => undefined);
    }

    setDraftContent(safeActiveContent);
    setBaseContent(safeActiveContent);
    setIsDirty(false);
    setIsEditing(false);
    setSaveError(null);
    setDraftSaveStatus('idle');
    setSelectedDocumentText('');
  };

  const handleEditorChange = (html: string) => {
    const sanitized = sanitizeDocumentHtml(html);
    setDraftContent(sanitized);
    setIsDirty(sanitized !== baseContent);
    setSaveError(null);
  };

  const handleSelectionUpdate = (selection: EditorSelectionRange | null) => {
    setSelectedDocumentText(selection?.text || '');
  };

  const saveCurrentVersion = async () => {
    if (!documentContent || !currentWorkspaceId || isSavingVersion) return;

    if (!isDirty) {
      setIsEditing(false);
      return;
    }

    setIsSavingVersion(true);
    setSaveError(null);

    const sourceMessageId = `manual-${crypto.randomUUID()}`;
    const summary = `${safeActiveTab} bölümü manuel olarak düzenlendi`;
    const nextSection: SectionData = {
      ...(activeSection || EMPTY_SECTION),
      content: sanitizeDocumentHtml(draftContent),
      status: activeSection?.status || 'DRAFT',
      flags: activeSection?.flags || [],
    };
    const nextDocument = createManualRevision(
      documentContent,
      activeSectionKey,
      nextSection,
      summary,
      sourceMessageId,
    );

    try {
      const result = await commit(nextDocument, {
        expectedCurrentVersionId: baseVersionId,
        changeSource: 'MANUAL',
        changeSummary: summary,
        changedSections: [activeSectionKey],
        sourceMessageId,
        idempotencyKey: sourceMessageId,
      });

      setDocumentContent(nextDocument);
      setBaseVersionId(result.versionId);
      setBaseContent(nextSection.content);
      setDraftContent(nextSection.content);
      setIsDirty(false);
      setIsEditing(false);
      setDraftSaveStatus('idle');
      setSelectedDocumentText('');
      editingStartDocumentRef.current = nextDocument;

      await deleteDocumentDraft({
        workspaceId: currentWorkspaceId,
        sectionKey: activeSectionKey,
      }).catch(() => undefined);

      toast.success(`Doküman v${result.versionNumber} olarak kaydedildi.`);
    } catch (error) {
      if (error instanceof DocumentVersionConflictError) {
        setSaveError('Yeni bir doküman sürümü oluştu. Taslağınız korunuyor; geçmişi açıp değişiklikleri karşılaştırın.');
        toast.error('Sürüm çakışması oluştu.');
        await refreshVersions().catch(() => undefined);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        setSaveError(message);
        toast.error('Doküman kaydedilemedi. Taslak korunuyor.');
      }
    } finally {
      setIsSavingVersion(false);
    }
  };

  const handleRestoreVersion = async (version: DocumentVersionRecord) => {
    if (!currentWorkspaceId || !documentContent || isRestoring) return;

    setIsRestoring(true);
    setSaveError(null);
    try {
      const snapshot = await refreshVersions();
      const sourceMessageId = `restore-${crypto.randomUUID()}`;
      const restoredDocument: DocumentData = {
        ...version.content,
        artifactMeta: {
          revisionId: crypto.randomUUID(),
          parentRevisionId: documentContent.artifactMeta?.revisionId,
          sourceMessageIds: Array.from(new Set([
            ...(documentContent.artifactMeta?.sourceMessageIds || []),
            sourceMessageId,
          ])).slice(-20),
          changeSummary: `v${version.versionNumber} içeriği geri yüklendi`,
          changedSections: ['businessAnalysis', 'review'],
          updatedAt: new Date().toISOString(),
        },
      };

      const result = await commit(restoredDocument, {
        expectedCurrentVersionId: snapshot.head.currentVersionId,
        changeSource: 'RESTORE',
        changeSummary: `v${version.versionNumber} içeriği yeni sürüm olarak geri yüklendi`,
        changedSections: ['businessAnalysis', 'review'],
        sourceMessageId,
        idempotencyKey: sourceMessageId,
      });

      setDocumentContent(restoredDocument);
      setDraftContent(getContentByTab(restoredDocument, safeActiveTab));
      setBaseContent(getContentByTab(restoredDocument, safeActiveTab));
      setBaseVersionId(result.versionId);
      setIsDirty(false);
      setIsEditing(false);
      toast.success(`v${version.versionNumber} içeriği v${result.versionNumber} olarak geri yüklendi.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveError(message);
      toast.error('Versiyon geri yüklenemedi.');
      throw error;
    } finally {
      setIsRestoring(false);
    }
  };

  const handleTabChange = async (tab: DocumentTab) => {
    if (tab === safeActiveTab) return;

    if (isEditing && isDirty) {
      const accepted = window.confirm('Sekme değiştirildiğinde kaydedilmemiş değişiklikler silinecek. Devam edilsin mi?');
      if (!accepted) return;
      await cancelEditing(true);
    } else if (isEditing) {
      setIsEditing(false);
    }

    setSelectedDocumentText('');
    setActiveTab(tab);
  };

  const handleShare = async () => {
    if (!documentContent || !currentWorkspaceId || !user) return;
    setIsSharing(true);
    try {
      const share = await createDocumentShare(currentWorkspaceId, user.uid, documentContent);
      const shareUrl = `${window.location.origin}?share=${encodeURIComponent(share.token)}`;
      await navigator.clipboard.writeText(shareUrl);
      setActiveShareId(share.id);
      toast.success('Paylaşım bağlantısı panoya kopyalandı.');
    } catch (error) {
      console.error(error);
      toast.error('Paylaşım bağlantısı oluşturulamadı.');
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
      toast.success('Paylaşım bağlantısı iptal edildi.');
    } catch (error) {
      console.error(error);
      toast.error('Paylaşım iptal edilemedi.');
    } finally {
      setIsSharing(false);
    }
  };

  const handleDownload = () => {
    if (!documentContent) return;
    const html = sanitizeDocumentHtml(getContentByTab(documentContent, safeActiveTab));
    const blob = new Blob([
      `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>${safeActiveTab}</title><style>body{font-family:Arial,sans-serif;line-height:1.6;max-width:960px;margin:0 auto;padding:32px;color:#111827}table{border-collapse:collapse;width:100%;margin:18px 0}th,td{border:1px solid #d1d5db;padding:10px;text-align:left}th{background:#f3f4f6}h1,h2,h3{color:#111827}pre{background:#111827;color:#f9fafb;padding:16px;border-radius:8px;overflow:auto}</style></head><body>${html}</body></html>`,
    ], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeActiveTab === 'Review' ? 'analiz_review.html' : 'analiz_ba_analiz.html';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const openHistory = () => {
    setIsHistoryOpen(true);
    void refreshVersions().catch(() => undefined);
  };

  const renderActiveContent = () => {
    if (!isEditing && !activeContent) return <EmptyContent />;

    return (
      <div className="space-y-3">
        {remoteVersionAvailable && (
          <div className="flex items-start justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
            <div>
              <p className="font-semibold">Belgenin yeni bir sürümü var.</p>
              <p className="mt-1 text-xs">Taslağınız korunuyor. Kaydetmeden önce versiyon geçmişinden değişiklikleri karşılaştırın.</p>
            </div>
            <button type="button" onClick={openHistory} className="whitespace-nowrap rounded-md border border-amber-500/30 px-2.5 py-1.5 text-xs font-semibold hover:bg-amber-500/10">
              Geçmişi Aç
            </button>
          </div>
        )}

        {saveError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">
            {saveError}
          </div>
        )}

        <DocumentEditor
          content={isEditing ? draftContent : safeActiveContent}
          editable={isEditing}
          onChange={handleEditorChange}
          onSelectionUpdate={handleSelectionUpdate}
          onSave={() => void saveCurrentVersion()}
          placeholder={`${safeActiveTab} içeriğini yazın...`}
        />

        {isEditing && (
          <div className="flex flex-col gap-3 rounded-lg border border-theme-border bg-theme-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-theme-text-muted">
              {isDirty ? (
                <span className="inline-flex items-center gap-2 text-amber-600">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                  Kaydedilmemiş değişiklikler
                </span>
              ) : (
                <span>Değişiklik yok</span>
              )}
              {isDirty && (
                <span className="ml-3">
                  {draftSaveStatus === 'saving' && 'Taslak kaydediliyor...'}
                  {draftSaveStatus === 'saved' && 'Taslak kaydedildi'}
                  {draftSaveStatus === 'error' && 'Taslak kaydedilemedi'}
                </span>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => void cancelEditing()}
                disabled={isSavingVersion}
                className="inline-flex items-center gap-2 rounded-md border border-theme-border px-4 py-2 text-sm font-medium text-theme-text hover:bg-theme-surface-hover disabled:opacity-50"
              >
                <X size={14} /> İptal
              </button>
              <button
                type="button"
                onClick={() => void saveCurrentVersion()}
                disabled={!isDirty || isSavingVersion || remoteVersionAvailable}
                className="inline-flex items-center gap-2 rounded-md bg-theme-primary px-4 py-2 text-sm font-semibold text-theme-primary-fg hover:bg-theme-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                title={remoteVersionAvailable ? 'Önce yeni sürümü karşılaştırın.' : 'Ctrl+S'}
              >
                {isSavingVersion ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Kaydet
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="relative z-10 flex h-full flex-1 shrink-0 flex-col overflow-hidden border-l border-theme-border/50 bg-theme-bg transition-colors duration-300">
      <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-theme-border bg-theme-bg px-4 py-2 shadow-sm sm:px-8">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => {
            const status = tabStatusMap[tab] as SectionData['status'];
            const hasError = status === 'NEEDS_REVISION';
            return (
              <button
                key={tab}
                type="button"
                onClick={() => void handleTabChange(tab)}
                className={cn(
                  'relative flex items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors sm:px-4',
                  safeActiveTab === tab
                    ? 'bg-theme-primary/10 text-theme-primary'
                    : 'text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text',
                )}
              >
                {tab}
                {hasError && <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" title="Revizyon Bekliyor" />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {effectiveScore !== undefined && effectiveScore > 0 && (
            <div
              data-testid="document-quality-score"
              title={effectiveScoreExplanation}
              className={cn(
                'hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-bold md:flex',
                effectiveScore >= 90
                  ? 'border-green-500/20 bg-green-500/10 text-green-600'
                  : effectiveScore >= 70
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-600'
                    : 'border-red-500/20 bg-red-500/10 text-red-600',
              )}
            >
              <CheckCircle2 size={12} />
              <span>KALİTE: {effectiveScore}</span>
            </div>
          )}

          {documentContent && (
            <div className="hidden rounded-md border border-theme-border bg-theme-surface px-2 py-1 font-mono text-[10px] text-theme-text-muted sm:block">
              v{head.currentVersionNumber || 0}
            </div>
          )}

          {documentContent && !isEditing && (
            <button
              type="button"
              onClick={() => void enterEditMode()}
              className="rounded-md p-1.5 text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text"
              title="Düzenle"
            >
              <Edit3 size={15} />
            </button>
          )}

          {documentContent && (
            <>
              <button
                type="button"
                onClick={openHistory}
                className="rounded-md p-1.5 text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text"
                title="Versiyon geçmişi"
              >
                <History size={15} />
              </button>
              <button
                data-testid="share-document"
                type="button"
                onClick={handleShare}
                disabled={isSharing}
                className="rounded-md p-1.5 text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text disabled:opacity-50"
                title="Paylaş"
              >
                <Share2 size={15} className={cn(isSharing && 'animate-pulse')} />
              </button>
              {activeShareId && (
                <button
                  data-testid="revoke-document-share"
                  type="button"
                  onClick={handleRevokeShare}
                  disabled={isSharing}
                  className="rounded-md p-1.5 text-theme-text-muted hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50"
                  title="Paylaşımı iptal et"
                >
                  <X size={15} />
                </button>
              )}
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-2 rounded-md bg-theme-primary px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-theme-primary-fg shadow-sm hover:bg-theme-primary-hover"
              >
                <Download size={12} />
                <span className="hidden sm:inline">İndir</span>
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-theme-bg p-4 transition-colors duration-300 sm:p-6">
        <div className="mx-auto max-w-5xl">
          <AnimatePresence mode="wait">
            {isLoadingWorkspace ? (
              <LoadingState />
            ) : !documentContent && !isGeneratingDocument && !isDiscussing ? (
              <ChatFirstEmptyState hasMessages={hasMessages} />
            ) : !documentContent && (isGeneratingDocument || isDiscussing) ? (
              <GeneratingState isDiscussing={isDiscussing} />
            ) : (
              <motion.div
                data-testid="document-panel-content"
                key={safeActiveTab}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative rounded-2xl border border-theme-border/50 bg-theme-surface p-4 shadow-lg sm:p-8"
              >
                <div className="absolute left-0 right-0 top-0 h-1 rounded-t-2xl bg-theme-primary opacity-80" />

                <div className="mb-6 flex items-start justify-between gap-4 border-b border-theme-border/50 pb-4 sm:mb-8">
                  <div>
                    <h2 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight text-theme-text">
                      {safeActiveTab === 'Review' ? 'Değerlendirme' : 'BA Analiz'} Raporu
                      <span className={cn('rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest', getStatusClass(currentStatus))}>
                        {getStatusLabel(currentStatus)}
                      </span>
                    </h2>
                    {effectiveScoreExplanation && (
                      <p className="mt-3 text-sm leading-relaxed text-theme-text-muted">{effectiveScoreExplanation}</p>
                    )}
                  </div>
                  {(isGenerating || isDiscussing) && (
                    <div className="flex items-center gap-2 text-xs font-medium text-theme-primary animate-pulse">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-theme-primary border-t-transparent" />
                      {isDiscussing ? 'Tartışılıyor...' : 'Güncelleniyor...'}
                    </div>
                  )}
                </div>

                {currentFlags.length > 0 && (
                  <div className="mb-8 rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-red-600">
                      <AlertTriangle size={16} /> Kalite Kapısı / Revizyon Notları
                    </h4>
                    <ul className="space-y-2">
                      {currentFlags.map((flag, index) => (
                        <li key={`${flag}-${index}`} className="text-sm text-theme-text opacity-90">• {flag}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {quickActions.length > 0 && onQuickAction && !isEditing && (
                  <div className="mb-8 border-b border-theme-border/50 pb-5">
                    <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-theme-text-muted">
                      <Wand2 size={14} className="text-theme-primary" /> Hızlı Aksiyonlar
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {quickActions.map((action, index) => (
                        <button
                          key={`${action}-${index}`}
                          type="button"
                          onClick={() => onQuickAction(buildQuickActionPrompt(action))}
                          className="inline-flex items-center gap-1.5 rounded-md border border-theme-border bg-theme-bg px-3 py-1.5 text-xs font-medium text-theme-text transition-colors hover:border-theme-primary/60 hover:bg-theme-surface-hover"
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

      <DocumentVersionHistory
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        versions={versions}
        currentVersionId={head.currentVersionId}
        currentDocument={documentContent}
        isLoading={isVersionLoading}
        isRestoring={isRestoring}
        error={versionError}
        onRefresh={refreshVersions}
        onRestore={handleRestoreVersion}
      />
    </div>
  );
}

function EmptyContent() {
  return (
    <div className="rounded-xl border border-dashed border-theme-border p-8 text-center text-sm text-theme-text-muted">
      Bu bölüm henüz doldurulmadı. Düzenle butonuyla içerik ekleyebilir veya chat üzerinden Jetwork AI'dan bölümü hazırlamasını isteyebilirsiniz.
    </div>
  );
}

function ChatFirstEmptyState({ hasMessages }: { hasMessages: boolean }) {
  return (
    <motion.div
      key="empty"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="flex h-[60vh] flex-col items-center justify-center rounded-2xl border border-dashed border-theme-border/50 bg-theme-surface text-center shadow-sm"
    >
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-xl border border-theme-border/50 bg-theme-bg shadow-sm">
        <FileText size={24} className="text-theme-text-muted" />
      </div>
      <h3 className="mb-2 text-lg font-semibold tracking-tight text-theme-text">Chat ile BA Analiz Oluşturun</h3>
      <p className="max-w-md text-sm leading-relaxed text-theme-text-muted">
        BA Analiz ve Review bölümleri TipTap editöründe düzenlenebilir ve her anlamlı kayıt yeni bir sürüm oluşturur.
      </p>
      {!hasMessages && <p className="mt-4 text-xs text-theme-text-muted">Başlamak için sol taraftaki chat alanına talebinizi yazın.</p>}
    </motion.div>
  );
}

function LoadingState() {
  return (
    <motion.div
      key="loading"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-8 rounded-2xl border border-theme-border/50 bg-theme-surface p-8 shadow-sm animate-pulse"
    >
      <div className="h-8 w-1/3 rounded-lg bg-theme-border/50" />
      <div className="space-y-4">
        <div className="h-4 w-full rounded bg-theme-border/30" />
        <div className="h-4 w-5/6 rounded bg-theme-border/30" />
        <div className="h-4 w-4/6 rounded bg-theme-border/30" />
      </div>
    </motion.div>
  );
}

function GeneratingState({ isDiscussing }: { isDiscussing: boolean }) {
  return (
    <motion.div
      key="generating"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-[60vh] flex-col items-center justify-center text-center"
    >
      <div className="relative mb-6 h-12 w-12">
        <div className="absolute inset-0 rounded-full border-2 border-theme-border/50" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-theme-primary border-t-transparent" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight text-theme-text">
        {isDiscussing ? 'Analiz Ediliyor' : 'BA Analiz Hazırlanıyor'}
      </h3>
      <p className="mt-2 text-sm text-theme-text-muted">
        Jetwork AI konuşma bağlamını analiz ediyor ve BA analiz bölümünü yapılandırıyor...
      </p>
    </motion.div>
  );
}
