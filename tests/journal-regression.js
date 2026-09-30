const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'content.js'), 'utf8');
const match = source.match(/  function redact\(value, hint = '', max = 1000\) \{[\s\S]*?\n  \}/);
assert(match, 'redactor exists');
const normalizeText = (value, max = 260) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const SENSITIVE_NAME = /(pass(word)?|secret|token|api[-_ ]?key|access[-_ ]?key|refresh[-_ ]?token|cookie|session|authorization|bearer)/i;
const redact = new Function('normalizeText', 'SENSITIVE_NAME', `${match[0]}; return redact`)(normalizeText, SENSITIVE_NAME);
for (const raw of [
  'Токен запроса: EXAMPLE_FAKE_TOKEN_FOR_TESTS Дата и время запроса 2026-09-29',
  'Токен запроса EXAMPLE_FAKE_TOKEN_FOR_TESTS Дата и время запроса 2026-09-29',
  'Bearer abc.def', 'access_token=secret123'
]) {
  const output = redact(raw, 'journal-details', 12000);
  assert(!/EXAMPLE_FAKE_TOKEN_FOR_TESTS|secret123|abc\.def/.test(output), `unmasked: ${output}`);
  assert(output.includes('[masked]'));
}
assert(source.includes('text !== previousText'), 'fresh detail text required');
assert(source.includes('step.details_verified && !step.truncated'), 'completion requires verified association');
assert(source.includes('Нет новых данных') && source.includes('Токен запроса\\s*:?\\s*\\S+'), 'sparse filter response recognized');
assert(source.includes('!/Файл таблицы|Текст письма|Номер строки|SMTP/'), 'other step signatures excluded');
console.log('journal redaction and completeness regression checks passed');
