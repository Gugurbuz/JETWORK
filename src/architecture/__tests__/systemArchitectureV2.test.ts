import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const platformRoot = join(repoRoot, 'supabase/functions/_shared/platform')
const gatewayRoot = join(repoRoot, 'supabase/functions/assistant-gateway')

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs'])

function extension(path: string) {
  const index = path.lastIndexOf('.')
  return index >= 0 ? path.slice(index) : ''
}

function walk(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (sourceExtensions.has(extension(entry.name))) files.push(path)
  }
  return files
}

function importsOf(source: string): string[] {
  const imports: string[] = []
  for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g)) {
    if (match[1]) imports.push(match[1])
  }
  return imports
}

function normalize(path: string) {
  return path.split(sep).join('/')
}

function platformContext(path: string): string | null {
  const rel = normalize(relative(platformRoot, path))
  if (!rel || rel.startsWith('..')) return null
  return rel.split('/')[0] || null
}

const allowedCrossContextTargets = new Set([
  'contracts',
  'interfaces',
])

const semanticGatewaySymbols = [
  'semanticOrchestrator',
  'controllerPolicy',
  'documentArtifactRouting',
  'trivialAssistantFastPath',
  'authoritativeInventoryFastPath',
]

describe('JETWORK System Architecture V2 fitness functions', () => {
  it('does not introduce version-suffixed implementation files in the target platform', () => {
    const offenders = walk(platformRoot)
      .map(path => normalize(relative(repoRoot, path)))
      .filter(path => /(?:V|v)\d+\.(?:ts|tsx|js|mjs)$/.test(path))

    expect(offenders, 'Version-wrapper chains are compatibility debt, not target architecture').toEqual([])
  })

  it('requires cross-bounded-context imports to use contracts or explicit interfaces', () => {
    const offenders: string[] = []

    for (const file of walk(platformRoot)) {
      const sourceContext = platformContext(file)
      if (!sourceContext || allowedCrossContextTargets.has(sourceContext) || sourceContext === 'compat') continue

      const source = readFileSync(file, 'utf8')
      for (const specifier of importsOf(source)) {
        if (!specifier.startsWith('.')) continue
        const target = resolve(dirname(file), specifier)
        const targetContext = platformContext(target)
        if (!targetContext || targetContext === sourceContext) continue
        if (allowedCrossContextTargets.has(targetContext)) continue
        if (/\/(?:public|interface|interfaces)(?:\.|\/)/.test(normalize(target))) continue

        offenders.push(`${normalize(relative(repoRoot, file))} -> ${specifier}`)
      }
    }

    expect(offenders, 'Bounded contexts may not import another context private implementation').toEqual([])
  })

  it('keeps provider adapters free of artifact, knowledge, evidence and agent policy imports', () => {
    const intelligenceRoot = join(platformRoot, 'intelligence')
    const forbiddenSegments = ['/artifact/', '/knowledge/', '/evidence/', '/agent/']
    const offenders: string[] = []

    for (const file of walk(intelligenceRoot)) {
      const normalizedFile = normalize(file)
      if (!/\/(?:provider|providers|adapter|adapters)\//.test(normalizedFile)) continue
      const source = readFileSync(file, 'utf8')
      for (const specifier of importsOf(source)) {
        if (!specifier.startsWith('.')) continue
        const target = normalize(resolve(dirname(file), specifier))
        if (forbiddenSegments.some(segment => target.includes(segment))) {
          offenders.push(`${normalize(relative(repoRoot, file))} -> ${specifier}`)
        }
      }
    }

    expect(offenders, 'Provider adapters are transport/normalization only').toEqual([])
  })

  it('keeps the target gateway semantically inert', () => {
    const offenders: string[] = []
    for (const file of walk(gatewayRoot)) {
      const source = readFileSync(file, 'utf8')
      const hits = semanticGatewaySymbols.filter(symbol => source.includes(symbol))
      if (hits.length) offenders.push(`${normalize(relative(repoRoot, file))}: ${hits.join(', ')}`)
    }

    expect(offenders, 'Gateway owns protocol/security/lease/SSE, not semantic routing').toEqual([])
  })

  it('does not let artifact implementation import the agent/controller implementation', () => {
    const artifactRoot = join(platformRoot, 'artifact')
    const offenders: string[] = []

    for (const file of walk(artifactRoot)) {
      const source = readFileSync(file, 'utf8')
      for (const specifier of importsOf(source)) {
        if (!specifier.startsWith('.')) continue
        const target = normalize(resolve(dirname(file), specifier))
        if (target.includes('/platform/agent/')) {
          offenders.push(`${normalize(relative(repoRoot, file))} -> ${specifier}`)
        }
      }
    }

    expect(offenders, 'Artifact execution cannot depend on the controller').toEqual([])
  })

  it('does not let evidence critics execute tools directly', () => {
    const evidenceRoot = join(platformRoot, 'evidence')
    const offenders: string[] = []

    for (const file of walk(evidenceRoot)) {
      if (!/critic/i.test(basename(file))) continue
      const source = readFileSync(file, 'utf8')
      for (const specifier of importsOf(source)) {
        if (!specifier.startsWith('.')) continue
        const target = normalize(resolve(dirname(file), specifier))
        if (target.includes('/platform/execution/')) {
          offenders.push(`${normalize(relative(repoRoot, file))} -> ${specifier}`)
        }
      }
    }

    expect(offenders, 'Evidence critic reports coverage/gaps/conflicts; it does not choose or execute tools').toEqual([])
  })

  it('requires compatibility adapters to declare ownership and removal conditions', () => {
    const compatRoot = join(platformRoot, 'compat')
    const offenders: string[] = []

    for (const file of walk(compatRoot)) {
      const source = readFileSync(file, 'utf8')
      const requiredMarkers = ['@compat-owner', '@compat-target', '@compat-remove-by']
      const missing = requiredMarkers.filter(marker => !source.includes(marker))
      if (missing.length) offenders.push(`${normalize(relative(repoRoot, file))}: missing ${missing.join(', ')}`)
    }

    expect(offenders, 'Compatibility code must be explicitly owned and expiring').toEqual([])
  })
})
