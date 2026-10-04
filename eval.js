// Runs every labeled test message through the model once, then scores two systems
// on the same extractions:
//   bare     - trust the model's lines as-is (what a prompt + API key app does)
//   verbatim - the model's lines after validate.js
// Usage: node eval.js [--fresh]   (extractions are cached in test/extractions.json)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extract } from './extract.js';
import { validate, findItem } from './validate.js';

const catalog = JSON.parse(readFileSync('catalog.json'));
const casesFile = process.argv.find(a => a.endsWith('.json')) ?? 'test/messages.json';
const cases = JSON.parse(readFileSync(casesFile));
const cacheFile = 'test/extractions.json';
const cache = existsSync(cacheFile) && !process.argv.includes('--fresh') ? JSON.parse(readFileSync(cacheFile)) : {};

for (let i = 0; i < cases.length; i += 4) {
  await Promise.all(cases.slice(i, i + 4).map(async c => {
    if (c.m in cache) return;
    try { cache[c.m] = await extract(c.m); } catch (e) { console.error(e.message); cache[c.m] = null; }
  }));
}
writeFileSync(cacheFile, JSON.stringify(cache, null, 2));

function bare(extraction) {
  const lines = [];
  for (const l of extraction?.lines ?? []) {
    const item = findItem(String(l.item ?? l.quote ?? '').toLowerCase(), catalog);
    if (!item || item.ambiguous || !(Number(l.quantity) > 0)) continue;
    const unit = item.units[l.unit] ? l.unit : Object.keys(item.units)[0];
    lines.push({ id: item.id, pieces: Number(l.quantity) * item.units[unit] });
  }
  return { confirmed: lines, held: [] };
}

function score(name, run) {
  const s = { name, right: 0, wrong: 0, lost: 0, asked: 0, perfect: 0 };
  for (const c of cases) {
    const r = run(c);
    const want = c.ok.map(([id, pieces]) => `${id}:${pieces}`);
    const got = r.confirmed.map(l => `${l.id}:${l.pieces}`);
    const right = got.filter(g => want.includes(g)).length;
    const wrong = got.length - right;
    const missing = want.length - right;
    s.right += right;
    s.wrong += wrong;
    s.asked += r.held.length;
    s.lost += r.held.length ? 0 : missing; // dropped with no question asked
    if (!wrong && !missing && (r.held.length > 0) === (c.held > 0)) s.perfect++;
  }
  return s;
}

const rows = [
  score('bare model', c => bare(cache[c.m])),
  score('verbatim', c => validate(c.m, cache[c.m], catalog)),
];
const total = cases.reduce((n, c) => n + c.ok.length, 0);
console.log(`${cases.length} messages, ${total} orderable lines, model: ${process.env.LLM_MODEL ?? 'default'}\n`);
console.table(rows.map(r => ({
  system: r.name, 'correct lines': r.right, 'WRONG lines committed': r.wrong,
  'lines silently lost': r.lost, 'questions asked': r.asked, 'messages fully right': r.perfect,
})));
writeFileSync(casesFile.replace('.json', '.results.json').replace('messages.', ''), JSON.stringify({ model: process.env.LLM_MODEL, cases: cases.length, total, rows }, null, 2));
