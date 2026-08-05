import { supabase } from '../supabase';
import { camelToSnake, nowIso } from '../lib/mapping';
import type { Message } from '../types';
import { FEATURE_FLAGS } from '../lib/featureFlags';

function toMessagePayload(workspaceId: string, message: Message, ownerId?: string): Record<string, unknown> {
  const {
    phase: _phase,
    phaseLabel: _phaseLabel,
    isTyping: _typing,
    isError: _isError,
    retryPayload: _retry,
    ...persistable
  } = message as any;
  if (
    FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
    && Array.isArray(persistable.attachments)
  ) {
    persistable.attachments = persistable.attachments.map((attachment: any) => {
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
  const payload = camelToSnake<Record<string, unknown>>(persistable);
  payload.workspace_id = workspaceId;
  payload.created_at = Number.isFinite(Number(message.createdAt))
    ? new Date(Number(message.createdAt)).toISOString()
    : nowIso();
  if (ownerId) payload.owner_id = ownerId;
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
