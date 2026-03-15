import { parse as parsePartialJson } from 'partial-json';

const json = `"{ \\"message\\": \\"Merhaba @deneme...\\", \\"document\\": { ... } }"`;
const parsed = parsePartialJson(json);
console.log(parsed);
