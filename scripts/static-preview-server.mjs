import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'dist');
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

function safePath(urlPath) {
  const pathname = decodeURIComponent(urlPath.split('?')[0] || '/');
  const normalized = path.normalize(pathname).replace(/^([/\\])+/, '');
  const resolved = path.resolve(root, normalized || 'index.html');
  if (!resolved.startsWith(root)) return path.join(root, 'index.html');
  return resolved;
}

const server = http.createServer(async (request, response) => {
  try {
    let filePath = safePath(request.url || '/');
    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {
      filePath = path.join(root, 'index.html');
    }

    const body = await fs.readFile(filePath);
    const type = contentTypes[path.extname(filePath)] || 'application/octet-stream';
    response.writeHead(200, { 'content-type': type });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Static preview listening on http://127.0.0.1:${port}`);
});
