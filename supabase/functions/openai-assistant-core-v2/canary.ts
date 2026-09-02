// Non-production Agentic Runtime V2 core entry.
// Static import order is intentional: bootstrap must configure the canary
// compatibility/provider guards before implementation.ts evaluates.
import '../_shared/runtime/agenticCanaryBootstrap.ts'
import './implementation.ts'
