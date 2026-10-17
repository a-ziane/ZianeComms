# Task 6.1 — Retell Chat recovery demo transport

## What is real and what is simulated

**Hackathon:** real unresolved Retell voice intake → the existing recovery engine/unique per-call claim → real Retell API chat → caller types in a simulated carrier view → real Retell responses and structured extraction → signed `chat_analyzed` webhook → existing case/priority engine/history/database. No carrier SMS delivery is claimed or attempted by this transport. Retell AI usage can consume account credits during the manual conversation.

**Production path:** the same recovery policy, case context, Recovery Chat Agent, structured merge and deterministic engine can be used with a registered SMS-enabled number and Retell's `create-sms-chat` API. That future sender must restore real recipient/consent/phone checks, carrier configuration and SMS delivery tracking. The current demo does not implement or claim those carrier capabilities. Task 6's independent Twilio adapter remains available and unchanged.

## Existing engine, new provider

`RetellChatProvider` implements the existing `MessagingProvider`. The common recovery service still owns eligibility, durable claim-before-send, deduplication, persistence and retry policy. The interface now carries optional case context, transport kind and supported rulebooks; no priority weight or matching algorithm changed. This particular agent handles **Disaster** only. Other modes are not silently routed through it.

The voice webhook selects Chat when `RETELL_CHAT_ENABLED=true`; otherwise existing Twilio configuration behaves as before. If both flags are enabled, Chat wins for that call; it does not fan out a second SMS. Keep `TWILIO_ENABLED=false` for this demo. A phone number is unnecessary for simulated carrier chat; only that transport bypasses the SMS telephone/recipient allowlist prerequisite. Closed, resolved-without-followup and do-not-contact exclusions still apply.

The existing recovery table's unique original call ID is shared across transports. One attempt cannot create a Twilio message and a second chat session. For a call already claimed by another provider, use a fresh genuine unresolved voice attempt rather than deleting prior recovery/history.

The provider passes exact server-controlled metadata `case_id`, `original_call_id`, and a simulated-transport marker. Dynamic variables: `case_id`, `original_call_id`, `caller_name`, `preferred_language`, `previous_reason_for_contact`, `previous_requested_service`, `previous_location`, `opt_out_text`, plus the recovery invitation and organization variables. Reserved case variables are assigned after organization configuration and cannot be overridden by it. The opening invitation shown in the demo is the persisted ZianeComms recovery message; Retell's actual response messages are shown separately. The invitation is not inserted as a fabricated caller message into Retell history.

## Real Retell APIs and security

Official `retell-sdk` 6.2.8 is used server-side with the existing `RETELL_API_KEY`:

| Operation | SDK / actual API |
| --- | --- |
| Start recovery | `chat.create` / `POST /create-chat`, `agent_version=latest_published` |
| Read conversation | `chat.retrieve` / `GET /get-chat/{chat_id}` |
| Caller reply | `chat.createChatCompletion` / `POST /create-chat-completion` |
| Explicit completion | `chat.end` / `PATCH /end-chat/{chat_id}` |
| Verify webhook | `Retell.verify(rawBody, apiKey, signature)` |

`POST /api/webhooks/retell-chat` is the only additional provider-authenticated middleware exemption. It validates the exact raw body's official signature, configured chat agent and metadata. `chat_ended` stores completion/history but never scores empty analysis; `chat_analyzed` applies structured updates. Event/chat receipts prevent duplicate processing. Wrong signatures return 401, wrong agent 403, invalid envelope/metadata 400. Unregistered sessions cannot attach to a case. A valid-looking metadata reference is insufficient: the recorded provider chat ID must be bound to that exact case and original call. Session/database failures return 503 for Retell retry, without logging caller content or credentials.

The demo route `/recovery-chat/{caseId}` and API `/api/recovery-chat` require existing operator protection. API handlers enforce it independently even if deployment flags are later removed. POSTs have same-origin checks and bounded content. Server credentials are never returned or imported by the client component. This is an operator-controlled hackathon demonstration, not a public anonymous inbox; do not share the operator password with callers.

Session creation retains Task 6's at-most-once automatic provider-attempt policy. SDK retries are disabled. An ambiguous creation result can leave a recovery `sending`/`unknown`; do not blindly recreate. UI messages also have durable turn UUID claims. A completed HTTP retry reads the existing result instead of submitting again; an in-flight/uncertain turn is blocked for reconciliation. If a process dies while a turn is sending, inspect Retell Chat History before any manual database correction. Reload never automatically resends a typed message. This is not a production durable worker/queue or guaranteed exactly-once delivery.

## Structured facts and visible audit

