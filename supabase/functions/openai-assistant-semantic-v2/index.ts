// Semantic gateway wrapper for Runtime Stream Stabilization.
// The gateway normally uses SafeStreamSink, but its trivial/cached fast-path
// still writes directly to a ReadableStream controller. Install the same
// terminal lifecycle guard before loading the gateway implementation so a
// browser disconnect cannot surface as a runtime failure.
import { installStreamControllerLifecycleGuard } from '../_shared/streamControllerGuard.ts'

installStreamControllerLifecycleGuard()

await import('../openai-assistant-v2/index.ts')
