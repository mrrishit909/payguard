// Readable labels for finding observed/expected keys. DOM-free; covered by tests/payguard-app/labels.test.js.
// Amount keys end in Cents in the engine and in exports; on screen their values are formatted
// dollars, so the label says USD instead.
export const FIELD_TEXT = Object.freeze({
  grossEarnedToDateCents: 'Gross earned to date, USD',
  overCapCents: 'Amount over the revised cap, USD',
  maximumGrossEarnedToDateCents: 'Maximum gross earned to date (revised cap), USD',
  calculatedCurrentDueCents: 'Calculated current due (current period), USD',
  postedPriorPaymentsCents: 'Posted prior payments, USD',
  minimumCalculatedCurrentDueCents: 'Minimum calculated current due, USD',
  claimedCurrentDueCents: 'Claimed current due (current period), USD',
  claimDiscrepancyCents: 'Difference, claimed minus calculated, USD',
  toleranceCents: 'Tolerance, USD',
  amountCents: 'Change order amount, USD',
  status: 'Change order status',
  lineId: 'Schedule of values line',
  includedInRevisedCap: 'Included in the revised cap',
  requiredSignedDocumentRuleConfigured: 'Signed document requirement configured',
  signedDocumentForPeriod: 'Signed document on file for the period',
  documentType: 'Document type',
  projectId: 'Project',
  periodStart: 'Period start',
  periodEnd: 'Period end',
});

const words = (k) => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** Label for an engine key; unknown amount keys still read as USD rather than as raw cents. */
export const fieldText = (k) => FIELD_TEXT[k] ?? (k.endsWith('Cents') ? `${words(k.slice(0, -5))}, USD` : words(k));
