import fs from 'node:fs'
const path = 'scripts/apply-gemini38-plan-100.mjs'
let source = fs.readFileSync(path, 'utf8')
source = source.split('\\\\`').join('\\`')
source = source.split('\\\\${').join('\\${')
fs.writeFileSync(path, source)
console.log('plan-100 patcher template escapes normalized')
