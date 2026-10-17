# Task 5 — Connect Retell to ZianeComms

## Verified implementation and remaining setup

The endpoint is `POST /api/webhooks/retell`. It accepts the actual Retell envelope `{ "event": "call_analyzed", "call": { ... } }`, verifies the original request body with `x-retell-signature`, normalizes extraction data, runs the existing Priority Engine, and commits to Supabase. Other signed events (including `call_started` and `call_ended`) are acknowledged without creating cases. Post-call extraction is unavailable on `call_ended`; do not subscribe only to that event.

Implementation was verified using signed synthetic payloads through a production build and the live Supabase database. Routine → Priority 3, emergency-services guidance → hard Priority 0, duplicate retries → no new case/attempt/history, dashboard reload → saved data. No real or paid Retell call has been placed for Task 5. Two explicitly labelled synthetic “Integration check” cases remain with their audit history. They are not evidence of a real provider delivery.

The configured agent was inspected read-only using the local API key on October 17, 2026. Its API-reported name was **ZianeComms Caller Support**, version 0, with no webhook URL configured. Confirm the agent ID in local `RETELL_AGENT_ID` is the Crisis Support Demo you intend to use. Its actual eleven extraction keys were retrieved from `GET /get-agent/{agent_id}`; these names were not inferred from conceptual labels.

## Local environment

The ignored `.env.local` already contains the supplied Retell credentials, the observed field mapping and `RETELL_RULEBOOK=disaster`. Missing operator/contact keys were generated locally without printing them. `RETELL_ENABLED=false` remains the safe default until the steps below are complete. Do not overwrite an existing encryption key.

Required server-only variable names:

