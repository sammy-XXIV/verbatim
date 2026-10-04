// Hosted Verbatim: Cloudflare Worker. Same validator as server.js; the open models
// (Gemma 4 for reading orders, Whisper for voice notes) run on Workers AI.
import catalog from './catalog.json';
import { validate } from './validate.js';
import { messagesFor, parseJson } from './extract.js';

const MODEL = '@cf/google/gemma-4-26b-a4b-it';
const STT = '@cf/openai/whisper-large-v3-turbo';

const json = (data, status = 200) => Response.json(data, { status });

async function order(env, message) {
  let extraction = null;
  try {
    const r = await env.AI.run(MODEL, { messages: messagesFor(message), temperature: 0 });
    const out = r.response ?? r.choices?.[0]?.message?.content ?? '';
    extraction = typeof out === 'string' ? parseJson(out) : out;
  } catch (e) { console.error(e.message); }
  return { message, extraction, ...validate(message, extraction, catalog) };
}

function base64(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    try {
      if (req.method === 'GET' && pathname === '/api/catalog') return json(catalog);
      if (req.method === 'POST' && pathname === '/api/order') {
        const { message } = await req.json();
        if (typeof message !== 'string' || !message.trim() || message.length > 2000) return json({ error: 'message required (max 2000 chars)' }, 400);
        return json(await order(env, message));
      }
      if (req.method === 'POST' && pathname === '/api/voice') {
        const audio = await req.arrayBuffer();
        if (!audio.byteLength || audio.byteLength > 10_000_000) return json({ error: 'audio required (max 10 MB)' }, 400);
        const { text = '' } = await env.AI.run(STT, { audio: base64(audio), language: 'en' });
        return json({ transcript: text.trim(), ...(await order(env, text.trim())) });
      }
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return json({ error: 'something went wrong' }, 500);
    }
  },
};
