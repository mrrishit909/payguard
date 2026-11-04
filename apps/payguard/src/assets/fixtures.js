// Same-origin static sample files shipped with the site. No remote data.
import * as engine from '../packages/payguard-engine/src/index.js';
import { IMPORT_LIMITS, SYNTHETIC_LABEL } from '../packages/contracts/src/index.js';
import { createWorkflow } from './workflow.js';

export const FIXTURE_BASE = new URL('../fixtures/payguard/', import.meta.url);
export const FIXTURES = Object.freeze({
  bundle: 'pg-syn-001.bundle.json',
  applicationJson: 'pg-syn-001.application.json',
  applicationCsv: 'pg-syn-001.application.csv',
  waiver: 'pg-syn-001.corrected-waiver.document.json',
  correctedJson: 'pg-syn-001.corrected.application.json',
});
export { engine, SYNTHETIC_LABEL, IMPORT_LIMITS };

/** A sample-loading failure whose message is written for the reader, safe to show as is. */
export class SampleError extends Error {}

export async function fetchBytes(name) {
  let res;
  try { res = await fetch(new URL(name, FIXTURE_BASE), { credentials: 'same-origin' }); } catch {
    throw new SampleError(`Sample file ${name} could not be loaded (network error).`);
  }
  if (!res.ok) throw new SampleError(`Sample file ${name} could not be loaded (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

const decodeJson = (bytes, name) => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch {
    throw new SampleError(`Sample file ${name} is not valid UTF-8 JSON.`);
  }
};

/** ISO-8601 UTC from the app clock, trimmed to seconds. */
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Workflow with the seeded synthetic project loaded. Throws a plain message on failure. */
export async function loadWorkflow() {
  const wf = createWorkflow({ engine, limits: IMPORT_LIMITS, now: nowIso });
  const [bundle, waiver] = await Promise.all([fetchBytes(FIXTURES.bundle), fetchBytes(FIXTURES.waiver)]);
  const r = wf.setSeed(decodeJson(bundle, FIXTURES.bundle), decodeJson(waiver, FIXTURES.waiver));
  if (!r.ok) throw new SampleError('The synthetic project failed validation.');
  return wf;
}

/** Reader-facing text for a failure: sample messages as written, anything else generic. */
export const failureText = (e) => (e instanceof SampleError ? e.message : 'An unexpected error stopped the calculation in this browser.');
