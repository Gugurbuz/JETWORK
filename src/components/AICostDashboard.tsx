import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  DollarSign,
  Gauge,
  RefreshCw,
  Search,
  Users,
  XCircle,
} from 'lucide-react';
import { supabase } from '../supabase';

type CostTarget = {
  label: string;
  value: number;
  target: number;
  pass: boolean;
};

type CostMetrics = {
  generatedAt: string;
  scope: 'global' | 'user';
  viewerRole: string | null;
  periodDays: number;
  sampled: boolean;
  sampledRows: number;
  periodRowCount: number;
  summary: {
    turnsTotal: number;
    completed: number;
    nonCompleted: number;
    activeOwners: number;
    trackedTokenCostUsd: number;
    avgCostUsd: number;
    p50CostUsd: number;
    p95CostUsd: number;
    p99CostUsd: number;
    avgInputTokens: number;
    avgOutputTokens: number;
    avgReasoningTokens: number;
    avgProviderCalls: number;
    proTurns: number;
    proShare: number;
    webTurns: number;
    webTurnShare: number;
    retryTurns: number;
    multiCall3PlusTurns: number;
    multiCall3PlusShare: number;
    multiCall3PlusCostUsd: number;
  };
  search: {
    month: string;
    providerWebRequestLowerBound: number;
    monthlyFreeRequestsAssumption: number;
    pricePer1kUsdAssumption: number;
    billableRequestLowerBound: number;
    estimatedCostLowerBoundUsd: number;
    note: string;
  };
  targets: {
    avgCost: CostTarget;
    p95Cost: CostTarget;
    proShare: CostTarget;
    multiCallShare: CostTarget;
  };
  daily: Array<{
    date: string;
    turns: number;
    completed: number;
    costUsd: number;
    proTurns: number;
    webTurns: number;
  }>;
  models: Array<{
    model: string;
    turns: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    providerCalls: number;
    avgCostUsd: number;
    costShare: number;
    avgProviderCalls: number;
  }>;
  topUsers: Array<{
    ownerId: string;
    displayName: string;
    turns: number;
    completed: number;
    costUsd: number;
  }>;
};

const money = (value: number, maxDigits = 4) => `$${Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: value > 0 && value < 0.01 ? maxDigits : 2,
  maximumFractionDigits: maxDigits,
})}`;

const compactNumber = (value: number) => Number(value || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 });
const percent = (value: number) => `%${(Number(value || 0) * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`;

const targetValue = (target: CostTarget) => target.label.includes('oran') || target.label.includes('turn') && target.target < 1
  ? (target.label.includes('Ortalama') || target.label.includes('P95') ? money(target.value) : percent(target.value))
  : String(target.value);

const targetLimit = (target: CostTarget) => target.label.includes('Ortalama') || target.label.includes('P95')
  ? `≤ ${money(target.target)}`
  : `≤ ${percent(target.target)}`;

function MetricCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-theme-border bg-theme-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted">{label}</span>
        <span className="text-theme-primary">{icon}</span>
      </div>
      <div className="text-2xl font-bold tracking-tight text-theme-text">{value}</div>
      <div className="mt-1 text-xs text-theme-text-muted">{detail}</div>
    </div>
  );
}