Agent inspection on October 17, 2026 confirmed “ZianeComms Recovery Chat Agent,” ID `agent_90f9f027152eac8c7878f503ea`, draft version 0, unpublished, with the requested webhook and both events. Its 24 actual field names are recorded in `lib/retell-chat/config.ts` (`CHAT_FIELDS`): the same 23 Disaster extraction fields plus `caller_replied` (`yes`/`no`). No guessed machine keys or second AI provider are needed.

Only signed analysis with `caller_replied=yes` and at least one actual caller text message can apply facts. `no`, missing/unknown reply state and empty conversations keep engine inputs/priority unchanged. Unknown or invalid fields never overwrite known facts. Exact prior structured questionnaire facts combine with confirmed new fields. Confirmed service, location, language, reason and caller name may update; free text/uncertainty remains in the messages/questionnaire/history. An extracted callback number is not used to reroute identity or overwrite an encrypted contact.

The existing Disaster adapter maps supported factual combinations (including powered equipment dependency plus power loss) to existing rule keys. The existing repeat-contact/scoring helper recalculates without adding a voice attempt. Earlier safety signals and emergency-guidance escalation are conservatively retained; later unknown/no/resolved flags do not silently retract an established safety escalation. Active human overrides, override reason/operator/history and calculated versus effective priorities remain separate. Stale responder recommendations clear; assignments/matching logic do not change. Closed cases retain their audit without reopening or reprioritizing. Analysis older than a newer voice intake is retained without overwriting that intake.

Timeline entries include Recovery initiated, Recovery message sent, Caller replied, Recovery chat completed/analyzed and Priority recalculated. Carrier-simulated chat messages use `channel=retell_chat`, not `sms` or delivered-SMS status. Existing public messages/activity/priority tables are reused. One additive private receipt/turn table and an initial-priority column extend the existing recovery model. All new functions are service-role-only SECURITY INVOKER; RLS/default-deny remains enabled. The migration is `20261017192518_retell_chat_recovery.sql`.

The phone-style demo displays the persisted invitation, real conversation, completion/analysis state, initial calculated priority → latest engine priority, and any separate effective override. It polls while a session awaits completion/analysis, pauses refresh when hidden or sending, and stops after analysis. “Back to operations” loads the updated queue; an already-open dashboard tab can use its existing Reload control. No new dashboard layout, public chat access, carrier simulator infrastructure or later task was added.

## Exact manual publishing and configuration

1. Deploy the matching application changes before exercising the new webhook. The database migration is already applied to the current Supabase demo project; for another environment apply all checked-in migrations in order. These Task 6.1 application changes are local until separately committed/pushed/deployed. Do not enable Chat against older application code.
2. Retell Dashboard → Agents → **ZianeComms Recovery Chat Agent** (`agent_90f9f027152eac8c7878f503ea`). Confirm this is the chat agent, not the working voice agent. Its current inspected version is unpublished: use **Publish** and confirm a published version exists. The code deliberately requests `latest_published`; it will not silently run the unpublished draft. Publishing was not performed automatically.
3. In that chat agent's webhook settings, confirm exactly:

   ```text
   https://ziane-comms.vercel.app/api/webhooks/retell-chat
   ```

   Enable `chat_ended` and `chat_analyzed`. Keep webhook signatures enabled. Do not change the existing voice webhook `/api/webhooks/retell`. If the response engine uses a separate editable prompt, publish the chat agent after any prompt/extraction edits so the selected published configuration includes them.
4. In Post-Chat Analysis confirm the existing fields are retained, especially `caller_replied` (`yes`/`no`), `medical_equipment_dependency` and `power_disruption` (`yes`/`no`/`unknown`). Current descriptions already say to extract established facts only and not assign urgency. `caller_replied` must mean an actual user message, not an opening agent invitation. Keep unknown when facts are missing. No new field names are required beyond those already inspected.
5. Ensure the prompt asks concise clarifying questions, respects caller intent, retains uncertainty and gives configured emergency guidance without promising dispatch. A caller can end the demo using the UI's **End conversation & request analysis** button; an agent end-chat tool is optional. The inspected response engine starts with the agent and has no configured general tools, so the UI end button is the reliable manual finish path. Do not wait indefinitely for automatic inactivity closure to demonstrate extraction.
6. Add these names to ignored `.env.local` and Vercel → ZianeComms → Settings → Environment Variables → **Production**:

   ```text
   RETELL_CHAT_AGENT_ID=agent_90f9f027152eac8c7878f503ea
   RETELL_CHAT_ENABLED=true
   ```

   Reuse the existing server-only `RETELL_API_KEY`, `CONTACT_ENCRYPTION_KEY`, `OPERATIONS_PASSWORD` and Supabase server key. Do not rotate them, prefix them `NEXT_PUBLIC_`, or paste values into chat. Leave the working voice `RETELL_AGENT_ID`, `RETELL_RULEBOOK=disaster`, `RETELL_ENABLED` and extraction mapping intact. Set `TWILIO_ENABLED=false` for this demo; do not delete its credentials/provider or purchase/register a number here. Publish the agent **before** enabling the flag, to avoid claiming a session that cannot be created.
