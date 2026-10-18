# Task 8 — Organization onboarding and configuration

## Architecture

```text
ORGANIZATION CONFIG (draft → human approval → active version)
  → RETELL INTERFACE (server-built, active-only variables; publishing remains manual)
  → ZIANECOMMS DECISION ENGINES (same deterministic priority and matching code)
  → HUMAN RESPONDER (explicit assignment approval)
```

This MVP adds organization configuration inside the existing protected `zianecomms-demo` facility workspace. It is **not** a new account system, multi-tenant authorization boundary, automatic telephone provisioning service, or Retell agent factory. Every operator still uses the existing password gate. Deployment profiles, case models, engine weights/thresholds, responder storage and provider interfaces are reused.

## Onboarding and page reuse

Open `/onboarding` as an authenticated operator. Start an organization draft, or select **Start fictional dental demo** for a polished `Ziane Dental Demo` template. Eight steps cover organization, line purpose, questionnaire, approved knowledge, responders, dispatch, deployment, and review/activation. Back/Continue save the current draft; Save draft is explicit and shows confirmation. Progress is retained per organization/device. A browser-local IndexedDB draft copy protects unsaved edits across refresh; Supabase remains the source of saved draft/active versions. An older local revision never silently overwrites newer server work. Local draft cache failures and uncertain server saves are shown rather than reported as success.

Agent Setup, Knowledge Base, Dispatch Rules and onboarding reuse the same editors and saved draft. Settings shows active organization details, readiness, safety/privacy information and the existing Task 7 device deployment/network controls. The organization selector switches workspace views; it never reclassifies or deletes existing cases. The default **Working Disaster / Clinic demo** stays separate and available. New organizations initially have no case records; existing live calls are not shown as their own. The responder directory can edit organization responder drafts, while availability on activated records remains the normal operational control.

Organization type is descriptive, not a hidden scoring classifier. Mode and deterministic rulebook are explicit. Questionnaires are stored per deployment/rulebook using the Task 7 profile IDs. Switching profiles retains the other question sets, clears unverified coverage mappings in the new draft, and requires review before activation.

## Agent Setup and suggestions

Questions have stable IDs and support add, edit, delete, enabled/disabled, required/optional and reordering. Core immediate-danger/allergy/severe-pain screening is locked for this MVP; server validation rejects removal, disabling or rewriting of those questions. Priority hard-safety rules remain unchanged and read-only.

**AI-assisted suggestions use deterministic demo templates, not a model call.** The interface explicitly says “DEMO TEMPLATE · NO MODEL CALL.” Suggestions remain pending and can be edited, accepted or rejected. Acceptance changes only the draft. Rejection changes neither the questionnaire nor active configuration. Preview Conversation renders the enabled draft questions without placing any call.

This mechanism deliberately avoids a new model credential, unreviewed provider output, or dependency on a model during the pitch. A future model adapter can return the same bounded proposal schema, with the same human-review boundary.

## Knowledge approval

Knowledge items have stable ID, title, content, status, updated time and source/notes. States are DRAFT, AI SUGGESTION and APPROVED. Accepting a suggestion creates a draft item. The operator supplies/reviews the facts and approves them separately. Editing an approved item returns it to DRAFT. Placeholder gap guidance cannot be approved without replacement. No live shelter capacity, emergency instructions, availability, booking or prescription policy is generated.

Only APPROVED knowledge is copied into an active publishable snapshot and the server dynamic-variable payload. Unapproved items remain in the editable draft and never enter that payload. Published snapshots strip pending suggestions. Activation blocks an approved-knowledge payload exceeding 4,000 characters rather than silently truncating a large body of facts; enabled questionnaires also have a publishing size limit.

The dental template has explicitly fictional hours, services and appointment information. It repeatedly states that it is not a real clinic and cannot provide prescriptions or book appointments.

## Responders and matching

Draft responder entries use the existing `Responder` model: expertise, languages, verified coverage tags, availability, rulebook and experience. Activation writes them into the existing `public.responders` directory with organization/deployment metadata. There is no second responder database. Reusing an ID belonging to the working demo or another organization is rejected. Runtime workload is derived from active case assignments, never accepted as a draft number. Re-activation preserves an existing responder’s runtime status.

