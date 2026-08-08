import fs from 'node:fs';
import ts from 'typescript';

const files = [
  'supabase/functions/_shared/assistantTools.ts',
  'supabase/functions/_shared/artifactSourceFidelity.ts',
  'supabase/functions/_shared/knowledgeParser.ts',
  'supabase/functions/_shared/modelProviders.ts',
  'supabase/functions/_shared/providerCircuitBreaker.ts',
  'supabase/functions/_shared/safeStreamSink.ts',
  'supabase/functions/ingest-knowledge-source/index.ts',
  'supabase/functions/normalize-artifact-v2/index.ts',
  'supabase/functions/openai-assistant/index.ts',
  'supabase/functions/openai-assistant-v2/index.ts',
  'supabase/functions/openai-assistant-core-v2/index.ts',
];

let hasErrors = false;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    fileName: file,
    reportDiagnostics: true,
  });
  const diagnostics = (result.diagnostics || [])
    .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length === 0) {
    console.log(`${file}: syntax ok`);
    continue;
  }
  hasErrors = true;
  console.error(`${file}:`);
  for (const diagnostic of diagnostics) {
    console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  }
}

if (hasErrors) process.exitCode = 1;
