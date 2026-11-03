# PayGuard fixtures — SYNTHETIC DEMO DATA

**All data here is synthetic.** Parties, projects, contracts and documents are fictional. "Demo Exhibit B §3" is an illustrative contract condition. It is not law, legal advice or a legal determination. Fixture schema version: `payguard.fixtures.v1` (see `manifest.json`). Explicit review date: 2026-11-03. Nothing is derived from the wall clock.

| File | Purpose |
|---|---|
| `pg-syn-001.bundle.json` | PG-SYN-001 project bundle (`payguard.project.v1`, cents) |
| `pg-syn-001.application.json` / `.csv` | Same application as JSON and CSV. CSV rows are deliberately in reverse order (order invariance) |
| `pg-syn-001.corrected-waiver.document.json` | Corrected evidence: signed October conditional waiver |
| `pg-syn-001.corrected.application.json` | Corrected claim, $45,000.00 |
| `manifest.json` | Literal hand-calculated expectations, in integer cents |

Malformed, adversarial and boundary variants are built inline in `tests/payguard-reference/reference.test.js` as small mutations of these files. They cover rounding, pending/rejected/unknown COs, duplicate IDs, cap overrun, overpayment, missing-document variants, CSV injection, size/UTF-8/row limits, and the $1B accept / $1B+0.01 reject boundary.

## Reference arithmetic (PG-SYN-001, by hand)
- Revised contract: 100,000.00 + 10,000.00 approved CO-A-01 = 110,000.00 (L1). L2 stays at 50,000.00, because pending CO-P-01 ($5,000) is excluded. Total **160,000.00** = 16000000¢, not 165,000.00.
- Gross earned: L1 66,000 + 4,000 = 70,000; L2 25,000 + 0 = 25,000. Total **95,000.00** = 9500000¢.
- Retainage, 1000 bps per line, half-up: L1 7,000.00; L2 2,500.00. Total **9,500.00** = 950000¢.
- Net earned: 95,000 − 9,500 = **85,500.00** = 8550000¢.
- Due: 85,500 − 40,500 posted (PAY-001) = **45,000.00** = 4500000¢. The 45,000 prior certified is informational and is **not** subtracted. Subtracting it as well would give a wrong −4,500.
- Claimed 50,000.00 − 45,000.00 = **+5,000.00** = 500000¢ discrepancy.
- Rounding: 5¢ × 1000 bps = 0.5¢, which rounds half-up to 1¢ per line, so two lines total 2¢. 4¢ gives 0.4¢, which rounds to 0¢.
- Overpayment: posted 86,000.00 against net 85,500.00 gives a due of −500.00 (−50000¢), not floored.
- Cap: L2 50,000.01 against a cap of 50,000.00 is 1¢ over. Pending CO-P-01 does not cover it.
- Waiver: DOC-WV-OCT-UNSIGNED is rejected as `UNSIGNED`, and DOC-WV-SEP-SIGNED is rejected as `WRONG_PERIOD`. Neither satisfies October 2026. The remediation is "Attach signed October conditional waiver and request review."

## Known gaps (recorded, not claimed)
- **No UI exists.** Spec test 7 (UI journey, keyboard, focus) and test 10 (Playwright, axe, reduced motion, mobile, CI, deployed URL) are **NOT RUN**. Only the engine-level journey in `tests/payguard-reference/integration.test.js` exists.
- The tests and the engine were written in the same run by the same implementer. They are **not an independent audit**. Codex's independent recalculation is still pending.
