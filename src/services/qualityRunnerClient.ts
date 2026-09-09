import type { SupabaseClient } from '@supabase/supabase-js';

export interface QualityRunProgress {
  completed: number;
  total: number;
  scenarioId?: string;
}

interface RunInput {
  suiteId?: string;
  suiteSlug?: string;
  scenarioIds?: string[];
  endpoint?: string;
  trigger?: 'ui' | 'ci' | 'schedule' | 'manual' | 'assistant';
}

async function functionErrorMessage(error: any) {
  const response = error?.context;
  if (!(response instanceof Response)) return error?.message || 'Quality runner çağrısı başarısız.';
  const status = response.status;
  let detail = '';
  try {
    const payload = await response.clone().json();
    detail = String(payload?.error || payload?.message || '');
  } catch {
    try { detail = (await response.clone().text()).trim(); } catch { /* noop */ }
  }
  return [`HTTP ${status}`, detail || error?.message].filter(Boolean).join(' · ');
}

async function invoke(client: SupabaseClient, body: Record<string, unknown>) {
  const { data, error } = await client.functions.invoke('ai-quality-runner', { body });
  if (error) throw new Error(await functionErrorMessage(error));
  if (data?.error) throw new Error(String(data.error));
  return data;
}

export async function runQualitySuite(
  client: SupabaseClient,
  input: RunInput,
  onProgress?: (progress: QualityRunProgress) => void,
) {
  const common = {
    endpoint: input.endpoint || 'openai-assistant-v2',
    trigger: input.trigger || 'ui',
  };
  const prepared = await invoke(client, { ...input, ...common, operation: 'prepare' });
  const runId = String(prepared?.run?.id || '');
  const scenarioIds = Array.isArray(prepared?.scenarioIds) ? prepared.scenarioIds.map(String) : [];
  if (!runId || !scenarioIds.length) throw new Error('Quality runner geçerli bir run veya senaryo listesi döndürmedi.');

  onProgress?.({ completed: 0, total: scenarioIds.length });
  let result = prepared;
  try {
    for (let index = 0; index < scenarioIds.length; index += 1) {
      const scenarioId = scenarioIds[index];
      result = await invoke(client, { ...common, operation: 'execute', runId, scenarioId });
      onProgress?.({ completed: index + 1, total: scenarioIds.length, scenarioId });
    }
    return result;
  } catch (error) {
    await invoke(client, {
      ...common,
      operation: 'fail',
      runId,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
}

export const qualityRunnerInternals = { functionErrorMessage };
