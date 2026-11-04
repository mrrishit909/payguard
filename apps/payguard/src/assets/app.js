// Review workspace. Renders engine output as text nodes; never computes money itself.
import { h, fill, $ } from './dom.js';
import { loadWorkflow, failureText, FIXTURES, FIXTURE_BASE, SYNTHETIC_LABEL, IMPORT_LIMITS, APPLICATION_ORIGIN_LABEL, REAL_DATA_WARNING } from './fixtures.js';
import { fieldText } from './labels.js';

const TITLES = {
  CLAIMED_DUE_MISMATCH: 'Claimed current due does not match the calculated due',
  MISSING_REQUIRED_SIGNED_WAIVER: 'Required signed waiver is missing',
  PENDING_CHANGE_ORDER_CONTEXT: 'Pending change order kept out of the revised cap',
  LINE_EARNED_EXCEEDS_REVISED_CAP: 'Line earned to date exceeds its revised cap',
  OVERPAYMENT_CREDIT: 'Posted payments exceed net earned (credit)',
  REQUIREMENT_NOT_CONFIGURED: 'Requirement not configured',
};
const SEVERITY_TEXT = { BLOCKING: 'Blocking', WARNING: 'Warning', INFO: 'Context' };
const SEVERITY_RANK = { BLOCKING: 0, WARNING: 1, INFO: 2 };
const CATEGORY_TEXT = { FINANCIAL: 'Financial', DOCUMENTARY: 'Documentary', CONTEXT: 'Context' };
const DISPOSITION_TEXT = { ACKNOWLEDGED: 'Acknowledged', CORRECTION_SUBMITTED: 'Correction submitted', NEEDS_FOLLOW_UP: 'Needs follow-up' };
const READINESS_TEXT = {
  NOT_READY: 'Not ready to submit',
  NO_BLOCKING_FINDINGS: 'No blocking findings under the configured rules (not an approval)',
};
const REASON_TEXT = { UNSIGNED: 'Not signed', WRONG_PERIOD: 'Wrong period', WRONG_PROJECT: 'Wrong project', WRONG_DOCUMENT_TYPE: 'Wrong document type' };

/** @type {Awaited<ReturnType<typeof loadWorkflow>>} */ let wf;
const ui = { run: 0, finding: null, q: '', severity: 'ALL', category: 'ALL', sort: 'severity', busy: false };
const el = {
  status: $('#status'), error: $('#error'), importBody: $('#import-body'), runbar: $('#runbar'), desk: $('#desk'),
  summary: $('#summary-body'), ledger: $('#ledger-body'), findings: $('#findings-body'), evidence: $('#evidence-body'),
  correct: $('#correct-body'), review: $('#review-body'), export: $('#export-body'), method: $('#method-body'),
};
const m = (c) => wf.money(c);
const signed = (c) => `${c > 0 ? '+' : ''}${m(c)}`;
const runOf = (i) => wf.state.runs[i - 1];
const latest = () => wf.state.runs.length;

function announce(text) { el.status.textContent = text; }
function showErrors(title, errors, keepNote) {
  fill(el.error,
    h('h2', null, title),
    h('ul', { testid: 'error-list' }, errors.slice(0, 20).map((e) => h('li', null,
      e.message, ' ',
      h('span', { class: 'muted' }, [e.code, e.row !== undefined && `row ${e.row}`, e.column && `column ${e.column}`, e.path && `field ${e.path}`].filter(Boolean).join(', '))))),
    errors.length > 20 ? h('p', null, `${errors.length - 20} more errors not shown.`) : null,
    keepNote ? h('p', null, keepNote) : null,
    h('button', { type: 'button', class: 'btn', testid: 'error-dismiss', onclick: () => { el.error.hidden = true; } }, 'Hide message'));
  el.error.hidden = false;
}
function clearErrors() { el.error.hidden = true; el.error.replaceChildren(); }

async function busy(button, label, fn) {
  if (ui.busy) return;
  ui.busy = true;
  const original = button.textContent;
  button.setAttribute('aria-busy', 'true');
  button.disabled = true;
  button.textContent = label;
  try { await fn(); } finally {
    ui.busy = false;
    button.removeAttribute('aria-busy');
    button.disabled = false;
    button.textContent = original;
  }
}

