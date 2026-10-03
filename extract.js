// Asks an open-weight model to split a customer message into order lines.
// Works with any OpenAI-compatible endpoint: Ollama, llama.cpp, vLLM,
// Cloudflare Workers AI. The output is only a proposal; validate.js decides.

const env = globalThis.process?.env ?? {};
const BASE = env.LLM_BASE_URL ?? 'http://localhost:11434/v1';
const MODEL = env.LLM_MODEL ?? 'gemma3:12b';
const KEY = env.LLM_API_KEY ?? 'ollama';

export const SYSTEM = `You read WhatsApp orders for a small bakery and list the items ordered.
Reply with JSON only: {"lines":[{"quote":"...","item":"...","quantity":number|null,"unit":"piece"|"dozen"|"box"|"pack"|null}]}
Rules:
- "quote" is the exact words from the message for that line, copied character for character.
- "item" is the product as the customer wrote it.
- "quantity" is the number the customer wrote, in their unit. Use null if they gave no number.
- "unit" is the unit the customer wrote, or null if none.
- One line per product. Skip greetings, chat and questions. Do not guess.`;

export async function extract(message) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, temperature: 0, messages: messagesFor(message) }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseJson((await res.json()).choices?.[0]?.message?.content ?? '');
}

export const messagesFor = message => [{ role: 'system', content: SYSTEM }, { role: 'user', content: message }];

// Models often wrap JSON in prose or code fences. Anything unreadable becomes
// null, which validate() holds instead of guessing.
export function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
