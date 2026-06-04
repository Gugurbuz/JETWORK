import { callAiWithRetry, callGemini } from '../../services/geminiService';
import {
  ConceptualDesignDocument,
  GenerateConceptualDesignInput,
  GenerateConceptualDesignResult,
} from './conceptualDesignTypes';
import { ConceptualDesignDocumentSchema, conceptualDesignJsonSchema } from './conceptualDesignSchemas';
import {
  buildConceptualDesignSystemPrompt,
  buildConceptualDesignUserPrompt,
} from './conceptualDesignPrompt';
import { normalizeConceptualDesignRequirements } from './requirementNormalizer';
import { runConceptualDesignQualityCheck } from './qualityChecker';

function stripCodeFences(raw: string): string {
  let value = raw.trim();
  const fenced = value.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  if (fenced) value = fenced[1].trim();
  return value;
}

function extractJson(raw: string): string {
  const withoutFence = stripCodeFences(raw);
  if (withoutFence.startsWith('{')) return withoutFence;

  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return withoutFence.slice(firstBrace, lastBrace + 1);
  }

  throw new Error('AI yanıtı içinde geçerli JSON bulunamadı.');
}

function parseConceptualDesign(raw: string): ConceptualDesignDocument {
  const jsonText = extractJson(raw);
  const parsed = JSON.parse(jsonText);
  return ConceptualDesignDocumentSchema.parse(parsed) as ConceptualDesignDocument;
}

function prepareConceptualDesign(document: ConceptualDesignDocument): ConceptualDesignDocument {
  const normalizationResult = normalizeConceptualDesignRequirements(document);
  return normalizationResult.document;
}

function buildContents(input: GenerateConceptualDesignInput) {
  const parts: any[] = [{ text: buildConceptualDesignUserPrompt(input) }];

  input.attachments?.forEach(attachment => {
    parts.push({
      inlineData: {
        data: attachment.data,
        mimeType: attachment.mimeType,
      },
    });
  });

  return [{ role: 'user', parts }];
}

export async function generateConceptualDesign(
  input: GenerateConceptualDesignInput,
): Promise<GenerateConceptualDesignResult> {
  const model = input.model || 'gemini-3-flash-preview';
  const systemInstruction = buildConceptualDesignSystemPrompt();
  let accumulatedText = '';

  await callAiWithRetry(() => callGemini({
    model,
    systemInstruction,
    responseSchema: conceptualDesignJsonSchema,
    contents: buildContents(input),
    onChunk: text => {
      accumulatedText = text;
    },
  }));

  const parsedDocument = parseConceptualDesign(accumulatedText);
  const document = prepareConceptualDesign(parsedDocument);
  const qualityReport = runConceptualDesignQualityCheck(document);

  return {
    document: {
      ...document,
      qualityReport,
    },
    rawResponse: accumulatedText,
    qualityReport,
  };
}

export function tryParseConceptualDesign(raw: string): GenerateConceptualDesignResult {
  const parsedDocument = parseConceptualDesign(raw);
  const document = prepareConceptualDesign(parsedDocument);
  const qualityReport = runConceptualDesignQualityCheck(document);

  return {
    document: {
      ...document,
      qualityReport,
    },
    rawResponse: raw,
    qualityReport,
  };
}
