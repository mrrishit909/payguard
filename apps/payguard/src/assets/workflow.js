// PayGuard reviewer workflow state. No DOM, no network, no storage: the engine module and a
// clock are injected so the same code runs in browsers and in Node tests. All money comes from
// the engine; this module never does financial arithmetic.

export const ACTOR = 'demo-reviewer';

/** Engine amount string -> display string with thousands separators (formatting only). */
export function groupDigits(decimalText) {
  const negative = decimalText.startsWith('-');
  const body = negative ? decimalText.slice(1) : decimalText;
  const [whole, frac] = body.split('.');
  let grouped = '';
  for (let i = 0; i < whole.length; i += 1) {
    if (i > 0 && (whole.length - i) % 3 === 0) grouped += ',';
    grouped += whole[i];
  }
  return `${negative ? '-' : ''}${grouped}.${frac}`;
}

/**
 * @param {object} deps
 * @param {typeof import('../../../../packages/payguard-engine/src/index.js')} deps.engine
 * @param {{ MAX_UPLOAD_BYTES: number }} deps.limits
 * @param {() => string} deps.now  ISO-8601 UTC clock (app clock; never the engine's).
 */
export function createWorkflow({ engine, limits, now }) {
  /** @type {any} */ let seedBundle = null;
  /** @type {any} */ let correctedWaiver = null;
  let state = fresh();

  function fresh() {
    return {
      imported: null,          // latest successfully imported/corrected application
      attachedDocuments: [],   // corrected evidence attached since the seed
      draft: null,             // staged, not yet analyzed: { claimText?, attachWaiver? }
      runs: [],                // { index, analysis, semanticHash, sourceName, occurredAt, trigger }
      history: Object.freeze([]),
      nextSequence: 1,
    };
  }

  const money = (cents) => groupDigits(engine.formatCents(cents));

  function setSeed(bundleJson, waiverJson) {
    const v = engine.validateProjectBundle(bundleJson);
    if (!v.ok) return v;
    seedBundle = bundleJson;
    correctedWaiver = waiverJson ?? null;
    return { ok: true, value: v.value };
  }

  function reset() { state = fresh(); }

  function currentBundle() {
    return { ...seedBundle, documents: [...seedBundle.documents, ...state.attachedDocuments] };
  }

  function appendRunEvent(semanticHash) {
    const event = { eventId: `EV-${String(state.nextSequence).padStart(4, '0')}`, sequence: state.nextSequence, type: 'ANALYSIS_RUN', analysisHash: semanticHash, actor: ACTOR, occurredAt: now() };
    const r = engine.appendReviewEvent(state.history, event);
    if (!r.ok) return r;
    state.history = r.value;
    state.nextSequence += 1;
    return { ok: true, value: event };
  }

  /** Analyze bundle+imported; commit only on full success (atomic). */
  async function runAnalysis(bundle, imported, trigger) {
    const vb = engine.validateProjectBundle(bundle);
    if (!vb.ok) return vb;
    const a = engine.analyze({ bundle: vb.value, imported });
    if (!a.ok) return a;
    const semanticHash = await engine.computeSemanticHash(a.value);
    const snapshot = { history: state.history, nextSequence: state.nextSequence };
    const ev = appendRunEvent(semanticHash);
    if (!ev.ok) { Object.assign(state, snapshot); return ev; }
    const run = { index: state.runs.length + 1, analysis: a.value, semanticHash, sourceName: imported.importBatch.sourceName, occurredAt: ev.value.occurredAt, trigger };
    state.runs = [...state.runs, run];
    return { ok: true, value: run };
  }

  /**
   * Import an uploaded application. Size is checked before decoding. On any failure the
   * previous imported application, runs and history are untouched.
   * @param {{ bytes?: Uint8Array, size: number, name: string, readBytes?: () => Promise<Uint8Array> }} file
   */
  async function importFile(file) {
    if (!seedBundle) return fail('NOT_READY', 'The synthetic project has not loaded yet.');
    const name = String(file.name ?? '').slice(0, 200);
    const lower = name.toLowerCase();
    const format = lower.endsWith('.json') ? 'json' : lower.endsWith('.csv') ? 'csv' : null;
    if (!format) return fail('UNSUPPORTED_FORMAT', 'Choose a .json or .csv payment application file.');
    if (file.size > limits.MAX_UPLOAD_BYTES) return fail('INPUT_TOO_LARGE', `This file is ${file.size} bytes. The limit is ${limits.MAX_UPLOAD_BYTES} bytes (1 MiB); nothing was read.`);
    if (file.size === 0) return fail('EMPTY_FILE', 'This file is empty.');
    const bytes = file.bytes ?? await file.readBytes();
    const importBatchId = await engine.computeImportBatchId(bytes);
    const meta = { importBatchId, sourceName: name };
    const parsed = format === 'json' ? engine.parseApplicationJson(bytes, meta) : engine.parseApplicationCsv(bytes, meta);
    if (!parsed.ok) return parsed;
    const run = await runAnalysis(currentBundle(), parsed.value, `Imported ${format.toUpperCase()}`);
    if (!run.ok) return run;
    state.imported = parsed.value;
    state.draft = null;
    return run;
  }

  /** Stage a corrected claimed current due (validated now, analyzed only on rerun). */
  function stageClaim(text) {
    if (!state.imported) return fail('NOT_READY', 'Import an application before correcting it.');
    const r = engine.parseDecimalToCents(String(text).trim());
    if (!r.ok) return r;
    state.draft = { ...(state.draft ?? {}), claimText: String(text).trim(), claimCents: r.value };
    return { ok: true, value: state.draft };
  }

  function stageWaiver() {
    if (!state.imported) return fail('NOT_READY', 'Import an application before attaching evidence.');
    if (!correctedWaiver) return fail('NOT_READY', 'The corrected sample waiver is unavailable.');
    if (state.attachedDocuments.some((d) => d.documentId === correctedWaiver.documentId)) return fail('DUPLICATE_ID', 'The corrected sample waiver is already attached.');
    state.draft = { ...(state.draft ?? {}), attachWaiver: true };
    return { ok: true, value: state.draft };
  }

  function discardDraft() { state.draft = null; }

  /** Applies staged corrections through the real importers and analyzer. */
  async function rerun() {
    if (!state.imported) return fail('NOT_READY', 'Import an application before rerunning.');
    let imported = state.imported;
    const draft = state.draft ?? {};
    if (draft.claimText !== undefined) {
      const app = state.imported.application;
      const raw = {
        schemaVersion: 'payguard.application.v1', dataClassification: 'SYNTHETIC', applicationId: app.applicationId,
        contractId: app.contractId, currency: app.currency, periodStart: app.periodStart, periodEnd: app.periodEnd,
        reviewDate: app.reviewDate, claimedCurrentDue: draft.claimText,
        lines: app.lines.map((l) => ({ lineId: l.lineId, completedToDate: engine.formatCents(l.completedToDateCents), storedToDate: engine.formatCents(l.storedToDateCents) })),
      };
      const bytes = new TextEncoder().encode(JSON.stringify(raw));
      const parsed = engine.parseApplicationJson(bytes, { importBatchId: await engine.computeImportBatchId(bytes), sourceName: 'Reviewer correction (claimed current due)' });
      if (!parsed.ok) return parsed;
      imported = parsed.value;
    }
    const attached = draft.attachWaiver ? [...state.attachedDocuments, correctedWaiver] : state.attachedDocuments;
    const bundle = { ...seedBundle, documents: [...seedBundle.documents, ...attached] };
    const parts = [draft.claimText !== undefined && `claim set to ${money(draft.claimCents)}`, draft.attachWaiver && `attached ${correctedWaiver.documentId}`].filter(Boolean);
    const run = await runAnalysis(bundle, imported, parts.length ? `Rerun: ${parts.join('; ')}` : 'Rerun: no input changes');
    if (!run.ok) return run;
    state.imported = imported;
    state.attachedDocuments = attached;
    state.draft = null;
    return run;
  }

  /**
   * Record a NOTE or DISPOSITION against the finding as it appeared in run `runIndex`.
   * findingIds of that referenced analysis are passed to the engine for the unknown-id check.
   */
  function addReview({ runIndex, findingId, disposition, note }) {
    const run = state.runs[runIndex - 1];
    if (!run) return fail('UNKNOWN_REFERENCE', 'Choose a recorded analysis run.');
    const text = typeof note === 'string' ? note : '';
    if (!disposition && text.trim() === '') return fail('MISSING_FIELD', 'Choose a disposition or write a note.');
    const event = {
      eventId: `EV-${String(state.nextSequence).padStart(4, '0')}`, sequence: state.nextSequence,
      type: disposition ? 'DISPOSITION' : 'NOTE', analysisHash: run.semanticHash, findingId, actor: ACTOR, occurredAt: now(),
    };
    if (disposition) event.disposition = disposition;
    if (text.trim() !== '') event.note = text;
    const r = engine.appendReviewEvent(state.history, event, { findingIds: run.analysis.findings.map((f) => f.findingId) });
    if (!r.ok) return r;
    state.history = r.value;
    state.nextSequence += 1;
    return { ok: true, value: event };
  }

  /** Immutable report for run `runIndex`, with earlier runs as prior analyses and full history. */
  function report(runIndex) {
    const run = state.runs[runIndex - 1];
    if (!run) return fail('UNKNOWN_REFERENCE', 'No analysis run to export.');
    const prior = state.runs.slice(0, runIndex - 1).map((r) => ({ analysis: r.analysis, semanticHash: r.semanticHash }));
    return { ok: true, value: engine.buildReport({ analysis: run.analysis, semanticHash: run.semanticHash, priorAnalyses: prior, reviewEvents: state.history, generatedAt: now() }) };
  }

  function exportReport(runIndex, format) {
    const r = report(runIndex);
    if (!r.ok) return r;
    const text = format === 'csv' ? engine.serializeReportCsv(r.value) : engine.serializeReportJson(r.value);
    const id = r.value.ids.applicationId;
    return { ok: true, value: { text, filename: `payguard-${id}-run-${runIndex}.${format}`, mime: format === 'csv' ? 'text/csv' : 'application/json', report: r.value } };
  }

  /** Derived status per finding across runs up to `runIndex` (via the engine's report). */
  function statuses(runIndex) {
    const r = report(runIndex);
    return r.ok ? new Map(r.value.findingStatuses.map((s) => [s.findingId, s])) : new Map();
  }

  return {
    setSeed, reset, importFile, stageClaim, stageWaiver, discardDraft, rerun, addReview, report, exportReport, statuses, money,
    get state() { return state; },
    get correctedWaiverId() { return correctedWaiver?.documentId ?? null; },
    get seedBundle() { return seedBundle; },
    currentBundle: () => (seedBundle ? currentBundle() : null),
  };
}

function fail(code, message) { return { ok: false, errors: [{ code, message }] }; }
