# Task 7 — Global + Offline Resilience

## Deployment profiles

`config/deployments/index.ts` configures Los Angeles and Algeria: languages, optional location fields, emergency guidance, connectivity preferences, rulebook and matching configuration. Selection lives on this device and is shared across same-origin tabs. Changing it changes new help intakes; it never resets, reclassifies, or migrates existing cases. Each help case persists its own `deploymentId` and `source: offline_help_form`.

Los Angeles: English/Spanish, address/ZIP/neighborhood/landmark/crisis-zone/details. Algeria: Arabic/French/Tamazight-ready, wilaya/commune/local area/landmark/details. A conventional address, phone, and every location field are optional. Tamazight-ready is configuration support, **not a claim of interpreter availability or full localization**. The operational UI remains English.

Both use the existing Disaster rulebook and the existing Priority and Matching engines. No weights, thresholds, or matching arithmetic changed. The form reuses the existing structured-fact adapter: explicit answers provide facts; narrative keywords never determine points. For example, mobility vulnerability needs limited mobility + inability to self-evacuate + affected crisis. Powered-equipment risk needs equipment dependency + confirmed power disruption. Medical need without a supported severity rule is retained for review. Unknown facts remain unknown.

Responder input is scoped by deployment before entering the same matching engine. Legacy responders belong to LA. Algeria has no configured real responder roster or verified coverage map yet; it must show no available local responder rather than recommend an LA operator as local. No country-specific matching engine or invented geographic mapping was added. Add explicitly approved deployment-scoped responder records and coverage data when available. Retell deployment configuration is unchanged by the device selector.

## Caller store-and-forward

Public `/help` → IndexedDB `zianecomms-offline-v1` → `POST /api/help` → existing case normalization/scoring → existing Supabase save transaction → callback queue.

The help request gets a UUID on the device and is durably saved **before** network transmission. The interface distinguishes OFFLINE, saved on this device, synchronizing, and server-confirmed sent. Missing/failed/mismatched acknowledgement retains the payload and the same UUID for retry. On success the local payload is removed. A user can explicitly remove a local copy; removal cannot undo a server submission whose acknowledgement was lost.

`public/offline-sw.js` caches only the public `/help` and `/offline` interface shells plus same-origin immutable Next static assets. It never caches API responses, authenticated root HTML, provider conversations, or server credentials. `/offline` renders the dashboard shell; actual operational data comes only from the existing authenticated API or a previously synchronized trusted-device cache. The interface must first load online. HTTPS (or localhost) and browser service-worker/IndexedDB support are required. Private browsing, eviction, device loss and denied storage can prevent persistence. Keep the page open if device storage reports a failure.

No background delivery is promised: reopen/keep the page open and restore connectivity. Pending requests persist across refresh. Online events and the explicit Retry button use the same sync routine. The DEMO network switch changes a shared same-origin connectivity flag; it does not fabricate server responses. RESTORE CONNECTION only removes simulation; a real network is still required.

Immediate danger displays the selected deployment's guidance. Offline text explicitly says no responders can be contacted. It never promises an emergency call can connect without service. Algeria guidance intentionally does not invent a single universal emergency number.

## Server persistence and idempotency

Migration `20261017205118_global_offline_help.sql` adds only a private receipt table and service-role-only security-invoker RPC, reusing `zianecomms_save_demo`. It takes the same facility lock/revision boundary and stores cases in the existing `cases` table. The caller never supplies scores, priorities, assignments, operator commands, or facility IDs.

A canonical request digest binds the UUID to its content. A duplicate returns acknowledgement without another case, attempt, audit event, revision bump, or reopening a later-resolved case. Reusing an ID with changed content is rejected. Unrelated operator writes cause a reload and up to three append-only intake attempts; concurrent server work is preserved. Intake is bounded to 16KB with field/enum validation and a coarse database limit of 60 new help requests per minute for this demo facility. This is not production anti-abuse protection.

Optional international phone numbers are normalized without country-code guessing and encrypted in the existing private contact store with `CONTACT_ENCRYPTION_KEY`. Operator projections are masked; phone-like content in narrative/location/name is redacted. The public endpoint only acknowledges its own request UUID and never returns case data. It is deliberately public write-only; existing operator APIs and signed webhooks remain protected. The transaction latches the existing `realCallsEnabled` protection flag to keep private case reads protected even if voice integration flags are later removed.

