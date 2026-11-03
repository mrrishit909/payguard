// Architecture guardrails (ADR-0001/0002). Owner: architecture (A01). Static, heuristic checks:
// they catch accidental violations, not a determined bypass. Codex review remains authoritative.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_PUBLIC_API } from '../../packages/contracts/src/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PURE_SOURCE_DIRS = ['packages/contracts/src', 'packages/payguard-engine/src'];

/** @param {string} dir @returns {string[]} */
function jsFiles(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => join(e.parentPath, e.name));
}

/** Removes comments so documentation may mention forbidden APIs. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const FORBIDDEN = [
  [/\bfrom\s+['"]node:/, 'node:* import (must run in browsers)'],
  [/\brequire\s*\(/, 'CommonJS require'],
  [/\bimport\s*\(/, 'dynamic import'],
  [/\bprocess\./, 'process global'],
  [/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/, 'network API'],
  [/\b(localStorage|sessionStorage|indexedDB)\b|\b(document|window|navigator)\s*\./, 'browser/DOM state'],
  [/\bDate\.now\b|\bnew\s+Date\s*\(|\bperformance\.now\b/, 'wall clock'],
  [/\bMath\.random\b|\bcrypto\.randomUUID\b|\bgetRandomValues\b/, 'randomness'],
  [/\bparseFloat\b|\.toFixed\s*\(|\btoLocaleString\b|\blocaleCompare\b|\bIntl\./, 'float/locale money or ordering'],
  [/\b(eval|Function)\s*\(/, 'dynamic code execution'],
  [/\binnerHTML\b|\bdangerouslySetInnerHTML\b/, 'HTML injection sink'],
];

test('pure packages use no forbidden platform, clock, randomness, float or locale APIs', () => {
  const files = PURE_SOURCE_DIRS.flatMap(jsFiles);
  assert.ok(files.length > 0, 'expected source files');
  for (const file of files) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const [pattern, why] of FORBIDDEN) {
      assert.doesNotMatch(code, pattern, `${relative(ROOT, file)}: ${why}`);
    }
  }
});

test('pure packages import only relative paths that stay inside packages/', () => {
  const pkgRoot = join(ROOT, 'packages') + sep;
  for (const file of PURE_SOURCE_DIRS.flatMap(jsFiles)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const m of code.matchAll(/\b(?:import|export)\b[^'"]*?\bfrom\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${relative(ROOT, file)} imports bare "${spec}"`);
      assert.ok(spec.endsWith('.js'), `${relative(ROOT, file)} import "${spec}" needs explicit .js for browsers`);
      assert.ok(resolve(dirname(file), spec).startsWith(pkgRoot), `${relative(ROOT, file)} escapes packages/`);
    }
  }
});

test('contracts never import the engine (one-way dependency)', () => {
  for (const file of jsFiles('packages/contracts/src')) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const engineImport = /\bfrom\s+['"][^'"]*payguard-engine[^'"]*['"]/.test(code);
    assert.equal(engineImport, false, `${relative(ROOT, file)} imports the engine`);
  }
});

test('packages declare zero runtime or dev dependencies', () => {
  for (const pkg of ['package.json', 'packages/contracts/package.json', 'packages/payguard-engine/package.json']) {
    const json = JSON.parse(readFileSync(join(ROOT, pkg), 'utf8'));
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      assert.equal(json[key], undefined, `${pkg} must not declare ${key} without an approved security record`);
    }
    assert.equal(json.type, 'module', `${pkg} must be ESM`);
  }
});

test('engine exports exactly ENGINE_PUBLIC_API', async () => {
  const engine = await import('../../packages/payguard-engine/src/index.js');
  assert.deepEqual(Object.keys(engine).sort(), [...ENGINE_PUBLIC_API].sort());
  for (const name of ENGINE_PUBLIC_API) assert.equal(typeof engine[name], 'function', name);
});

test('reference tests use only the engine public entry point', () => {
  for (const file of jsFiles('tests/payguard-reference')) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/from\s+['"]([^'"]*payguard-engine[^'"]*)['"]/g)) {
      assert.match(m[1], /payguard-engine\/src\/index\.js$/, `${relative(ROOT, file)} imports engine internals`);
    }
  }
});
