# Runtime Stream Stabilization

The public `openai-assistant-v2` endpoint is a transport gateway. It forwards the authenticated request to `openai-assistant-core-v2` without coupling the durable reasoning turn to the browser request signal.

The gateway drains the upstream SSE stream under `EdgeRuntime.waitUntil()` so a browser navigation or cancelled response cannot terminate the core turn. Downstream writes use `createSafeStreamSink`, which makes `enqueue`, `[DONE]`, and `close` idempotent and converts a disconnected stream controller into a no-op rather than a reasoning failure.

The core runtime remains pinned to the previously production-verified Reasoning Engine v2 implementation. This package changes stream lifecycle semantics only; it does not alter routing, planning, tools, verification, synthesis, or artifact behavior.
