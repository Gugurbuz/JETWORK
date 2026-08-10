import { supabase } from '../supabase';

export type ReasoningIntent =
  | 'simple_answer'
  | 'sap_diagnosis'
  | 'research'
  | 'analysis'
  | 'document'
  | 'decision'
  | 'project';

export type ReasoningRunStatus = 'running' | 'completed' | 'failed';

export interface ReasoningDebugRunSummary {
  runId: string;
  turnId: string;
  conversationId: string;
  workspaceId: string;
  messageId: string;
  intent: ReasoningIntent | string;
  complexity: 'low' | 'medium' | 'high' | string;
  engineVersion: string;
  status: ReasoningRunStatus | string;
  knowledgeUsed: boolean;
  webUsed: boolean;
  toolCallCount: number;
  fallbackUsed: boolean;
  responseModel?: string;
  provider?: string;
  usage: Record<string, number>;
  latencyMs?: number;
  artifactStatus?: string;
  artifactOperation?: string;
  artifactVersionNumber?: number;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
}

export interface ReasoningToolRun {
  id: string;
  toolName: string;
  callId?: string;
  status: string;
  durationMs?: number;
  arguments?: Record<string, unknown>;
  resultSummary?: Record<string, unknown>;
  sourceRefs?: Array<Record<string, unknown>>;
  errorMessage?: string;
  createdAt?: string;
}

export interface ReasoningArtifactDebug {
  id: string;
  operation: string;
  status: string;
  documentVersionId?: string;
  documentVersionNumber?: number;
  errorMessage?: string;
  lastTransitionAt?: string;
}

export interface ReasoningUsageStage {
  calls?: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface ReasoningUsageBreakdown {
  semanticPlanner: ReasoningUsageStage;
  agent: ReasoningUsageStage;
  finalSynthesis: ReasoningUsageStage;
  runtime: ReasoningUsageStage & {
    deterministicKnowledgeDispatches?: number;
    providerCallsAvoided?: number;
  };
  combined: {
    totalTokens: number;
    estimatedCostUsd: number;
  };
}

export interface ReasoningDebugRunDetail {
  runId: string;
  turnId: string;
  conversationId: string;
  workspaceId: string;
  messageId: string;
  engineVersion: string;
  intent: string;
  complexity: string;
  status: string;
  knowledgeUsed: boolean;
  webUsed: boolean;
  toolCallCount: number;
  fallbackUsed: boolean;
  selectedModel?: string;
  responseModel?: string;
  provider?: string;
  usage: Record<string, number>;
  usageBreakdown?: ReasoningUsageBreakdown | null;
  latencyMs?: number;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
  plan: Record<string, unknown>;
  verification: Record<string, unknown>;
  executionTrace: Array<Record<string, unknown>>;
  evidenceSummary: Record<string, unknown>;
  sourceRefs: Array<Record<string, unknown>>;
  artifact?: ReasoningArtifactDebug | null;
  toolRuns: ReasoningToolRun[];
}

const asObject = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

const asArray = (value: unknown): Array<Record<string, unknown>> => (
  Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>>
    : []
);

const asNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const numberOrZero = (value: unknown): number => asNumber(value) || 0;

const clean = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
};

const numericUsage = (value: unknown): Record<string, number> => {
  const source = asObject(value);
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, candidate]) => [key, asNumber(candidate)] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== undefined),
  );
};

export const totalUsageTokens = (usage: Record<string, number>): number | undefined => {
  const explicit = usage.total_tokens ?? usage.totalTokenCount ?? usage.total_tokens_count;
  if (Number.isFinite(explicit)) return explicit;
  const input = usage.input_tokens ?? usage.promptTokenCount ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.candidatesTokenCount ?? usage.completion_tokens;
  if (Number.isFinite(input) || Number.isFinite(output)) return (input || 0) + (output || 0);
  return undefined;
};

export const formatLatency = (latencyMs?: number): string => {
  if (!Number.isFinite(latencyMs)) return '—';
  if ((latencyMs as number) < 1_000) return `${Math.round(latencyMs as number)} ms`;
  return `${((latencyMs as number) / 1_000).toFixed((latencyMs as number) < 10_000 ? 1 : 0)} sn`;
};

export const providerLabel = (provider?: string, model?: string): string => {
  const normalized = `${provider || ''} ${model || ''}`.toLocaleLowerCase('tr-TR');
  if (normalized.includes('gemini')) return 'Gemini';
  if (normalized.trim()) return 'OpenAI';
  return '—';
};

function mapSummary(row: Record<string, unknown>): ReasoningDebugRunSummary {
  return {
    runId: String(row.run_id || ''),
    turnId: String(row.turn_id || ''),
    conversationId: String(row.conversation_id || ''),
    workspaceId: String(row.workspace_id || ''),
    messageId: String(row.message_id || ''),
    intent: String(row.intent || ''),
    complexity: String(row.complexity || ''),
    engineVersion: String(row.engine_version || ''),
    status: String(row.status || ''),
    knowledgeUsed: Boolean(row.knowledge_used),
    webUsed: Boolean(row.web_used),
    toolCallCount: asNumber(row.tool_call_count) || 0,
    fallbackUsed: Boolean(row.fallback_used),
    responseModel: clean(row.response_model),
    provider: clean(row.provider),
    usage: numericUsage(row.usage),
    latencyMs: asNumber(row.latency_ms),
    artifactStatus: clean(row.artifact_status),
    artifactOperation: clean(row.artifact_operation),
    artifactVersionNumber: asNumber(row.artifact_version_number),
    errorMessage: clean(row.error_message),
    startedAt: String(row.started_at || ''),
    completedAt: clean(row.completed_at),
  };
}

