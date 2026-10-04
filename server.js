import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extract } from './extract.js';
import { validate } from './validate.js';

const catalog = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url)));
const page = readFileSync(new URL('./public/index.html', import.meta.url));
const PORT = process.env.PORT ?? 3000;

const body = req => new Promise((ok, fail) => {
  const chunks = [];
  req.on('data', c => chunks.push(c)).on('end', () => ok(Buffer.concat(chunks))).on('error', fail);
});

// Local open-weight speech-to-text (OpenAI Whisper CLI). Audio never leaves the machine.
function transcribe(audio) {
  const dir = mkdtempSync(join(tmpdir(), 'verbatim-'));
  const file = join(dir, 'note.webm');
  writeFileSync(file, audio);
  const args = [file, '--model', process.env.WHISPER_MODEL ?? 'base', '--language', 'en',
    '--output_format', 'txt', '--output_dir', dir, '--fp16', 'False'];
  return new Promise((ok, fail) => execFile('whisper', args, { timeout: 120_000 }, err => {
    try {
      if (err) return fail(err);
      ok(readFileSync(join(dir, 'note.txt'), 'utf8').trim());
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }));
}

async function order(message) {
  let extraction = null;
  try { extraction = await extract(message); } catch (e) { console.error(e.message); }
  return { message, extraction, ...validate(message, extraction, catalog) };
}

const send = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(page);
    }
    if (req.method === 'GET' && req.url === '/api/catalog') return send(res, 200, catalog);
    if (req.method === 'POST' && req.url === '/api/order') {
      const { message } = JSON.parse(await body(req));
      if (typeof message !== 'string' || !message.trim() || message.length > 2000) return send(res, 400, { error: 'message required (max 2000 chars)' });
      return send(res, 200, await order(message));
    }
    if (req.method === 'POST' && req.url === '/api/voice') {
      const audio = await body(req);
      if (!audio.length || audio.length > 10_000_000) return send(res, 400, { error: 'audio required (max 10 MB)' });
      const text = await transcribe(audio);
      return send(res, 200, { transcript: text, ...(await order(text)) });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'something went wrong' });
  }
}).listen(PORT, () => console.log(`Verbatim on http://localhost:${PORT}`));