Timeline: device creation (explicitly device-reported time), request synchronized, priority calculated. The initial contact/message projection uses `offline_help_form`/`help_form`, without claiming that SMS was sent. Recovery Chat still requires a real eligible voice session; help intakes do not create or impersonate one.

## Responder offline queue

The device caches active cases, priority explanations, locations and assignment context in IndexedDB. Conversation text, questionnaire answers, full history and recommendation snapshots are omitted. Already-synchronized active cases remain viewable; closed/uncached cases require connection. Last synchronization time and queued-action count are visible.

While offline, the small work panel accepts notes, callback-attempt records and callback outcomes (No Answer / Needs Follow-Up remain active; Resolved / Referred close). These record operator work; they do not make a phone call. Assignments, reassignments, responder availability changes and priority overrides require a connection and current review.

Commands are saved durably with UUID mutation IDs and expected revisions before optimistic display. Reconnection sends commands through the existing protected `/api/operations`, not client replacement snapshots. Server authorization, validation, immutable history, current-priority logic and transaction idempotency remain authoritative. The queue survives refresh; Web Locks serialize work between same-origin tabs where supported, while server UUIDs still prevent duplicate application.

**Conflict strategy:** conservative facility revision checking. Any unaccounted-for server revision (even an unrelated case change) stops replay with 409. Invalid/stale actions also stop replay. The queued action and original revision remain for operator review; no automatic consequential merge or rebase. Reconnect, inspect current data, explicitly discard queued local intentions if appropriate, and re-enter only still-needed work. Already accepted actions remain in server history. Authorization failures preserve the queue and never bypass access checks.

Device cache can be cleared explicitly when there are no pending actions. Pending local work must first be synchronized or deliberately reviewed/discarded. Browser storage is a hackathon demo implementation, **not application-encrypted offline storage**.

## Exact demo

1. After the migration is applied and this code is deployed, open the dashboard online once so active cases synchronize. Settings → Deployment → Algeria. Show Arabic / French / Tamazight-ready and Wilaya / Commune / Landmark.
2. Open `/help` online once. Wait for “Offline interface cached on this device.”
3. Click SIMULATE OFFLINE. Choose Algeria if not already selected.
4. Name: Demo Caller. Preferred language: Arabic or French. Wilaya: Blida Wilaya. Commune / landmark: clearly fictional details.
5. Need: “Wildfire nearby. My elderly father has limited mobility and we need evacuation assistance.” Requested assistance: Evacuation. Explicitly answer limited mobility: Yes; affected by active crisis: Yes; unable to evacuate without assistance: Yes. Immediate danger: answer the facts; do not select Yes simply to force a score. Leave unavailable facts unknown.
6. Save on this device. Show OFFLINE, the local request ID, and waiting for connection. Refresh to demonstrate persistence if desired.
7. RESTORE CONNECTION. Show Synchronizing → Request sent successfully. The pending payload clears only after the real server acknowledgement.
8. Return to the dashboard and Reload database. The normal Disaster queue contains Demo Caller with Algeria provenance, optional non-address location, timeline, and deterministic priority breakdown. No priority is hard-coded.
9. To demonstrate responder offline work, synchronize the dashboard first, then Settings → SIMULATE OFFLINE. Select a cached case in Offline work, save a note or outcome, show queued count, restore connection and inspect the saved history. A concurrent server change deliberately produces a reviewable conflict.

## Privacy and production hardening

Use fictional demo information and a trusted device. IndexedDB is protected by the browser origin and device, not by application-level encryption. Cached locations/needs/names and unsent contact details remain sensitive. No sensitive request payloads are logged. Never claim queued work reached responders or contacted emergency services.

Before real use: encrypted local storage with device-bound key management, device/session access control and remote wipe, retention/expiry policy, per-device/operator queue ownership, reliable multi-tab locking on unsupported browsers, offline auditing with trusted timestamps, per-caller rate limiting/bot protection, quota monitoring, multi-device conflict review UI, locally verified emergency guidance, approved Algeria responders/interpreters and geographic coverage, and accessibility/local-language review. Background Sync can improve delivery where supported but must not replace confirmed acknowledgement.

## Verification status

Automated tests exercise both profiles, unchanged engines, queues/acknowledgements/retries/conflicts, PostgreSQL schema persistence and private contacts. All pre-existing Retell, Recovery Chat, priority and matching tests are retained.