// ---------- URL state (?run=N&finding=ID), history-aware ----------
function readUrl() {
  const p = new URLSearchParams(location.search);
  const run = Number(p.get('run'));
  return { run: Number.isSafeInteger(run) && run > 0 ? run : 0, finding: p.get('finding') };
}
function writeUrl(push) {
  const p = new URLSearchParams();
  if (ui.run) p.set('run', String(ui.run));
  if (ui.finding) p.set('finding', ui.finding);
  const qs = p.toString();
  const url = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`;
  if (url !== `${location.pathname}${location.search}${location.hash}`) history[push ? 'pushState' : 'replaceState'](null, '', url);
}
window.addEventListener('popstate', () => {
  if (!wf) return; // e.g. the skip link's #main fires popstate before the sample project has loaded
  const u = readUrl();
  if (u.run && runOf(u.run)) ui.run = u.run;
  ui.finding = u.finding;
  renderRun();
});

// ---------- Import ----------
function buildImport() {
  const fileInput = h('input', { type: 'file', id: 'file', accept: '.json,.csv,application/json,text/csv', testid: 'import-file', class: 'sr-only' });
  const fileButton = h('button', { type: 'button', class: 'btn', testid: 'import-file-button', onclick: () => fileInput.click() }, 'Import JSON or CSV file');
  const sampleJson = h('button', { type: 'button', class: 'btn btn-primary', testid: 'load-sample-json' }, 'Load sample application');
  const sampleCsv = h('button', { type: 'button', class: 'btn', testid: 'load-sample-csv' }, 'Load sample as CSV');
  sampleJson.addEventListener('click', () => busy(sampleJson, 'Loading…', () => importSample('json')));
  sampleCsv.addEventListener('click', () => busy(sampleCsv, 'Loading…', () => importSample('csv')));
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) { announce('No file was chosen.'); return; }
    busy(fileButton, 'Checking file…', () => importUpload(file));
  });
  const dl = (name, text, testid) => h('a', { href: new URL(name, FIXTURE_BASE).href, download: name, testid }, text);
  fill(el.importBody,
    h('div', { id: 'import-state', testid: 'import-state' }),
    h('div', { class: 'actions' }, sampleJson, sampleCsv, fileButton, h('label', { for: 'file', class: 'sr-only' }, 'Payment application file'), fileInput),
    h('p', { class: 'hint', testid: 'import-origin-hint' }, 'Only the two sample buttons are labelled bundled synthetic. A file you choose is read in this browser tab, is not uploaded, and is labelled unverified origin whatever its name or fields say. ', REAL_DATA_WARNING),
    h('p', { class: 'hint' }, `Accepted: payguard.application.v1 JSON, or CSV with exactly these columns: ${['schema_version', 'data_classification', 'application_id', 'contract_id', 'currency', 'period_start', 'period_end', 'review_date', 'claimed_current_due', 'line_id', 'completed_to_date', 'stored_to_date'].join(', ')}. Maximum ${IMPORT_LIMITS.MAX_UPLOAD_BYTES} bytes (1 MiB) and ${IMPORT_LIMITS.MAX_ROWS} rows. Amounts are plain decimals such as 45000.00.`),
    h('p', { class: 'hint' }, 'Sample files: ', dl(FIXTURES.applicationJson, 'application JSON', 'download-fixture-json'), ', ',
      dl(FIXTURES.applicationCsv, 'application CSV', 'download-fixture-csv'), ', ',
      dl(FIXTURES.correctedJson, 'corrected application JSON', 'download-fixture-corrected'), ', ',
      dl(FIXTURES.bundle, 'project bundle', 'download-fixture-bundle'), '.'));
}

function renderImportState() {
  const box = $('#import-state');
  const imp = wf.state.imported;
  if (!imp) {
    fill(box, h('div', { class: 'empty', testid: 'empty-state' },
      h('p', null, h('strong', null, 'No application loaded.'), ' The fictional project ', wf.seedBundle.project.name, ' is ready. Load the bundled sample payment application, or import a local file (labelled unverified origin), to start the check.')));
    return;
  }
  const a = imp.application;
  fill(box, h('dl', { class: 'kv' },
    h('dt', null, 'Application'), h('dd', null, `${a.applicationId}, contract ${a.contractId}`),
    h('dt', null, 'Period'), h('dd', { class: 'num' }, `${a.periodStart} to ${a.periodEnd}, review date ${a.reviewDate}`),
    h('dt', null, 'Source'), h('dd', { testid: 'source-name' }, `${imp.importBatch.sourceName} (${imp.importBatch.sourceFormat.toUpperCase()}, ${imp.importBatch.byteLength} bytes, batch ${imp.importBatch.importBatchId})`),
    h('dt', null, 'Origin'), h('dd', { testid: 'source-origin', 'data-origin': wf.state.origin }, ORIGIN_TEXT[wf.state.origin])));
}

const ORIGIN_TEXT = { BUNDLED_SYNTHETIC_SAMPLE: 'Bundled synthetic sample', UNVERIFIED_LOCAL_FILE: 'Unverified origin (local file)' };

/** Origin notice for the run being shown; text comes from the contracts, as in the exports. */
function originNotice(run) {
  return h('div', { class: `origin${run.origin === 'UNVERIFIED_LOCAL_FILE' ? ' origin-unverified' : ''}`, role: 'note', 'aria-label': 'Application origin', 'data-origin': run.origin, testid: 'origin-notice' },
    h('p', null, h('strong', null, `${ORIGIN_TEXT[run.origin]}. `), APPLICATION_ORIGIN_LABEL[run.origin]),
    h('p', { testid: 'origin-warning' }, REAL_DATA_WARNING));
}

async function importSample(format) {
  let r;
  try { r = await wf.importSample(format); } catch (e) { showErrors('The sample file could not be loaded', [{ code: 'MISSING_FILE', message: failureText(e) }], keepText()); announce('Sample file missing.'); return; }
  await afterImport(r);
}
async function importUpload(file) {
  await afterImport(await wf.importFile({ size: file.size, name: file.name, readBytes: async () => new Uint8Array(await file.arrayBuffer()) }));
}
function keepText() { return latest() ? `The previous report (run ${latest()}) is unchanged.` : 'Nothing was loaded.'; }
async function afterImport(r) {
  if (!r.ok) { showErrors('This file was not imported', r.errors, keepText()); announce(`Import failed with ${r.errors.length} error${r.errors.length === 1 ? '' : 's'}. ${keepText()}`); return; }
  clearErrors();
  onNewRun(r.value, `Imported ${r.value.sourceName}.`);
}

function onNewRun(run, prefix) {
  ui.run = run.index;
  const first = run.analysis.findings.find((f) => !ui.finding || f.findingId === ui.finding) ?? run.analysis.findings[0];
  ui.finding = first?.findingId ?? null;
  writeUrl(true);
  renderRun();
  const blocking = run.analysis.findings.filter((f) => f.severity === 'BLOCKING').length;
  announce(`${prefix} Run ${run.index}: ${READINESS_TEXT[run.analysis.readiness]}, ${blocking} blocking finding${blocking === 1 ? '' : 's'}, difference ${signed(run.analysis.totals.claimDiscrepancyCents)}.`);
}

// ---------- Run bar ----------
function renderRunbar() {
  const select = h('select', { id: 'run-select', testid: 'run-select' }, wf.state.runs.map((r) => h('option', { value: r.index, selected: r.index === ui.run }, `Run ${r.index}${r.index === latest() ? ' (latest)' : ''}: ${r.trigger}`)));
  select.addEventListener('change', () => { ui.run = Number(select.value); writeUrl(true); renderRun(); announce(`Showing run ${ui.run}.`); });
  const a = runOf(ui.run).analysis;
  fill(el.runbar,
    h('div', { class: 'field' }, h('label', { for: 'run-select' }, 'Analysis run'), select),
    h('p', { class: 'readiness', 'data-state': a.readiness, testid: 'readiness' }, READINESS_TEXT[a.readiness]),
    originNotice(runOf(ui.run)),
    ui.run !== latest() ? h('p', { testid: 'older-run-note' }, `You are viewing an earlier run. Run ${latest()} is the latest.`) : null);
}

// ---------- Summary ----------
function renderSummary(a) {
  const t = a.totals;
  const d = t.claimDiscrepancyCents;
  fill(el.summary,
    h('dl', { class: 'figures' },
      h('div', null, h('dt', null, 'Claimed current due (current period)'), h('dd', { class: 'num', testid: 'claimed-due' }, m(t.claimedCurrentDueCents))),
      h('div', null, h('dt', null, 'Calculated current due (current period)'), h('dd', { class: 'num', testid: 'calculated-due' }, m(t.calculatedCurrentDueCents))),
      h('div', { class: d === 0 ? 'flat' : 'delta' }, h('dt', null, 'Difference, claimed minus calculated'), h('dd', { class: 'num', testid: 'difference' }, signed(d)))),
    h('dl', { class: 'context-list' },
      h('dt', null, 'Posted prior payments (subtracted)'), h('dd', { class: 'num' }, m(t.postedPriorPaymentsCents)),
      h('dt', null, 'Prior certified amount (informational, not subtracted)'), h('dd', { class: 'num', testid: 'prior-certified' }, m(t.priorCertifiedInformationalCents)),
      h('dt', null, 'Revised contract (approved change orders only)'), h('dd', { class: 'num' }, m(t.revisedContractCents)),
      h('dt', null, 'Pending change orders (excluded)'), h('dd', { class: 'num' }, m(t.pendingChangeOrdersCents))));
}

// ---------- Ledger ----------
function renderLedger(a) {
  const sov = new Map(a.canonicalInput.bundle.sovLines.map((l) => [l.lineId, l.description]));
  const t = a.totals;
  const cols = ['Original value', 'Approved change orders', 'Pending change orders (excluded)', 'Revised cap', 'Completed to date', 'Stored to date', 'Gross earned to date', 'Retainage to date', 'Net earned to date'];
  const cell = (c, cls) => h('td', { class: `num${cls ? ` ${cls}` : ''}` }, m(c));
  const bp = a.canonicalInput.bundle.contract.retainage.basisPoints;
  fill(el.ledger,
    h('div', { class: 'scroll-region', role: 'region', 'aria-labelledby': 'ledger-caption', tabindex: '0', testid: 'ledger-region' },
      h('table', { class: 'ledger', testid: 'ledger-table' },
        h('caption', { id: 'ledger-caption' }, 'Schedule of values, cumulative through period end, USD. Scroll sideways for all columns.'),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Line'), cols.map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', null, a.lines.map((l) => h('tr', null,
          h('th', { scope: 'row' }, `${l.lineId} ${sov.get(l.lineId) ?? ''}`),
          cell(l.originalValueCents), cell(l.approvedChangeOrdersCents), cell(l.pendingChangeOrdersCents, 'excluded'), cell(l.revisedCapCents),
          cell(l.completedToDateCents), cell(l.storedToDateCents), cell(l.grossEarnedToDateCents), cell(l.retainageToDateCents), cell(l.netEarnedToDateCents)))),
        h('tfoot', null, h('tr', null, h('th', { scope: 'row' }, 'Total'),
          cell(t.originalContractCents), cell(t.approvedChangeOrdersCents), cell(t.pendingChangeOrdersCents, 'excluded'), cell(t.revisedContractCents),
          cell(t.completedToDateCents), cell(t.storedToDateCents), cell(t.grossEarnedToDateCents), cell(t.retainageToDateCents), cell(t.netEarnedToDateCents))))),
    h('h3', null, 'How the current due is calculated'),
    h('dl', { class: 'trace', testid: 'calc-trace' },
      h('dt', null, 'Gross earned to date (completed plus stored, cumulative)'), h('dd', { class: 'num' }, m(t.grossEarnedToDateCents)),
      h('dt', null, `Less retainage to date (${bp / 100}% per line, rounded half up to the cent)`), h('dd', { class: 'num' }, m(t.retainageToDateCents)),
      h('dt', null, 'Net earned to date'), h('dd', { class: 'num' }, m(t.netEarnedToDateCents)),
      h('dt', null, 'Less posted prior payments'), h('dd', { class: 'num' }, m(t.postedPriorPaymentsCents)),
      h('dt', { class: 'result' }, 'Calculated current due (current period)'), h('dd', { class: 'num result' }, m(t.calculatedCurrentDueCents))),
    h('p', { class: 'hint' }, 'Retainage is withheld, not paid. The prior certified amount is shown for context only.'));
}

// ---------- Findings ----------
function buildFindingControls() {
  const q = h('input', { type: 'search', id: 'f-q', testid: 'findings-search', autocomplete: 'off' });
  const sev = h('select', { id: 'f-sev', testid: 'findings-severity' }, h('option', { value: 'ALL' }, 'All severities'), Object.entries(SEVERITY_TEXT).map(([k, v]) => h('option', { value: k }, v)));
  const cat = h('select', { id: 'f-cat', testid: 'findings-category' }, h('option', { value: 'ALL' }, 'All categories'), Object.entries(CATEGORY_TEXT).map(([k, v]) => h('option', { value: k }, v)));
  const sort = h('select', { id: 'f-sort', testid: 'findings-sort' }, h('option', { value: 'severity' }, 'Severity, blocking first'), h('option', { value: 'code' }, 'Finding code A to Z'), h('option', { value: 'category' }, 'Category'));
  const update = () => { ui.q = q.value; ui.severity = sev.value; ui.category = cat.value; ui.sort = sort.value; renderFindingList(true); };
  q.addEventListener('input', update);
  for (const s of [sev, cat, sort]) s.addEventListener('change', update);
  const clear = h('button', { type: 'button', class: 'btn btn-quiet', testid: 'findings-clear', onclick: () => { q.value = ''; sev.value = 'ALL'; cat.value = 'ALL'; sort.value = 'severity'; update(); q.focus(); } }, 'Clear filters');
  fill(el.findings,
    h('div', { class: 'filters', role: 'search', 'aria-label': 'Filter findings' },
      h('div', { class: 'field' }, h('label', { for: 'f-q' }, 'Search findings'), q),
      h('div', { class: 'field' }, h('label', { for: 'f-sev' }, 'Severity'), sev),
      h('div', { class: 'field' }, h('label', { for: 'f-cat' }, 'Category'), cat),
      h('div', { class: 'field' }, h('label', { for: 'f-sort' }, 'Sort'), sort)),
    h('div', { class: 'row' }, h('p', { id: 'f-count', testid: 'findings-count', 'aria-live': 'polite' }), clear),
    h('ul', { class: 'finding-list', id: 'f-list', testid: 'findings-list' }),
    h('div', { id: 'f-gone' }));
}

function filtered(a) {
  const q = ui.q.trim().toLowerCase();
  const list = a.findings.filter((f) => (ui.severity === 'ALL' || f.severity === ui.severity) && (ui.category === 'ALL' || f.category === ui.category)
    && (!q || [f.code, TITLES[f.code] ?? '', f.rationale, f.remediation, f.ruleId, f.subject.id].some((s) => s.toLowerCase().includes(q))));
  const key = { severity: (f) => [SEVERITY_RANK[f.severity], f.findingId], code: (f) => [f.code, f.findingId], category: (f) => [f.category, f.findingId] }[ui.sort];
  return list.sort((x, y) => { const a1 = key(x), b1 = key(y); return a1[0] < b1[0] ? -1 : a1[0] > b1[0] ? 1 : a1[1] < b1[1] ? -1 : a1[1] > b1[1] ? 1 : 0; });
}

function renderFindingList(fromFilter) {
  const a = runOf(ui.run).analysis;
  const status = wf.statuses(ui.run);
  const list = filtered(a);
  $('#f-count').textContent = `Showing ${list.length} of ${a.findings.length} findings in run ${ui.run}.`;
  const ul = $('#f-list');
  if (a.findings.length === 0) {
    fill(ul, h('li', { class: 'empty', testid: 'findings-empty' }, 'This run produced no findings under the configured rules.'));
  } else if (list.length === 0) {
    fill(ul, h('li', { class: 'empty', testid: 'findings-empty' }, ui.severity === 'BLOCKING' && !a.findings.some((f) => f.severity === 'BLOCKING')
      ? 'No blocking findings in this run. Clear the filters to see context findings.'
      : 'No findings match these filters. Clear the filters to see all findings.'));
  } else {
    fill(ul, list.map((f) => h('li', null, h('button', {
      type: 'button', class: 'finding', 'data-severity': f.severity, 'aria-current': f.findingId === ui.finding ? 'true' : 'false', testid: `finding-${f.code}`,
      onclick: () => selectFinding(f.findingId),
    },
    h('span', null, h('span', { class: `tag${f.severity === 'BLOCKING' ? ' tag-blocking' : ''}` }, SEVERITY_TEXT[f.severity]), h('strong', null, TITLES[f.code] ?? f.code)),
    h('span', { class: 'meta num' }, `${f.code}, rule ${f.ruleId} v${f.ruleVersion}`),
    h('span', { class: 'meta' }, `${CATEGORY_TEXT[f.category]}, ${status.get(f.findingId)?.status === 'OPEN' ? 'open in this run' : 'not present'}`)))));
  }
  // Findings seen in earlier runs that this run no longer produces (derived by the engine).
  const gone = [...status.values()].filter((s) => s.status === 'NOT_PRESENT_IN_LATEST_RUN');
  fill($('#f-gone'), gone.length ? [
    h('h3', null, 'No longer produced by this run'),
    h('ul', { class: 'refs', testid: 'findings-gone' }, gone.map((s) => {
      const firstRun = wf.state.runs.find((r) => r.semanticHash === s.firstSeenAnalysisHash)?.index;
      const lastRun = wf.state.runs.slice(0, ui.run).reverse().find((r) => r.semanticHash === s.lastSeenAnalysisHash)?.index;
      const code = s.findingId.split('|')[0];
      return h('li', null, `${TITLES[code] ?? code}: last seen in run ${lastRun}, first seen in run ${firstRun}. `,
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { ui.run = lastRun; ui.finding = s.findingId; writeUrl(true); renderRun(); announce(`Showing run ${lastRun}.`); $('#evidence').focus(); } }, `Open in run ${lastRun}`));
    })),
  ] : []);
  if (fromFilter) announce($('#f-count').textContent);
}

function selectFinding(id) {
  ui.finding = id;
  writeUrl(true);
  renderFindingList(false);
  renderEvidence(true);
  syncReviewFinding();
  $('#evidence').focus({ preventScroll: window.matchMedia('(min-width: 961px)').matches });
}

// ---------- Evidence ----------
function valueText(k, v) {
  if (typeof v === 'number' && k.endsWith('Cents')) return k === 'claimDiscrepancyCents' ? signed(v) : m(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}
function kvTable(obj, testid) {
  return h('dl', { class: 'kv', testid }, Object.entries(obj).map(([k, v]) => [h('dt', null, fieldText(k)), h('dd', { class: 'num' }, valueText(k, v))]));
}
function renderEvidence(animate) {
  const a = runOf(ui.run).analysis;
  const f = a.findings.find((x) => x.findingId === ui.finding);
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    $('#evidence').classList.add('swap');
    requestAnimationFrame(() => requestAnimationFrame(() => $('#evidence').classList.remove('swap')));
  }
  if (!f) {
    fill(el.evidence, h('div', { class: 'empty', testid: 'evidence-empty' }, ui.finding
      ? h('p', null, `The linked finding is not part of run ${ui.run}. Choose a finding from the list.`)
      : h('p', null, 'Choose a finding to see its calculation, source fields and evidence.')));
    return;
  }
  const docs = new Map(a.canonicalInput.bundle.documents.map((d) => [d.documentId, d]));
  const evalForRule = a.ruleEvaluations.find((r) => r.ruleId === f.ruleId && r.ruleVersion === f.ruleVersion);
  const docMeta = (id) => { const d = docs.get(id); return d ? `${d.title}. ${d.documentType}, ${d.periodStart} to ${d.periodEnd}, ${d.signed ? 'signed' : 'unsigned'}, project ${d.projectId}.` : ''; };
  fill(el.evidence,
    h('div', { testid: 'evidence-detail' },
      h('h3', { testid: 'evidence-title' }, TITLES[f.code] ?? f.code),
      h('dl', { class: 'kv' },
        h('dt', null, 'Severity'), h('dd', null, SEVERITY_TEXT[f.severity]),
        h('dt', null, 'Category'), h('dd', null, CATEGORY_TEXT[f.category]),
        h('dt', null, 'Rule'), h('dd', { class: 'num' }, `${f.ruleId} version ${f.ruleVersion}`),
        h('dt', null, 'Run'), h('dd', null, `Run ${ui.run}, fingerprint ${runOf(ui.run).semanticHash.slice(0, 12)}`),
        f.source ? [h('dt', null, 'Source clause'), h('dd', { testid: 'evidence-clause' }, `${f.source.clause} (illustrative contract condition, not law)`)] : null),
      h('p', { testid: 'evidence-rationale' }, f.rationale),
      f.formula ? h('p', { class: 'formula', testid: 'evidence-formula' }, f.formula) : null,
      h('h4', null, 'Observed'), kvTable(f.observed, 'evidence-observed'),
      h('h4', null, 'Expected'), kvTable(f.expected, 'evidence-expected'),
      f.rejectedCandidates?.length ? [
        h('h4', null, 'Documents considered and rejected'),
        h('div', { testid: 'rejected-candidates' }, f.rejectedCandidates.map((c) => h('div', { class: 'candidate' },
          h('h4', { class: 'num' }, c.documentId),
          h('p', null, h('strong', null, c.reasons.map((r) => REASON_TEXT[r] ?? r).join(', ')), '. ', c.explanation),
          h('p', { class: 'hint' }, docMeta(c.documentId))))),
      ] : null,
      evalForRule?.matchedDocumentIds.length ? h('div', null, evalForRule.matchedDocumentIds.map((id) => h('div', { class: 'candidate matched' }, h('h4', null, `Matched: ${id}`), h('p', { class: 'hint' }, docMeta(id))))) : null,
      h('h4', null, 'Input fields used'),
      h('ul', { class: 'refs num' }, f.inputRefs.map((r) => h('li', null, `${r.entity} ${r.id}, ${r.field}`))),
      h('h4', null, 'Next step'),
      h('p', { testid: 'evidence-remediation' }, f.remediation)));
}

// ---------- Correction ----------
function buildCorrect() {
  const input = h('input', { type: 'text', id: 'claim', inputmode: 'decimal', autocomplete: 'off', testid: 'claim-input', 'aria-describedby': 'claim-hint claim-err' });
  const err = h('p', { id: 'claim-err', class: 'field-error', 'aria-live': 'polite' });
  const stage = h('button', { type: 'submit', class: 'btn', testid: 'stage-claim' }, 'Stage claim correction');
  const form = h('form', { novalidate: true, testid: 'claim-form' },
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'claim' }, 'Claimed current due (current period), USD'), input,
        h('p', { class: 'hint', id: 'claim-hint' }, 'Plain decimal, up to two places, for example 45000.00.')),
      stage), err);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = wf.stageClaim(input.value);
    if (!r.ok) { err.textContent = r.errors[0].message; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    err.textContent = ''; input.removeAttribute('aria-invalid');
    renderStaged(); announce(`Claim correction staged at ${m(r.value.claimCents)}. Rerun the analysis to apply it.`);
  });
  const attach = h('button', { type: 'button', class: 'btn', testid: 'attach-waiver', id: 'attach-waiver' }, 'Attach corrected sample waiver');
  attach.addEventListener('click', () => {
    const r = wf.stageWaiver();
    if (!r.ok) { announce(r.errors[0].message); return; }
    renderStaged(); announce(`Waiver ${wf.correctedWaiverId} staged. Rerun the analysis to apply it.`);
  });
  const rerun = h('button', { type: 'button', class: 'btn btn-primary', testid: 'rerun', id: 'rerun' }, 'Rerun analysis');
  rerun.addEventListener('click', () => busy(rerun, 'Running…', async () => {
    const r = await wf.rerun();
    if (!r.ok) { showErrors('The rerun did not complete', r.errors, keepText()); announce('Rerun failed. The previous report is unchanged.'); return; }
    clearErrors();
    onNewRun(r.value, 'Analysis rerun.');
  }));
  const discard = h('button', { type: 'button', class: 'btn btn-quiet', testid: 'discard-staged', onclick: () => { wf.discardDraft(); renderStaged(); announce('Staged changes discarded.'); } }, 'Discard staged changes');
  fill(el.correct,
    h('p', null, 'Stage one or both corrections, then rerun. A finding is resolved only when a new run no longer produces it.'),
    form,
    h('div', { class: 'field' }, h('p', { class: 'label' }, 'Supporting evidence'),
      h('p', { class: 'hint' }, 'Adds the fictional signed October conditional waiver from the sample files. No document contents are read.'), attach),
    h('div', { id: 'staged', testid: 'staged' }),
    h('div', { class: 'actions' }, rerun, discard));
}
function renderStaged() {
  const d = wf.state.draft;
  const items = [];
  if (d?.claimText !== undefined) items.push(h('li', null, `Claimed current due set to ${m(d.claimCents)}`));
  if (d?.attachWaiver) items.push(h('li', null, `Attach ${wf.correctedWaiverId}`));
  fill($('#staged'), items.length
    ? h('div', { class: 'staged' }, h('strong', null, 'Staged, not yet analyzed'), h('ul', null, items))
    : h('p', { class: 'hint' }, 'Nothing staged. Rerunning now records a new run with the same inputs.'));
  const attached = wf.state.attachedDocuments.some((x) => x.documentId === wf.correctedWaiverId) || d?.attachWaiver;
  const btn = $('#attach-waiver');
  btn.disabled = Boolean(attached);
  btn.textContent = attached ? `Waiver ${wf.correctedWaiverId} ${d?.attachWaiver ? 'staged' : 'attached'}` : 'Attach corrected sample waiver';
}

// ---------- Review ----------
function buildReview() {
  const findingSel = h('select', { id: 'rv-finding', testid: 'review-finding' });
  const disp = h('select', { id: 'rv-disp', testid: 'review-disposition' }, h('option', { value: '' }, 'Note only, no disposition'), Object.entries(DISPOSITION_TEXT).map(([k, v]) => h('option', { value: k }, v)));
  const note = h('textarea', { id: 'rv-note', maxlength: String(IMPORT_LIMITS.MAX_REVIEW_NOTE_CHARS), testid: 'review-note', 'aria-describedby': 'rv-count rv-err' });
  const count = h('p', { id: 'rv-count', class: 'counter' });
  const err = h('p', { id: 'rv-err', class: 'field-error', 'aria-live': 'polite' });
  const updateCount = () => { count.textContent = `${note.value.length} of ${IMPORT_LIMITS.MAX_REVIEW_NOTE_CHARS} characters`; };
  note.addEventListener('input', updateCount);
  updateCount();
  const form = h('form', { novalidate: true, testid: 'review-form' },
    h('p', { id: 'rv-run', class: 'hint' }),
    h('div', { class: 'field' }, h('label', { for: 'rv-finding' }, 'Finding'), findingSel),
    h('div', { class: 'field' }, h('label', { for: 'rv-disp' }, 'Disposition'), disp,
      h('p', { class: 'hint' }, 'There is no resolve or dismiss option. Findings clear only through a rerun.')),
    h('div', { class: 'field' }, h('label', { for: 'rv-note' }, 'Reviewer note'), note, count),
    err,
    h('button', { type: 'submit', class: 'btn btn-primary', testid: 'review-submit' }, 'Record review entry'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = wf.addReview({ runIndex: ui.run, findingId: findingSel.value, disposition: disp.value || undefined, note: note.value });
    if (!r.ok) { err.textContent = r.errors[0].message; return; }
    err.textContent = '';
    note.value = ''; disp.value = ''; updateCount();
    renderHistory();
    announce(`Review entry ${r.value.eventId} recorded for run ${ui.run}.`);
  });
  fill(el.review, form, h('h3', null, 'Review history'), h('ol', { class: 'history', id: 'history', testid: 'review-history' }));
}
function syncReviewFinding() {
  const sel = $('#rv-finding');
  const a = runOf(ui.run).analysis;
  const keep = ui.finding ?? sel.value;
  fill(sel, a.findings.map((f) => h('option', { value: f.findingId, selected: f.findingId === keep }, `${SEVERITY_TEXT[f.severity]}: ${TITLES[f.code] ?? f.code}`)));
  sel.disabled = a.findings.length === 0;
  $('#rv-run').textContent = a.findings.length ? `Entries are recorded against run ${ui.run}.` : `Run ${ui.run} has no findings to review.`;
  $('[data-testid="review-submit"]').disabled = a.findings.length === 0;
}
function renderHistory() {
  const runByHash = new Map();
  for (const r of wf.state.runs) if (!runByHash.has(r.semanticHash)) runByHash.set(r.semanticHash, r.index);
  const runIdx = new Map();
  let n = 0;
  fill($('#history'), wf.state.history.map((e) => {
    if (e.type === 'ANALYSIS_RUN') { n += 1; runIdx.set(e.eventId, n); }
    const code = e.findingId?.split('|')[0];
    return h('li', { testid: `history-${e.eventId}` },
      h('strong', null, e.type === 'ANALYSIS_RUN' ? `Run ${runIdx.get(e.eventId)} recorded` : e.type === 'NOTE' ? 'Note' : `Disposition: ${DISPOSITION_TEXT[e.disposition]}`),
      ' ', h('span', { class: 'muted num' }, `${e.eventId}, ${e.occurredAt}`),
      e.findingId ? h('p', { class: 'hint' }, `${TITLES[code] ?? code}, run ${runByHash.get(e.analysisHash)}`) : null,
      e.note !== undefined ? h('p', { class: 'note' }, e.note) : null);
  }));
}

// ---------- Export ----------
function download(text, filename, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = h('a', { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderExport() {
  const go = (format) => {
    const r = wf.exportReport(ui.run, format);
    if (!r.ok) { showErrors('Export failed', r.errors); return; }
    download(r.value.text, r.value.filename, r.value.mime);
    announce(`Downloaded ${r.value.filename} (${r.value.text.length} characters).`);
  };
  fill(el.export,
    h('p', null, `Exports run ${ui.run} with every earlier run's finding status and the full review history. Amounts are in USD; the JSON keeps integer cents.`),
    h('p', { testid: 'export-origin' }, `Both files record this run's origin as ${ORIGIN_TEXT[runOf(ui.run).origin].toLowerCase()} (${runOf(ui.run).origin}) with the warning that PayGuard does not detect or prevent real data.`),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', testid: 'export-json', onclick: () => go('json') }, `Download report JSON (run ${ui.run})`),
      h('button', { type: 'button', class: 'btn', testid: 'export-csv', onclick: () => go('csv') }, `Download report CSV (run ${ui.run})`)),
    h('p', { class: 'hint' }, 'CSV text cells that start with =, +, -, @, tab or carriage return are neutralised so spreadsheets do not run them as formulas.'));
}

