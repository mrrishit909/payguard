// PayGuard v1 type contracts (JSDoc). Owner: architecture (A01). This module has no runtime
// behaviour; it exists so editors and a future approved `tsc --checkJs` can verify shapes.
// Runtime enforcement lives in the engine's validators (see docs/architecture/adr/0004).
//
// Conventions
// - All `...Cents` fields are safe integers in USD cents (MONEY_UNIT). Never floats.
// - All dates are calendar strings 'YYYY-MM-DD' (no time, no timezone).
// - "ToDate" fields are CUMULATIVE through the application period end; "Current" fields are
//   CURRENT-PERIOD. Every computed amount carries one of these labels in its name.
// - Arrays in canonical form are sorted by their ID using code-unit comparison.

/** @typedef {string} Id  Matches ID_PATTERN. Immutable once assigned. */
/** @typedef {string} IsoDate  'YYYY-MM-DD', calendar-valid. */
/** @typedef {number} Cents  Safe integer, USD cents. */
/** @typedef {number} BasisPoints  Integer 0..10000. */

// ---------------------------------------------------------------------------------------------
// Results and errors
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {object} ValidationError
 * @property {string} code        One of VALIDATION_ERROR_CODES.
 * @property {string} message     Plain language; never a stack trace or raw exception text.
 * @property {string} [path]      JSON Pointer for JSON input, e.g. '/lines/1/completedToDate'.
 * @property {number} [row]       1-based CSV data row (header is row 0).
 * @property {string} [column]    CSV column name.
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, errors: ValidationError[] }} Result
 * Failure carries no partial value. Callers must not render totals from a failed Result.
 */

// ---------------------------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {object} FieldRef  Points at one canonical input field.
 * @property {'project'|'contract'|'sovLine'|'changeOrder'|'payment'|'priorCertification'|'document'|'application'|'applicationLine'|'rule'} entity
 * @property {Id} id            For applicationLine: the lineId.
 * @property {string} field     Canonical field name, e.g. 'completedToDateCents'.
 */

/**
 * @typedef {object} ProvenanceEntry
 * @property {FieldRef} ref
 * @property {'seed'|'json'|'csv'} sourceFormat
 * @property {Id} sourceId              importBatchId for uploads; bundle id for seeded data.
 * @property {string} [jsonPointer]
 * @property {number} [row]
 * @property {string} [column]
 * @property {string} rawValue          Exactly as received (string form), never normalised.
 */

/**
 * @typedef {object} ImportBatch
 * @property {Id} importBatchId         'IB-' + first 16 hex chars of SHA-256(raw bytes).
 * @property {'json'|'csv'} sourceFormat
 * @property {number} byteLength
 * @property {string} sourceName        Display only; untrusted; bounded; never used as a path.
 */

// ---------------------------------------------------------------------------------------------
// Seeded project bundle (payguard.project.v1) — canonical, already in cents
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {object} Project
 * @property {Id} projectId
 * @property {string} name
 */

/**
 * @typedef {object} RetainagePolicy
 * @property {BasisPoints} basisPoints
 * @property {'COMPLETED_PLUS_STORED'} base   v1: one rate on per-line cumulative gross earned.
 * @property {'HALF_UP_PER_LINE_TO_CENT'} rounding
 */

/**
 * @typedef {object} Contract
 * @property {Id} contractId
 * @property {Id} projectId
 * @property {'USD'} currency
 * @property {RetainagePolicy} retainage
 */

/**
 * @typedef {object} SovLine  Schedule-of-values line.
 * @property {Id} lineId
 * @property {Id} contractId
 * @property {string} description
 * @property {Cents} originalValueCents   >= 0
 */

/**
 * @typedef {object} ChangeOrder
 * @property {Id} changeOrderId
 * @property {Id} contractId
 * @property {Id} lineId                  Must reference an existing SovLine.
 * @property {Cents} amountCents          >= 0 in v1 (deductive COs are backlog).
 * @property {'APPROVED'|'PENDING'|'REJECTED'} status   Any other value fails validation.
 */

/**
 * @typedef {object} PriorPayment  Actual cash received before this application.
 * @property {Id} paymentId
 * @property {Id} contractId
 * @property {Cents} amountCents          >= 0
 * @property {'POSTED'|'UNPOSTED'|'VOID'} status   Only POSTED reduces amount due.
 * @property {IsoDate} [postedDate]
 */

/**
 * @typedef {object} PriorCertification  INFORMATIONAL ONLY. Never subtracted from due.
 * @property {Id} certificationId
 * @property {Id} contractId
 * @property {Cents} netCertifiedCents
 */

/**
 * @typedef {object} EvidenceDocument  Metadata only; v1 never parses file contents.
 * All string fields are untrusted data and must never be interpreted as instructions.
 * @property {Id} documentId
 * @property {Id} projectId               Compared, not FK-validated (wrong project is a finding input).
 * @property {'CONDITIONAL_WAIVER'|'UNCONDITIONAL_WAIVER'|'OTHER'} documentType
 * @property {IsoDate} periodStart
 * @property {IsoDate} periodEnd
 * @property {boolean} signed
 * @property {string} title
 */