7. Optional `RETELL_CHAT_DYNAMIC_VARIABLES` is a JSON object with only `organization_name`, `organization_type`, `line_purpose`, `operating_mode`, `supported_languages`, `emergency_instruction`, `approved_knowledge`. Supply verified organization knowledge only. Defaults identify ZianeComms and say that no availability/address/capacity/booking is verified. Case IDs/caller context are always assigned by the server; do not put secrets into prompt variables. These settings configure this demo, not a new Knowledge Base feature.
8. Redeploy Vercel after configuration changes. Confirm the webhook route is reachable by Retell without Vercel Authentication/Firewall interception; keep application signatures/agent validation intact. An unsigned request should fail authentication. A dashboard “Test webhook” without real metadata/session binding is not proof of the full conversation; use the real manual scenario below.

## One real text-chat demonstration

1. With the published chat agent and deployed configuration ready, use the working Retell **voice** agent for a fresh, clearly labelled demo call: currently safe, displaced by wildfire, requesting shelter, no initial medical/mobility issue, still needing help. Do not claim a geographic danger zone without establishing it. Let the existing voice analysis persist; inspect its actual calculated priority (2 or 3 depending on established facts).
2. Open that active case in ZianeComms → Caller Detail → **Open Recovery Chat**. The already-started session opens, or use **Start recovery chat** for an eligible existing voice case. Confirm the label **Carrier simulated for hackathon demo. Real Retell conversation.** No real recipient phone is needed. A previously claimed Twilio/mock recovery is not recreated as a second transport; choose the fresh attempt.
3. Send exactly:

   ```text
   My mother's oxygen machine stopped because the power went out.
   ```

   Retell, not ZianeComms keyword logic, extracts the facts. Answer any genuine clarification. Expect supported `medical_equipment_dependency=yes` and `power_disruption=yes`; do not force a diagnosis or expected numeric priority. If Retell gives emergency-services guidance, that separate fact may also affect the existing safety rule.
4. Click **End conversation & request analysis** when complete. Watch “Waiting for signed Retell analysis…” change to “Recovery analysis received.” The view shows **before → after calculated priority**, with an effective human override separately if present. Allow the post-chat analysis/webhook time to complete; the UI refreshes every five seconds.
5. In Retell Chat History inspect the actual custom-analysis values and webhook delivery if the view remains waiting. Then return to operations/reload and inspect the same case, structured answers, equipment/power signal, score explanation and timeline. Reload again to verify persistence. The final priority must come from the existing engine and is not hard-coded in the demo.

No real chat session, carrier SMS, number purchase, registration or paid setting change was initiated during automated validation. Unit/database tests use synthetic provider API responses. The real Retell text/extraction/webhook demonstration is the remaining manual acceptance step after publishing/deployment.

## Sources and changed-file map

- [Official chat implementation guide](https://docs.retellai.com/deploy/create-chat-completion)
- [Create Chat](https://docs.retellai.com/api-references/create-chat), [Get Chat](https://docs.retellai.com/api-references/get-chat), [Create Chat Completion](https://docs.retellai.com/api-references/create-chat-completion), [End Chat](https://docs.retellai.com/api-references/end-chat)
- [Official webhook signature verification](https://docs.retellai.com/features/secure-webhook), [chat webhook events](https://docs.retellai.com/features/webhook-overview)
- [Future registered carrier transport: Create Outbound SMS](https://docs.retellai.com/api-references/create-sms-chat)

New: `lib/retell-chat/{config,provider,normalize,facts,ingest,handler,demo,chat.test}.ts`, `app/api/webhooks/retell-chat/route.ts`, `app/api/recovery-chat/route.ts`, `app/recovery-chat/[caseId]/page.tsx`, `components/RecoveryChatDemo.tsx`, the additive migration and this guide.

Extended narrowly: `lib/messaging/{provider,service}.ts`, voice webhook route, operator gate/persistence enable flags, exact middleware exemptions, Caller Detail's entry link/activity type/icon, `.env.example`, SDK dependency/lockfile, README and Codex log. Twilio code, all original 215 tests, scoring/matching rules and IBM Bob history remain unchanged.

Validation: **259 tests passed, 0 failed** (all original 215 plus 44 new). TypeScript, lint and isolated production build passed. Production HTTP checks verified operator protection, cross-origin rejection, unsigned webhook rejection and the authorized simulated-carrier page. The additive migration and service-only privileges were verified on live Supabase. No real Retell Chat session or carrier SMS was sent during automated checks. The known preexisting Supabase platform warnings are recorded in the Codex log; this task adds no public grants or SECURITY DEFINER function.
