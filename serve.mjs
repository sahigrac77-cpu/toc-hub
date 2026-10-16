// Local preview: node scripts/serve.mjs  then open http://localhost:8080
import http from 'node:http'; import { readFile } from 'node:fs/promises'; import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const types = { '.html': 'text/html', '.json': 'application/json' };
http.createServer(async (q, s) => {
  const p = q.url.split('?')[0]; const f = p === '/' ? '/index.html' : p;
  try { const b = await readFile(join(dir, f)); s.setHeader('content-type', (types[f.slice(f.lastIndexOf('.'))] || 'text/plain') + '; charset=utf-8'); s.end(b); }
  catch { s.statusCode = 404; s.end('not found'); }
}).listen(8080, () => console.log('http://localhost:8080'));
