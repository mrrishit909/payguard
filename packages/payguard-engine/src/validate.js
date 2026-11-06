// Project bundle validation (seeded data is trusted only as synthetic, not as correct).
import {
  SCHEMA_VERSIONS, DATA_CLASSIFICATION, CURRENCY, MONEY_LIMITS, IMPORT_LIMITS, ID_PATTERN,
  CHANGE_ORDER_STATUS, PAYMENT_STATUS, DOCUMENT_TYPE, RULE_KIND, FINDING_CODES, RETAINAGE_BASE, ROUNDING,
} from '../../contracts/src/constants.js';
import { ErrorList, fail } from './import.js';
import { byKey, cmp, clone, deepFreeze, isValidDate, isPlainObject as isPlain, hasOwn } from './canonical.js';

const ID_RE = new RegExp(ID_PATTERN);

/** Field kinds: id | string | cents | bps | int+ | bool | true | date | date? | enum:<values> | const:<value> */
const SHAPES = {
  root: { schemaVersion: ['const', SCHEMA_VERSIONS.PROJECT_BUNDLE, 'UNSUPPORTED_SCHEMA_VERSION'],
    dataClassification: ['const', DATA_CLASSIFICATION, 'UNSUPPORTED_CLASSIFICATION'], bundleId: ['id'],
    project: ['object'], contract: ['object'], sovLines: ['array'], changeOrders: ['array'], priorPayments: ['array'],
    priorCertifications: ['array'], documents: ['array'], rules: ['array'] },
  project: { projectId: ['id'], name: ['string'] },
  contract: { contractId: ['id'], projectId: ['id'], currency: ['const', CURRENCY, 'UNSUPPORTED_CURRENCY'], retainage: ['object'] },
  retainage: { basisPoints: ['bps'], base: ['enum', Object.values(RETAINAGE_BASE)], rounding: ['enum', Object.values(ROUNDING)] },
  sovLines: { lineId: ['id'], contractId: ['id'], description: ['string'], originalValueCents: ['cents'] },
  changeOrders: { changeOrderId: ['id'], contractId: ['id'], lineId: ['id'], amountCents: ['cents'], status: ['enum', Object.values(CHANGE_ORDER_STATUS)] },
  priorPayments: { paymentId: ['id'], contractId: ['id'], amountCents: ['cents'], status: ['enum', Object.values(PAYMENT_STATUS)], postedDate: ['date', 'optional'] },
  priorCertifications: { certificationId: ['id'], contractId: ['id'], netCertifiedCents: ['cents'] },
  documents: { documentId: ['id'], projectId: ['id'], documentType: ['enum', Object.values(DOCUMENT_TYPE)], periodStart: ['date'], periodEnd: ['date'], signed: ['bool'], title: ['string'] },
  rules: { ruleId: ['id'], ruleVersion: ['int+'], kind: ['enum', Object.values(RULE_KIND)], documentType: ['enum', Object.values(DOCUMENT_TYPE)],
    matchScope: ['enum', ['SAME_PROJECT_AND_EXACT_APPLICATION_PERIOD']], findingCode: ['enum', [FINDING_CODES.MISSING_REQUIRED_SIGNED_WAIVER]],
    sourceClause: ['string'], illustrative: ['true'], remediation: ['string'] },
};
const ID_KEY = { sovLines: 'lineId', changeOrders: 'changeOrderId', priorPayments: 'paymentId', priorCertifications: 'certificationId', documents: 'documentId' };

