import { Brain, CheckCircle2, X, XCircle } from 'lucide-react';
import type { CanonicalContextDebugSnapshot } from '../services/ai/canonicalProjectContext';

interface ContextDebugPanelProps {
  snapshot: CanonicalContextDebugSnapshot | null;
  onClose: () => void;
}

export function ContextDebugPanel({ snapshot, onClose }: ContextDebugPanelProps) {
  return (
    <aside
      data-testid="context-debug-panel"
      className="absolute right-3 top-[4.5rem] z-50 flex max-h-[calc(100%-5.5rem)] w-[390px] flex-col overflow-hidden rounded-xl border border-theme-border bg-theme-bg shadow-2xl"
    >
      <div className="flex items-center gap-3 border-b border-theme-border px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
          <Brain size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-theme-text">Project Brain</h2>
          <p className="truncate text-[10px] text-theme-text-muted">
            {snapshot ? `Workspace: ${snapshot.workspaceId}` : 'Henüz bağlam snapshot’ı oluşturulmadı'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-theme-text-muted transition-colors hover:bg-theme-surface hover:text-theme-text"
          aria-label="Bağlam panelini kapat"
        >
          <X size={16} />
        </button>
      </div>

      {!snapshot ? (
        <div className="p-5 text-sm leading-relaxed text-theme-text-muted">
          İlk AI turundan sonra kullanılan mesajlar, doküman omurgası, hafıza ve retrieval kaynakları burada görünür.
        </div>
      ) : (
        <div className="overflow-y-auto p-4">
          <div className="mb-4 grid grid-cols-2 gap-2">
            <Metric label="Token bütçesi" value={snapshot.tokenBudget.toLocaleString('tr-TR')} />
            <Metric label="Tahmini kullanım" value={snapshot.estimatedTokensUsed.toLocaleString('tr-TR')} />
            <Metric label="History" value={`${snapshot.historyMessageCount}/${snapshot.priorMessageCount}`} />
            <Metric label="Özetlenen" value={String(snapshot.summarizedMessageCount)} />
          </div>

          <div className="space-y-2">
            {snapshot.entries
              .slice()
              .sort((left, right) => right.priority - left.priority)
              .map(entry => (
                <div key={entry.source} className="rounded-lg border border-theme-border bg-theme-surface/50 p-3">
                  <div className="flex items-center gap-2">
                    {entry.included
                      ? <CheckCircle2 size={14} className="text-green-500" />
                      : <XCircle size={14} className="text-theme-text-muted" />}
                    <span className="flex-1 text-xs font-semibold text-theme-text">{entry.label}</span>
                    <span className="rounded bg-theme-bg px-1.5 py-0.5 text-[9px] font-bold text-theme-text-muted">
                      P{entry.priority}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-theme-text-muted">
                    <span>{entry.note}</span>
                    <span>~{entry.estimatedTokens} token</span>
                  </div>
                </div>
              ))}
          </div>

          {snapshot.documentSummary && (
            <details className="mt-4 rounded-lg border border-theme-border bg-theme-surface/40">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-theme-text">
                Mevcut doküman omurgası
              </summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-theme-border p-3 text-[10px] leading-relaxed text-theme-text-muted">
                {snapshot.documentSummary}
              </pre>
            </details>
          )}

          {snapshot.conversationSummary && (
            <details className="mt-2 rounded-lg border border-theme-border bg-theme-surface/40">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-theme-text">
                Senkron konuşma özeti
              </summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-theme-border p-3 text-[10px] leading-relaxed text-theme-text-muted">
                {snapshot.conversationSummary}
              </pre>
            </details>
          )}
        </div>
      )}
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-theme-border bg-theme-surface p-2.5">
      <div className="text-[9px] font-medium uppercase tracking-wider text-theme-text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-theme-text">{value}</div>
    </div>
  );
}
