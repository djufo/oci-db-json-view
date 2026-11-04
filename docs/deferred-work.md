# Deferred work: what is parked here and why

Owner rulings 2026-10-30
(`/engineering/refs/owner-rulings.md#concerns-not-fixes-20261030`): our
products are in demo. Work that a demo does not need, while the feature
already works, is **recorded, not built**. Building it now is
over-engineering. One file per item keeps it findable when we come back to it.

## Who this applies to

- **Precise (nothing is parked; fix as found):** Score, and in EMIBS every
  path of Agent Guild, Auth, AuthZ or Files: `agent-guild`,
  `emibs-svc-auth`, `emibs-svc-authz`, `emibs-svc-files`, `emibs-files-ui`,
  and the shared packages `emibs-auth-browser`, `emibs-auth-go`,
  `emibs-files-go`, `files-client`, `files-mfe`, `files-ui-core`,
  `files-viewers`. A change that touches any of these is precise as a whole.
- **Demo-grade (park here):** everything else.

## Never parked, in any project

- The feature does not work, gives wrong results, or loses or corrupts data.
- Secrets are printed, committed or exposed.
- An outsider could run code on our servers or read their secrets.

## Folders

| Folder | What goes in | Examples |
|---|---|---|
| `concerns/` | Limits today's data does not reach. | response or page size, row counts, rate, timeout, scale, performance, cost |
| `vulnerabilities/` | Security weaknesses with no real users or data to harm yet. Write down the weakness, not an exploit. | a missing check that only an admin could misuse, missing rate limiting, weak input validation, missing security headers, a dependency CVE |
| `test-gaps/` | Proofs a working feature lacks. | concurrent writes, save → reopen → read, edge cases, browser end-to-end checks |
| `resilience/` | Recovery and operations hardening. | retries, idempotency, crash recovery, backup and restore drills, monitoring, alerts, logging gaps |
| `compliance/` | Needed before real users, not for a demo. | GDPR records and retention, consent texts, accessibility, legal pages |

Reviewers record these items as files instead of requesting changes. A
finding that only says "this could be bigger, faster, safer or better
proven" belongs here.

## One file per item

Name: `<component>-<subject>-<kind>.md`, lowercase kebab-case.

- `component`: the service or area, e.g. `bff`, `srv-go`, `ui`, `crawler`.
- `subject`: what is affected, e.g. `admin-organizations-list`.
- `kind`: a short word for the problem, e.g. `size`, `rate`, `timeout`,
  `authz`, `injection`, `concurrency`, `persistence`, `retry`, `gdpr`.

Example: `concerns/bff-admin-organizations-list-size.md`.

Look for a duplicate first: `ls docs/*/ | grep <subject>` and
`grep -ril <keyword> docs/concerns docs/vulnerabilities docs/test-gaps docs/resilience docs/compliance`.
If the item exists, add a dated "Seen again" line to its file instead.

## File content

```
# <one-line title>

- Found: <YYYY-MM-DD>, <source: review / PR / incident>
- Where: <file:line or component>
- What: <the limit, weakness or gap>
- When it bites: <what data, load or user would trigger it>
- What happens then: <effect>
- Possible fix: <short>
- Status: open
```

When an item is fixed, the fixing PR deletes its file.