Organization/deployment scoping occurs before the unchanged generic Matching Engine. Only the organization’s active responder IDs are recommended. Expertise/language/location/workload/experience weights are configurable with finite 0–100 values totaling 100. An invalid in-progress total is displayed without crashing the preview; saving/activation rejects it. The preview is labelled as a sample need/language with draft availability and zero initial workload. Activated weights/version are included in the normal operational recommendation validation and signature, so an obsolete shown recommendation cannot silently be approved after configuration changes.

Hard priority rules, weights, thresholds and human override safeguards are not configurable in this task. No scoring or matching arithmetic was rewritten.

## Persistence and versions

Migration `20261017235346_organization_configuration.sql` adds:

- `zianecomms_private.organization_configs`: organization identity, editable draft, revision and active-version pointer tied to the existing facility.
- `zianecomms_private.organization_versions`: immutable approved configuration snapshots and activation timestamps.
- `zianecomms_private.organization_commands`: idempotent mutation receipts.
- Service-role-only security-invoker configuration read/write RPCs.
- Read-only active summaries on the existing operations load RPC; the existing Retell recovery-state projection and grants are retained.

All three tables have RLS. Browser roles get no table or function grants. The server role cannot update published versions. Configuration writes use explicit revision checks and UUID command IDs. Retries cannot duplicate an activation version. Concurrent stale edits require review. Activation uses the existing facility lock before writing responders and increments the operations revision so an older operational snapshot cannot erase those additions. It does not invoke the full case-save routine or rewrite existing cases, contacts, histories, existing demo responders or facility/Retell settings.

The protected `/api/organization` endpoint requires operator authentication even in a demo-only environment, checks write origin and payload size, validates known fields/enums/safety/weights, and returns safe errors. It never returns API keys, auth tokens, encryption keys or raw caller contacts. Unexpected secret-bearing configuration fields are rejected. This is one shared operator trust boundary; production needs true organization membership and per-user authorization before independent customers can use it.

## Retell publishing boundary

`lib/organization/dynamic-variables.ts` builds provider-ready string variables from the **ACTIVE** version: organization name/type, purpose/mode, languages, emergency instruction, approved knowledge, enabled questionnaire, callback expectations, location labels, deployment and version. The protected **Preview active Retell variable payload** action uses this same function. It neither starts a provider session nor updates an agent. Draft edits never reach the published voice/chat agents.

The current verified agents and their deployed environment variables remain unchanged. The UI says **Configuration Ready** after activation. To connect an organization for real interactions, an operator must review the reusable agent prompt/placeholders (including the new questionnaire/location/version variables), verify supported language and extraction fields, map the deployment/organization in the server-controlled incoming-call route, and test against an explicitly selected published version. The existing production voice webhook still resolves its configured rulebook; it is not silently rerouted by an onboarding selection. Recovery Chat remains bound to the existing eligible Disaster voice flow. This deployment-routing/publishing step is intentionally manual for demo safety, not presented as already active.

Never paste keys into the wizard or dynamic variables. Provider credentials remain in server-only ignored environment settings. No new provider keys, package versions or dependencies were added.

## Integration truth and metrics

Readiness reflects server configuration and a successful database configuration read, not a fresh external-provider probe. Voice/Recovery Chat show configured/ready only when their existing flags and required values are present. Carrier status never claims delivered SMS or completed registration. Carrier transport remains simulated for the hackathon; the existing Twilio provider is retained for future registered service.

Dashboard counts now come from stored records rather than fixed invented totals. It reports cases, analyzed voice records, active cases, actual recorded recovery sessions, available responders, awaiting callbacks, critical and closed cases; it also shows recorded average wait, active priority distribution and synchronized help requests. Seeded/synthetic records are labelled as such; these are not throughput, response-time or answered-call estimates for a real phone line.

## Safe DEMO RESET — manual only

No destructive reset endpoint was added. On a shared/live workspace:

