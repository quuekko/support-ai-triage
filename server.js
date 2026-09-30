import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import handler from './api/index.js';

try {
  const env = await readFile('.env', 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* .env is optional */ }

const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) return handler(req, res);
  const path = new URL(req.url, 'http://localhost').pathname;
  if (['/', '/index.html', '/admin', '/login', '/admin/login'].includes(path)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(await readFile(path.endsWith('/login') ? 'login.html' : 'index.html'));
  }
  res.writeHead(404); res.end('Not found');
});
const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`http://localhost:${port}`));