- `RETELL_ENABLED`: set `true` when ready to receive calls.
- `RETELL_API_KEY`: Retell API key used for webhook signature verification.
- `RETELL_AGENT_ID`: exactly one allowed voice agent for this deployment.
- `RETELL_RULEBOOK`: `disaster` now; `clinic` is also supported. This is deployment configuration, not a raw payload field.
- `RETELL_EXTRACTION_FIELDS`: JSON mapping described below.
- `OPERATIONS_PASSWORD`: at least 24 characters; browser HTTP Basic username is `operator`. Read its value locally, never paste it into chat or a URL.
- `CONTACT_ENCRYPTION_KEY`: exactly 64 hex characters (32 random bytes). Back it up securely. Existing encrypted contacts cannot be recovered if it is lost. Key rotation/re-encryption is a future operational task.
- Existing `NEXT_PUBLIC_SUPABASE_URL` and server-only `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.

`.env.example` contains names/placeholders only. The operator password gates the dashboard and operational API even when Retell is disabled. After the first ingestion a persistent database flag also prevents API data from becoming public if deployment flags/password are accidentally removed.

## Extraction mapping in one place

`config/retell.ts` defines adapter concepts and validates `RETELL_EXTRACTION_FIELDS`. Values are exact, flat keys inside `call.call_analysis.custom_analysis_data`; changing a Retell field name requires updating this mapping. The current mapping is based on the inspected agent:

```dotenv
RETELL_EXTRACTION_FIELDS={"caller_name":"caller_name","phone_number":"phone_number","preferred_language":"preferred_language","reason_for_contact":"reason_for_contact","location":"location","questionnaire_answers":"questionnaire_answers","unresolved_need":"unresolved_need","human_requested":"human_requested","emergency_guidance_provided":"emergency_guidance_provided","automation_resolved_request":"automation_resolved_request","safety_context_signals":"safety_context_signals"}
```

The repeated names above happen to match for this agent; they are not implicit adapter defaults. An absent/invalid mapping disables ingestion. Required outcome/safety booleans must actually be present as JSON booleans on analyzed conversations; a missing field or string `"false"` is rejected rather than silently treated as false.

| Retell data | ZianeComms use |
| --- | --- |
| `call_id`, `agent_id` | Durable correlation, allowlist and idempotency |
| `call_type`, `direction`, `from_number`, `to_number` | Caller-side contact for phone calls; extracted `phone_number` for web calls |
| `start_timestamp`, `end_timestamp`, `call_status` | Provider timestamps/status and one contact attempt per conversation |
| `caller_name`, `preferred_language`, `reason_for_contact`, `location` | Existing Caller and EngineInput fields |
| `questionnaire_answers` | Existing questionnaire; JSON array preferred, existing question:answer text preserved under a labelled answer |
| `unresolved_need`, `human_requested`, `automation_resolved_request` | Existing agent outcomes, with unresolved need taking precedence over human request/resolution |
| `emergency_guidance_provided` | Existing `directed_to_911` hard-safety outcome; define it precisely as below |
| `safety_context_signals` | Structured classification/context/signal JSON as below; free text is retained for operator review |
| `call_analysis.call_summary` | Existing summary, with phone-like values redacted |

No Retell priority or score is trusted. Priority 0–3, raw/final score and explanations come only from the existing configured engine. Language does not become an urgency signal. Missing wait time is zero, not the voice conversation's duration. Clinic intake leaves Customer Fit uncalculated unless valid fit inputs exist; a repeat case preserves its existing separate Customer Fit.

## Retell dashboard changes before the real-call test

1. Open Retell → **Agents** → the agent matching local `RETELL_AGENT_ID`. In the agent editor, expand **Post call extraction**. For a conversation-flow agent, open **Global settings** first.
2. Verify the eleven field names/types above. The four outcome/safety flags must be Boolean fields. Their actual keys are also available from `GET /get-agent/{agent_id}` → `post_call_analysis_data[].name`, or a completed call's `call_analysis.custom_analysis_data`.
3. Edit the existing `questionnaire_answers` Text field description to request: **Return a JSON string containing an array of objects with `question` and `answer` strings, retaining the caller's actual answers. Return `[]` when none were collected. Do not invent answers.** Existing plain-text answers are still accepted.
4. Edit `emergency_guidance_provided` Boolean description to: **True only when this agent actually instructed the caller to call 911 or the configured local emergency services number for an emergency. False for general safety advice, ordinary human follow-up, or a routine referral. Do not infer that emergency dispatch occurred.** This matches the existing engine's hard escalation meaning.
5. Edit the existing `safety_context_signals` Text field description to request a JSON string using this schema, never a priority number:

```json
{
  "need_category": "shelter",
  "location_zone": "affected_area",
  "facility_signals": ["urgent_evacuation_shelter"],
  "possible_danger": false,
  "immediate_life_threat": false
}
```

Use only information supported by the conversation; use `other`, `unknown`, `[]` and false for unestablished facts. `immediate_life_threat=true` is a hard safety signal and must only represent an explicitly reported immediate threat to life. `possible_danger` represents uncertain danger, not confirmed immediate life threat. Do not infer an affected/evacuation zone from an unverified street address.

Disaster categories: `medical_equipment`, `evacuation`, `shelter`, `welfare_check`, `mobility_issue`, `outage_information`, `general_disaster`, `other`. Zones: `active_danger`, `near_danger`, `affected_area`, `outside`, `unknown`.

Disaster signal keys and their existing meanings are authoritative in `config/rulebooks/index.ts`: `immediate_life_threat`, `medical_equipment_dependency`, `person_trapped`, `mobility_vulnerability`, `welfare_check_needed`, `urgent_evacuation_shelter`, `no_transportation`, `service_problem_human_needed`, `info_unresolved`. Return only matching facts, never all keys. These are extraction labels for the existing rules, not new scoring rules.

If `safety_context_signals` remains legacy free text, the adapter preserves it in the questionnaire, labels classification incomplete in the summary/timeline, and requires operator review. It does not guess safety signals from words or treat an ordinary reference to “danger” as Priority 0. Unknown signal keys are ignored with a review note. Malformed structured JSON returns 400 and requires configuration correction/replay.

6. Save/publish the extraction changes to the version used by the voice test or phone number. Do not change the voice prompt or create another agent for this integration.
7. After setting up the reachable endpoint below, set this agent's **Webhook URL** to `https://YOUR_PUBLIC_HOST/api/webhooks/retell`. Ensure `call_analyzed` is selected in webhook events. Receiving the default three events is also safe. Agent-level URLs take precedence over account-level webhooks; avoid changing the whole account's URL for this single-agent integration.

