// Isolated browser preview of the real renderer. This bridge never accesses user data or executes commands.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const host = '127.0.0.1';
const port = 4173;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    if (url.pathname === '/preview-bridge.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      return response.end(await fs.readFile(path.join(root, 'tools/design-preview-bridge.js')));
    }
    const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!['index.html', 'renderer.js', 'renderer.js.map', 'styles.css', 'conversation-desk.css', 'security.css', 'buji.png'].includes(filename)) {
      response.writeHead(404); return response.end('Not found');
    }
    let content = await fs.readFile(path.join(root, 'dist', filename));
    if (filename === 'index.html') content = content.toString().replace('<script src="renderer.js">', '<script src="/preview-bridge.js"></script><script src="renderer.js">');
    response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch { response.writeHead(500); response.end('Preview unavailable'); }
}).listen(port, host, () => console.log(`Buji design preview: http://${host}:${port} (sample data only)`));
