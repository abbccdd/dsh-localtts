// Static UI fixture only. Never exposes a directory listing or arbitrary files.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const server = createServer((req, res) => {
  if (req.url !== '/') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(readFileSync(new URL('./ui-preview.html', import.meta.url)));
});
server.listen(0, '127.0.0.1', () => console.log(`Static UI fixture: http://127.0.0.1:${server.address().port}`));
