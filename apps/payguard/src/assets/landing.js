// Landing proof: the document fragment is filled from a real engine run on the sample files.
import { h, fill, $, motionPreference } from './dom.js';
import { loadWorkflow, fetchBytes, failureText, FIXTURES, SampleError, SYNTHETIC_LABEL } from './fixtures.js';

const sheet = $('#proof');
const skip = $('[data-testid="proof-skip"]');
// Figures sit in the proof sheet; the clause and limitations sit in Method. All are looked up
// page-wide before anything is written, so a missing slot never leaves a half-filled document.
const SLOTS = ['appId', 'period', 'lines', 'gross', 'ret', 'net', 'net2', 'posted', 'posted2', 'cert', 'pending', 'revised', 'due', 'claimed', 'diff', 'clause', 'limitations'];
const slot = (name) => $(`#main [data-f="${name}"]`);
let timer = 0;

function slots() {
  const missing = SLOTS.filter((name) => !slot(name));
  if (missing.length) throw new Error(`Landing slots missing: ${missing.join(', ')}`);
  return Object.fromEntries(SLOTS.map((name) => [name, slot(name)]));
}

function finishMotion() {
  sheet.classList.remove('align-run');
  skip.hidden = true;
  clearTimeout(timer);
}

async function main() {
  for (const el of document.querySelectorAll('[data-synthetic-label]')) el.textContent = SYNTHETIC_LABEL;
  const f = slots();
  const wf = await loadWorkflow();
  const bytes = await fetchBytes(FIXTURES.applicationJson);
  const run = await wf.importFile({ bytes, size: bytes.length, name: FIXTURES.applicationJson });
  if (!run.ok) throw new SampleError('The sample application did not pass validation.');
  const rep = wf.report(1);
  if (!rep.ok) throw new SampleError('The sample report could not be built.');
  const { analysis } = run.value;
  const t = analysis.totals;
  const m = wf.money;
  const app = analysis.canonicalInput.imported.application;
  const sov = new Map(analysis.canonicalInput.bundle.sovLines.map((l) => [l.lineId, l.description]));
  const rule = analysis.canonicalInput.bundle.rules[0];

  f.appId.textContent = app.applicationId;
  f.period.textContent = `${app.periodStart} to ${app.periodEnd}`;
  fill(f.lines, analysis.lines.map((l) => h('tr', null,
    h('td', null, `${l.lineId} ${sov.get(l.lineId) ?? ''}`),
    h('td', { class: 'num' }, m(l.grossEarnedToDateCents)),
    h('td', { class: 'num' }, m(l.retainageToDateCents)),
    h('td', { class: 'num' }, m(l.netEarnedToDateCents)))));
  f.gross.textContent = m(t.grossEarnedToDateCents);
  f.ret.textContent = m(t.retainageToDateCents);
  f.net.textContent = m(t.netEarnedToDateCents);
  f.net2.textContent = m(t.netEarnedToDateCents);
  f.posted.textContent = m(t.postedPriorPaymentsCents);
  f.posted2.textContent = m(t.postedPriorPaymentsCents);
  f.cert.textContent = m(t.priorCertifiedInformationalCents);
  f.pending.textContent = m(t.pendingChangeOrdersCents);
  f.revised.textContent = m(t.revisedContractCents);
  f.due.textContent = m(t.calculatedCurrentDueCents);
  f.claimed.textContent = m(t.claimedCurrentDueCents);
  const d = t.claimDiscrepancyCents;
  f.diff.textContent = `${d > 0 ? '+' : ''}${m(d)} difference`;
  if (rule) f.clause.textContent = rule.sourceClause;
  fill(f.limitations, rep.value.limitations.map((x) => h('li', null, x)));
  sheet.dataset.state = 'ready';

  // One alignment sequence; content is already final, only transforms move.
  const mq = motionPreference((reduced) => { if (reduced) finishMotion(); });
  if (!mq.matches) {
    sheet.classList.add('align-run');
    skip.hidden = false;
    timer = setTimeout(finishMotion, 1000);
  }
}

skip.addEventListener('click', () => { finishMotion(); $('#proof-title').focus?.(); });

main().catch((e) => {
  if (!(e instanceof SampleError)) console.error('PayGuard landing proof failed:', e);
  sheet.dataset.state = 'error';
  finishMotion();
  const diff = slot('diff');
  if (diff) diff.textContent = 'Not calculated';
  const lines = slot('lines');
  if (lines) fill(lines, h('tr', null, h('td', { colspan: 4, testid: 'proof-error' },
    `The sample figures could not be calculated. ${failureText(e)} `,
    h('a', { href: './app/' }, 'Open the review workspace'), ' to run the same check on the same sample files.')));
});
