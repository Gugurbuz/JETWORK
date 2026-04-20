import { parse as parsePartialJson } from 'partial-json';
import { DocumentData, Question, SectionData } from '../types';

export interface StreamChunkResult {
  text: string;
  thinkingText: string;
  questions?: Question[];
  documentUpdates?: Record<string, any>;
  isNoResponse: boolean;
}

export const parseStreamChunk = (rawText: string, existingThinking = ''): StreamChunkResult => {
  let text = rawText;
  let thinkingText = existingThinking;
  let questions: Question[] | undefined;
  let documentUpdates: Record<string, any> | undefined;
  let isNoResponse = false;

  let jsonToParse = rawText.trim();
  const jsonBlockMatch = rawText.match(/```(?:json)?\n([\s\S]*?)(```|$)/);
  if (jsonBlockMatch) {
    jsonToParse = jsonBlockMatch[1].trim();
  }

  if (jsonToParse.startsWith('{')) {
    try {
      const parsed = parsePartialJson(jsonToParse);
      if (parsed && typeof parsed === 'object') {
        if (parsed.message) {
          text = parsed.message;
        }
        if (parsed.thinking && !thinkingText) {
          thinkingText = parsed.thinking;
        }
        if (parsed.questions && Array.isArray(parsed.questions)) {
          questions = parsed.questions;
        }
        if (parsed.document && typeof parsed.document === 'object') {
          documentUpdates = parsed.document;
        }
      }
    } catch {
      text = rawText.trim();
    }
  }

  if (text.trim().startsWith('NO_RESPONSE')) {
    isNoResponse = true;
  }

  return { text, thinkingText, questions, documentUpdates, isNoResponse };
};

export const parseFinalResponse = (rawText: string): {
  text: string;
  questions?: Question[];
  documentUpdates?: Record<string, any>;
} => {
  let text = rawText;
  let questions: Question[] | undefined;
  let documentUpdates: Record<string, any> | undefined;

  let jsonToParse = rawText.trim();
  const jsonBlockMatch = rawText.match(/```(?:json)?\n([\s\S]*?)(```|$)/);
  if (jsonBlockMatch) {
    jsonToParse = jsonBlockMatch[1].trim();
  }

  if (jsonToParse.startsWith('{')) {
    try {
      const parsed = JSON.parse(jsonToParse);
      if (parsed.message) {
        text = parsed.message;
      }
      if (parsed.questions && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        questions = parsed.questions;
      }
      if (parsed.document && typeof parsed.document === 'object') {
        documentUpdates = parsed.document;
        if (Object.keys(parsed.document).length > 0) {
          text += '\n\n*(Sistem Notu: Doküman güncellendi)*';
        }
      }
    } catch {
      text = rawText.trim();
    }
  }

  return { text, questions, documentUpdates };
};