// ---------- Method ----------
function renderMethod(a) {
  const rep = wf.report(ui.run);
  const rules = a.canonicalInput.bundle.rules;
  fill(el.method,
    h('h3', null, 'Configured requirement'),
    rules.length ? h('ul', { testid: 'method-rules' }, rules.map((r) => h('li', null,
      `${r.ruleId} version ${r.ruleVersion}: a signed ${r.documentType.toLowerCase().replace('_', ' ')} for this project and the exact application period. Source: ${r.sourceClause}, an illustrative sample condition, not a statute or universal form rule.`)))
      : h('p', null, 'No document requirement is configured. That means the requirement was not checked, not that the application meets it.'),
    h('h3', null, 'Calculation rules applied'),
    h('ul', { class: 'num' }, a.ruleVersions.map((r) => h('li', null, `${r.ruleId} v${r.ruleVersion}`))),
    h('h3', null, 'Limits of this review'),
    h('ul', { testid: 'method-limitations' }, (rep.ok ? rep.value.limitations : []).map((x) => h('li', null, x))));
}

// ---------- Orchestration ----------
function renderRun() {
  renderImportState();
  const has = latest() > 0;
  el.runbar.hidden = !has;
  el.desk.hidden = !has;
  if (!has) return;
  if (!runOf(ui.run)) ui.run = latest();
  const a = runOf(ui.run).analysis;
  renderRunbar(); renderSummary(a); renderLedger(a); renderFindingList(false); renderEvidence(false);
  renderStaged(); syncReviewFinding(); renderHistory(); renderExport(); renderMethod(a);
}

$('#reset').addEventListener('click', () => {
  if (!wf) return;
  wf.reset();
  ui.run = 0; ui.finding = null;
  writeUrl(true);
  clearErrors();
  renderRun();
  announce('Demo reset. Runs, corrections and review history in this tab were cleared.');
  $('[data-testid="load-sample-json"]').focus();
});

async function main() {
  for (const n of document.querySelectorAll('[data-synthetic-label]')) n.textContent = SYNTHETIC_LABEL;
  try { wf = await loadWorkflow(); } catch (e) {
    showErrors('The synthetic project could not load', [{ code: 'MISSING_FILE', message: failureText(e) }], 'Reload the page to try again.');
    announce('The synthetic project could not load.');
    return;
  }
  const u = readUrl();
  ui.finding = u.finding;
  buildImport(); buildFindingControls(); buildCorrect(); buildReview();
  renderRun();
  announce(u.finding || u.run ? 'This link points to a review in another session. Load the sample application to recreate it; state is not stored.' : 'Synthetic project loaded. No application yet.');
}
main();
