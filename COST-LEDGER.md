# Cost ledger

| Item | Verified state | Authorization / limit |
|---|---|---|
| Claude Max | Existing subscription authenticated in initial audit | Included allowance only |
| Claude usage credits | User confirmed Off for mathur1@usf.edu on 2026-11-03 | Must remain Off; never enable |
| Browser usage read | Credits Off and auto-reload Off; browser displayed different plan so not used to prove CLI identity | Account-specific gate cleared by user confirmation |
| Anthropic API/provider overrides | None found in initial environment audit | Never add API billing or fallback |
| GitHub coordination repository | Private repository created | No Actions jobs started |
| GitHub Actions allowance | Account usage API denied: token lacks user scope | No private workflow dispatch until quota and zero-spend controls verified |
| Cloudflare | No authenticated CLI/token found in inspected locations | No resources created; account plan unverified |
| Local work | Small documentation checkout; no dependency installation | Minimize writes; no persistent application DB |

No new purchases or paid resources initiated. Read-only HTTP/GitHub requests and existing Codex account usage are not an independent account billing audit. Record Claude quota outcomes after every bounded assignment. Do not interpret model cost estimates as an actual invoice.