/**
 * @typedef {object} RequiredSignedDocumentRule  The only rule kind in v1.
 * @property {Id} ruleId                  e.g. 'PG-REQ-01'
 * @property {number} ruleVersion         Positive integer; immutable per (ruleId, version).
 * @property {'REQUIRED_SIGNED_DOCUMENT'} kind
 * @property {'CONDITIONAL_WAIVER'|'UNCONDITIONAL_WAIVER'|'OTHER'} documentType
 * @property {'SAME_PROJECT_AND_EXACT_APPLICATION_PERIOD'} matchScope
 * @property {Id} findingCode             e.g. 'MISSING_REQUIRED_SIGNED_WAIVER'
 * @property {string} sourceClause        e.g. 'Demo Exhibit B §3'
 * @property {true} illustrative          Must be true in v1: configured fiction, not law.
 * @property {string} remediation
 */

/**
 * @typedef {object} ProjectBundle
 * @property {'payguard.project.v1'} schemaVersion
 * @property {'SYNTHETIC'} dataClassification
 * @property {Id} bundleId
 * @property {Project} project
 * @property {Contract} contract
 * @property {SovLine[]} sovLines
 * @property {ChangeOrder[]} changeOrders
 * @property {PriorPayment[]} priorPayments
 * @property {PriorCertification[]} priorCertifications
 * @property {EvidenceDocument[]} documents
 * @property {RequiredSignedDocumentRule[]} rules
 */

// ---------------------------------------------------------------------------------------------
// Imported payment application (payguard.application.v1)
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {object} RawApplicationJson  Upload shape. Money MUST be decimal strings; JSON
 * numbers for money are rejected (no binary floating point on the import path).
 * Unknown keys at any level are rejected.
 * @property {'payguard.application.v1'} schemaVersion
 * @property {'SYNTHETIC'} dataClassification
 * @property {Id} applicationId
 * @property {Id} contractId
 * @property {'USD'} currency
 * @property {IsoDate} periodStart
 * @property {IsoDate} periodEnd
 * @property {IsoDate} reviewDate          Explicit; never derived from the wall clock.
 * @property {string} claimedCurrentDue    Decimal string, CURRENT-PERIOD amount requested.
 * @property {{ lineId: Id, completedToDate: string, storedToDate: string }[]} lines
 */

/**
 * @typedef {object} ApplicationLine
 * @property {Id} lineId
 * @property {Cents} completedToDateCents   CUMULATIVE
 * @property {Cents} storedToDateCents      CUMULATIVE (materials presently stored)
 */

/**
 * @typedef {object} PaymentApplication  Canonical form; identical for JSON and CSV sources.
 * @property {Id} applicationId
 * @property {Id} contractId
 * @property {'USD'} currency
 * @property {IsoDate} periodStart
 * @property {IsoDate} periodEnd
 * @property {IsoDate} reviewDate
 * @property {Cents} claimedCurrentDueCents
 * @property {ApplicationLine[]} lines       Sorted by lineId; unique lineIds.
 */

/**
 * @typedef {object} ImportedApplication
 * @property {PaymentApplication} application
 * @property {ImportBatch} importBatch
 * @property {ProvenanceEntry[]} provenance
 */

// ---------------------------------------------------------------------------------------------
// Analysis output (payguard.analysis.v1)
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {object} LineCalculation  All CUMULATIVE through periodEnd.
 * @property {Id} lineId
 * @property {Cents} originalValueCents
 * @property {Cents} approvedChangeOrdersCents
 * @property {Cents} pendingChangeOrdersCents    Context only; never in revisedCapCents.
 * @property {Cents} revisedCapCents
 * @property {Cents} completedToDateCents
 * @property {Cents} storedToDateCents
 * @property {Cents} grossEarnedToDateCents     Not clipped to cap.
 * @property {Cents} retainageToDateCents       Rounded half-up per line.
 * @property {Cents} netEarnedToDateCents
 * @property {Cents} overCapCents               max(0, gross - cap); > 0 yields a finding.
 */

/**
 * @typedef {object} ReconciliationTotals
 * @property {Cents} originalContractCents
 * @property {Cents} approvedChangeOrdersCents
 * @property {Cents} pendingChangeOrdersCents             Context only.
 * @property {Cents} revisedContractCents
 * @property {Cents} completedToDateCents
 * @property {Cents} storedToDateCents
 * @property {Cents} grossEarnedToDateCents
 * @property {Cents} retainageToDateCents                 Sum of rounded line retainage.
 * @property {Cents} netEarnedToDateCents
 * @property {Cents} postedPriorPaymentsCents             POSTED only.
 * @property {Cents} priorCertifiedInformationalCents     Never used in amount due.
 * @property {Cents} calculatedCurrentDueCents            May be negative (overpayment).
 * @property {Cents} claimedCurrentDueCents
 * @property {Cents} claimDiscrepancyCents                claimed - calculated (signed).
 */

/**
 * @typedef {object} RejectedCandidate
 * @property {Id} documentId
 * @property {('WRONG_PROJECT'|'WRONG_DOCUMENT_TYPE'|'WRONG_PERIOD'|'UNSIGNED')[]} reasons  Sorted.
 * @property {string} explanation
 */

