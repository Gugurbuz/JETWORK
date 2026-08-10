import React from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  Globe2,
  Loader2,
  RefreshCw,
  Search,
  ServerCog,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  formatLatency,
  loadReasoningDebugRun,
  loadReasoningDebugRuns,
  providerLabel,
  totalUsageTokens,
  type ReasoningDebugRunDetail,
  type ReasoningDebugRunSummary,
  type ReasoningUsageStage,
} from '../services/reasoningObservability';

interface ReasoningDebugModalProps {
  open: boolean;
  onClose: () => void;
  currentWorkspaceId?: string | null;
}

const intentLabel: Record<string, string> = {
  simple_answer: 'Basit yanıt',
  sap_diagnosis: 'SAP teşhis',
  research: 'Araştırma',
  analysis: 'Analiz',
  document: 'Doküman',
  decision: 'Karar',
  project: 'Proje',
};

const statusTone = (status: string) => {
  if (status === 'completed') return 'text-emerald-600 bg-emerald-500/10';
  if (status === 'failed') return 'text-red-600 bg-red-500/10';
  return 'text-amber-600 bg-amber-500/10';
};

const complexityTone = (complexity: string) => {
  if (complexity === 'high') return 'text-red-600 bg-red-500/10';
  if (complexity === 'medium') return 'text-amber-600 bg-amber-500/10';
  return 'text-theme-text-muted bg-theme-surface-hover';
};

const formatDate = (value?: string) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'medium' });
};

const formatUsd = (value?: number) => {
  if (!Number.isFinite(value)) return '—';
  const amount = value as number;
  return `$${amount.toFixed(amount < 0.01 ? 6 : 4)}`;
};

const JsonBlock = ({ value }: { value: unknown }) => (
  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-theme-bg p-3 text-[11px] leading-relaxed text-theme-text-muted ring-1 ring-theme-border/50">
    {JSON.stringify(value ?? {}, null, 2)}
  </pre>
);

