// Static build: copies only public synthetic assets into dist/. Node built-ins only.
// Usage: node scripts/build.js [outDir]   (default: dist)
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { COPY, FIXTURE_FILES, SECURITY_HEADERS } from './site-config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function build(outDir = join(ROOT, 'dist')) {
  const out = resolve(outDir);
  if (out === ROOT || !out.startsWith(ROOT + sep)) throw new Error('Output directory must be inside the repository and not its root.');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const skip = (src) => !/(^|[\\/])\.|\.test\.js$|[\\/]test[\\/]/.test(relative(ROOT, src));
  for (const [from, to] of COPY) cpSync(join(ROOT, from), join(out, to), { recursive: true, filter: skip });
  mkdirSync(join(out, 'fixtures/payguard'), { recursive: true });
  for (const f of FIXTURE_FILES) cpSync(join(ROOT, 'fixtures/payguard', f), join(out, 'fixtures/payguard', f));

  // Cloudflare static-assets header file (also documents intended headers for any static host).
  const headers = ['/*', ...Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`),
    '/fixtures/*', '  Cache-Control: no-cache', '/assets/*', '  Cache-Control: no-cache', ''].join('\n');
  writeFileSync(join(out, '_headers'), headers);

  const files = list(out).filter((p) => !p.endsWith('build-manifest.json'));
  const manifest = {
    note: 'PayGuard synthetic demo static output. Sizes are uncompressed bytes on disk.',
    files: files.map((p) => ({ path: relative(out, p).split(sep).join('/'), bytes: statSync(p).size, sha256: createHash('sha256').update(readFileSync(p)).digest('hex') })),
  };
  manifest.totalBytes = manifest.files.reduce((s, f) => s + f.bytes, 0);
  writeFileSync(join(out, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { out, manifest };
}

function list(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(join(dir, e.name)) : [join(dir, e.name)]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { out, manifest } = build(process.argv[2] ? resolve(process.argv[2]) : undefined);
  console.log(`Built ${manifest.files.length} files, ${manifest.totalBytes} bytes, into ${relative(ROOT, out)}/`);
}
