import { supabase } from '../supabase';
import { nowIso } from '../lib/mapping';
import type { Message } from '../types';
import { FEATURE_FLAGS } from '../lib/featureFlags';

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

  // Keep this list aligned with public.messages. UI-only fields must never reach PostgREST:
  // an unknown column makes the complete message write fail with HTTP 400.
  // Runtime progress/reasoning/provider labels are transient observability metadata in the
  // single assistant runtime and must never become durable user-visible conversation content.
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
    thinking_text: hidesPrivateRuntimeTelemetry ? null : message.thinkingText,
    agent_role: message.agentRole,
    action_summary: message.actionSummary,
    document_snapshot: message.documentSnapshot,
    previous_document_snapshot: message.previousDocumentSnapshot,
    document_actions: message.documentActions,
    score: message.score,
    score_explanation: message.scoreExplanation,
    token_count: message.tokenCount,
    thinking_time: hidesPrivateRuntimeTelemetry ? null : message.thinkingTime,
    owner_id: ownerId ?? message.ownerId,
    raw_response: message.rawResponse,
    reply_to_id: message.replyToId,
    knowledge_sources: message.knowledgeSources,
    is_error: message.isError === true,
    retry_payload: retryPayload,
    provider: hidesPrivateRuntimeTelemetry ? null : message.provider,
    response_model: hidesPrivateRuntimeTelemetry ? null : message.responseModel,
    fallback_used: hidesPrivateRuntimeTelemetry ? false : message.fallbackUsed,
  };
  const payload = Object.fromEntries(
    Object.entries(candidates).filter(([, value]) => value !== undefined),
  );
  return payload;
}

export async function saveUserMessage(
  workspaceId: string,
  ownerId: string,
  message: Message,
): Promise<void> {
  const { error } = await supabase.from('messages').upsert(toMessagePayload(workspaceId, message, ownerId));
  if (error) throw error;

  const { error: workspaceError } = await supabase
    .from('workspaces')
    .update({ last_updated: nowIso() })
    .eq('id', workspaceId);
  if (workspaceError) throw workspaceError;
}

export async function saveAiMessage(
  workspaceId: string,
  ownerId: string,
  message: Message,
): Promise<void> {
  const { error } = await supabase.from('messages').upsert(toMessagePayload(workspaceId, message, ownerId));
  if (error) throw error;
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
