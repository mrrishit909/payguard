// Local preview server for the built site. Binds 127.0.0.1 only, serves only the built
// directory, blocks traversal and dotfiles, sets MIME and security headers. GET/HEAD only.
// Usage: node scripts/serve.js [dir] [port]   (defaults: dist, 4173; PORT env also honoured)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIME, SECURITY_HEADERS } from './site-config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function createSiteServer(dir) {
  const base = resolve(dir);
  return createServer(async (req, res) => {
    const send = (code, body, type = 'text/plain; charset=utf-8', extra = {}) => {
      res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed', undefined, { Allow: 'GET, HEAD' });
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname); } catch { return send(400, 'Bad request'); }
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some((seg) => seg.startsWith('.'))) return send(404, 'Not found');
    let file = resolve(base, `.${pathname}`);
    if (file !== base && !file.startsWith(base + sep)) return send(404, 'Not found');
    try {
      let s = await stat(file);
      if (s.isDirectory()) {
        if (!pathname.endsWith('/')) return send(301, '', undefined, { Location: `${pathname}/` });
        file = join(file, 'index.html');
        s = await stat(file);
      }
      if (!s.isFile()) throw new Error('not a file');
      const type = MIME[extname(file)];
      if (!type) return send(404, 'Not found');
      return send(200, await readFile(file), type);
    } catch {
      try { return send(404, await readFile(join(base, '404.html')), MIME['.html']); } catch { return send(404, 'Not found'); }
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? join(ROOT, 'dist'));
  const port = Number(process.argv[3] ?? process.env.PORT ?? 4173);
  const server = createSiteServer(dir);
  server.listen(port, '127.0.0.1', () => console.log(`PayGuard preview: http://127.0.0.1:${server.address().port}/ (serving ${dir}; Ctrl+C to stop)`));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
}