## Reachable development endpoint

No hosting platform or stable public URL is currently configured by this task. Localhost is not reachable by Retell. No tunnel was started automatically and no temporary URL is embedded in source.

For a short controlled test, install/sign in to the official ngrok CLI using its own setup instructions. Set `RETELL_ENABLED=true` locally after reviewing the settings above, then start the app on a separate port:

```sh
npm run dev -- --hostname 127.0.0.1 --port 3002
```

In another terminal:

```sh
ngrok http 3002
```

Use ngrok's assigned **HTTPS** host plus `/api/webhooks/retell` in Retell. Keep the app and tunnel running. Do not put the operator password in the webhook URL or add Basic authentication to the webhook path; provider HMAC authenticates it. Access the dashboard locally using username `operator` and the password in `.env.local`. Avoid browsing an HTTP public tunnel; use HTTPS. Do not share tunnel request bodies or credentials; tunnel inspection can retain call content. Stop the tunnel after testing. A tunnel URL may change on restart, requiring an update in Retell.

For longer testing, use an existing Next.js-capable HTTPS host with the same server environment values and migrations. The endpoint needs server execution, not static export. Confirm hosting protection does not redirect/block this webhook, while dashboard/API operator protection remains enabled. Retell expects a response within ten seconds; persistence failures return 503 for retry, not a false success. No background queue is implemented.

## Two-call manual test

1. Open the authenticated dashboard, Disaster mode. Make a short **routine test conversation** asking for ordinary wildfire information, with no emergency. After the call ends and post-call extraction finishes, use **Reload database**. Find the caller, inspect their questionnaire/history/explanation, and refresh. Routine example should be low/moderate priority according to collected facts, with no hard escalation.
2. Make a short **fictional critical test conversation** using the already tested emergency scenario. Do not place a real emergency call. When the agent gives the configured emergency-services instruction, complete the conversation. Reload the dashboard. The new case should show calculated Priority 0, hard-escalation reason and an emergency-guidance timeline entry. This records what the agent said; it does not confirm emergency dispatch.
3. Verify each has exactly one provider contact attempt. Retell retries must not create another case or append duplicate timeline entries. Cases remain in the queue for human review even if the agent reports resolution.

If the caller does not appear: confirm the local server/tunnel are still running, the tested agent/version matches `RETELL_AGENT_ID`, `call_analyzed` is selected, the signature key belongs to that Retell workspace, and all four safety/outcome fields are booleans. Check delivery HTTP status: 401 signature, 403 agent, 400 extraction/payload, 413 size, 503 configuration/database. A call that never connected may have no custom extraction; such an incomplete analyzed payload is rejected rather than assigned a fabricated priority. Correct configuration and redeliver the post-call event while its signature is fresh. Successful analyzed events are immutable/idempotent; rerunning analysis for the same call does not silently rewrite a case already reviewed by a human.

## Merge, security and persistence decisions

