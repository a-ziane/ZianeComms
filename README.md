# zianeComms

Hackathon operations console for missed-caller recovery, explainable urgency ranking and human-approved responder matching. Built with Next.js 14, TypeScript and Supabase/Postgres.

## Run locally

Use Node.js 24 (Node 22.12+ is also supported by the current dependencies).

```sh
npm ci --legacy-peer-deps
cp .env.example .env.local
```

The legacy-peer option accommodates the pre-existing Vitest / Node type optional-peer mismatch without changing the previously validated dependencies.

Set these values in **local** `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=YOUR_SERVER_ONLY_SECRET_KEY
ZIANECOMMS_DEMO_MODE=true
```

`SUPABASE_SERVICE_ROLE_KEY` is supported as a legacy alternative to `SUPABASE_SECRET_KEY`. Neither key may be named `NEXT_PUBLIC_*`, put in browser code, pasted in documentation, or committed. `.env.local` is ignored; `.env.example` contains names/placeholders only.

### Apply the database migration

Use a dedicated demo Supabase project. Inspect an existing project's schema first; the migration creates new tables, so similarly named existing tables need review rather than replacement.

With Supabase CLI installed (or via `npx supabase`):

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REFERENCE
npx supabase db push
npm run db:seed
npm run dev
```

No database reset is necessary. **Never run `db reset` against a remote project.** If CLI access is unavailable, run the exact contents of `supabase/migrations/20261017000100_operations_persistence.sql` in the project's SQL Editor, then explicitly run `supabase/seed.sql`. This project's initial Task 4 migration was applied using the SQL Editor. Its already-applied version was registered in migration history during Task 5, together with the matching Task 5 version. Do not rerun its CREATE TABLE statements. New projects can use `db push` to apply both checked-in migrations normally.

`npm run db:seed` uses the server-only key and existing TypeScript mock data. It returns without changing data if demo cases already exist. Seeding never runs during normal application startup. To regenerate the reproducible SQL seed from the current models and engines:

```sh
npm run db:seed:sql
```

Both Disaster and Clinic start with six cases. Ten responders include one shared medical liaison whose workload counts active assignments across both modes. Full phone values are omitted from the database seed; display values retain only the masked suffix. Mock call/message history is explicitly simulated, not actual telephony or SMS.

### Verify

```sh
npm test
npx tsc --noEmit --incremental false
npm run lint
npm run build
npm start
```

The persistence suite applies the real SQL migration and seed in embedded PostgreSQL (PGlite), exercising the repository without a live Supabase dependency. All pre-existing tests remain unchanged. Avoid building into the same `.next` directory while another development server is compiling there; stop that server or verify an identical checkout separately.

After applying the migration and seeding, manually verify: change priority → refresh; assign/reassign → refresh; change responder status → refresh; No Answer / Needs Follow-Up → refresh; resolve → refresh; modify Clinic and Disaster independently and return to each. Each confirmed action must survive reload. The status bar indicates whether a save is complete.

## Retell real-call integration (Task 5)

After the proven real-call pipeline, configure native Disaster extraction using [docs/retell-disaster-extraction.md](docs/retell-disaster-extraction.md). It lists the exact Retell field types/descriptions and the Production mapping update; scoring rules remain unchanged.

The server endpoint is `POST /api/webhooks/retell`. Full setup, the inspected extraction schema, exact field mapping, privacy/access controls and the two-call manual test are in [docs/retell-setup.md](docs/retell-setup.md). Retell is disabled by default until its environment, extraction formats and public HTTPS webhook URL are configured. The existing dashboard gains no new integration UI.

When `OPERATIONS_PASSWORD` is set, open the dashboard with HTTP Basic username `operator` and that local password. Keep it configured after ingesting any real call data. This controlled-test gate replaces Task 4’s public synthetic-demo API assumption. The existing demo records are preserved alongside provider-origin cases.

## Persistence architecture

- `lib/persistence/mapping.ts` maps the existing Caller/Responder types to database rows and back. Both engines remain pure application logic. Workload is derived from active case assignments, never incremented/decremented as an unrelated counter.
- `lib/persistence/commands.ts` reconstructs supported operations on the server. Browser-submitted arbitrary score/state patches are rejected. Hard-safety downgrade confirmation remains required.
- `lib/persistence/repository.ts` wraps the database load/save/seed functions. `app/api/operations/route.ts` is the server boundary. Components contain no raw Supabase queries.
- `hooks/usePersistentCases.ts` loads both modes and submits existing actions. The UI displays saved results only after database acknowledgement. Mode/page navigation does not seed or reset cases.
- Each write is one Postgres transaction. Facility revisions reject conflicting writes; mutation UUIDs make retries idempotent, including when a response is lost after a successful commit. History is append-only. Workload and assignment history update atomically with the case.

### Schema

`facilities` stores demo scope, mode/rulebook/matching configuration snapshots and revision. Current engine configuration remains in the checked-in TypeScript config; the stored configuration prepares future administrative configuration workflows, not automatic rule changes.

`cases` and `responders` reuse the current model as JSONB, with queryable generated columns for core operational fields. Canonical case JSON includes questionnaire and timeline state; relational tables project it for audit/querying within the same transaction. This deliberately avoids a second application-domain model or an elaborate ORM.

Additional tables: `activity_events`, `priority_events`, `contact_attempts`, `questionnaire_answers`, `messages`, `assignments`. History/projections retain structured recommendation scores, overrides, operator/timestamps, explanations, assignments, response-time metadata and outcomes. Questionnaire replacements include previous/current answers in an activity event. Assignment rows are ended on reassignment/closure rather than deleted. No Answer and Needs Follow-Up remain active.

`zianecomms_private.case_contacts` reserves a separate server-only place for actual contact values. Seeded contact values are NULL. `zianecomms_private.mutations` stores idempotency receipts. Neither table is returned by the load function.

## Demo security and limits

**Task 5 update:** the synthetic-only public API description below applies only before Retell ingestion and without an operator password. The Retell integration requires operator protection, encrypts callback numbers and persists a flag that prevents API data from reopening publicly if environment flags are removed. See the [integration security decisions](docs/retell-setup.md#merge-security-and-persistence-decisions).

RLS is **enabled** on every operational table. `anon` and `authenticated` have no direct table privileges and cannot invoke operational RPCs; private schema access is also denied. Server RPCs use SECURITY INVOKER, not SECURITY DEFINER. A server-only secret client performs the fixed-facility demo operations. No privileged key is imported by a browser module.

To avoid adding authentication UI in this hackathon task, enabling `ZIANECOMMS_DEMO_MODE=true` deliberately makes the app's operational API a **shared, unauthenticated synthetic-data demo**. Anyone who can access the app can modify that fixed demo facility through validated commands. Cross-origin browser POSTs are rejected, but this is not authentication and does not stop direct HTTP clients. This is acceptable only for fake data and a controlled demo. The API cannot select another facility or expose arbitrary database queries. Set demo mode false to disable this public API.

Before production or real caller data: implement authenticated operator membership, facility-scoped authorization/RLS, verified operator identity, proper private contact ingestion, encryption/key management, rate limits, retention/deletion policies and a security/privacy review. Current demo operator IDs are labels, not authenticated identities. A future populated private contact column alone would not make the application production compliant. Caller messages/questionnaire free text can themselves contain personal information; do not put real personal data in this demo.

### Database failures

When initial loading fails, the existing mock dataset remains a **read-only preview**, with a clear error banner. Once live data has loaded, it stays visible on a failure. Mutation controls are disabled while loading/saving or after a failed request. Failed actions are not reported as saved; one pending request remains in memory in that tab for explicit retry. Navigation/reload warns while an action is unconfirmed. A user may explicitly cancel the unsaved action and reload the database (needed after a concurrent-edit conflict). Closing the tab after dismissing that warning can lose the pending request; there is no durable offline queue or store-and-forward implementation.

There is no automatic realtime subscription or polling in Task 4. Use Reload database or normal refresh to pick up another operator's confirmed changes.

## Development history

IBM Bob's work: `docs/bob-log.md` (preserved). Later Codex-assisted work and verification: `docs/codex-log.md`.

Task 5 adds Retell post-call ingestion. Twilio, SMS recovery, authentication UI, offline mode, simulator and deployment profiles remain deferred.
