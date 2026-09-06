import React from 'react';
import {
  Activity,
  ArrowLeft,
  Beaker,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Copy,
  Edit3,
  FlaskConical,
  Gauge,
  History,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { supabase } from '../supabase';
import { JetWorkLogo } from './JetWorkLogo';

const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');
const money = (value: unknown) => `$${Number(value || 0).toFixed(4)}`;
const millis = (value: unknown) => `${(Number(value || 0) / 1000).toFixed(1)} sn`;
const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString('tr-TR') : '—';

const ASSERTION_KINDS = [
  ['contains', 'Cevap içerir'],
  ['not_contains', 'Cevap içermez'],
  ['regex', 'Regex eşleşir'],
  ['source_canonical', 'Canonical kaynak'],
  ['source_name', 'Kaynak adı'],
  ['usage_lte', 'Metrik ≤'],
  ['usage_gte', 'Metrik ≥'],
  ['status', 'Turn durumu'],
  ['model_is', 'Model eşittir'],
  ['provider_is', 'Provider eşittir'],
] as const;

const CATEGORIES = ['regression', 'rag', 'grounding', 'follow-up', 'hallucination', 'general-chat', 'artifact', 'web', 'performance', 'cost', 'latency'];
const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
const MODELS = ['auto', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview', 'gpt-5.6-sol'];

interface ScenarioEditorState {
  id?: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  severity: string;
  enabled: boolean;
  model: string;
  project_id: string | null;
  tags: string[];
  steps: Array<{ id?: string; step_no: number; message: string }>;
  assertions: Array<{
    id?: string;
    position: number;
    target_step: number | null;
    kind: string;
    field: string | null;
    expected_text: string | null;
    expected_number: number | null;
    required: boolean;
    enabled: boolean;
  }>;
}

interface SuiteEditorState {
  id?: string;
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  scenarioIds: string[];
}

const emptyScenario = (): ScenarioEditorState => ({
  slug: '',
  name: '',
  description: '',
  category: 'regression',
  severity: 'P1',
  enabled: true,
  model: 'auto',
  project_id: null,
  tags: [],
  steps: [{ step_no: 1, message: '' }],
  assertions: [{
    position: 1,
    target_step: 1,
    kind: 'contains',
    field: null,
    expected_text: '',
    expected_number: null,
    required: true,
    enabled: true,
  }],
});

const slugify = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ı/g, 'i')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 72);

function StatusBadge({ status }: { status: string }) {
  const success = status === 'completed' || status === 'passed';
  const running = status === 'running' || status === 'queued';
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
      success && 'bg-emerald-500/10 text-emerald-600',
      running && 'bg-amber-500/10 text-amber-600',
      !success && !running && 'bg-red-500/10 text-red-600',
    )}>
      {running ? <Loader2 size={12} className="animate-spin" /> : success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
      {status}
    </span>
  );
}

function MetricCard({ icon: Icon, label, value, hint }: { icon: React.ElementType; label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-theme-border/70 bg-theme-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between text-theme-text-muted">
        <span className="text-xs font-medium">{label}</span>
        <Icon size={16} />
      </div>
      <div className="text-2xl font-semibold tracking-tight text-theme-text">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-theme-text-muted">{hint}</div>}
    </div>
  );
}

