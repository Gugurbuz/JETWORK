import { supabase } from '../supabase';
import { nowIso } from '../lib/mapping';
import type { Message } from '../types';
import { FEATURE_FLAGS } from '../lib/featureFlags';
import { persistAssistantToolAttachments } from './assistantFileRepository';
import { encodeAgentWorkEnvelope } from './agentWorkPersistence';
import {
  getAgentWorkLiveSnapshot,
  registerPersistedAgentWorkEvents,
  resetAgentWorkLiveSnapshot,
} from './agentWorkLiveStream';

function toMessagePayload(workspaceId: string, message: Message, ownerId?: string): Record<string, unknown> {
  let attachments = message.attachments;
  if (
    FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
    && Array.isArray(attachments)
  ) {
    attachments = attachments.map((attachment) => {
      const {
        file: _file,
        data: _data,
        url,
        ...metadata
      } = attachment;
      return {
        ...metadata,
        url: typeof url === 'string' && !url.startsWith('data:') ? url : '',
      };
    });
  }

  const retryPayload = message.retryPayload
    ? {
        ...message.retryPayload,
        attachments: message.retryPayload.attachments?.map(({ file: _file, data: _data, ...attachment }) => attachment),
      }
    : null;
  const hidesPrivateRuntimeTelemetry = FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME && message.role === 'model';
  const persistedRawResponse = hidesPrivateRuntimeTelemetry
    ? encodeAgentWorkEnvelope(message.workEvents || [], message.rawResponse)
    : message.rawResponse;

  // Keep this list aligned with public.messages. UI-only fields must never reach PostgREST:
  // an unknown column makes the complete message write fail with HTTP 400.
  // Agent Work chronology is intentionally persisted in a versioned envelope inside the
  // existing raw_response column so rollout requires no schema mutation. The envelope contains
  // only public operational events; private reasoning/provider telemetry never enters it.
  const candidates: Record<string, unknown> = {
    id: message.id,
    workspace_id: workspaceId,
    sender_name: message.senderName,
    sender_role: message.senderRole,
    sender_color: message.senderColor,
    text: message.text,
    is_ai: message.role === 'model',
    attachments,
    reactions: message.reactions,
    grounding_urls: message.groundingUrls,
    questions: message.questions,
    created_at: Number.isFinite(Number(message.createdAt))
      ? new Date(Number(message.createdAt)).toISOString()
      : nowIso(),
    role: message.role,
    thinking_text: message.thinkingText,
    agent_role: message.agentRole,
    action_summary: message.actionSummary,
    document_snapshot: message.documentSnapshot,
    previous_document_snapshot: message.previousDocumentSnapshot,
    document_actions: message.documentActions,
    score: message.score,
    score_explanation: message.scoreExplanation,
    token_count: message.tokenCount,
    thinking_time: message.thinkingTime,
    owner_id: ownerId ?? message.ownerId,
    raw_response: persistedRawResponse,
    reply_to_id: message.replyToId,
    knowledge_sources: message.knowledgeSources,
    is_error: message.isError === true,
    retry_payload: retryPayload,
    provider: hidesPrivateRuntimeTelemetry ? null : message.provider,
    response_model: hidesPrivateRuntimeTelemetry ? null : message.responseModel,
    fallback_used: hidesPrivateRuntimeTelemetry ? false : message.fallbackUsed,
  };
  return Object.fromEntries(
    Object.entries(candidates).filter(([, value]) => value !== undefined),
  );
}

export async function saveUserMessage(
  workspaceId: string,
  ownerId: string,
  message: Message,
): Promise<void> {
  if (FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME) {
    // User-message persistence is the turn boundary. Clear any previous live
    // chronology before the new assistant stream can emit canonical sequence 1.
    resetAgentWorkLiveSnapshot();
  }
  if (FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME && Array.isArray(message.attachments)) {
    const originalAttachments = message.attachments;
    const persistedAttachments = await persistAssistantToolAttachments(workspaceId, originalAttachments);
    // Keep the caller's attachment array in sync. useMessages passes this same array
    // into prepareAssistantChatAttachments after persistence; mutating in place ensures
    // XLSX action files are no longer treated as text chat attachments.
    originalAttachments.splice(0, originalAttachments.length, ...persistedAttachments);
    message.attachments = originalAttachments;
  }

  // The assistant runtime needs the user message row before it can claim the turn, so this
  // write remains on the critical path. The workspace freshness touch does not: awaiting a
  // second PostgREST round-trip here directly inflates send -> runtime-start TTFT.
  const { error } = await supabase.from('messages').upsert(toMessagePayload(workspaceId, message, ownerId));
  if (error) throw error;

  void supabase
    .from('workspaces')
    .update({ last_updated: nowIso() })
    .eq('id', workspaceId)
    .then(({ error: workspaceError }) => {
      if (workspaceError) console.warn('Workspace freshness touch failed after message save:', workspaceError);
    });
}

export async function saveAiMessage(
  workspaceId: string,
  ownerId: string,
  message: Message,
): Promise<void> {
  const currentWorkEvents = message.workEvents?.length
    ? message.workEvents
    : FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
      ? getAgentWorkLiveSnapshot()
      : [];
  const persistableMessage = currentWorkEvents.length
    ? { ...message, workEvents: currentWorkEvents }
    : message;
  const { error } = await supabase.from('messages').upsert(toMessagePayload(workspaceId, persistableMessage, ownerId));
  if (error) throw error;
  if (FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME) {
    // Atomically hand the just-persisted canonical chronology to the completed
    // message view before clearing the transient turn snapshot. This prevents a
    // final render from falling back to reported:/observed: compatibility rows.
    if (currentWorkEvents.length) {
      registerPersistedAgentWorkEvents(message.createdAt, currentWorkEvents);
    }
    // Persistence has copied the authoritative public chronology into the message
    // envelope. Clear the transient singleton so a retry/new turn cannot briefly
    // render the previous turn while waiting for its first canonical event.
    resetAgentWorkLiveSnapshot();
  }
}

export async function saveMessageReactions(
  workspaceId: string,
  messageId: string,
  reactions: NonNullable<Message['reactions']>,
): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .update({ reactions })
    .eq('id', messageId)
    .eq('workspace_id', workspaceId);
  if (error) throw error;
}