1. Keep all real cases, Retell bindings, configuration versions, migrations and the labelled Task 7 synthetic verification case.
2. Switch the organization selector to **Working Disaster / Clinic demo** when demonstrating the original workflow, or start a fresh fictional organization draft for onboarding recording.
3. Restore the Task 7 network control to ONLINE. Only clear a device case cache using the existing confirmation after there are no pending actions. Never discard uncertain pending actions without inspecting the current server state.
4. Use an isolated local database with the existing idempotent seed for a reproducible clean recording. Do not point reset scripts, seed replacement or deletion queries at the live database.
5. To retire a fictional demo case in a live workspace, an authenticated human must inspect that exact labelled case and use the normal outcome workflow if appropriate; preserve its history. No automatic bulk cleanup or data deletion is performed.

## Demo rehearsal

1. Sign in as operator → `/onboarding` → Start fictional dental demo.
2. Review fictional organization, service area, LA languages/hours and phone-line purpose.
3. Generate the demo questionnaire suggestion, edit a non-safety question, accept it, and Preview Conversation. Emphasize human review and no model call.
4. Add a fictional knowledge item, provide a fictional source, approve it. Show that unapproved knowledge stays excluded.
5. Add a fictional responder with clinic expertise/languages/coverage/experience. Review default availability.
6. Review immutable priority safety rules. Adjust matching weights to a valid total of 100 and inspect the same engine’s preview.
7. Review LA profile and offline capabilities → Review & Activate → confirm. Show ACTIVE v1 / Configuration Ready and the active variable preview.
8. Refresh; configuration and history remain. Open operations and the existing responder directory for this organization. New organization case queues are correctly empty until explicitly routed intake exists.
9. Switch to Working Disaster / Clinic demo. Existing Disaster cases, signed voice intake and Recovery Chat remain the original flow. Settings → Algeria retains Task 7 language/location/offline controls.

## Production hardening and deliberate limits

No new full localization, model generation API, carrier registration, real phone provisioning, automatic Retell publication, unsafe priority editing, destructive reset, simulator or presentation assets were added. This is a protected shared hackathon workspace; customer self-service accounts, tenant isolation, scoped operator identity, approval attribution, provider routing/provisioning and audited publishing are production work. Browser draft caching is a demo convenience without application-level encryption; use fictional data/trusted devices. Organization facts still need local operational and accessibility review.

### Validation

Validation results and live-migration status are recorded in the Codex development log. IBM Bob’s history remains untouched; this task is attributed to Codex.

### Current release status and file inventory

The live Task 8 migration is **not applied**. Automatic approval review rejected the new private tables, service-role access/write RPCs, and replacement load RPC as requiring explicit production schema authorization. The live working demo, Task 7 synthetic case, migration-history numbering and Retell agents remain untouched. Apply only the reviewed Task 8 migration after approval; do not attempt to realign Task 7 history.

Local validation: **385/385 tests pass**, comprising all 341 existing tests unchanged and 44 focused Task 8 tests. TypeScript and lint pass. Production builds pass. Isolated Chromium verification covers dental onboarding, draft refresh, human suggestion approval, approved knowledge, responder registration, matching-weight edits, activation/refresh, active provider-variable preview, original Disaster case preservation, Task 7 Algeria controls and phone-width layout. Local PostgreSQL tests execute the actual checked-in migrations and existing RPCs; this is not a claim of live Task 8 persistence before approval.

Files added:

- `app/onboarding/page.tsx`, `app/api/organization/route.ts`.
- `components/organization/OrganizationProvider.tsx`, `OnboardingWizard.tsx`, `Editors.tsx`.
- `lib/organization/model.ts`, `repository.ts`, `suggestions.ts`, `dynamic-variables.ts`, `status.ts`, `metrics.ts`, `organization.test.tsx`.
- `supabase/migrations/20261017235346_organization_configuration.sql`.
- This document.

Existing files extended:

- `app/page.tsx`, all five existing configuration/directory pages, `DashboardSummary`, `LeftNav`, `CallerDetailModal`, `ResponderPicker`.
- `lib/cases/index.ts`, `lib/cases/deployment.ts`, `lib/persistence/commands.ts`, `lib/persistence/mapping.ts`, `types/index.ts`.
- `README.md`, `docs/codex-log.md`.

No changes to Priority Engine weights/thresholds, generic Matching Engine arithmetic, existing tests, provider modules, package versions, environment values or `docs/bob-log.md`. No commit, push, app deployment or later feature task is included.
