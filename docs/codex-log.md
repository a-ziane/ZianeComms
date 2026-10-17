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


## Task 4 — Supabase Persistence

Date: October 17, 2026 (America/Los_Angeles). Codex-assisted development.

Status: completed and verified against the user's live Supabase project. The existing project was inspected first: no application tables existed. The exact checked-in migration was applied through the signed-in SQL Editor, followed by the explicit idempotent demo seed using the locally stored server key. No remote reset was performed.

- Added additive migration `supabase/migrations/20261017000100_operations_persistence.sql` for facilities, cases, responders, contact attempts, questionnaire answers, messages, priority events, assignments and activity events; private schema holds contact values and idempotency receipts. JSONB reuses the existing domain models and configuration/explanations, with generated core query columns.
- Added an explicit idempotent seed derived from the existing twelve demo cases and ten responders. `supabase/seed.sql` can be regenerated; `npm run db:seed` uses the same existing mock inputs. Startup never seeds or resets data.
- Added a shared operations repository, serialization mapping, validated server commands, server-only Supabase client, API boundary and persistent state hook. Scoring/matching stay pure TypeScript. The only Priority Engine file change is making the phone masking display utility accept an already-masked phone.
- Existing workflows persist through one atomic RPC transaction: case creation, server-calculated priority, overrides, repeat contact, questionnaire updates, recommendations, assignments/reassignments, responder status, callbacks, outcomes and closure. Browser-submitted arbitrary case/score patches are rejected.
- Facility revisions reject concurrent stale saves. Mutation IDs make confirmed/retried operations idempotent, with a lookup before reapplying commands. Prior events cannot be removed or rewritten. Workload derives from active assignments across both modes after loading.
- RLS is enabled and browser roles have no direct operational/private table or RPC privileges. Server-only credentials access only a fixed synthetic demo facility through the app's validated API. Public demo mode is an explicit opt-in: it has no authenticated operator identity and is not safe for real personal data. No security policy was disabled. Production auth, membership authorization, real contact encryption/ingestion and retention remain deferred.
- Raw demo phone values are not seeded or returned. Browser-visible cases contain only masked display values; private contact values start NULL. Existing free-text mock details are synthetic and are not a production privacy design.
- Added foreground database loading/saving/error feedback and read-only preview/retained data. Failed operations are not shown as saved; one in-tab pending action can be retried or explicitly cancelled. Refresh/navigation warns about unconfirmed work. This is not durable offline storage or store-and-forward.
- Added embedded PostgreSQL (PGlite) as a development test dependency. The test suite executes the actual migration/functions and seed, testing persistence round trips, explanations, separate overrides, hard escalations, attempts/history, questionnaires, assignment transfer/closure/workload, mode separation, Customer Fit, structured events, RLS, secret isolation, conflicts, idempotency, historical immutability, cross-facility ID isolation and same-origin writes.
- Local browser verification used an isolated Next.js source copy and a temporary PostgREST-compatible test adapter over real PGlite/PostgreSQL. Verified priority override → reload; assignment → reload; responder status → reload; Needs Follow-Up → reload; resolution → reload; Clinic/Disaster independent edits and reload. Stopping the local database showed a foreground error, retained the last loaded case state, and disabled mutation controls. A rejected write retained its pending intent and succeeded after retry.
- Live Supabase browser verification passed using the production build: Maria priority override 1 → 2 survived reload while calculated priority stayed 1; assignment to Sarah Martinez survived reload; Sarah status Busy survived reload; Needs Follow-Up remained active after reload; resolved John stayed out of the active queue after reload; Diane Clinic priority 3 → 2 and Maria Disaster priority 2 survived switching modes and reload. These intentional synthetic demo edits remain in the database with their history. The seed contains twelve cases and ten responders. Live SQL inspection confirmed RLS enabled and anonymous direct reads denied for all eleven tables, including private contacts and mutation receipts. No credentials were printed or committed.
- Validation: all 102 tests passed (73 existing unchanged + 29 persistence regression tests), zero failures. TypeScript passed, lint passed without warnings/errors, and the isolated production build passed. The original eleven Priority Engine tests remain unchanged and passing. The nonblocking existing Vite native-config notice remains.
- Added README with installation, env names, migration/seed/test instructions, schema/architecture, privacy/RLS decisions and exact demo limitations. IBM Bob's log is unchanged.
- Optional realtime is deferred; manual reload fetches current saved state. No Retell/Twilio/SMS/real calls, authentication UI, Agent Setup, Knowledge Base, simulator, offline functionality or other later task was started.
