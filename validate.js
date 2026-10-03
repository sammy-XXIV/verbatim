// Deterministic checks between the model's extraction and the real order.
// The model only proposes lines; nothing reaches the sheet unless every fact
// in it (item, quantity, unit) is written in the customer's own message.

const WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, half: 0.5,
};
const UNITS = { piece: 'piece', pieces: 'piece', pcs: 'piece', pc: 'piece', dozen: 'dozen', dozens: 'dozen',
  box: 'box', boxes: 'box', pack: 'pack', packs: 'pack' };
const HEDGE = /\b(maybe|about|around|roughly|approx|not sure|or so)\b/;

const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokens = s => [...s.matchAll(/\d+(?:\.\d+)?|[a-z]+/g)].map(m => ({ t: m[0], i: m.index }));
const numberOf = t => (/^\d/.test(t) ? Number(t) : WORDS[t]);

const startWords = catalog => new Set(catalog.items.flatMap(i => [i.name, ...i.aliases]).map(n => norm(n).split(' ')[0]));

// True when the number at qt[idx] is followed by a unit or a product word.
function countsSomething(qt, idx, starts) {
  let next = idx + 1;
  while (qt[next] && ['of', 'x', 'a', 'an'].includes(qt[next].t)) next++;
  return Boolean(qt[next] && (UNITS[qt[next].t] || starts.has(qt[next].t)));
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

// Closest product name for a typo, offered as a question only. Never auto-applied.
function suggest(text, catalog) {
  let best = null;
  for (const item of catalog.items) {
    if (item.ambiguous) continue;
    for (const name of [item.name, ...item.aliases].map(norm)) {
      const dist = editDistance(text, name);
      if (dist <= 2 && (!best || dist < best.dist)) best = { name, dist };
    }
  }
  return best?.name;
}

export function findItem(quote, catalog) {
  let best = null;
  for (const item of catalog.items) {
    for (const name of [item.name, ...item.aliases].map(norm)) {
      if (new RegExp(`\\b${esc(name)}\\b`).test(quote) && (!best || name.length > best.name.length)) best = { item, name };
    }
  }
  return best?.item;
}

function checkLine(line, msg, catalog) {
  const quote = norm(line?.quote);
  const label = norm(line?.item) || quote || 'this item';
  const hold = question => ({ ok: false, quote, question });

  if (!quote || !msg.includes(quote)) return hold(`I couldn't find "${label}" in your message. Can you confirm it?`);

  const item = findItem(quote, catalog);
  if (!item) {
    const guess = suggest(norm(line?.item), catalog);
    return hold(guess ? `Did you mean ${guess}?` : `Sorry, "${label}" isn't on our price list. What did you mean?`);
  }
  if (item.ambiguous) {
    const names = item.ambiguous.map(id => catalog.items.find(i => i.id === id).name);
    return hold(`Which ${item.name}: ${names.join(' or ')}?`);
  }

  const qt = tokens(quote);
  const plural = (item.plural ?? `${item.name}s`).toLowerCase();
  const nums = qt.filter(x => numberOf(x.t) !== undefined);
  if (!nums.length) return hold(`How many ${plural}?`);
  const real = nums.filter(x => x.t !== 'a' && x.t !== 'an').map(x => x.t);
  if (real.length > 1) return hold(`Is that ${real.join(' or ')} ${plural}?`);
  // A null quantity with exactly one number written is read from the customer's words, not guessed.
  const quantity = line.quantity == null && nums.length === 1 ? numberOf(nums[0].t) : Number(line.quantity);

  // The quantity must sit right before a unit or the product ("10 people" is not 10 cupcakes).
  const starts = startWords(catalog);
  if (!qt.some((x, i) => numberOf(x.t) === quantity && countsSomething(qt, i, starts))) return hold(`How many ${plural} exactly?`);

  const at = msg.indexOf(quote);
  if (HEDGE.test(msg.slice(Math.max(0, at - 25), at + quote.length + 20))) return hold(`Just to confirm, how many ${plural}?`);

  const quoteUnits = [...new Set(qt.map(x => UNITS[x.t]).filter(Boolean))];
  const modelUnit = UNITS[norm(line.unit)] ?? null;
  if (quoteUnits.length > 1) return hold(`Is that by ${quoteUnits.join(' or ')}?`);
  if (quoteUnits[0] && modelUnit && modelUnit !== 'piece' && modelUnit !== quoteUnits[0]) return hold(`Is that ${quantity} ${quoteUnits[0]}?`);
  if (quoteUnits[0] && modelUnit === 'piece') return hold(`Is that ${quantity} ${quoteUnits[0]} or ${quantity} pieces?`);
  const unit = quoteUnits[0] ?? Object.keys(item.units)[0];
  if (!item.units[unit]) return hold(`We don't sell ${item.name.toLowerCase()} by the ${unit}. How many pieces?`);

  const pieces = quantity * item.units[unit];
  if (!Number.isInteger(pieces) || pieces <= 0) return hold(`How many ${item.name.toLowerCase()}s exactly?`);

  const amount = Math.round(pieces * item.price * 100) / 100;
  return { ok: true, line: { id: item.id, name: item.name, quantity: quantity, unit, pieces, price: item.price, amount, quote } };
}

// Parts of the message that mention a number or an item but sit outside every
// accepted quote: the model skipped them, so they are held instead of lost.
// Only numbers that count a product ("3 cupcakes") and product names that are not
// just talk ("your pies are the best") count as order mentions.
function uncovered(msg, spans, catalog) {
  const names = catalog.items.flatMap(i => [i.name, ...i.aliases]).map(norm);
  const starts = startWords(catalog);
  const out = [];
  let offset = 0;
  for (const clause of msg.split(/(,|;|\n|\.\s|\band\b|\bplus\b|&)/)) {
    const start = offset;
    offset += clause.length;
    const ct = tokens(clause);
    const hits = ct.filter((x, i) => (/^\d/.test(x.t) || (WORDS[x.t] && x.t !== 'a' && x.t !== 'an')) && countsSomething(ct, i, starts))
      .map(x => start + x.i)
      .concat(names.flatMap(n => [...clause.matchAll(new RegExp(`\\b${esc(n)}\\b`, 'g'))]
        .filter(m => !/\b(your|my|the|our|his|her|their|these|those)\s+$/.test(clause.slice(0, m.index)))
        .map(m => start + m.index)));
    if (hits.some(p => !spans.some(([s, e]) => p >= s && p < e))) {
      out.push({ quote: clause.trim(), question: `I didn't catch "${clause.trim()}". What would you like?` });
    }
  }
  return out;
}

export function validate(message, extraction, catalog) {
  const msg = norm(message);
  if (!extraction || !Array.isArray(extraction.lines)) {
    return { confirmed: [], held: [{ quote: msg, question: 'I could not read this order. Can you send it again?' }], total: 0 };
  }

  const confirmed = [];
  const held = [];
  const spans = [];
  for (const line of extraction.lines) {
    const r = checkLine(line, msg, catalog);
    const quote = r.ok ? r.line.quote : r.quote;
    if (quote && msg.includes(quote)) {
      const s = msg.indexOf(quote);
      spans.push([s, s + quote.length]);
    }
    r.ok ? confirmed.push(r.line) : held.push({ quote: r.quote, question: r.question });
  }
  held.push(...uncovered(msg, spans, catalog));
  if (!confirmed.length && !held.length) held.push({ quote: msg, question: "I couldn't find an order here. What would you like?" });

  const total = Math.round(confirmed.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
  return { confirmed, held, total };
}
