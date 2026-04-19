import { SYSTEM_AGENTS } from '../constants';

export interface AgentTarget {
  agentRole: string;
  agentName: string;
  messageText: string;
}

export interface ParseResult {
  isMention: boolean;
  target: AgentTarget | null;
  error: string | null;
}

export const parseAgentMention = (text: string): ParseResult => {
  if (!text.startsWith('@')) {
    return { isMention: false, target: null, error: null };
  }

  const match = text.match(/^@(\w+)\s+(.*)/s);
  if (!match) {
    return {
      isMention: true,
      target: null,
      error: `Ajan adından sonra bir mesaj girmelisiniz (örn: "@BA bana bir analiz yaz").`
    };
  }

  const [, agentName, messageText] = match;
  const agent = SYSTEM_AGENTS.find(
    (a) => a.name.toLowerCase() === agentName.toLowerCase()
  );

  if (!agent) {
    const validNames = SYSTEM_AGENTS.map((a) => `@${a.name}`).join(', ');
    return {
      isMention: true,
      target: null,
      error: `"@${agentName}" adında bir ajan bulunamadı. Geçerli ajanlar: ${validNames}`
    };
  }

  return {
    isMention: true,
    target: {
      agentRole: agent.role,
      agentName: agent.name,
      messageText: messageText.trim()
    },
    error: null
  };
};

export const isJetWorkMention = (text: string): boolean => {
  return (
    text.includes('@JetWork') ||
    text.startsWith('/spike') ||
    text.startsWith('/thinkmore') ||
    text.startsWith('/websearch') ||
    text.startsWith('/story') ||
    text.startsWith('/test') ||
    text.startsWith('/read')
  );
};

export const parseReadUrl = (text: string): string | null => {
  const match = text.match(/\/read\s+(https?:\/\/[^\s]+)/);
  return match ? match[1] : null;
};