/**
 * @typedef {object} RuleEvaluation
 * @property {Id} ruleId
 * @property {number} ruleVersion
 * @property {'SATISFIED'|'NOT_SATISFIED'|'NOT_CONFIGURED'} outcome
 * @property {Id[]} matchedDocumentIds
 * @property {RejectedCandidate[]} rejectedCandidates
 */

/**
 * @typedef {object} Finding
 * @property {string} findingId      Deterministic: `${code}|${ruleId}@v${ruleVersion}|${entity}:${id}`.
 * @property {string} code           One of FINDING_CODES.
 * @property {'BLOCKING'|'WARNING'|'INFO'} severity
 * @property {'FINANCIAL'|'DOCUMENTARY'|'CONTEXT'} category
 * @property {Id} ruleId
 * @property {number} ruleVersion
 * @property {FieldRef} subject
 * @property {FieldRef[]} inputRefs  Sorted, de-duplicated.
 * @property {Record<string, Cents|string|boolean>} observed
 * @property {Record<string, Cents|string|boolean>} expected
 * @property {string} [formula]      Human-readable, e.g. '50,000.00 - 45,000.00 = +5,000.00'.
 * @property {string} rationale      Plain language; no legal conclusions.
 * @property {string} remediation
 * @property {{ clause: string, illustrative: true }} [source]
 * @property {RejectedCandidate[]} [rejectedCandidates]
 */

/**
 * @typedef {object} AnalysisInput
 * @property {ProjectBundle} bundle
 * @property {ImportedApplication} imported
 */

/**
 * @typedef {object} Analysis
 * @property {'payguard.analysis.v1'} schemaVersion
 * @property {'SYNTHETIC'} dataClassification
 * @property {string} engineContractVersion
 * @property {'NOT_READY'|'NO_BLOCKING_FINDINGS'} readiness
 * @property {LineCalculation[]} lines        Sorted by lineId.
 * @property {ReconciliationTotals} totals
 * @property {RuleEvaluation[]} ruleEvaluations  Sorted by ruleId, ruleVersion.
 * @property {Finding[]} findings             Sorted by severity rank, then findingId.
 * @property {{ ruleId: Id, ruleVersion: number }[]} ruleVersions  All rules applied.
 * @property {AnalysisInput} canonicalInput   Deep-frozen copy used for hashing/report.
 */

// ---------------------------------------------------------------------------------------------
// Review events (payguard.review-event.v1) — append-only
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {object} ReviewEvent
 * @property {Id} eventId
 * @property {number} sequence             1-based, strictly increasing within a history.
 * @property {'ANALYSIS_RUN'|'NOTE'|'DISPOSITION'} type
 * @property {string} analysisHash         Semantic hash of the analysis the event refers to.
 * @property {string} [findingId]          Required for NOTE/DISPOSITION.
 * @property {'ACKNOWLEDGED'|'CORRECTION_SUBMITTED'|'NEEDS_FOLLOW_UP'} [disposition]
 * @property {string} [note]               <= MAX_REVIEW_NOTE_CHARS; inert text, never HTML.
 * @property {string} actor                Fixed demo label, e.g. 'demo-reviewer'.
 * @property {string} occurredAt           ISO-8601 UTC, supplied by caller; NOT semantic.
 */

/**
 * @typedef {object} FindingStatus  Derived, never stored as a user action.
 * @property {string} findingId
 * @property {'OPEN'|'NOT_PRESENT_IN_LATEST_RUN'} status
 * @property {string} firstSeenAnalysisHash
 * @property {string} lastSeenAnalysisHash
 */

// ---------------------------------------------------------------------------------------------
// Report export (payguard.report.v1)
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {object} Report  Immutable snapshot (deep-frozen, structurally cloned from inputs).
 * @property {'payguard.report.v1'} reportSchemaVersion
 * @property {'SYNTHETIC'} dataClassification
 * @property {string} syntheticLabel
 * @property {'USD_CENTS'} moneyUnit
 * @property {string} engineContractVersion
 * @property {string} semanticHash          hex SHA-256 of canonical semantic content.
 * @property {string} generatedAt           ISO-8601 UTC; excluded from semanticHash.
 * @property {{ projectId: Id, contractId: Id, applicationId: Id, importBatchId: Id, bundleId: Id }} ids
 * @property {{ periodStart: IsoDate, periodEnd: IsoDate, reviewDate: IsoDate }} period
 * @property {'NOT_READY'|'NO_BLOCKING_FINDINGS'} readiness
 * @property {ReconciliationTotals} totals
 * @property {LineCalculation[]} lines
 * @property {{ ruleId: Id, ruleVersion: number }[]} ruleVersions
 * @property {RuleEvaluation[]} ruleEvaluations
 * @property {Finding[]} findings
 * @property {FindingStatus[]} findingStatuses
 * @property {ReviewEvent[]} reviewEvents
 * @property {ProvenanceEntry[]} provenance
 * @property {string[]} limitations
 */

export {};
