export type AgentWorkEventState = 'pending' | 'active' | 'completed' | 'warning' | 'failed';
export type AgentWorkEventKind = 'agent' | 'tool' | 'source' | 'artifact' | 'warning' | 'final';
export type AgentWorkSourceType = 'knowledge' | 'web' | 'media' | 'github' | 'vercel' | 'artifact' | 'runtime';

export interface AgentWorkEvent {
  eventId: string;
  sequence: number;
  kind: AgentWorkEventKind;
  label: string;
  tool?: string;
  sourceType?: AgentWorkSourceType;
  startedAt?: string;
  completedAt?: string;
  state: AgentWorkEventState;
  rawLabel?: string;
}
