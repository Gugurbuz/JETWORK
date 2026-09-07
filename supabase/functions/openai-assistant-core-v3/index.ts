// Isolated production Controller V3 core.
//
// The rollout switch is process-local to this dedicated Edge Function identity;
// request headers/body/user content cannot influence it. The shared durable core
// remains rollback-compatible while this entry guarantees the V3 semantic path.
const originalEnvGet = Deno.env.get.bind(Deno.env)
Deno.env.get = ((key: string) => (
  key === 'AGENT_CONTROLLER_V2' ? 'true' : originalEnvGet(key)
)) as typeof Deno.env.get

await import('../openai-assistant-core-v2/index.ts')