function mapToolRun(row: Record<string, unknown>): ReasoningToolRun {
  return {
    id: String(row.id || ''),
    toolName: String(row.toolName || row.tool_name || 'tool'),
    callId: clean(row.callId || row.call_id),
    status: String(row.status || ''),
    durationMs: asNumber(row.durationMs || row.duration_ms),
    arguments: asObject(row.arguments),
    resultSummary: asObject(row.resultSummary || row.result_summary),
    sourceRefs: asArray(row.sourceRefs || row.source_refs),
    errorMessage: clean(row.errorMessage || row.error_message),
    createdAt: clean(row.createdAt || row.created_at),
  };
}

const mapUsageStage = (value: unknown): ReasoningUsageStage => {
  const row = asObject(value);
  return {
    calls: asNumber(row.calls),
    inputTokens: numberOrZero(row.inputTokens),
    outputTokens: numberOrZero(row.outputTokens),
    reasoningTokens: numberOrZero(row.reasoningTokens),
    totalTokens: numberOrZero(row.totalTokens),
    estimatedCostUsd: numberOrZero(row.estimatedCostUsd),
  };
};

const mapUsageBreakdown = (value: unknown): ReasoningUsageBreakdown | null => {
  const row = asObject(value);
  if (!Object.keys(row).length) return null;
  const runtimeRaw = asObject(row.runtime);
  const combinedRaw = asObject(row.combined);
  return {
    semanticPlanner: mapUsageStage(row.semanticPlanner),
    agent: mapUsageStage(row.agent),
    finalSynthesis: mapUsageStage(row.finalSynthesis),
    runtime: {
      ...mapUsageStage(runtimeRaw),
      deterministicKnowledgeDispatches: asNumber(runtimeRaw.deterministicKnowledgeDispatches),
      providerCallsAvoided: asNumber(runtimeRaw.providerCallsAvoided),
    },
    combined: {
      totalTokens: numberOrZero(combinedRaw.totalTokens),
      estimatedCostUsd: numberOrZero(combinedRaw.estimatedCostUsd),
    },
  };
};

function mapDetail(raw: unknown): ReasoningDebugRunDetail | null {
  const row = asObject(raw);
  if (!row.runId && !row.run_id) return null;
  const artifactRaw = asObject(row.artifact);
  const artifact = Object.keys(artifactRaw).length
    ? {
        id: String(artifactRaw.id || ''),
        operation: String(artifactRaw.operation || ''),
        status: String(artifactRaw.status || ''),
        documentVersionId: clean(artifactRaw.documentVersionId),
        documentVersionNumber: asNumber(artifactRaw.documentVersionNumber),
        errorMessage: clean(artifactRaw.errorMessage),
        lastTransitionAt: clean(artifactRaw.lastTransitionAt),
      }
    : null;

  return {
    runId: String(row.runId || row.run_id || ''),
    turnId: String(row.turnId || row.turn_id || ''),
    conversationId: String(row.conversationId || row.conversation_id || ''),
    workspaceId: String(row.workspaceId || row.workspace_id || ''),
    messageId: String(row.messageId || row.message_id || ''),
    engineVersion: String(row.engineVersion || row.engine_version || ''),
    intent: String(row.intent || ''),
    complexity: String(row.complexity || ''),
    status: String(row.status || ''),
    knowledgeUsed: Boolean(row.knowledgeUsed ?? row.knowledge_used),
    webUsed: Boolean(row.webUsed ?? row.web_used),
    toolCallCount: asNumber(row.toolCallCount ?? row.tool_call_count) || 0,
    fallbackUsed: Boolean(row.fallbackUsed ?? row.fallback_used),
    selectedModel: clean(row.selectedModel || row.selected_model),
    responseModel: clean(row.responseModel || row.response_model),
    provider: clean(row.provider),
    usage: numericUsage(row.usage),
    usageBreakdown: null,
    latencyMs: asNumber(row.latencyMs || row.latency_ms),
    startedAt: String(row.startedAt || row.started_at || ''),
    completedAt: clean(row.completedAt || row.completed_at),
    errorMessage: clean(row.errorMessage || row.error_message),
    plan: asObject(row.plan),
    verification: asObject(row.verification),
    executionTrace: asArray(row.executionTrace || row.execution_trace),
    evidenceSummary: asObject(row.evidenceSummary || row.evidence_summary),
    sourceRefs: asArray(row.sourceRefs || row.source_refs),
    artifact,
    toolRuns: asArray(row.toolRuns || row.tool_runs).map(mapToolRun),
  };
}

export async function loadReasoningDebugRuns(input: {
  workspaceId?: string | null;
  limit?: number;
  offset?: number;
} = {}): Promise<ReasoningDebugRunSummary[]> {
  const { data, error } = await supabase.rpc('get_reasoning_debug_runs', {
    p_workspace_id: input.workspaceId || null,
    p_limit: Math.min(Math.max(input.limit || 50, 1), 100),
    p_offset: Math.max(input.offset || 0, 0),
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(row => mapSummary(asObject(row)));
}

export async function loadReasoningDebugRun(runId: string): Promise<ReasoningDebugRunDetail | null> {
  const [detailResult, breakdownResult] = await Promise.all([
    supabase.rpc('get_reasoning_debug_run', { p_run_id: runId }),
    supabase.rpc('get_reasoning_usage_breakdown', { p_run_id: runId }),
  ]);
  if (detailResult.error) throw detailResult.error;
  if (breakdownResult.error) throw breakdownResult.error;
  const detail = mapDetail(detailResult.data);
  if (detail) detail.usageBreakdown = mapUsageBreakdown(breakdownResult.data);
  return detail;
}
