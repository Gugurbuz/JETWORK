import fs from 'node:fs'
const path = 'scripts/apply-gemini38-plan-100.mjs'
let source = fs.readFileSync(path, 'utf8')
source = source.split('\\\\`').join('\\`')
source = source.split('\\\\${').join('\\${')
source = source.replace("replaceAllExact('supabase/functions/_shared/groundingGuard.ts', \"source.sourceType !== 'web'\", \"source.sourceType === 'knowledge' || !source.sourceType\", 4)", "replaceAllExact('supabase/functions/_shared/groundingGuard.ts', \"source.sourceType !== 'web'\", \"source.sourceType === 'knowledge' || !source.sourceType\", 2)")
fs.writeFileSync(path, source)
console.log('plan-100 patcher normalized')
