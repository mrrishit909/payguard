// Reconciliation (PG-CALC-01..04), configured document rule (PG-REQ-xx) and findings (ADR-0003/0005).
import {
  SCHEMA_VERSIONS, DATA_CLASSIFICATION, ENGINE_CONTRACT_VERSION, CALCULATION_RULES, FINDING_CODES,
  FINDING_SEVERITY, FINDING_CATEGORY, RULE_OUTCOME, READINESS,
} from '../../contracts/src/constants.js';
import { add, sub, sum, retainageHalfUp, formatCentsText, ArithmeticOverflow } from './money.js';
import { cmp, byKey, clone, deepFreeze, periodLabel } from './canonical.js';
import { validateBundle } from './validate.js';
import { ErrorList, fail, checkImportedEnvelope } from './import.js';

/** Pseudo rule identity used only when no REQUIRED_SIGNED_DOCUMENT rule is configured. */
export const NOT_CONFIGURED_RULE = Object.freeze({ ruleId: 'PG-REQ-NONE', ruleVersion: 0 });

const SEVERITY_RANK = { BLOCKING: 0, WARNING: 1, INFO: 2 };
const usd = (c) => formatCentsText(c, true);
const signedUsd = (c) => (c > 0 ? `+${usd(c)}` : usd(c));
const ref = (entity, id, field) => ({ entity, id, field });
const refKey = (r) => `${r.entity}\u0000${r.id}\u0000${r.field}`;
const sortRefs = (refs) => [...new Map(refs.map((r) => [refKey(r), r])).values()].sort((a, b) => cmp(refKey(a), refKey(b)));

function finding({ code, severity, category, rule, subject, inputRefs, observed, expected, formula, rationale, remediation, source, rejectedCandidates }) {
  return {
    findingId: `${code}|${rule.ruleId}@v${rule.ruleVersion}|${subject.entity}:${subject.id}`,
    code, severity, category, ruleId: rule.ruleId, ruleVersion: rule.ruleVersion, subject,
    inputRefs: sortRefs(inputRefs), observed, expected,
    ...(formula ? { formula } : {}), rationale, remediation,
    ...(source ? { source } : {}), ...(rejectedCandidates ? { rejectedCandidates } : {}),
  };
}

function evaluateRule(rule, bundle, app) {
  const projectId = bundle.project.projectId;
  const matched = []; const rejected = [];
  for (const d of bundle.documents) {
    const reasons = [];
    if (d.projectId !== projectId) reasons.push('WRONG_PROJECT');
    if (d.documentType !== rule.documentType) reasons.push('WRONG_DOCUMENT_TYPE');
    if (d.periodStart !== app.periodStart || d.periodEnd !== app.periodEnd) reasons.push('WRONG_PERIOD');
    if (d.signed !== true) reasons.push('UNSIGNED');
    if (reasons.length === 0) { matched.push(d.documentId); continue; }
    if (d.documentType !== rule.documentType && d.projectId !== projectId) continue;
    reasons.sort(cmp);
    const parts = reasons.map((r) => ({
      WRONG_PROJECT: `belongs to project ${d.projectId}, not ${projectId}`,
      WRONG_DOCUMENT_TYPE: `is a ${d.documentType}, not a ${rule.documentType}`,
      WRONG_PERIOD: `covers ${d.periodStart} to ${d.periodEnd}, not the application period ${app.periodStart} to ${app.periodEnd}`,
      UNSIGNED: 'is not signed',
    })[r]);
    rejected.push({ documentId: d.documentId, reasons, explanation: `Document ${d.documentId} does not satisfy ${rule.ruleId} v${rule.ruleVersion}: it ${parts.join('; it ')}.` });
  }
  return {
    ruleId: rule.ruleId, ruleVersion: rule.ruleVersion,
    outcome: matched.length > 0 ? RULE_OUTCOME.SATISFIED : RULE_OUTCOME.NOT_SATISFIED,
    matchedDocumentIds: matched.sort(cmp), rejectedCandidates: rejected.sort(byKey('documentId')),
  };
}

