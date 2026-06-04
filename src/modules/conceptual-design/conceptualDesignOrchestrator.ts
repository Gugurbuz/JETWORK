import type {
  ConceptualDesignDocument,
  GenerateConceptualDesignInput,
  GenerateConceptualDesignResult,
} from './conceptualDesignTypes';
import { generateConceptualDesign, tryParseConceptualDesign } from './conceptualDesignGenerator';
import { analyzeConceptualDesignIntake } from './intakeAnalyzer';
import { buildProcessModelsFromSeeds } from './processModelBuilder';
import { enrichProcessesWithKpis } from './kpiBuilder';
import { buildCommonUiRules, enrichProcessesWithMessages } from './messageCatalogBuilder';
import { normalizeConceptualDesignRequirements } from './requirementNormalizer';
import { runConceptualDesignQualityCheck } from './qualityChecker';

export interface ConceptualDesignOrchestrationResult extends GenerateConceptualDesignResult {
  intake: ReturnType<typeof analyzeConceptualDesignIntake>;
}

function mergeFallbackProcessModels(document: ConceptualDesignDocument, input: GenerateConceptualDesignInput): ConceptualDesignDocument {
  if (document.processModels?.length) return document;

  const intake = analyzeConceptualDesignIntake(input.notes, input.attachments || []);
  return {
    ...document,
    processModels: buildProcessModelsFromSeeds(intake.processSeeds),
  };
}

function enrichDocument(document: ConceptualDesignDocument, input: GenerateConceptualDesignInput): ConceptualDesignDocument {
  const withFallbackProcesses = mergeFallbackProcessModels(document, input);
  const withKpis = enrichProcessesWithKpis(withFallbackProcesses.processModels || []);
  const withMessages = enrichProcessesWithMessages(withKpis);
  const commonUiRules = buildCommonUiRules(withMessages);
  const normalized = normalizeConceptualDesignRequirements({
    ...withFallbackProcesses,
    processModels: withMessages,
    commonUiRules: {
      ...commonUiRules,
      designPrinciples: [
        ...new Set([
          ...(withFallbackProcesses.commonUiRules?.designPrinciples || []),
          ...commonUiRules.designPrinciples,
        ]),
      ],
      validationRules: [
        ...(withFallbackProcesses.commonUiRules?.validationRules || []),
        ...commonUiRules.validationRules,
      ],
      toastRules: [
        ...(withFallbackProcesses.commonUiRules?.toastRules || []),
        ...commonUiRules.toastRules,
      ],
      modalRules: [
        ...(withFallbackProcesses.commonUiRules?.modalRules || []),
        ...commonUiRules.modalRules,
      ],
      emptyStateRules: [
        ...(withFallbackProcesses.commonUiRules?.emptyStateRules || []),
        ...commonUiRules.emptyStateRules,
      ],
    },
  });

  return normalized.document;
}

export async function runConceptualDesignOrchestration(
  input: GenerateConceptualDesignInput,
): Promise<ConceptualDesignOrchestrationResult> {
  const intake = analyzeConceptualDesignIntake(input.notes, input.attachments || []);
  const generated = await generateConceptualDesign({
    ...input,
    conversationSummary: [
      input.conversationSummary,
      `Intake topics: ${intake.detectedTopics.join(', ')}`,
      `Intake risks: ${intake.risks.join(' | ')}`,
    ].filter(Boolean).join('\n'),
  });

  const document = enrichDocument(generated.document, input);
  const qualityReport = runConceptualDesignQualityCheck(document);

  return {
    intake,
    document: {
      ...document,
      qualityReport,
    },
    rawResponse: generated.rawResponse,
    qualityReport,
  };
}

export function runConceptualDesignPostProcessing(
  rawJson: string,
  input: GenerateConceptualDesignInput,
): ConceptualDesignOrchestrationResult {
  const intake = analyzeConceptualDesignIntake(input.notes, input.attachments || []);
  const parsed = tryParseConceptualDesign(rawJson);
  const document = enrichDocument(parsed.document, input);
  const qualityReport = runConceptualDesignQualityCheck(document);

  return {
    intake,
    document: {
      ...document,
      qualityReport,
    },
    rawResponse: rawJson,
    qualityReport,
  };
}
