from pathlib import Path
p=Path('supabase/functions/openai-assistant-core-v2/implementation.ts')
s=p.read_text()
needle="import { hasExactTechnicalIdentifier } from '../_shared/technicalIdentifier.ts'\n"
insert=needle+"import { resultHasVerifiedKnowledgeEvidence } from '../_shared/groundingGuard.ts'\n"
if "resultHasVerifiedKnowledgeEvidence } from '../_shared/groundingGuard.ts'" not in s:
    if needle not in s: raise SystemExit('import marker missing')
    s=s.replace(needle,insert,1)
p.write_text(s)

# Assert semantic grounding functions remain absent from live core.
for forbidden in ['evaluateGroundedTechnicalClaims','shouldFailClosedGroundedAnswer','groundingFailureText','[GROUNDING_REPAIR_OBSERVATION]','grounding_fail_closed']:
    if forbidden in s: raise SystemExit(f'forbidden semantic grounding path remains: {forbidden}')
