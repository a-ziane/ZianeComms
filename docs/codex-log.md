# zianeComms — Codex-assisted development

This log records Codex-assisted work separately from IBM Bob's history. `docs/bob-log.md` remains unchanged.

## Task 3 — Responders and Explainable Matching Engine

Date: October 17, 2026 (America/Los_Angeles)

### Implementation

- Extended the existing Responder interface and mock roster: ten responders, Disaster/Clinic membership, structured expertise, languages, approved interpreter support, coverage, explicit experience tags, three availability statuses, and derived active assignments.
- Added `config/matching.ts` and a pure deterministic engine in `lib/matching/index.ts`. Default maxima: expertise 40, language 20, coverage 20, workload 15, experience 5. Reasons and component points accompany every result.
- Availability is a gate: Available responders alone qualify as primary; Busy responders are manual alternatives; Offline responders cannot be assigned. Recommendations explicitly disclose when no strong available match exists.
- Extended the existing caller modal/picker through `components/ResponderPicker.tsx`; added recommendation explanations, ranked alternatives, optional manual-choice/reassignment reason, assigned responder name and reassignment controls. No dashboard redesign.
- Upgraded the existing Responders page with Available/Busy/Offline groups, live status changes, expertise/languages/coverage/experience, workload and assigned active caller names.
- Extended the existing case reducer and assignment handler. Viewing recommendations only records an event. Assignment requires an explicit approval action plus a current shown recommendation snapshot; stale/offline/closed-case assignments and duplicate same-responder assignments are rejected.
- Workload derives from active caller assignments across both modes. Assignment/reassignment/closure update the same shared responder state. Follow-up outcomes retain workload; closure retains assignment history but releases active workload.
- Structured recommendation events retain all candidate scores, statuses, component explanations, workload, caller priority, operator and shown timestamp. Assignment events retain the shown snapshot, selected/previous responder, followed/overridden recommendation, reason, timestamp and before/after workloads. Callback events measure assignment-to-attempt elapsed milliseconds. Outcomes reference the actual assignment snapshot even when later recommendations have been viewed.

### Explicit behavior changes and assumptions

- Removed `non_english_speaker` urgency rules from BOTH rulebooks and mock input signals, as requested. The generic Priority Engine and all safety/override safeguards are unchanged. Language support influences responder matching and the existing separate Customer Fit calculation, not urgency.
- Maria's urgency score changes 93 → 85; priority remains 1. Carlos changes 75 → 67 and Priority 1 → 2. Ahmed's raw score changes 125 → 117 but remains capped at 100, Priority 1. Diane's raw score changes 3 → -5 and final score 3 → 0, Priority 3. Maria's mock history was corrected to score 85. No other mock priorities change.
- Strong available match means at least 70/100, at least 25 expertise points, and direct or approved interpreter language support. Thresholds are configurable. A weaker Available responder may still be shown as “Best Available — Review Required.” Busy never becomes primary automatically, even when no Available responders exist.
- Matching maxima must total 100. Configured category values scale with those maxima. Disabled location scoring awards zero location points, with an explicit reason; remaining scores are not inflated/renormalized. Remote billing, appointments and cleaning requests disable location by default.
- Demo coverage uses explicit structured areas and configured adjacency, not geographic distance or address-string inference. Interpreter support and experience are explicit demo tags, not inferred from outcomes.
- Responder status is manually controlled and independent of workload; Busy can mean non-case duties. Initial active counts are zero, replacing the old static fake workload. Counts/list membership thereafter derive solely from actual active assignments.
- A shared responder's workload includes assignments in both modes. Status and assignments persist across page/mode navigation in the existing in-memory session; refresh still resets demo data.
- The operator remains the existing demo identity `operator-mock-001` (displayed as Operator 01); no authentication added. Response time means latest assignment to a callback attempt, not a real telephony response or service-level guarantee.
- Duplicate/Unable to Reach retain their existing terminal behavior. No Answer and Needs Follow-Up remain active.

### Verification

- Original Priority Engine suite: 11/11 passed, file unchanged.
- Existing Task 2.5 stabilization suite: 18/18 passed, file unchanged.
- New Task 3 suite: 38/38 passed, including scoring factors, language independence from urgency, gates/weak matches, configuration changes, human approval, stale approvals, real workload, reassignment/closure/follow-up, recommendation overrides, shared-mode workload, structured learning data and rendered UI.
- Total: 67 passed, 0 failed.
- TypeScript: passed. Lint: passed with no warnings/errors. Production build: passed.
- Browser verification: explanation totals; no assignment before approval; Offline disabled; assigned name/history; status changing primary; reassignment transferring workload; manual recommendation override; No Answer remaining active; closure releasing workload; honest 52% Available versus 100% Busy alternative. No browser console warnings/errors in the verification session.
- An existing Next.js process on port 3001 uses this workspace and can overwrite `.next` while a production build is served. Production runtime verification therefore used a byte-identical source snapshot in an isolated temporary directory with the existing `node_modules` linked in. No running user process was stopped and no dependency versions were changed.
- Existing nonblocking Vite native-config migration notice remains unchanged.
- `package.json`, `package-lock.json`, the existing 29 tests, and IBM Bob's development log remain unchanged.

No backend, integrations, ML, Dispatch Rules editor, Agent Setup, Knowledge Base, offline behavior or subsequent task was implemented.


## Supabase client and session-refresh foundation

Date: October 17, 2026 (America/Los_Angeles). Codex-assisted setup requested after Task 3.

- Installed `@supabase/supabase-js` 2.118.0 and `@supabase/ssr` 0.12.7. Existing locked package versions were preserved. The existing Vitest / Node type optional peer conflict required `npm install --legacy-peer-deps`; no global npm configuration was changed.
- Added local project environment settings in ignored `.env.local` and a placeholder-only `.env.example`.
- Added browser/server client helpers and async session-refresh middleware under `utils/supabase/`, plus the Next.js 14 root middleware entry point. The middleware invokes `auth.getClaims()`, propagates refreshed request/response cookies and cache-protection headers, and preserves cookies/headers across repeated writes.
- Preserved the dashboard and existing caller/responder logic. The supplied todos page was treated as an SDK usage example, not a dashboard replacement. No tables, persistence, login UI or database migrations were added; optional agent skills were not installed.
- Added six focused regression tests for anonymous passthrough, auth refresh invocation, cookie/options forwarding, cache headers, repeated writes, server cookie stores and browser configuration.
- Verification: 73/73 total tests pass; TypeScript and lint pass; isolated production build passes. An anonymous request through the production middleware returned HTTP 200 and the existing dashboard, queue and mock callers. Signed-in token refresh is covered with mocks; no live user login was available for an authenticated end-to-end check.
- Repository changes include only the Supabase helpers, middleware, placeholder environment example, dependency files, tests and this log. The actual `.env.local` settings remain local and excluded from Git.