function compute(bundle, imported) {
  const app = imported.application;
  const errors = new ErrorList();
  if (app.contractId !== bundle.contract.contractId) errors.add('UNKNOWN_REFERENCE', `Application contract ${app.contractId} does not match ${bundle.contract.contractId}.`, { path: '/imported/application/contractId' });
  if (app.currency !== bundle.contract.currency) errors.add('UNSUPPORTED_CURRENCY', 'Application currency does not match the contract.', { path: '/imported/application/currency' });
  const sov = new Map(bundle.sovLines.map((l) => [l.lineId, l]));
  const appLines = new Map(app.lines.map((l) => [l.lineId, l]));
  app.lines.forEach((l, i) => { if (!sov.has(l.lineId)) errors.add('UNKNOWN_REFERENCE', `Application line ${l.lineId} is not in the schedule of values.`, { path: `/imported/application/lines/${i}/lineId` }); });
  for (const id of sov.keys()) if (!appLines.has(id)) errors.add('MISSING_FIELD', `Schedule-of-values line ${id} has no application line.`, { path: '/imported/application/lines' });
  if (errors.any) return fail(errors);

  const bps = bundle.contract.retainage.basisPoints;
  const lines = bundle.sovLines.map((s) => {
    const a = appLines.get(s.lineId);
    const cos = bundle.changeOrders.filter((c) => c.lineId === s.lineId);
    const approved = sum(cos.filter((c) => c.status === 'APPROVED').map((c) => c.amountCents));
    const pending = sum(cos.filter((c) => c.status === 'PENDING').map((c) => c.amountCents));
    const cap = add(s.originalValueCents, approved);
    const gross = add(a.completedToDateCents, a.storedToDateCents);
    const ret = retainageHalfUp(gross, bps);
    return {
      lineId: s.lineId, originalValueCents: s.originalValueCents, approvedChangeOrdersCents: approved,
      pendingChangeOrdersCents: pending, revisedCapCents: cap, completedToDateCents: a.completedToDateCents,
      storedToDateCents: a.storedToDateCents, grossEarnedToDateCents: gross, retainageToDateCents: ret,
      netEarnedToDateCents: sub(gross, ret), overCapCents: gross > cap ? sub(gross, cap) : 0,
    };
  });
  const total = (k) => sum(lines.map((l) => l[k]));
  const posted = sum(bundle.priorPayments.filter((p) => p.status === 'POSTED').map((p) => p.amountCents));
  const net = total('netEarnedToDateCents');
  const due = sub(net, posted);
  const totals = {
    originalContractCents: total('originalValueCents'), approvedChangeOrdersCents: total('approvedChangeOrdersCents'),
    pendingChangeOrdersCents: total('pendingChangeOrdersCents'), revisedContractCents: total('revisedCapCents'),
    completedToDateCents: total('completedToDateCents'), storedToDateCents: total('storedToDateCents'),
    grossEarnedToDateCents: total('grossEarnedToDateCents'), retainageToDateCents: total('retainageToDateCents'),
    netEarnedToDateCents: net, postedPriorPaymentsCents: posted,
    priorCertifiedInformationalCents: sum(bundle.priorCertifications.map((c) => c.netCertifiedCents)),
    calculatedCurrentDueCents: due, claimedCurrentDueCents: app.claimedCurrentDueCents,
    claimDiscrepancyCents: sub(app.claimedCurrentDueCents, due),
  };

  const findings = [];
  const appId = app.applicationId;
  const postedRefs = bundle.priorPayments.filter((p) => p.status === 'POSTED').map((p) => ref('payment', p.paymentId, 'amountCents'));
  const lineRefs = lines.flatMap((l) => [ref('applicationLine', l.lineId, 'completedToDateCents'), ref('applicationLine', l.lineId, 'storedToDateCents')]);

  for (const l of lines) {
    if (l.overCapCents <= 0) continue;
    const pendingNote = l.pendingChangeOrdersCents > 0 ? ` Pending change orders of ${usd(l.pendingChangeOrdersCents)} on this line are not approved and do not raise the cap.` : '';
    findings.push(finding({
      code: FINDING_CODES.LINE_EARNED_EXCEEDS_REVISED_CAP, severity: FINDING_SEVERITY.BLOCKING, category: FINDING_CATEGORY.FINANCIAL,
      rule: CALCULATION_RULES.REVISED_CAP, subject: ref('sovLine', l.lineId, 'revisedCapCents'),
      inputRefs: [ref('sovLine', l.lineId, 'originalValueCents'), ref('applicationLine', l.lineId, 'completedToDateCents'), ref('applicationLine', l.lineId, 'storedToDateCents'),
        ...bundle.changeOrders.filter((c) => c.lineId === l.lineId).map((c) => ref('changeOrder', c.changeOrderId, 'amountCents'))],
      observed: { grossEarnedToDateCents: l.grossEarnedToDateCents, overCapCents: l.overCapCents },
      expected: { maximumGrossEarnedToDateCents: l.revisedCapCents },
      formula: `${usd(l.grossEarnedToDateCents)} gross earned - ${usd(l.revisedCapCents)} revised cap = ${signedUsd(l.overCapCents)}`,
      rationale: `Cumulative gross earned on line ${l.lineId} (${usd(l.grossEarnedToDateCents)}) exceeds its revised cap (${usd(l.originalValueCents)} original + ${usd(l.approvedChangeOrdersCents)} approved change orders = ${usd(l.revisedCapCents)}) by ${usd(l.overCapCents)}. The amount is shown unclipped.${pendingNote}`,
      remediation: `Reduce the claimed completed or stored amount on line ${l.lineId} to the revised cap, or obtain an approved change order, then rerun validation.`,
    }));
  }
  if (due < 0) {
    findings.push(finding({
      code: FINDING_CODES.OVERPAYMENT_CREDIT, severity: FINDING_SEVERITY.BLOCKING, category: FINDING_CATEGORY.FINANCIAL,
      rule: CALCULATION_RULES.AMOUNT_DUE, subject: ref('application', appId, 'calculatedCurrentDueCents'),
      inputRefs: [...lineRefs, ...postedRefs], observed: { calculatedCurrentDueCents: due, postedPriorPaymentsCents: posted },
      expected: { minimumCalculatedCurrentDueCents: 0 },
      formula: `${usd(net)} net earned - ${usd(posted)} posted prior payments = ${usd(due)}`,
      rationale: `Posted prior payments exceed cumulative net earned, giving a calculated current due of ${usd(due)}. This indicates an overpayment or credit of ${usd(-due)}; it is not floored to zero.`,
      remediation: 'Review posted prior payments and earned amounts with the fictional counterparty, then rerun validation.',
    }));
  }
  if (totals.claimDiscrepancyCents !== 0) {
    findings.push(finding({
      code: FINDING_CODES.CLAIMED_DUE_MISMATCH, severity: FINDING_SEVERITY.BLOCKING, category: FINDING_CATEGORY.FINANCIAL,
      rule: CALCULATION_RULES.CLAIM_COMPARISON, subject: ref('application', appId, 'claimedCurrentDueCents'),
      inputRefs: [ref('application', appId, 'claimedCurrentDueCents'), ...lineRefs, ...postedRefs],
      observed: { claimedCurrentDueCents: app.claimedCurrentDueCents, claimDiscrepancyCents: totals.claimDiscrepancyCents },
      expected: { calculatedCurrentDueCents: due, toleranceCents: 0 },
      formula: `${usd(app.claimedCurrentDueCents)} - ${usd(due)} = ${signedUsd(totals.claimDiscrepancyCents)} (calculated due = ${usd(totals.grossEarnedToDateCents)} gross earned - ${usd(totals.retainageToDateCents)} retainage - ${usd(posted)} posted prior payments)`,
      rationale: `The claimed current due of ${usd(app.claimedCurrentDueCents)} differs from the calculated current due of ${usd(due)} by ${signedUsd(totals.claimDiscrepancyCents)}. Tolerance is exactly zero. Prior certified amounts are informational and are not subtracted; retainage is withheld, not paid.`,
      remediation: `Change the claimed current due to ${usd(due)} or correct the underlying line amounts, then rerun validation.`,
    }));
  }
  for (const co of bundle.changeOrders.filter((c) => c.status === 'PENDING')) {
    findings.push(finding({
      code: FINDING_CODES.PENDING_CHANGE_ORDER_CONTEXT, severity: FINDING_SEVERITY.INFO, category: FINDING_CATEGORY.CONTEXT,
      rule: CALCULATION_RULES.REVISED_CAP, subject: ref('changeOrder', co.changeOrderId, 'status'),
      inputRefs: [ref('changeOrder', co.changeOrderId, 'status'), ref('changeOrder', co.changeOrderId, 'amountCents')],
      observed: { status: co.status, amountCents: co.amountCents, lineId: co.lineId },
      expected: { includedInRevisedCap: false },
      rationale: `Change order ${co.changeOrderId} (${usd(co.amountCents)}, line ${co.lineId}) is PENDING and is excluded from the revised cap. Context only; it is not an additional discrepancy.`,
      remediation: 'No action required for this calculation; include the amount only after the change order is approved.',
    }));
  }

  const rules = bundle.rules;
  const ruleEvaluations = [];
  if (rules.length === 0) {
    ruleEvaluations.push({ ...NOT_CONFIGURED_RULE, outcome: RULE_OUTCOME.NOT_CONFIGURED, matchedDocumentIds: [], rejectedCandidates: [] });
    findings.push(finding({
      code: FINDING_CODES.REQUIREMENT_NOT_CONFIGURED, severity: FINDING_SEVERITY.INFO, category: FINDING_CATEGORY.DOCUMENTARY,
      rule: NOT_CONFIGURED_RULE, subject: ref('application', appId, 'periodEnd'), inputRefs: [ref('application', appId, 'periodEnd')],
      observed: { requiredSignedDocumentRuleConfigured: false }, expected: { requiredSignedDocumentRuleConfigured: true },
      rationale: 'No required-signed-document requirement is configured for this project. Documentary readiness was not evaluated; this is not a statement that documents are complete.',
      remediation: 'Configure the applicable illustrative document requirement if one applies, then rerun validation.',
    }));
  }
  const label = periodLabel(app.periodStart, app.periodEnd);
  for (const rule of rules) {
    const ev = evaluateRule(rule, bundle, app);
    ruleEvaluations.push(ev);
    if (ev.outcome === RULE_OUTCOME.SATISFIED) continue;
    const cands = ev.rejectedCandidates.length
      ? ` Rejected candidates: ${ev.rejectedCandidates.map((c) => `${c.documentId} (${c.reasons.join(', ')})`).join('; ')}.`
      : ' No candidate documents were provided.';
    findings.push(finding({
      code: rule.findingCode, severity: FINDING_SEVERITY.BLOCKING, category: FINDING_CATEGORY.DOCUMENTARY,
      rule, subject: ref('application', appId, 'periodEnd'),
      inputRefs: [ref('rule', rule.ruleId, 'documentType'), ref('application', appId, 'periodStart'), ref('application', appId, 'periodEnd'),
        ...ev.rejectedCandidates.map((c) => ref('document', c.documentId, 'signed'))],
      observed: { signedDocumentForPeriod: false },
      expected: { signedDocumentForPeriod: true, documentType: rule.documentType, projectId: bundle.project.projectId, periodStart: app.periodStart, periodEnd: app.periodEnd },
      rationale: `Required signed ${rule.documentType.toLowerCase().replace('_', ' ')} for ${label} is absent for project ${bundle.project.projectId}. Configured rule ${rule.ruleId} v${rule.ruleVersion} cites "${rule.sourceClause}", an illustrative contract condition, not law.${cands}`,
      remediation: rule.remediation,
      source: { clause: rule.sourceClause, illustrative: true },
      rejectedCandidates: ev.rejectedCandidates,
    }));
  }
  ruleEvaluations.sort((a, b) => cmp(a.ruleId, b.ruleId) || a.ruleVersion - b.ruleVersion);
  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || cmp(a.findingId, b.findingId));
  const ruleVersions = [...Object.values(CALCULATION_RULES), ...rules].map((r) => ({ ruleId: r.ruleId, ruleVersion: r.ruleVersion }))
    .sort((a, b) => cmp(a.ruleId, b.ruleId) || a.ruleVersion - b.ruleVersion);

  return {
    ok: true,
    value: deepFreeze(clone({
      schemaVersion: SCHEMA_VERSIONS.ANALYSIS_RESULT, dataClassification: DATA_CLASSIFICATION,
      engineContractVersion: ENGINE_CONTRACT_VERSION,
      readiness: findings.some((f) => f.severity === 'BLOCKING') ? READINESS.NOT_READY : READINESS.NO_BLOCKING_FINDINGS,
      lines, totals, ruleEvaluations, findings, ruleVersions, canonicalInput: { bundle, imported },
    })),
  };
}

/** @param {{ bundle: unknown, imported: unknown }} input */
export function analyzeInput(input) {
  const b = validateBundle(input?.bundle);
  if (!b.ok) return b;
  const errors = new ErrorList();
  checkImportedEnvelope(input.imported, errors);
  if (errors.any) return fail(errors);
  const imported = clone(input.imported);
  imported.application.lines.sort(byKey('lineId'));
  try {
    return compute(b.value, imported);
  } catch (e) {
    if (e instanceof ArithmeticOverflow) return fail([{ code: 'ARITHMETIC_OVERFLOW', message: 'A calculation exceeded the safe integer range.' }]);
    throw e;
  }
}