export function AICostDashboard() {
  const [periodDays, setPeriodDays] = useState<7 | 30 | 90>(30);
  const [metrics, setMetrics] = useState<CostMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('assistant-cost-metrics', {
        body: { periodDays },
      });
      if (invokeError) throw invokeError;
      if (!data || data.error) throw new Error(data?.error || 'Maliyet metrikleri alınamadı.');
      setMetrics(data as CostMetrics);
    } catch (err) {
      console.error('Failed to load assistant cost metrics:', err);
      setError(err instanceof Error ? err.message : 'Maliyet metrikleri alınamadı.');
    } finally {
      setLoading(false);
    }
  }, [periodDays]);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const targetEntries = useMemo(() => metrics ? Object.values(metrics.targets) : [], [metrics]);
  const targetPassCount = targetEntries.filter(item => item.pass).length;
  const visibleDaily = useMemo(() => metrics?.daily.slice(Math.max(0, metrics.daily.length - 30)) || [], [metrics]);
  const maxDailyCost = Math.max(0.001, ...visibleDaily.map(item => item.costUsd));

  if (loading && !metrics) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-theme-text-muted">
          <RefreshCw size={18} className="animate-spin text-theme-primary" />
          AI maliyetleri hesaplanıyor...
        </div>
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
        <div className="flex items-center gap-2 font-semibold text-theme-text">
          <AlertTriangle size={18} className="text-red-500" />
          Maliyet verisi yüklenemedi
        </div>
        <p className="mt-2 text-sm text-theme-text-muted">{error}</p>
        <button
          type="button"
          onClick={() => void loadMetrics()}
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-theme-primary px-3 py-2 text-sm font-semibold text-theme-primary-fg"
        >
          <RefreshCw size={15} /> Tekrar dene
        </button>
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="space-y-5" data-testid="ai-cost-dashboard">
      <div className="flex flex-col gap-3 rounded-xl border border-theme-border bg-theme-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <DollarSign size={18} className="text-theme-primary" />
            <h3 className="font-bold text-theme-text">AI Maliyet Kontrolü</h3>
          </div>
          <p className="mt-1 text-xs text-theme-text-muted">
            {metrics.scope === 'global' ? 'Ürün geneli' : 'Kendi kullanımınız'} · Son {metrics.periodDays} gün · Token maliyeti + web arama alt sınır tahmini
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-theme-border bg-theme-bg p-1">
            {([7, 30, 90] as const).map(days => (
              <button
                key={days}
                type="button"
                onClick={() => setPeriodDays(days)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${periodDays === days ? 'bg-theme-primary text-theme-primary-fg' : 'text-theme-text-muted hover:text-theme-text'}`}
              >
                {days}G
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void loadMetrics()}
            disabled={loading}
            className="rounded-lg border border-theme-border bg-theme-bg p-2 text-theme-text-muted transition-colors hover:text-theme-text disabled:opacity-50"
            title="Yenile"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {metrics.sampled && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-theme-text-muted">
          Bu görünüm {compactNumber(metrics.periodRowCount)} kaydın en güncel {compactNumber(metrics.sampledRows)} tanesi üzerinden örneklenmiştir. Büyük hacimde günlük aggregate tabloya geçilmelidir.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<DollarSign size={18} />} label="Token maliyeti" value={money(metrics.summary.trackedTokenCostUsd)} detail={`${compactNumber(metrics.summary.completed)} tamamlanan turn`} />
        <MetricCard icon={<Gauge size={18} />} label="Ortalama / turn" value={money(metrics.summary.avgCostUsd)} detail={`P50 ${money(metrics.summary.p50CostUsd)} · P95 ${money(metrics.summary.p95CostUsd)}`} />
        <MetricCard icon={<Activity size={18} />} label="Provider çağrısı" value={metrics.summary.avgProviderCalls.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} detail={`${compactNumber(metrics.summary.multiCall3PlusTurns)} turn 3+ çağrı`} />
        <MetricCard icon={<Users size={18} />} label="Aktif kullanıcı" value={compactNumber(metrics.summary.activeOwners)} detail={`${compactNumber(metrics.summary.turnsTotal)} toplam turn`} />
      </div>

      <div className="rounded-xl border border-theme-border bg-theme-surface p-4">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-semibold text-theme-text">
              <Gauge size={17} className="text-theme-primary" />
              Sürdürülebilirlik hedefleri
            </div>
            <p className="mt-1 text-xs text-theme-text-muted">Hedef: ortalama ≤ $0.01, P95 ≤ $0.04, Pro ≤ %15, 3+ çağrı ≤ %5.</p>
          </div>
          <div className={`rounded-full px-3 py-1 text-xs font-bold ${targetPassCount === targetEntries.length ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
            {targetPassCount}/{targetEntries.length} hedef sağlanıyor
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {targetEntries.map(target => (
            <div key={target.label} className="rounded-lg border border-theme-border bg-theme-bg p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-theme-text-muted">{target.label}</span>
                {target.pass ? <CheckCircle2 size={16} className="text-emerald-500" /> : <XCircle size={16} className="text-amber-500" />}
              </div>
              <div className="mt-2 text-lg font-bold text-theme-text">{targetValue(target)}</div>
              <div className="mt-1 text-xs text-theme-text-muted">Hedef {targetLimit(target)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="rounded-xl border border-theme-border bg-theme-surface p-4">
          <div className="mb-4 flex items-center gap-2 font-semibold text-theme-text">
            <BarChart3 size={17} className="text-theme-primary" />
            Günlük token maliyeti
          </div>
          <div className="flex h-44 items-end gap-1.5 overflow-hidden">
            {visibleDaily.map(item => {
              const height = Math.max(3, (item.costUsd / maxDailyCost) * 100);
              return (
                <div key={item.date} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${item.date}: ${money(item.costUsd)} · ${item.completed} turn`}>
                  <div className="relative flex h-36 w-full items-end rounded-sm bg-theme-bg">
                    <div className="w-full rounded-sm bg-theme-primary/70 transition-all group-hover:bg-theme-primary" style={{ height: `${height}%` }} />
                  </div>
                  <span className="hidden text-[9px] text-theme-text-muted md:block">{item.date.slice(5).replace('-', '/')}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-theme-border bg-theme-surface p-4">
          <div className="mb-4 flex items-center gap-2 font-semibold text-theme-text">
            <Search size={17} className="text-theme-primary" />
            Web arama maliyeti
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-theme-bg p-3">
              <div className="text-xs text-theme-text-muted">Provider web çağrısı</div>
              <div className="mt-1 text-xl font-bold text-theme-text">{compactNumber(metrics.search.providerWebRequestLowerBound)}</div>
            </div>
            <div className="rounded-lg bg-theme-bg p-3">
              <div className="text-xs text-theme-text-muted">Tahmini ek maliyet</div>
              <div className="mt-1 text-xl font-bold text-theme-text">{money(metrics.search.estimatedCostLowerBoundUsd)}</div>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-theme-text-muted">{metrics.search.note}</p>
          <p className="mt-2 text-[11px] text-theme-text-muted">
            Varsayım: ayda {compactNumber(metrics.search.monthlyFreeRequestsAssumption)} ücretsiz istek, sonrasında {money(metrics.search.pricePer1kUsdAssumption, 2)}/1K.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-theme-border bg-theme-surface overflow-hidden">
        <div className="border-b border-theme-border px-4 py-3">
          <h4 className="font-semibold text-theme-text">Model maliyet dağılımı</h4>
          <p className="mt-1 text-xs text-theme-text-muted">Pahalı model ve çoklu çağrı etkisini doğrudan görün.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-theme-bg text-left text-xs uppercase tracking-wider text-theme-text-muted">
              <tr>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3 text-right">Turn</th>
                <th className="px-4 py-3 text-right">Toplam</th>
                <th className="px-4 py-3 text-right">Ort./turn</th>
                <th className="px-4 py-3 text-right">Maliyet payı</th>
                <th className="px-4 py-3 text-right">Ort. çağrı</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-border">
              {metrics.models.map(model => (
                <tr key={model.model}>
                  <td className="px-4 py-3 font-medium text-theme-text">{model.model}</td>
                  <td className="px-4 py-3 text-right text-theme-text-muted">{compactNumber(model.turns)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-theme-text">{money(model.costUsd)}</td>
                  <td className="px-4 py-3 text-right text-theme-text-muted">{money(model.avgCostUsd)}</td>
                  <td className="px-4 py-3 text-right text-theme-text-muted">{percent(model.costShare)}</td>
                  <td className="px-4 py-3 text-right text-theme-text-muted">{model.avgProviderCalls.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
              {metrics.models.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-theme-text-muted">Bu dönemde tamamlanan AI turnü yok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-theme-border bg-theme-surface p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted">Pro kullanımı</div>
          <div className="mt-2 text-2xl font-bold text-theme-text">{percent(metrics.summary.proShare)}</div>
          <div className="mt-1 text-xs text-theme-text-muted">{compactNumber(metrics.summary.proTurns)} turn</div>
        </div>
        <div className="rounded-xl border border-theme-border bg-theme-surface p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted">3+ çağrılı turn</div>
          <div className="mt-2 text-2xl font-bold text-theme-text">{percent(metrics.summary.multiCall3PlusShare)}</div>
          <div className="mt-1 text-xs text-theme-text-muted">Maliyet: {money(metrics.summary.multiCall3PlusCostUsd)}</div>
        </div>
        <div className="rounded-xl border border-theme-border bg-theme-surface p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted">Reasoning ortalaması</div>
          <div className="mt-2 text-2xl font-bold text-theme-text">{compactNumber(metrics.summary.avgReasoningTokens)}</div>
          <div className="mt-1 text-xs text-theme-text-muted">Input {compactNumber(metrics.summary.avgInputTokens)} · Output {compactNumber(metrics.summary.avgOutputTokens)}</div>
        </div>
      </div>

      {metrics.scope === 'global' && metrics.topUsers.length > 1 && (
        <div className="rounded-xl border border-theme-border bg-theme-surface overflow-hidden">
          <div className="border-b border-theme-border px-4 py-3">
            <h4 className="font-semibold text-theme-text">En yüksek AI maliyeti oluşturan kullanıcılar</h4>
          </div>
          <div className="divide-y divide-theme-border">
            {metrics.topUsers.map(user => (
              <div key={user.ownerId} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-theme-text">{user.displayName}</div>
                  <div className="text-xs text-theme-text-muted">{compactNumber(user.completed)} tamamlanan / {compactNumber(user.turns)} turn</div>
                </div>
                <div className="font-semibold text-theme-text">{money(user.costUsd)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-[11px] leading-relaxed text-theme-text-muted">
        Son hesaplama: {new Date(metrics.generatedAt).toLocaleString('tr-TR')}. Token maliyeti `assistant_turns.usage.estimated_cost_usd` telemetrisinden gelir. Web arama maliyeti gerçek provider query sayısı kaydedilene kadar alt sınır tahminidir.
      </div>
    </div>
  );
}
