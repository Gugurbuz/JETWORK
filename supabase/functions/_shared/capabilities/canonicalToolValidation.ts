import type { RuntimeToolSchema } from './registry.ts'

const allowedTypes = (schema: Record<string, unknown>) => {
  const raw = schema.type
  return Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : []
}

const valueType = (value: unknown) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  if (typeof value === 'number') return 'number'
  return typeof value
}

const validateValue = (schema: Record<string, unknown>, value: unknown, path: string): void => {
  const types = allowedTypes(schema)
  const actual = valueType(value)
  const typeOk = !types.length
    || types.includes(actual)
    || (actual === 'integer' && types.includes('number'))
  if (!typeOk) throw new Error(`${path} must be ${types.join('|')}; received ${actual}.`)
  if (value === null) return

  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) {
    throw new Error(`${path} is not an allowed enum value.`)
  }

  if (typeof value === 'string') {
    const minLength = Number(schema.minLength)
    const maxLength = Number(schema.maxLength)
    if (Number.isFinite(minLength) && value.length < minLength) throw new Error(`${path} is shorter than minLength ${minLength}.`)
    if (Number.isFinite(maxLength) && value.length > maxLength) throw new Error(`${path} exceeds maxLength ${maxLength}.`)
  }

  if (typeof value === 'number') {
    const minimum = Number(schema.minimum)
    const maximum = Number(schema.maximum)
    if (Number.isFinite(minimum) && value < minimum) throw new Error(`${path} is below minimum ${minimum}.`)
    if (Number.isFinite(maximum) && value > maximum) throw new Error(`${path} exceeds maximum ${maximum}.`)
    if (types.includes('integer') && !Number.isInteger(value)) throw new Error(`${path} must be an integer.`)
  }

  if (Array.isArray(value)) {
    const minItems = Number(schema.minItems)
    const maxItems = Number(schema.maxItems)
    if (Number.isFinite(minItems) && value.length < minItems) throw new Error(`${path} has fewer than ${minItems} items.`)
    if (Number.isFinite(maxItems) && value.length > maxItems) throw new Error(`${path} has more than ${maxItems} items.`)
    if (schema.uniqueItems === true) {
      const serialized = value.map(item => JSON.stringify(item))
      if (new Set(serialized).size !== serialized.length) throw new Error(`${path} must contain unique items.`)
    }
    const itemSchema = schema.items && typeof schema.items === 'object' ? schema.items as Record<string, unknown> : null
    if (itemSchema) value.forEach((item, index) => validateValue(itemSchema, item, `${path}[${index}]`))
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    const properties = schema.properties && typeof schema.properties === 'object'
      ? schema.properties as Record<string, Record<string, unknown>>
      : {}
    const required = Array.isArray(schema.required) ? schema.required.map(String) : []
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(object, key)) throw new Error(`${path}.${key} is required.`)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(object)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) throw new Error(`${path}.${key} is not allowed.`)
      }
    }
    for (const [key, nestedSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(object, key)) validateValue(nestedSchema, object[key], `${path}.${key}`)
    }
  }
}

export const validateCanonicalToolArguments = (
  tools: readonly RuntimeToolSchema[],
  capabilityName: string,
  args: Record<string, unknown>,
) => {
  const tool = tools.find(candidate => candidate.name === capabilityName)
  if (!tool) throw new Error(`Unknown canonical capability: ${capabilityName}`)
  const schema = tool.parameters && typeof tool.parameters === 'object'
    ? tool.parameters as Record<string, unknown>
    : { type: 'object' }
  validateValue(schema, args, capabilityName)
  return args
}