The live migration was explicitly authorized and applied after the original approval block. Exactly one labelled synthetic Algeria request was persisted and replayed through the same intake service/receipt logic. Live verification used the local offline queue and live database RPC; the new public browser route has not been deployed. Earlier browser verification used an isolated production build and PGlite. Retell and Twilio configuration were not changed.

### Validation results (local)

- 341/341 Vitest tests pass: all 295 previous tests unchanged, plus 46 Task 7 tests.
- TypeScript check passes; lint passes without warnings; isolated production build passes.
- Real Chromium checks pass: Algeria help form → IndexedDB; actual network-off reload; restored acknowledged submission through the real Next route to isolated PostgreSQL; local payload removal; normal scored dashboard case; offline cached-case reopen; queued note applied once; API responses absent from service-worker cache; concurrent server change visibly stops stale offline work. No uncaught browser errors.
- The isolated database runs every checked-in migration. These are local PostgreSQL/Supabase-schema checks, **separate from the subsequently authorized live verification below**.
- Live security advisors remain at the existing baseline: 16 intentional default-deny/no-policy informational notices, plus the two pre-existing platform `rls_auto_enable()` SECURITY DEFINER warnings. Task 7 did not alter that live schema. See [Supabase public function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

### File inventory

- Profiles: `config/deployments/index.ts`, `hooks/useDeployment.ts`, `lib/cases/deployment.ts`.
- Help interface/intake: `app/help/page.tsx`, `components/HelpForm.tsx`, `app/api/help/route.ts`, `lib/help/intake.ts`, `lib/help/service.ts`.
- Offline shell/storage/sync: `app/offline/page.tsx`, `public/offline-sw.js`, `lib/offline/storage.ts`, `lib/offline/queue.ts`, `hooks/useConnectivity.ts`, `hooks/usePersistentCases.ts`.
- Operator/settings wiring: `components/NetworkControl.tsx`, `components/OfflineWorkPanel.tsx`, `components/pages/SettingsPage.tsx`, `app/page.tsx`, `components/CallerDetailModal.tsx`, `components/ResponderPicker.tsx`.
- Case commands/types: `types/index.ts`, `lib/cases/index.ts`, `lib/persistence/commands.ts`.
- Public-shell routing/cache headers: `middleware.ts`, `next.config.js`.
- Migration: `supabase/migrations/20261017205118_global_offline_help.sql` (applied live; Supabase history version `20261017210755`, name `global_offline_help`).
- Tests: `lib/help/help.test.ts`, `lib/offline/offline.test.tsx`.
- Documentation: `README.md`, `docs/codex-log.md`, this file.

Implementation references: [MDN IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB), [MDN service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers), [Supabase RPC](https://supabase.com/docs/reference/javascript/rpc).

### Authorized live verification

The reviewed `20261017205118_global_offline_help.sql` migration applied successfully. Supabase recorded it as `20261017210755`, name `global_offline_help`. An optional history-version alignment was rejected by automatic review and was not performed. Do not apply the local migration again without reconciling the ledger first.

Exactly one case was created: `help-c0bb9cbe-b7e0-4d56-9acf-525f548d2540`, name **TASK 7 VERIFICATION — SYNTHETIC**, provenance `integration_test`, source `offline_help_form`, deployment `algeria`, Disaster rulebook, Arabic, fictional Blida-area details, no contact number. The existing engine calculated **Priority 1 / score 88**, independently recalculated from the stored input after commit.

The offline queue did not send while disconnected. The intake RPC was invoked with the normalized engine-scored request in a guarded production transaction. A duplicate within the transaction, then an after-commit replay through the actual `submitHelp` service, acknowledged the same ID without extra case creation or revision increments. The local pending payload cleared only after acknowledgement. One receipt, one initial contact attempt, one inbound form message and three timeline events remained.

The existing save function refreshes timestamps even for unchanged rows. The verification transaction preserved original bookkeeping timestamps and asserted exact unrelated-row equality across all 17 operational tables before committing; any business-data discrepancy would have aborted it. All 18 prior cases and 10 responders remained intact; the total is now 19 cases. The synthetic case was retained for inspection. Receipt RLS is enabled; anonymous table reads/RPC execution remain denied; the new RPC is security invoker.

No Retell configuration changed. No application code was committed, pushed or deployed. This confirms live persistence and idempotency, not a deployed Task 7 browser endpoint.
