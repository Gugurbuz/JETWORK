import { supabase } from '../supabase';
import type { DocumentData } from '../types';
import type { DocumentOperation, DocumentSectionKey } from './ai/intentTypes';
import type { AiTurnAction } from './ai/aiTurnDecision';

export type PendingOperationStatus = 'pending' | 'confirmed' | 'applied' | 'cancelled' | 'expired' | 'failed';

export interface PendingOperation {
  id: string;
  workspaceId: string;
  createdBy: string;
  action: AiTurnAction;
  operation: DocumentOperation;
  targetSection: DocumentSectionKey | null;
  baseDocument: DocumentData;
  proposedDocument: DocumentData;
  diff: {
    changedSections: string[];
    beforeCharacters: number;
    afterCharacters: number;
  };
  requestText: string;
  status: PendingOperationStatus;
  expiresAt: string;
}

export interface CreatePendingOperationInput {
  workspaceId: string;
  action: AiTurnAction;
  operation: DocumentOperation;
  targetSection?: DocumentSectionKey | null;
  baseDocument: DocumentData;
  proposedDocument: DocumentData;
  requestText: string;
}

const documentTextLength = (document: DocumentData): number => Object.values(document)
  .reduce((total, value: any) => total + (typeof value?.content === 'string' ? value.content.length : 0), 0);

function changedSections(base: DocumentData, proposed: DocumentData): string[] {
  const keys = new Set([...Object.keys(base), ...Object.keys(proposed)]);
  return [...keys].filter(key => {
    const before = (base as any)[key];
    const after = (proposed as any)[key];
    return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
  });
}

function mapRow(row: any): PendingOperation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    action: row.action,
    operation: row.operation,
    targetSection: row.target_section || null,
    baseDocument: row.base_document || {},
    proposedDocument: row.proposed_document || {},
    diff: row.diff || { changedSections: [], beforeCharacters: 0, afterCharacters: 0 },
    requestText: row.request_text,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

export async function createPendingOperation(input: CreatePendingOperationInput): Promise<PendingOperation> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (authError || !userId) throw authError || new Error('Authenticated user is required.');

  const diff = {
    changedSections: changedSections(input.baseDocument, input.proposedDocument),
    beforeCharacters: documentTextLength(input.baseDocument),
    afterCharacters: documentTextLength(input.proposedDocument),
  };

  const { data, error } = await supabase
    .from('pending_operations')
    .insert({
      workspace_id: input.workspaceId,
      created_by: userId,
      action: input.action,
      operation: input.operation,
      target_section: input.targetSection || null,
      base_document: input.baseDocument,
      proposed_document: input.proposedDocument,
      diff,
      request_text: input.requestText,
    })
    .select('*')
    .single();

  if (error) throw error;
  return mapRow(data);
}

export async function getLatestPendingOperation(workspaceId: string): Promise<PendingOperation | null> {
  const { data, error } = await supabase
    .from('pending_operations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}

async function updateStatus(
  operationId: string,
  status: PendingOperationStatus,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const { error } = await supabase
    .from('pending_operations')
    .update({ status, ...extra })
    .eq('id', operationId);
  return !error;
}

export const confirmPendingOperation = (operationId: string, messageId?: string): Promise<boolean> => updateStatus(
  operationId,
  'confirmed',
  { confirmed_at: new Date().toISOString(), confirmation_message_id: messageId || null },
);

export const markPendingOperationApplied = (operationId: string): Promise<boolean> => updateStatus(
  operationId,
  'applied',
  { applied_at: new Date().toISOString() },
);

export const cancelPendingOperation = (operationId: string): Promise<boolean> => updateStatus(operationId, 'cancelled');

export const failPendingOperation = (operationId: string, errorMessage: string): Promise<boolean> => updateStatus(
  operationId,
  'failed',
  { error_message: errorMessage.slice(0, 1000) },
);

export function documentsMatch(left: DocumentData | null, right: DocumentData | null): boolean {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}