function ScenarioEditor({
  value,
  projects,
  onClose,
  onSave,
  saving,
}: {
  value: ScenarioEditorState;
  projects: any[];
  onClose: () => void;
  onSave: (value: ScenarioEditorState) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  const updateStep = (index: number, patch: Partial<ScenarioEditorState['steps'][number]>) => {
    setDraft(current => ({ ...current, steps: current.steps.map((step, i) => i === index ? { ...step, ...patch } : step) }));
  };
  const updateAssertion = (index: number, patch: Partial<ScenarioEditorState['assertions'][number]>) => {
    setDraft(current => ({ ...current, assertions: current.assertions.map((item, i) => i === index ? { ...item, ...patch } : item) }));
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-stretch justify-end bg-black/30 backdrop-blur-[2px]">
      <div className="h-full w-full max-w-3xl overflow-y-auto border-l border-theme-border bg-theme-bg shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-theme-border bg-theme-bg/95 px-6 py-4 backdrop-blur">
          <div>
            <div className="text-lg font-semibold text-theme-text">{draft.id ? 'Senaryoyu düzenle' : 'Yeni test senaryosu'}</div>
            <div className="text-xs text-theme-text-muted">Mesaj akışını ve ölçülebilir beklentileri burada tanımla.</div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-theme-text-muted hover:bg-theme-surface"><X size={18} /></button>
        </div>

        <div className="space-y-8 p-6">
          <section className="grid gap-4 md:grid-cols-2">
            <label className="md:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-theme-text-muted">Senaryo adı</span>
              <input value={draft.name} onChange={e => setDraft(current => ({ ...current, name: e.target.value, slug: current.id ? current.slug : slugify(e.target.value) }))} className="w-full rounded-xl border border-theme-border bg-theme-surface px-3 py-2.5 text-sm outline-none focus:border-theme-primary" />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-medium text-theme-text-muted">Slug</span>
              <input value={draft.slug} onChange={e => setDraft(current => ({ ...current, slug: slugify(e.target.value) }))} className="w-full rounded-xl border border-theme-border bg-theme-surface px-3 py-2.5 text-sm outline-none focus:border-theme-primary" />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-medium text-theme-text-muted">Model</span>
              <select value={draft.model} onChange={e => setDraft(current => ({ ...current, model: e.target.value }))} className="w-full rounded-xl border border-theme-border bg-theme-surface px-3 py-2.5 text-sm outline-none">
                {MODELS.map(model => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-medium text-theme-text-muted">Kategori</span>
              <select value={draft.category} onChange={e => setDraft(current => ({ ...current, category: e.target.value }))} className="w-full rounded-xl border border-theme-border bg-theme-surface px-3 py-2.5 text-sm outline-none">
                {CATEGORIES.map(category => <option key={category}>{category}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-medium text-theme-text-muted">Severity</span>
              <select value={draft.severity} onChange={e => setDraft(current => ({ ...current, severity: e.target.value }))} className="w-full rounded-xl border border-theme-border bg-theme-surface px-3 py-2.5 text-sm outline-none">
                {SEVERITIES.map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="md:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-theme-text-muted">Project scope (opsiyonel)</span>
              <select value={draft.project_id || ''} onChange={e => setDraft(current => ({ ...current, project_id: e.target.value || null }))} className="w-full rounded-xl border border-theme-border bg-theme-surface px-3 py-2.5 text-sm outline-none">
                <option value="">Global knowledge scope</option>
                {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label className="md:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-theme-text-muted">Açıklama</span>
              <textarea value={draft.description} onChange={e => setDraft(current => ({ ...current, description: e.target.value }))} rows={3} className="w-full resize-none rounded-xl border border-theme-border bg-theme-surface px-3 py-2.5 text-sm outline-none focus:border-theme-primary" />
            </label>
            <label className="md:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-theme-text-muted">Etiketler (virgülle)</span>
              <input value={draft.tags.join(', ')} onChange={e => setDraft(current => ({ ...current, tags: e.target.value.split(',').map(v => v.trim()).filter(Boolean) }))} className="w-full rounded-xl border border-theme-border bg-theme-surface px-3 py-2.5 text-sm outline-none focus:border-theme-primary" />
            </label>
            <label className="flex items-center gap-2 text-sm text-theme-text">
              <input type="checkbox" checked={draft.enabled} onChange={e => setDraft(current => ({ ...current, enabled: e.target.checked }))} /> Aktif
            </label>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-theme-text">Mesaj adımları</h3>
                <p className="text-xs text-theme-text-muted">Multi-turn senaryolarda mesajlar aynı izole workspace içinde sırayla gönderilir.</p>
              </div>
              <button onClick={() => setDraft(current => ({ ...current, steps: [...current.steps, { step_no: current.steps.length + 1, message: '' }] }))} className="inline-flex items-center gap-1 rounded-xl border border-theme-border px-3 py-2 text-xs font-medium hover:bg-theme-surface"><Plus size={14} /> Adım</button>
            </div>
            <div className="space-y-3">
              {draft.steps.map((step, index) => (
                <div key={index} className="rounded-2xl border border-theme-border bg-theme-surface p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-theme-text-muted">TURN {index + 1}</span>
                    {draft.steps.length > 1 && <button onClick={() => setDraft(current => ({ ...current, steps: current.steps.filter((_, i) => i !== index).map((item, i) => ({ ...item, step_no: i + 1 })) }))} className="text-theme-text-muted hover:text-red-500"><Trash2 size={14} /></button>}
                  </div>
                  <textarea value={step.message} onChange={e => updateStep(index, { message: e.target.value })} rows={3} placeholder="Kullanıcı mesajı" className="w-full resize-none rounded-xl border border-theme-border bg-theme-bg px-3 py-2.5 text-sm outline-none focus:border-theme-primary" />
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-theme-text">Assertions</h3>
                <p className="text-xs text-theme-text-muted">Cevap, source ve usage telemetry aynı run içinde doğrulanır.</p>
              </div>
              <button onClick={() => setDraft(current => ({ ...current, assertions: [...current.assertions, { position: current.assertions.length + 1, target_step: current.steps.length, kind: 'contains', field: null, expected_text: '', expected_number: null, required: true, enabled: true }] }))} className="inline-flex items-center gap-1 rounded-xl border border-theme-border px-3 py-2 text-xs font-medium hover:bg-theme-surface"><Plus size={14} /> Assertion</button>
            </div>
            <div className="space-y-3">
              {draft.assertions.map((assertion, index) => {
                const numeric = assertion.kind === 'usage_lte' || assertion.kind === 'usage_gte';
                return (
                  <div key={index} className="grid gap-3 rounded-2xl border border-theme-border bg-theme-surface p-4 md:grid-cols-[120px_170px_1fr_36px]">
                    <select value={assertion.target_step || draft.steps.length} onChange={e => updateAssertion(index, { target_step: Number(e.target.value) })} className="rounded-xl border border-theme-border bg-theme-bg px-2 py-2 text-xs">
                      {draft.steps.map(step => <option key={step.step_no} value={step.step_no}>Turn {step.step_no}</option>)}
                    </select>
                    <select value={assertion.kind} onChange={e => updateAssertion(index, { kind: e.target.value, expected_number: e.target.value.startsWith('usage_') ? 0 : null })} className="rounded-xl border border-theme-border bg-theme-bg px-2 py-2 text-xs">
                      {ASSERTION_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <div className="flex gap-2">
                      {numeric && <input value={assertion.field || ''} onChange={e => updateAssertion(index, { field: e.target.value })} placeholder="usage field" className="min-w-0 flex-1 rounded-xl border border-theme-border bg-theme-bg px-2 py-2 text-xs" />}
                      <input
                        value={numeric ? String(assertion.expected_number ?? '') : assertion.expected_text || ''}
                        onChange={e => numeric ? updateAssertion(index, { expected_number: e.target.value === '' ? null : Number(e.target.value) }) : updateAssertion(index, { expected_text: e.target.value })}
                        placeholder={numeric ? 'eşik' : 'beklenen değer'}
                        className="min-w-0 flex-[2] rounded-xl border border-theme-border bg-theme-bg px-2 py-2 text-xs"
                      />
                    </div>
                    <button onClick={() => setDraft(current => ({ ...current, assertions: current.assertions.filter((_, i) => i !== index).map((item, i) => ({ ...item, position: i + 1 })) }))} className="flex items-center justify-center text-theme-text-muted hover:text-red-500"><Trash2 size={15} /></button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-theme-border bg-theme-bg/95 px-6 py-4 backdrop-blur">
          <button onClick={onClose} className="rounded-xl border border-theme-border px-4 py-2 text-sm font-medium hover:bg-theme-surface">Vazgeç</button>
          <button disabled={saving || !draft.name.trim() || !draft.slug.trim() || draft.steps.some(step => !step.message.trim())} onClick={() => onSave(draft)} className="inline-flex items-center gap-2 rounded-xl bg-theme-primary px-4 py-2 text-sm font-semibold text-theme-primary-fg disabled:opacity-50">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

function SuiteEditor({ value, scenarios, onClose, onSave, saving }: { value: SuiteEditorState; scenarios: any[]; onClose: () => void; onSave: (value: SuiteEditorState) => void; saving: boolean }) {
  const [draft, setDraft] = React.useState(value);
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-theme-border bg-theme-bg shadow-2xl">
        <div className="flex items-center justify-between border-b border-theme-border px-6 py-4">
          <div><div className="font-semibold text-theme-text">{draft.id ? 'Suite düzenle' : 'Yeni suite'}</div><div className="text-xs text-theme-text-muted">Birlikte çalıştırılacak senaryoları seç.</div></div>
          <button onClick={onClose} className="rounded-xl p-2 hover:bg-theme-surface"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-6">
          <input value={draft.name} onChange={e => setDraft(current => ({ ...current, name: e.target.value, slug: current.id ? current.slug : slugify(e.target.value) }))} placeholder="Suite adı" className="w-full rounded-xl border border-theme-border bg-theme-surface px-3 py-2.5 text-sm" />
          <input value={draft.slug} onChange={e => setDraft(current => ({ ...current, slug: slugify(e.target.value) }))} placeholder="slug" className="w-full rounded-xl border border-theme-border bg-theme-surface px-3 py-2.5 text-sm" />
          <textarea value={draft.description} onChange={e => setDraft(current => ({ ...current, description: e.target.value }))} placeholder="Açıklama" rows={2} className="w-full resize-none rounded-xl border border-theme-border bg-theme-surface px-3 py-2.5 text-sm" />
          <div className="rounded-2xl border border-theme-border bg-theme-surface p-3">
            <div className="mb-2 text-xs font-semibold text-theme-text-muted">Senaryolar</div>
            <div className="space-y-1">
              {scenarios.map(scenario => (
                <label key={scenario.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-theme-bg">
                  <input type="checkbox" checked={draft.scenarioIds.includes(scenario.id)} onChange={e => setDraft(current => ({ ...current, scenarioIds: e.target.checked ? [...current.scenarioIds, scenario.id] : current.scenarioIds.filter(id => id !== scenario.id) }))} />
                  <span className="min-w-0 flex-1 truncate text-sm text-theme-text">{scenario.name}</span>
                  <span className="text-[10px] font-semibold text-theme-text-muted">{scenario.severity}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-theme-border px-6 py-4">
          <button onClick={onClose} className="rounded-xl border border-theme-border px-4 py-2 text-sm">Vazgeç</button>
          <button disabled={saving || !draft.name.trim() || !draft.slug.trim() || !draft.scenarioIds.length} onClick={() => onSave(draft)} className="inline-flex items-center gap-2 rounded-xl bg-theme-primary px-4 py-2 text-sm font-semibold text-theme-primary-fg disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Kaydet</button>
        </div>
      </div>
    </div>
  );
}

export function QualityLabPage() {
  const [ready, setReady] = React.useState(false);
  const [user, setUser] = React.useState<any>(null);
  const [tab, setTab] = React.useState<'scenarios' | 'suites' | 'runs'>('scenarios');
  const [scenarios, setScenarios] = React.useState<any[]>([]);
  const [steps, setSteps] = React.useState<any[]>([]);
  const [assertions, setAssertions] = React.useState<any[]>([]);
  const [suites, setSuites] = React.useState<any[]>([]);
  const [suiteCases, setSuiteCases] = React.useState<any[]>([]);
  const [runs, setRuns] = React.useState<any[]>([]);
  const [projects, setProjects] = React.useState<any[]>([]);
  const [query, setQuery] = React.useState('');
  const [editor, setEditor] = React.useState<ScenarioEditorState | null>(null);
  const [suiteEditor, setSuiteEditor] = React.useState<SuiteEditorState | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [runningKey, setRunningKey] = React.useState<string | null>(null);
  const [selectedRun, setSelectedRun] = React.useState<any>(null);
  const [selectedRunCases, setSelectedRunCases] = React.useState<any[]>([]);
  const [selectedRunSteps, setSelectedRunSteps] = React.useState<any[]>([]);
  const [banner, setBanner] = React.useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [gemini38Scorecard, setGemini38Scorecard] = React.useState({ completed: 0, grounded: 0, p95Ms: 0, costPerGrounded: 0, cacheHitRate: 0 });

  const load = React.useCallback(async () => {
    const [scenarioRes, stepRes, assertionRes, suiteRes, suiteCaseRes, runRes, projectRes] = await Promise.all([
      supabase.from('ai_quality_scenarios').select('*').order('severity').order('name'),
      supabase.from('ai_quality_steps').select('*').order('step_no'),
      supabase.from('ai_quality_assertions').select('*').order('position'),
      supabase.from('ai_quality_suites').select('*').order('name'),
      supabase.from('ai_quality_suite_cases').select('*').order('position'),
      supabase.from('ai_quality_runs').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('projects').select('id,name').is('deleted_at', null).order('name'),
    ]);
    const firstError = scenarioRes.error || stepRes.error || assertionRes.error || suiteRes.error || suiteCaseRes.error || runRes.error || projectRes.error;
    if (firstError) throw firstError;
    setScenarios(scenarioRes.data || []);
    setSteps(stepRes.data || []);
    setAssertions(assertionRes.data || []);
    setSuites(suiteRes.data || []);
    setSuiteCases(suiteCaseRes.data || []);
    setRuns(runRes.data || []);
    setProjects(projectRes.data || []);
    const { data: g38Turns } = await supabase.from('assistant_turns').select('status,source_refs,usage,created_at,completed_at').eq('response_model', 'gemini-3.8-flash').order('created_at', { ascending: false }).limit(100);
    const completed = (g38Turns || []).filter(turn => turn.status === 'completed');
    const grounded = completed.filter(turn => Array.isArray(turn.source_refs) && turn.source_refs.length > 0);
    const durations = completed.map(turn => Math.max(0, new Date(turn.completed_at || turn.created_at).getTime() - new Date(turn.created_at).getTime())).sort((a,b) => a-b);
    const p95Ms = durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] : 0;
    const totalCost = grounded.reduce((sum, turn) => sum + Number((turn.usage as any)?.estimated_cost_usd || 0), 0);
    const cacheHits = completed.filter(turn => Number((turn.usage as any)?.gemini_implicit_cache_hit || 0) > 0).length;
    setGemini38Scorecard({ completed: completed.length, grounded: grounded.length, p95Ms, costPerGrounded: grounded.length ? totalCost / grounded.length : 0, cacheHitRate: completed.length ? Math.round((cacheHits / completed.length) * 100) : 0 });
  }, []);

  React.useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data.session?.user || null);
      setReady(true);
      if (data.session?.user) {
        try { await load(); } catch (error) { setBanner({ tone: 'error', text: error instanceof Error ? error.message : 'Quality Lab yüklenemedi.' }); }
      }
    })();
  }, [load]);

  const scenarioBundle = React.useCallback((scenario: any): ScenarioEditorState => ({
    ...scenario,
    tags: Array.isArray(scenario.tags) ? scenario.tags : [],
    steps: steps.filter(step => step.scenario_id === scenario.id).map(step => ({ ...step })),
    assertions: assertions.filter(assertion => assertion.scenario_id === scenario.id).map(assertion => ({ ...assertion, expected_number: assertion.expected_number == null ? null : Number(assertion.expected_number) })),
  }), [steps, assertions]);

  const saveScenario = async (draft: ScenarioEditorState) => {
    setSaving(true);
    setBanner(null);
    try {
      let scenarioId = draft.id;
      const payload = {
        slug: draft.slug,
        name: draft.name.trim(),
        description: draft.description.trim(),
        category: draft.category,
        severity: draft.severity,
        enabled: draft.enabled,
        model: draft.model,
        project_id: draft.project_id || null,
        tags: draft.tags,
        created_by: user?.id,
        updated_at: new Date().toISOString(),
      };
      if (scenarioId) {
        const { error } = await supabase.from('ai_quality_scenarios').update(payload).eq('id', scenarioId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('ai_quality_scenarios').insert(payload).select('id').single();
        if (error) throw error;
        scenarioId = data.id;
      }
      await supabase.from('ai_quality_steps').delete().eq('scenario_id', scenarioId!);
      await supabase.from('ai_quality_assertions').delete().eq('scenario_id', scenarioId!);
      const { error: stepError } = await supabase.from('ai_quality_steps').insert(draft.steps.map((step, index) => ({ scenario_id: scenarioId, step_no: index + 1, message: step.message.trim() })));
      if (stepError) throw stepError;
      if (draft.assertions.length) {
        const { error: assertionError } = await supabase.from('ai_quality_assertions').insert(draft.assertions.map((item, index) => ({
          scenario_id: scenarioId,
          position: index + 1,
          target_step: item.target_step,
          kind: item.kind,
          field: item.field || null,
          expected_text: item.expected_text || null,
          expected_number: item.expected_number,
          required: item.required,
          enabled: item.enabled,
        })));
        if (assertionError) throw assertionError;
      }
      setEditor(null);
      setBanner({ tone: 'success', text: 'Senaryo kaydedildi.' });
      await load();
    } catch (error) {
      setBanner({ tone: 'error', text: error instanceof Error ? error.message : 'Senaryo kaydedilemedi.' });
    } finally { setSaving(false); }
  };

  const deleteScenario = async (scenario: any) => {
    if (!window.confirm(`“${scenario.name}” senaryosu silinsin mi?`)) return;
    const { error } = await supabase.from('ai_quality_scenarios').delete().eq('id', scenario.id);
    if (error) setBanner({ tone: 'error', text: error.message }); else await load();
  };

  const saveSuite = async (draft: SuiteEditorState) => {
    setSaving(true);
    try {
      let suiteId = draft.id;
      const payload = { slug: draft.slug, name: draft.name.trim(), description: draft.description.trim(), enabled: draft.enabled, created_by: user?.id, updated_at: new Date().toISOString() };
      if (suiteId) {
        const { error } = await supabase.from('ai_quality_suites').update(payload).eq('id', suiteId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('ai_quality_suites').insert(payload).select('id').single();
        if (error) throw error;
        suiteId = data.id;
      }
      await supabase.from('ai_quality_suite_cases').delete().eq('suite_id', suiteId!);
      const { error: linkError } = await supabase.from('ai_quality_suite_cases').insert(draft.scenarioIds.map((scenarioId, index) => ({ suite_id: suiteId, scenario_id: scenarioId, position: index + 1, enabled: true })));
      if (linkError) throw linkError;
      setSuiteEditor(null);
      setBanner({ tone: 'success', text: 'Suite kaydedildi.' });
      await load();
    } catch (error) { setBanner({ tone: 'error', text: error instanceof Error ? error.message : 'Suite kaydedilemedi.' }); }
    finally { setSaving(false); }
  };

  const runQuality = async (key: string, body: Record<string, unknown>) => {
    setRunningKey(key);
    setBanner(null);
    try {
      const { data, error } = await supabase.functions.invoke('ai-quality-runner', { body: { ...body, endpoint: 'openai-assistant-v2', trigger: 'ui' } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setBanner({ tone: data.run?.failed_cases > 0 ? 'error' : 'success', text: `${data.run?.passed_cases || 0}/${data.run?.total_cases || 0} case PASS · ${money(data.run?.total_cost_usd)}` });
      setTab('runs');
      await load();
      if (data.run?.id) await openRun(data.run);
    } catch (error) {
      setBanner({ tone: 'error', text: error instanceof Error ? error.message : 'Quality run başlatılamadı.' });
    } finally { setRunningKey(null); }
  };

  const openRun = async (run: any) => {
    setSelectedRun(run);
    const { data: cases } = await supabase.from('ai_quality_run_cases').select('*, ai_quality_scenarios(name,slug,severity,category)').eq('run_id', run.id).order('started_at');
    const ids = (cases || []).map(item => item.id);
    let runSteps: any[] = [];
    if (ids.length) {
      const { data } = await supabase.from('ai_quality_run_steps').select('*').in('run_case_id', ids).order('step_no');
      runSteps = data || [];
    }
    setSelectedRunCases(cases || []);
    setSelectedRunSteps(runSteps);
  };

  const duplicateScenario = async (scenario: any) => {
    const base = scenarioBundle(scenario);
    const copy = { ...base, id: undefined, name: `${base.name} Kopya`, slug: `${base.slug}-copy-${Date.now().toString().slice(-5)}` };
    setEditor(copy);
  };

  if (!ready) return <div className="flex h-screen items-center justify-center bg-theme-bg"><Loader2 className="animate-spin text-theme-primary" /></div>;
  if (!user) return (
    <div className="flex min-h-screen items-center justify-center bg-theme-bg p-6 text-theme-text">
      <div className="max-w-md rounded-3xl border border-theme-border bg-theme-surface p-8 text-center">
        <JetWorkLogo className="mx-auto mb-4 h-10 w-10" />
        <h1 className="text-xl font-semibold">Quality Lab için oturum gerekli</h1>
        <p className="mt-2 text-sm text-theme-text-muted">Önce JetWork’e giriş yap, sonra bu sayfayı tekrar aç.</p>
        <a href="/" className="mt-5 inline-flex rounded-xl bg-theme-primary px-4 py-2 text-sm font-semibold text-theme-primary-fg">JetWork’e dön</a>
      </div>
    </div>
  );

  const filteredScenarios = scenarios.filter(scenario => [scenario.name, scenario.slug, scenario.category, ...(scenario.tags || [])].join(' ').toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR')));
  const latest = runs[0];
  const latestPassRate = latest?.total_cases ? Math.round((Number(latest.passed_cases) / Number(latest.total_cases)) * 100) : 0;

  return (
    <div className="min-h-screen bg-theme-bg text-theme-text">
      <header className="sticky top-0 z-30 border-b border-theme-border/70 bg-theme-bg/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-5 py-3">
          <a href="/" className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-theme-surface"><JetWorkLogo className="h-7 w-7" /><span className="font-semibold">JetWork</span></a>
          <div className="h-6 w-px bg-theme-border" />
          <div className="flex min-w-0 items-center gap-2"><FlaskConical size={18} className="text-theme-primary" /><div><div className="text-sm font-semibold">AI Quality Lab</div><div className="hidden text-[10px] text-theme-text-muted sm:block">Production assistant regression & quality management</div></div></div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => void load()} className="rounded-xl border border-theme-border p-2 text-theme-text-muted hover:bg-theme-surface" title="Yenile"><RefreshCw size={16} /></button>
            <a href="/" className="inline-flex items-center gap-1 rounded-xl border border-theme-border px-3 py-2 text-xs font-medium hover:bg-theme-surface"><ArrowLeft size={14} /> JetWork</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] p-5 md:p-7">
        {banner && <div className={cn('mb-5 flex items-center justify-between rounded-2xl border px-4 py-3 text-sm', banner.tone === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700' : 'border-red-500/30 bg-red-500/10 text-red-700')}><span>{banner.text}</span><button onClick={() => setBanner(null)}><X size={15} /></button></div>}

        <section className="mb-4 rounded-2xl border border-theme-border/70 bg-theme-surface p-4">
          <div className="mb-3 flex items-center gap-2"><Zap size={16} className="text-theme-primary" /><div><div className="text-sm font-semibold">Gemini 3.8 Production Scorecard</div><div className="text-[10px] text-theme-text-muted">Son 100 production turn · cost / successful grounded answer ana metriği</div></div></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard icon={ShieldCheck} label="Grounded başarı" value={`${gemini38Scorecard.grounded}/${gemini38Scorecard.completed}`} hint="source_refs bulunan completed turn" />
            <MetricCard icon={Clock3} label="P95 total turn" value={millis(gemini38Scorecard.p95Ms)} />
            <MetricCard icon={CircleDollarSign} label="Cost / grounded" value={money(gemini38Scorecard.costPerGrounded)} />
            <MetricCard icon={Gauge} label="Native cache hit" value={`%${gemini38Scorecard.cacheHitRate}`} />
          </div>
        </section>

        <section className="mb-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard icon={ShieldCheck} label="Son kalite skoru" value={latest ? `%${latestPassRate}` : '—'} hint={latest ? dateTime(latest.created_at) : 'Henüz run yok'} />
          <MetricCard icon={Beaker} label="Aktif senaryo" value={scenarios.filter(item => item.enabled).length} hint={`${suites.filter(item => item.enabled).length} suite`} />
          <MetricCard icon={CircleDollarSign} label="Son run maliyeti" value={latest ? money(latest.total_cost_usd) : '—'} hint={latest ? `${latest.total_cases} case` : undefined} />
          <MetricCard icon={Clock3} label="Ort. case süresi" value={latest ? millis(latest.avg_duration_ms) : '—'} hint={latest ? `${latest.passed_cases} PASS · ${latest.failed_cases} FAIL` : undefined} />
        </section>

        <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-theme-border">
          {[
            ['scenarios', FlaskConical, 'Senaryolar'],
            ['suites', Layers3, 'Suites'],
            ['runs', History, 'Run geçmişi'],
          ].map(([key, Icon, label]) => (
            <button key={String(key)} onClick={() => setTab(key as any)} className={cn('inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition', tab === key ? 'border-theme-primary text-theme-text' : 'border-transparent text-theme-text-muted hover:text-theme-text')}><Icon size={16} />{String(label)}</button>
          ))}
        </div>

        {tab === 'scenarios' && (
          <section>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative max-w-md flex-1"><Search size={15} className="absolute left-3 top-3 text-theme-text-muted" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Senaryo, kategori veya etiket ara" className="w-full rounded-xl border border-theme-border bg-theme-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:border-theme-primary" /></div>
              <button onClick={() => setEditor(emptyScenario())} className="inline-flex items-center justify-center gap-2 rounded-xl bg-theme-primary px-4 py-2.5 text-sm font-semibold text-theme-primary-fg"><Plus size={16} /> Yeni senaryo</button>
            </div>
            <div className="overflow-hidden rounded-2xl border border-theme-border bg-theme-surface">
              {filteredScenarios.map((scenario, index) => {
                const scenarioSteps = steps.filter(step => step.scenario_id === scenario.id);
                const scenarioAssertions = assertions.filter(assertion => assertion.scenario_id === scenario.id && assertion.enabled);
                return (
                  <div key={scenario.id} className={cn('flex flex-col gap-3 p-4 md:flex-row md:items-center', index > 0 && 'border-t border-theme-border/60')}>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2"><span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-bold', scenario.severity === 'P0' ? 'bg-red-500/10 text-red-600' : scenario.severity === 'P1' ? 'bg-amber-500/10 text-amber-600' : 'bg-theme-bg text-theme-text-muted')}>{scenario.severity}</span><span className="truncate text-sm font-semibold">{scenario.name}</span>{!scenario.enabled && <span className="text-[10px] text-theme-text-muted">PASİF</span>}</div>
                      <div className="text-xs text-theme-text-muted">{scenario.category} · {scenarioSteps.length} turn · {scenarioAssertions.length} assertion · {scenario.model}</div>
                      {scenario.description && <div className="mt-1 line-clamp-1 text-xs text-theme-text-muted/80">{scenario.description}</div>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button disabled={!!runningKey} onClick={() => void runQuality(`scenario:${scenario.id}`, { scenarioIds: [scenario.id] })} className="inline-flex items-center gap-1.5 rounded-xl border border-theme-border px-3 py-2 text-xs font-semibold hover:bg-theme-bg disabled:opacity-50">{runningKey === `scenario:${scenario.id}` ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Çalıştır</button>
                      <button onClick={() => setEditor(scenarioBundle(scenario))} className="rounded-xl p-2 text-theme-text-muted hover:bg-theme-bg hover:text-theme-text" title="Düzenle"><Edit3 size={15} /></button>
                      <button onClick={() => void duplicateScenario(scenario)} className="rounded-xl p-2 text-theme-text-muted hover:bg-theme-bg hover:text-theme-text" title="Kopyala"><Copy size={15} /></button>
                      <button onClick={() => void deleteScenario(scenario)} className="rounded-xl p-2 text-theme-text-muted hover:bg-red-500/10 hover:text-red-600" title="Sil"><Trash2 size={15} /></button>
                    </div>
                  </div>
                );
              })}
              {!filteredScenarios.length && <div className="p-10 text-center text-sm text-theme-text-muted">Senaryo bulunamadı.</div>}
            </div>
          </section>
        )}

        {tab === 'suites' && (
          <section>
            <div className="mb-4 flex justify-end"><button onClick={() => setSuiteEditor({ slug: '', name: '', description: '', enabled: true, scenarioIds: [] })} className="inline-flex items-center gap-2 rounded-xl bg-theme-primary px-4 py-2.5 text-sm font-semibold text-theme-primary-fg"><Plus size={16} /> Yeni suite</button></div>
            <div className="grid gap-4 lg:grid-cols-2">
              {suites.map(suite => {
                const ids = suiteCases.filter(item => item.suite_id === suite.id && item.enabled).sort((a, b) => a.position - b.position).map(item => item.scenario_id);
                return (
                  <div key={suite.id} className="rounded-2xl border border-theme-border bg-theme-surface p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Layers3 size={16} className="text-theme-primary" /><h3 className="font-semibold">{suite.name}</h3></div><p className="mt-1 text-xs text-theme-text-muted">{suite.description}</p></div><button onClick={() => setSuiteEditor({ ...suite, scenarioIds: ids })} className="rounded-xl p-2 text-theme-text-muted hover:bg-theme-bg"><Settings2 size={15} /></button></div>
                    <div className="my-4 flex flex-wrap gap-1.5">{ids.map(id => scenarios.find(item => item.id === id)).filter(Boolean).map(scenario => <span key={scenario.id} className="rounded-lg bg-theme-bg px-2 py-1 text-[11px] text-theme-text-muted">{scenario.severity} · {scenario.name}</span>)}</div>
                    <button disabled={!!runningKey || !ids.length} onClick={() => void runQuality(`suite:${suite.slug}`, { suiteSlug: suite.slug })} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-theme-border py-2.5 text-sm font-semibold hover:bg-theme-bg disabled:opacity-50">{runningKey === `suite:${suite.slug}` ? <Loader2 size={15} className="animate-spin" /> : <Activity size={15} />} {ids.length} case çalıştır</button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {tab === 'runs' && (
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
            <div className="overflow-hidden rounded-2xl border border-theme-border bg-theme-surface">
              {runs.map((run, index) => (
                <button key={run.id} onClick={() => void openRun(run)} className={cn('flex w-full items-center gap-3 p-4 text-left transition hover:bg-theme-bg', index > 0 && 'border-t border-theme-border/60', selectedRun?.id === run.id && 'bg-theme-bg')}>
                  <StatusBadge status={run.status} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{suites.find(suite => suite.id === run.suite_id)?.name || 'Custom run'}</div><div className="text-[11px] text-theme-text-muted">{dateTime(run.created_at)} · {run.endpoint} · {run.trigger}</div></div>
                  <div className="hidden text-right sm:block"><div className="text-sm font-semibold">{run.passed_cases}/{run.total_cases}</div><div className="text-[11px] text-theme-text-muted">{money(run.total_cost_usd)} · {millis(run.avg_duration_ms)}</div></div>
                  <ChevronRight size={16} className="text-theme-text-muted" />
                </button>
              ))}
              {!runs.length && <div className="p-10 text-center text-sm text-theme-text-muted">Henüz quality run yok.</div>}
            </div>

            <div className="min-h-[420px] rounded-2xl border border-theme-border bg-theme-surface p-5">
              {!selectedRun ? <div className="flex h-full min-h-[380px] items-center justify-center text-center text-sm text-theme-text-muted"><div><History size={28} className="mx-auto mb-3 opacity-40" />Detay için bir run seç.</div></div> : (
                <div>
                  <div className="mb-5 flex items-start justify-between"><div><div className="flex items-center gap-2"><StatusBadge status={selectedRun.status} /><span className="text-xs text-theme-text-muted">{dateTime(selectedRun.created_at)}</span></div><h3 className="mt-2 text-lg font-semibold">{suites.find(suite => suite.id === selectedRun.suite_id)?.name || 'Custom run'}</h3></div><button onClick={() => { setSelectedRun(null); setSelectedRunCases([]); setSelectedRunSteps([]); }} className="rounded-xl p-2 hover:bg-theme-bg"><X size={16} /></button></div>
                  <div className="mb-5 grid grid-cols-3 gap-2"><div className="rounded-xl bg-theme-bg p-3"><div className="text-[10px] text-theme-text-muted">PASS</div><div className="text-lg font-semibold text-emerald-600">{selectedRun.passed_cases}</div></div><div className="rounded-xl bg-theme-bg p-3"><div className="text-[10px] text-theme-text-muted">FAIL</div><div className="text-lg font-semibold text-red-600">{selectedRun.failed_cases}</div></div><div className="rounded-xl bg-theme-bg p-3"><div className="text-[10px] text-theme-text-muted">COST</div><div className="text-lg font-semibold">{money(selectedRun.total_cost_usd)}</div></div></div>
                  <div className="space-y-3">
                    {selectedRunCases.map(runCase => {
                      const runScenario = runCase.ai_quality_scenarios || {};
                      const runCaseSteps = selectedRunSteps.filter(step => step.run_case_id === runCase.id);
                      return (
                        <details key={runCase.id} className="group rounded-2xl border border-theme-border bg-theme-bg p-3">
                          <summary className="flex cursor-pointer list-none items-center gap-2"><StatusBadge status={runCase.status} /><div className="min-w-0 flex-1 truncate text-xs font-semibold">{runScenario.name}</div><span className="text-[10px] text-theme-text-muted">{runCase.score}% · {money(runCase.cost_usd)}</span></summary>
                          <div className="mt-3 space-y-3 border-t border-theme-border/60 pt-3">
                            {runCase.failure_summary && <div className="rounded-xl bg-red-500/10 p-2 text-[11px] text-red-700">{runCase.failure_summary}</div>}
                            {runCaseSteps.map(step => (
                              <div key={step.id} className="rounded-xl border border-theme-border bg-theme-surface p-3">
                                <div className="mb-2 text-[10px] font-bold text-theme-text-muted">TURN {step.step_no} · {millis(step.duration_ms)}</div>
                                <div className="mb-2 rounded-lg bg-theme-bg p-2 text-xs"><span className="font-semibold">USER:</span> {step.user_text}</div>
                                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-theme-bg p-2 text-[11px] leading-relaxed">{step.response_text}</pre>
                                <div className="mt-2 space-y-1">{(step.assertion_results || []).map((result: any, index: number) => <div key={index} className={cn('flex items-center gap-2 text-[10px]', result.passed ? 'text-emerald-600' : 'text-red-600')}>{result.passed ? <CheckCircle2 size={11} /> : <XCircle size={11} />} {result.kind}{result.field ? `:${result.field}` : ''}</div>)}</div>
                              </div>
                            ))}
                          </div>
                        </details>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {editor && <ScenarioEditor value={editor} projects={projects} onClose={() => setEditor(null)} onSave={value => void saveScenario(value)} saving={saving} />}
      {suiteEditor && <SuiteEditor value={suiteEditor} scenarios={scenarios.filter(item => item.enabled)} onClose={() => setSuiteEditor(null)} onSave={value => void saveSuite(value)} saving={saving} />}
    </div>
  );
}