function checkObject(obj, shape, path, errors) {
  if (!isPlain(obj)) { errors.add('INVALID_TYPE', `${path || '/'} must be a plain JSON object (no inherited fields).`, { path }); return false; }
  // Own-property membership only: Object.prototype names (toString, constructor, __proto__) are unknown fields.
  for (const k of Object.keys(obj)) if (!hasOwn(SHAPES[shape], k)) errors.add('UNKNOWN_FIELD', `Unknown field ${k.slice(0, 64)}.`, { path: `${path}/${k.slice(0, 64)}` });
  for (const [k, [kind, arg, code]] of Object.entries(SHAPES[shape])) {
    const v = hasOwn(obj, k) ? obj[k] : undefined; const p = `${path}/${k}`; const loc = { path: p };
    if (v === undefined) { if (arg !== 'optional') errors.add('MISSING_FIELD', `Required field ${p} is missing.`, loc); continue; }
    switch (kind) {
      case 'const': if (v !== arg) errors.add(code, `Unsupported value at ${p}.`, loc); break;
      case 'id': if (typeof v !== 'string' || !ID_RE.test(v)) errors.add('INVALID_ID', `Invalid identifier at ${p}.`, loc); break;
      case 'string':
        if (typeof v !== 'string') errors.add('INVALID_TYPE', `${p} must be a string.`, loc);
        else if (v.length > IMPORT_LIMITS.MAX_STRING_CHARS) errors.add('STRING_TOO_LONG', `${p} exceeds 500 characters.`, loc);
        break;
      case 'cents':
        if (!Number.isSafeInteger(v)) errors.add('INVALID_AMOUNT', `${p} must be integer cents.`, loc);
        else if (v < 0 || v > MONEY_LIMITS.MAX_INPUT_AMOUNT_CENTS) errors.add('AMOUNT_OUT_OF_RANGE', `${p} is out of range.`, loc);
        break;
      case 'bps': if (!Number.isInteger(v) || v < 0 || v > MONEY_LIMITS.MAX_BASIS_POINTS) errors.add('INVALID_BASIS_POINTS', `${p} must be 0..10000.`, loc); break;
      case 'int+': if (!Number.isSafeInteger(v) || v < 1) errors.add('INVALID_TYPE', `${p} must be a positive integer.`, loc); break;
      case 'bool': if (typeof v !== 'boolean') errors.add('INVALID_TYPE', `${p} must be a boolean.`, loc); break;
      case 'true': if (v !== true) errors.add('INVALID_TYPE', `${p} must be true (illustrative configuration, not law).`, loc); break;
      case 'date': if (!isValidDate(v)) errors.add('INVALID_DATE', `${p} must be YYYY-MM-DD.`, loc); break;
      case 'enum': if (!arg.includes(v)) errors.add('INVALID_ENUM', `Unsupported value at ${p}.`, loc); break;
      case 'object': case 'array':
        if (kind === 'array' ? !Array.isArray(v) : !isPlain(v)) errors.add('INVALID_TYPE', `${p} must be an ${kind}.`, loc);
        break;
      default: break;
    }
  }
  return true;
}

/** @param {unknown} bundle */
export function validateBundle(bundle) {
  const errors = new ErrorList();
  if (!checkObject(bundle, 'root', '', errors)) return fail(errors);
  if (isPlain(bundle.project)) checkObject(bundle.project, 'project', '/project', errors);
  if (isPlain(bundle.contract)) {
    checkObject(bundle.contract, 'contract', '/contract', errors);
    if (isPlain(bundle.contract.retainage)) checkObject(bundle.contract.retainage, 'retainage', '/contract/retainage', errors);
  }
  for (const key of Object.keys(ID_KEY).concat('rules')) {
    if (!Array.isArray(bundle[key])) continue;
    if (bundle[key].length > IMPORT_LIMITS.MAX_ROWS) { errors.add('TOO_MANY_ROWS', `/${key} exceeds ${IMPORT_LIMITS.MAX_ROWS} entries.`, { path: `/${key}` }); continue; }
    bundle[key].forEach((item, i) => checkObject(item, key, `/${key}/${i}`, errors));
  }
  if (errors.any) return fail(errors);

  // Uniqueness and references.
  const contractId = bundle.contract.contractId;
  if (bundle.contract.projectId !== bundle.project.projectId) errors.add('UNKNOWN_REFERENCE', 'Contract projectId does not match the project.', { path: '/contract/projectId' });
  for (const [key, idKey] of Object.entries(ID_KEY)) {
    const seen = new Set();
    bundle[key].forEach((item, i) => {
      if (seen.has(item[idKey])) errors.add('DUPLICATE_ID', `Duplicate ${idKey} ${item[idKey]}.`, { path: `/${key}/${i}/${idKey}` });
      seen.add(item[idKey]);
      if (key !== 'documents' && item.contractId !== contractId) errors.add('UNKNOWN_REFERENCE', `${idKey} ${item[idKey]} references another contract.`, { path: `/${key}/${i}/contractId` });
    });
  }
  const lineIds = new Set(bundle.sovLines.map((l) => l.lineId));
  bundle.changeOrders.forEach((co, i) => {
    if (!lineIds.has(co.lineId)) errors.add('UNKNOWN_REFERENCE', `Change order ${co.changeOrderId} references missing line ${co.lineId}.`, { path: `/changeOrders/${i}/lineId` });
  });
  bundle.documents.forEach((d, i) => {
    if (d.periodEnd < d.periodStart) errors.add('PERIOD_END_BEFORE_START', `Document ${d.documentId} period ends before it starts.`, { path: `/documents/${i}/periodEnd` });
  });
  const ruleKeys = new Set();
  bundle.rules.forEach((r, i) => {
    const k = `${r.ruleId}@${r.ruleVersion}`;
    if (ruleKeys.has(k)) errors.add('DUPLICATE_ID', `Duplicate rule version ${k}.`, { path: `/rules/${i}` });
    ruleKeys.add(k);
  });
  if (errors.any) return fail(errors);

  const out = clone(bundle);
  for (const [key, idKey] of Object.entries(ID_KEY)) out[key].sort(byKey(idKey));
  out.rules.sort((a, b) => cmp(a.ruleId, b.ruleId) || a.ruleVersion - b.ruleVersion);
  return { ok: true, value: deepFreeze(out) };
}