const Metric = ({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) => (
  <div className="rounded-xl border border-theme-border/60 bg-theme-surface p-3">
    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-theme-text-muted">
      {icon}{label}
    </div>
    <div className="text-sm font-semibold text-theme-text">{value}</div>
  </div>
);

const UsageStageCard = ({ label, stage }: { label: string; stage: ReasoningUsageStage }) => (
  <div className="rounded-xl border border-theme-border/60 bg-theme-surface p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="text-xs font-semibold text-theme-text">{label}</div>
      <span className="rounded-full bg-theme-surface-hover px-2 py-0.5 text-[10px] text-theme-text-muted">
        {stage.calls ?? 0} çağrı
      </span>
    </div>
    <div className="mt-2 text-lg font-semibold text-theme-text">{stage.totalTokens.toLocaleString('tr-TR')} token</div>
    <div className="mt-1 text-xs font-medium text-theme-text-muted">{formatUsd(stage.estimatedCostUsd)}</div>
    <div className="mt-2 text-[10px] leading-relaxed text-theme-text-muted">
      input {stage.inputTokens.toLocaleString('tr-TR')} · output {stage.outputTokens.toLocaleString('tr-TR')} · reasoning {stage.reasoningTokens.toLocaleString('tr-TR')}
    </div>
  </div>
);

function RunListItem({
  run,
  selected,
  onSelect,
}: {
  key?: React.Key;
  run: ReasoningDebugRunSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const tokenCount = totalUsageTokens(run.usage);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-2xl border p-3 text-left transition-colors',
        selected
          ? 'border-theme-primary/50 bg-theme-primary/5'
          : 'border-theme-border/60 bg-theme-surface hover:bg-theme-surface-hover',
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-theme-text">
            {intentLabel[run.intent] || run.intent || 'Reasoning turn'}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-theme-text-muted">{run.messageId}</div>
        </div>
        <ChevronRight size={15} className="mt-1 shrink-0 text-theme-text-muted" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className={cn('rounded-full px-2 py-1 font-medium', statusTone(run.status))}>{run.status}</span>
        <span className={cn('rounded-full px-2 py-1 font-medium', complexityTone(run.complexity))}>{run.complexity}</span>
        {run.knowledgeUsed && <span className="rounded-full bg-theme-surface-hover px-2 py-1 text-theme-text-muted">KB</span>}
        {run.webUsed && <span className="rounded-full bg-theme-surface-hover px-2 py-1 text-theme-text-muted">Web</span>}
        {run.fallbackUsed && <span className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-600">Fallback</span>}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-theme-text-muted">
        <span>{formatLatency(run.latencyMs)}</span>
        <span>{run.toolCallCount} tool</span>
        <span>{tokenCount == null ? '— runtime token' : `${tokenCount.toLocaleString('tr-TR')} runtime token`}</span>
      </div>
      <div className="mt-2 text-[10px] text-theme-text-muted">{formatDate(run.startedAt)}</div>
    </button>
  );
}

function DetailView({ detail, loading }: { detail: ReasoningDebugRunDetail | null; loading: boolean }) {
  if (loading) {
    return <div className="grid h-full place-items-center text-theme-text-muted"><Loader2 className="animate-spin" size={22} /></div>;
  }
  if (!detail) {
    return <div className="grid h-full place-items-center px-6 text-center text-sm text-theme-text-muted">Detayını görmek için bir reasoning turn seç.</div>;
  }

  const tokenCount = totalUsageTokens(detail.usage);
  const breakdown = detail.usageBreakdown;
  const combinedTokens = breakdown?.combined.totalTokens ?? tokenCount;
  const combinedCost = breakdown?.combined.estimatedCostUsd
    ?? detail.usage.estimated_total_cost_usd
    ?? detail.usage.estimated_cost_usd;

  return (
    <div className="h-full overflow-y-auto px-4 pb-8 pt-4 md:px-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-theme-text">{intentLabel[detail.intent] || detail.intent}</h3>
            <span className={cn('rounded-full px-2 py-1 text-[10px] font-medium', statusTone(detail.status))}>{detail.status}</span>
            <span className={cn('rounded-full px-2 py-1 text-[10px] font-medium', complexityTone(detail.complexity))}>{detail.complexity}</span>
          </div>
          <p className="mt-1 text-xs text-theme-text-muted">{detail.engineVersion} · {detail.runId}</p>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="Provider / model" value={`${providerLabel(detail.provider, detail.responseModel)} · ${detail.responseModel || detail.selectedModel || '—'}`} icon={<ServerCog size={12} />} />
        <Metric label="Latency" value={formatLatency(detail.latencyMs)} icon={<Clock3 size={12} />} />
        <Metric label="Combined token" value={combinedTokens == null ? '—' : combinedTokens.toLocaleString('tr-TR')} icon={<Sparkles size={12} />} />
        <Metric label="Tahmini maliyet" value={formatUsd(combinedCost)} icon={<Sparkles size={12} />} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="Knowledge" value={detail.knowledgeUsed ? 'Kullanıldı' : 'Kullanılmadı'} icon={<Database size={12} />} />
        <Metric label="Web" value={detail.webUsed ? 'Kullanıldı' : 'Kullanılmadı'} icon={<Globe2 size={12} />} />
        <Metric label="Tool calls" value={detail.toolCallCount} icon={<Wrench size={12} />} />
        <Metric label="Fallback" value={detail.fallbackUsed ? 'Evet' : 'Hayır'} icon={<RefreshCw size={12} />} />
      </div>

      {breakdown && (
        <section className="mb-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-theme-text"><Sparkles size={14} /> Token / maliyet kırılımı</div>
            {(breakdown.runtime.deterministicKnowledgeDispatches || breakdown.runtime.providerCallsAvoided) ? (
              <div className="text-[10px] text-theme-text-muted">
                {breakdown.runtime.deterministicKnowledgeDispatches || 0} deterministik knowledge · {breakdown.runtime.providerCallsAvoided || 0} provider çağrısı önlendi
              </div>
            ) : null}
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <UsageStageCard label="Semantic planner" stage={breakdown.semanticPlanner} />
            <UsageStageCard label="Agent kararları" stage={breakdown.agent} />
            <UsageStageCard label="Final synthesis" stage={breakdown.finalSynthesis} />
            <div className="rounded-xl border border-theme-primary/30 bg-theme-primary/5 p-3">
              <div className="text-xs font-semibold text-theme-text">Combined</div>
              <div className="mt-2 text-lg font-semibold text-theme-text">{breakdown.combined.totalTokens.toLocaleString('tr-TR')} token</div>
              <div className="mt-1 text-xs font-medium text-theme-text-muted">{formatUsd(breakdown.combined.estimatedCostUsd)}</div>
              <div className="mt-2 text-[10px] leading-relaxed text-theme-text-muted">
                Planner + tüm runtime provider çağrılarının toplamı. Embedding maliyeti ayrıca provider telemetry’sinde izlenir.
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="mb-6 grid grid-cols-1 gap-2 md:grid-cols-2">
        <Metric label="Artifact" value={detail.artifact ? `${detail.artifact.status}${detail.artifact.documentVersionNumber ? ` · v${detail.artifact.documentVersionNumber}` : ''}` : 'Yok'} icon={<BrainCircuit size={12} />} />
        <Metric label="Runtime token" value={tokenCount == null ? '—' : tokenCount.toLocaleString('tr-TR')} icon={<Sparkles size={12} />} />
      </div>

      {detail.errorMessage && (
        <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-600">
          <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle size={15} /> Hata</div>
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{detail.errorMessage}</p>
        </div>
      )}

      <section className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-theme-text"><BrainCircuit size={14} /> Plan</div>
        <JsonBlock value={detail.plan} />
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-theme-text"><Database size={14} /> Evidence / kaynaklar</div>
        <div className="grid gap-2 md:grid-cols-2">
          <JsonBlock value={detail.evidenceSummary} />
          <JsonBlock value={detail.sourceRefs} />
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-theme-text"><Wrench size={14} /> Tool çağrıları</div>
        {detail.toolRuns.length === 0 ? (
          <div className="rounded-xl border border-theme-border/60 bg-theme-surface p-3 text-xs text-theme-text-muted">Bu turn’de tool çağrısı yok.</div>
        ) : (
          <div className="space-y-2">
            {detail.toolRuns.map(tool => (
              <details key={tool.id || tool.callId} className="rounded-xl border border-theme-border/60 bg-theme-surface p-3">
                <summary className="cursor-pointer list-none text-xs font-medium text-theme-text">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate">{tool.toolName}</span>
                    <span className="shrink-0 text-[10px] text-theme-text-muted">{tool.status} · {formatLatency(tool.durationMs)}</span>
                  </div>
                </summary>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <JsonBlock value={{ arguments: tool.arguments, resultSummary: tool.resultSummary }} />
                  <JsonBlock value={{ sourceRefs: tool.sourceRefs, errorMessage: tool.errorMessage }} />
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-theme-text"><CheckCircle2 size={14} /> Verification</div>
        <JsonBlock value={detail.verification} />
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-theme-text"><ServerCog size={14} /> Execution trace</div>
        <JsonBlock value={detail.executionTrace} />
      </section>

      <section>
        <div className="mb-2 text-xs font-semibold text-theme-text">Runtime meta</div>
        <JsonBlock value={{
          selectedModel: detail.selectedModel,
          responseModel: detail.responseModel,
          provider: detail.provider,
          usage: detail.usage,
          usageBreakdown: detail.usageBreakdown,
          startedAt: detail.startedAt,
          completedAt: detail.completedAt,
          artifact: detail.artifact,
          workspaceId: detail.workspaceId,
          conversationId: detail.conversationId,
          turnId: detail.turnId,
          messageId: detail.messageId,
        }} />
      </section>
    </div>
  );
}

export function ReasoningDebugModal({ open, onClose, currentWorkspaceId }: ReasoningDebugModalProps) {
  const [scope, setScope] = React.useState<'current' | 'all'>(currentWorkspaceId ? 'current' : 'all');
  const [runs, setRuns] = React.useState<ReasoningDebugRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<ReasoningDebugRunDetail | null>(null);
  const [loadingRuns, setLoadingRuns] = React.useState(false);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [intent, setIntent] = React.useState('all');
  const [status, setStatus] = React.useState('all');

  const loadRuns = React.useCallback(async () => {
    if (!open) return;
    setLoadingRuns(true);
    setError(null);
    try {
      const rows = await loadReasoningDebugRuns({
        workspaceId: scope === 'current' ? currentWorkspaceId : null,
        limit: 100,
      });
      setRuns(rows);
      if (selectedRunId && !rows.some(row => row.runId === selectedRunId)) {
        setSelectedRunId(null);
        setDetail(null);
      }
    } catch (loadError) {
      console.error('Reasoning debug runs could not be loaded:', loadError);
      setError('Reasoning kayıtları yüklenemedi. Migration/deploy durumunu ve yetkileri kontrol edin.');
    } finally {
      setLoadingRuns(false);
    }
  }, [currentWorkspaceId, open, scope, selectedRunId]);

  React.useEffect(() => {
    if (open) void loadRuns();
  }, [loadRuns, open]);

  React.useEffect(() => {
    if (!open || !selectedRunId) return;
    let active = true;
    setLoadingDetail(true);
    setDetail(null);
    void loadReasoningDebugRun(selectedRunId)
      .then(result => {
        if (active) setDetail(result);
      })
      .catch(loadError => {
        console.error('Reasoning debug detail could not be loaded:', loadError);
        if (active) setError('Reasoning turn detayı yüklenemedi.');
      })
      .finally(() => {
        if (active) setLoadingDetail(false);
      });
    return () => { active = false; };
  }, [open, selectedRunId]);

  React.useEffect(() => {
    if (!currentWorkspaceId && scope === 'current') setScope('all');
  }, [currentWorkspaceId, scope]);

  const filteredRuns = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr-TR');
    return runs.filter(run => {
      if (intent !== 'all' && run.intent !== intent) return false;
      if (status !== 'all' && run.status !== status) return false;
      if (!normalized) return true;
      return [run.intent, run.complexity, run.status, run.messageId, run.responseModel, run.errorMessage]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR')
        .includes(normalized);
    });
  }, [intent, query, runs, status]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-0 backdrop-blur-[2px] md:p-6" role="dialog" aria-modal="true" aria-label="Reasoning Debug">
      <div className="flex h-full w-full flex-col overflow-hidden bg-theme-bg md:h-[92vh] md:max-w-7xl md:rounded-3xl md:border md:border-theme-border/70 md:shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-theme-border/60 px-4 py-3 md:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-theme-text"><BrainCircuit size={17} /> Reasoning Debug</div>
            <p className="mt-0.5 truncate text-[10px] text-theme-text-muted">Operasyonel trace, kaynak, tool ve model metadatası · gizli chain-of-thought gösterilmez</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void loadRuns()} className="grid h-9 w-9 place-items-center rounded-xl text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text" aria-label="Yenile" title="Yenile">
              <RefreshCw size={16} className={loadingRuns ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text" aria-label="Kapat" title="Kapat">
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="flex max-h-[45vh] min-h-0 w-full shrink-0 flex-col border-b border-theme-border/60 bg-theme-surface/30 md:max-h-none md:w-[360px] md:border-b-0 md:border-r">
            <div className="space-y-2 border-b border-theme-border/60 p-3">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-theme-surface p-1">
                <button type="button" disabled={!currentWorkspaceId} onClick={() => setScope('current')} className={cn('rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors', scope === 'current' ? 'bg-theme-bg text-theme-text shadow-sm' : 'text-theme-text-muted', !currentWorkspaceId && 'opacity-40')}>Aktif sohbet</button>
                <button type="button" onClick={() => setScope('all')} className={cn('rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors', scope === 'all' ? 'bg-theme-bg text-theme-text shadow-sm' : 'text-theme-text-muted')}>Tümü</button>
              </div>

              <div className="relative">
                <Search size={14} className="absolute left-3 top-2.5 text-theme-text-muted" />
                <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Intent, message id, model ara" className="w-full rounded-xl bg-theme-surface py-2 pl-9 pr-3 text-xs text-theme-text outline-none ring-1 ring-theme-border/60 focus:ring-theme-text-muted/40" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select value={intent} onChange={event => setIntent(event.target.value)} className="rounded-xl bg-theme-surface px-2 py-2 text-[11px] text-theme-text outline-none ring-1 ring-theme-border/60">
                  <option value="all">Tüm intent'ler</option>
                  {Object.entries(intentLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select value={status} onChange={event => setStatus(event.target.value)} className="rounded-xl bg-theme-surface px-2 py-2 text-[11px] text-theme-text outline-none ring-1 ring-theme-border/60">
                  <option value="all">Tüm durumlar</option>
                  <option value="completed">completed</option>
                  <option value="running">running</option>
                  <option value="failed">failed</option>
                </select>
              </div>
            </div>

            {error && (
              <div className="m-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-600">{error}</div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {loadingRuns && runs.length === 0 ? (
                <div className="grid h-32 place-items-center text-theme-text-muted"><Loader2 className="animate-spin" size={20} /></div>
              ) : filteredRuns.length === 0 ? (
                <div className="grid h-32 place-items-center px-4 text-center text-xs text-theme-text-muted">Bu filtrelerde reasoning kaydı yok.</div>
              ) : (
                <div className="space-y-2">
                  {filteredRuns.map(run => (
                    <RunListItem key={run.runId} run={run} selected={run.runId === selectedRunId} onSelect={() => setSelectedRunId(run.runId)} />
                  ))}
                </div>
              )}
            </div>
          </aside>

          <main className="min-h-0 min-w-0 flex-1">
            <DetailView detail={detail} loading={loadingDetail} />
          </main>
        </div>
      </div>
    </div>
  );
}
