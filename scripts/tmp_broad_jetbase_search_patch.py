from pathlib import Path

p = Path('supabase/functions/_shared/assistantTools.ts')
s = p.read_text()

old = "description: 'Search published JetWork global knowledge plus active-project knowledge. Returns ranked candidate evidence with canonical identifiers and provenance metadata; search candidates are not citation-ready exact records.',"
new = "description: 'Search published JetWork global knowledge plus active-project knowledge across all catalog object types. This primary semantic candidate search is intentionally type-unfiltered so short identifiers and product-family terms can match methods, messages, classes, documents and other Jetbase objects. Returns ranked candidate evidence with canonical identifiers and provenance metadata; search candidates are not citation-ready exact records.',"
if old not in s:
    raise SystemExit('description marker missing')
s = s.replace(old, new, 1)

old = "        query: { type: 'string', minLength: 2, maxLength: 300 },\n        objectTypes: nullableArray({ type: 'string', enum: objectTypes }),\n        limit: nullableInteger(1, 12),\n      },\n      required: ['query', 'objectTypes', 'limit'],"
new = "        query: { type: 'string', minLength: 2, maxLength: 300 },\n        limit: nullableInteger(1, 12),\n      },\n      required: ['query', 'limit'],"
if old not in s:
    raise SystemExit('schema marker missing')
s = s.replace(old, new, 1)

old = "return searchCatalog(client, workspaceId, query, args.objectTypes, clampLimit(args.limit, 6, 8))"
new = "return searchCatalog(client, workspaceId, query, null, clampLimit(args.limit, 6, 8))"
if old not in s:
    raise SystemExit('execution marker missing')
s = s.replace(old, new, 1)

p.write_text(s)