- The existing fixed hackathon facility and rulebook architecture are reused. This is one controlled deployment, not multi-tenant routing. The resolved agent/mode is also stored under facility configuration `retellDeployment`, and each case/attempt retains the mode/call reference. No scoring SQL or duplicate case model was added.
- A new call creates a new case unless trusted call metadata explicitly contains `zianecomms_case_id`, the target is an active Retell-origin case in the same mode, its need category matches, its private normalized phone identity matches, and the call is not older than that case's latest conversation. Metadata must be set by a trusted integration/operator, not extracted from caller speech. A phone match alone never merges. No phone or reference → new case. Same-call retries always correlate to the existing call receipt, even after closure.
- Repeat calls reuse the existing repeat-contact helper: attempts accumulate, safety signals union, human override/history and assignments remain. An earlier emergency-services outcome is not silently retracted. New calculations and effective human priority remain separate. Recommendations must be shown again after intake changes.
- One RPC transaction uses the existing facility revision lock and save function for all cases, responders and audit projections. It adds the provider receipt, real voice attempt, priority snapshot and encrypted contact atomically. Failed saves leave no partial case or receipt. Revision conflicts reload/recalculate up to three times, then return 503 for provider retry.
- Private `retell_calls.call_id` is the durable unique receipt. Raw payloads, transcripts, recordings, access tokens and recording URLs are not stored. Retell call ID is the provider reference for authorized later investigation. No outbound call/message APIs are invoked.
- Numbers use strict international format with no country guessing. The UI sees only the masked suffix. Necessary contact values use case-bound AES-256-GCM in the existing private contact table; a keyed HMAC supports identity comparison without exposing the number. Phone-like values in summary, location, questionnaire and other displayed extraction text are redacted. This does not make arbitrary free text anonymous.
- Dashboard/API use shared HTTP Basic access over HTTPS. This is a minimal controlled-test gate, not per-user authentication, verified operator identities, roles, rate limiting, retention management, complete encryption/key rotation, or production medical/privacy compliance. The original rulebook weights remain demo rules. Do not use real sensitive caller data for this hackathon test.
- RLS remains enabled with browser roles denied; new RPCs use SECURITY INVOKER and service-role-only execution. The Supabase advisor reports expected default-deny/no-policy INFO findings. Its two pre-existing warnings about the unrelated platform `public.rls_auto_enable()` SECURITY DEFINER trigger remain unchanged; Task 5 introduces no SECURITY DEFINER functions or public data grants.
- The Task 4 manually applied baseline was registered in migration history without rerunning its schema. The Task 5 MCP-generated history version was aligned to the CLI-generated checked-in filename. Both migration versions now match repository files; no reset or existing case edits were used.

## Validation

Run `npm test`, `npx tsc --noEmit --incremental false`, `npm run lint`, and `npm run build`. New tests exercise the real SQL migration/functions in PGlite, the actual HTTP handler and the operator API boundary. No paid calls or live database are needed for unit/regression tests. Existing 102 tests and scoring/matching rules are unchanged. Package versions/dependency files are unchanged.

Task 5 stops at readiness for the two real-call tests. Twilio, SMS recovery, offline/global modes, Agent Setup, Knowledge Base, simulator and poster remain deferred.

Official references checked for implementation: [Retell webhook events](https://docs.retellai.com/features/webhook-overview), [signature verification](https://docs.retellai.com/features/secure-webhook), [Get Voice Agent / extraction schema](https://docs.retellai.com/api-references/get-agent), [post-call extraction](https://docs.retellai.com/features/post-call-analysis-overview), [Supabase database functions](https://supabase.com/docs/guides/database/functions), [ngrok HTTP endpoints](https://ngrok.com/docs/gateway/endpoints/http).

Final validation: **146 passed, 0 failed** (102 unchanged baseline plus 44 new tests); TypeScript, lint and isolated production build passed. No actual server secrets were present in pending source files or compiled browser assets.

## Changed files

Added: `app/api/webhooks/retell/route.ts`, `config/retell.ts`, `lib/retell/config.ts`, `lib/retell/contact.ts`, `lib/retell/handler.ts`, `lib/retell/ingest.ts`, `lib/retell/normalize.ts`, `lib/retell/signature.ts`, `lib/retell/retell.test.ts`, `lib/retell/access.test.ts`, `lib/security/operator-access.ts`, `supabase/migrations/20261017151241_retell_integration.sql`, and this guide.

Updated: `.env.example`, `.gitignore`, `README.md`, `docs/codex-log.md`, `middleware.ts`, `app/api/operations/route.ts`, `lib/persistence/admin.ts`, `lib/persistence/repository.ts`, `types/index.ts`, `components/CallerDetailModal.tsx`, and the obsolete data-source label in `components/LeftNav.tsx`. The actual `.env.local` was updated only locally. Package files, both engines/configured scoring rules, the existing test files and IBM Bob's log are unchanged.
