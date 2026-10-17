# Task 6 — SMS Recovery

## What is implemented

A verified `call_analyzed` Retell delivery commits the existing case, then evaluates recovery. Eligible facts: explicit unresolved need, explicit human follow-up, or documented `user_hangup` **and** `call_successful === false`. Hang-up alone, transcript keywords, and a generic error status are insufficient. Confirmed automation resolution without unresolved/human need is excluded. `user_requested_dnc`, closed cases, missing encrypted callback contacts, disabled messaging, opted-out contacts and recipients outside the explicit demo consent allowlist cannot send. Existing analyzed-call normalization still requires start/end timestamps; not-connected calls without a complete analyzed intake do not enter this flow.

The mode comes from the stored case/deployment; the current facility remains `zianecomms-demo`. Templates are configurable separately for Disaster and Clinic. No priority weight, threshold or matching rule changed.

`MessagingProvider` has send and inbound-normalization operations. Recovery business logic receives that interface; only the server adapter imports the official Twilio SDK. Both webhook routes use official SDK signature validation. No credential is prefixed `NEXT_PUBLIC_` or returned to the dashboard.

## Timing, duplicates and limits

This hackathon version attempts SMS immediately **after analyzed-call persistence**, before acknowledging the Retell webhook. Post-call analysis already follows the conversation; no timer, sleep, pretend queue or purchased scheduler is used. The SDK has a 3.5-second HTTP timeout and automatic retries disabled. Database round trips add latency: this is not a guaranteed webhook-latency or delivery SLA.

A unique private recovery row keyed by Retell call ID and a public `messages` row in `sending` state are committed before the provider attempt. Only one claimant can send. Replayed Retell events still invoke the deduplicated recovery check. A send timeout/error leaves `unknown`; a process crash can leave `sending`. Neither state is automatically resent. A signed delivery callback can reconcile provider acceptance. If acceptance is recorded through that callback after a lost HTTP response, the message status is retained even when the normal send audit could not be completed.

This deliberately favors avoiding duplicate texts over guaranteed delivery: a crash after claim but before sending can lose that SMS. Provider acceptance is not proof of delivery. Reconcile ambiguous sends in Twilio Messaging Logs before considering any manual action. Never delete claims to blindly retry. A production upgrade would use a transactional outbox, durable delayed worker, retries limited to definitively unsent attempts, and provider reconciliation; it cannot assume exactly-once external delivery.

## Reply behavior

- Exact `URGENT` requests human follow-up. It does not assert medical danger or automatically force Priority 0.
- Free text is retained for responder review. No medical keyword diagnosis and no new AI service are used. Existing Retell call analysis is not an SMS extraction service.
- Explicit structured replies use `key=value` pairs separated by semicolons. Example:

  ```text
  medical_equipment_dependency=yes;power_disruption=yes
  ```

  The existing Disaster adapter maps these facts to the existing equipment-at-risk rule; the existing Priority Engine decides the score. No arbitrary `priority`, numeric weights or caller-supplied rule keys are accepted.
- Supported facts: `immediate_danger`, `medical_need`, `mobility_limitation`, `medical_equipment_dependency`, `affected_by_active_crisis`, `unable_to_self_evacuate`, `no_transportation_available`, `person_unresponsive`, `person_trapped`, `power_disruption`: `yes`, `no`, `unknown`. Also `requested_service` (existing Retell service choices), `location_zone` (existing zone choices), `preferred_language`, `location`. Exact prior structured questionnaire facts are retained across contacts. Uncertain/invalid values remain unknown. Prior safety signals are conservatively retained, not silently retracted.
- The oxygen-machine prose example stays unstructured/operator review. For the deterministic demo, send the explicit structured answer above. Adding a validated AI SMS extractor is a future extension, not claimed here.
- An SMS is not another voice call: it does not increase the voice-attempt counter. Calculated/effective priority history and active human overrides remain separate. Replies keep active cases in Needs Follow-Up, and invalidate stale responder recommendations without changing assignments or matching logic.
- Full raw inbound text is encrypted in the private receipt with message-bound AES-GCM. Dashboard message/history text masks phone-like values. Current shared operator access still applies; this is not a per-user clinical privacy system.
- Correlation uses encrypted-contact identity and recoveries within 48 hours. For one active case, the latest recovery supplies the call reference. Multiple distinct active cases are deliberately ambiguous, even when one is newer. Closed/expired/unknown contacts are not attached. Unmatched and ambiguous replies are retained privately with `review_required=true`.
- STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT suppress future sends. No automated SMS response, START re-enrollment or dispatch promise is implemented. Twilio may independently handle its own opt-out notifications. Multimedia is rejected; this endpoint supports SMS text only.

The existing Caller Detail activity timeline shows Recovery SMS sent, SMS reply received and Priority recalculated after SMS, including safe message bodies. Use the existing dashboard reload control (or reload the page) to fetch external webhook updates; realtime/polling was not added.

## Manual setup — do this after deployment

1. In Twilio Console, inspect the account's actual SMS capability before purchasing anything. The current **new SMS trial** limits outbound content to predefined template identifiers; that trial cannot send the custom recovery body implemented here. Its API parameters also differ from a full Programmable Messaging account. Do not assume older trial behavior. If your account has only this new trial, custom recovery requires a separately authorized account upgrade or other supported messaging access; stop rather than substituting an unrelated trial template. Nothing has been bought, upgraded or sent automatically.
2. For a legacy/full Programmable Messaging-capable trial/account, use an existing SMS-capable number with inbound webhook support. Console → Phone Numbers → Manage → Active numbers → select it. Confirm SMS capability. US toll-free senders require Toll-Free Verification; US local business messaging requires applicable A2P 10DLC registration. An SMS-capable number alone does not prove outbound traffic is permitted. Don't purchase a number solely to discover registration blocks.
3. Verify your own consenting recipient in the account's verified-recipient flow (legacy Console: Phone Numbers → Manage → Verified Caller IDs). The current SMS trial allows up to five verified US recipient numbers, and its trial sender can vary by recipient/product. Legacy restrictions differ. Use the sender assigned to the exact recipient/product. International sending is not assumed. Trial quotas/expiration and trial message prefixes may apply; messages can span more than one billable segment.
4. Console → Account → API keys & tokens → create a Standard API key in the same account as the sender. Copy its SID and one-time secret directly into your ignored local env and Vercel settings. Use Account SID `AC…`, API Key SID `SK…`; the account Auth Token is a separate value required to validate Twilio webhook signatures. Never share them in chat. If your trial cannot create/use API keys with its SMS offering, it is not the supported custom-body account setup; do not weaken authentication.
5. Add these **server-only** variables to `.env.local` and Vercel → Project → Settings → Environment Variables → Production. Keep `TWILIO_ENABLED` unset/false until the other settings and number are ready:

   | Name | Set to |
   | --- | --- |
   | `TWILIO_ACCOUNT_SID` | Account owning the sender |
   | `TWILIO_API_KEY` | Standard API key SID |
   | `TWILIO_API_SECRET` | Its secret |
   | `TWILIO_AUTH_TOKEN` | Same account's Auth Token, for signatures |
   | `TWILIO_PHONE_NUMBER` | Actual SMS sender in E.164 |
   | `TWILIO_WEBHOOK_BASE_URL` | `https://ziane-comms.vercel.app` (origin only; no path) |
   | `SMS_RECOVERY_ALLOWED_RECIPIENTS` | Your consenting, verified demo phone in E.164; comma separated if needed |
   | `TWILIO_ENABLED` | `true` only when ready for the one-message demo |

   Existing Supabase server credentials, `CONTACT_ENCRYPTION_KEY`, strong `OPERATIONS_PASSWORD`, and working Retell deployment settings must remain. Do not regenerate the encryption key: existing contacts depend on it. Optional `SMS_RECOVERY_DISASTER_TEXT` / `SMS_RECOVERY_CLINIC_TEXT` customize templates for the current single facility; retain opt-out/emergency-services wording and do not promise dispatch. The allowlist is a demo consent attestation, not a production consent-management system. Before any broader use, implement recorded per-contact consent and local messaging compliance.
6. Configure the number's Messaging section: **A message comes in → Webhook → HTTP POST**:

   ```text
   https://ziane-comms.vercel.app/api/webhooks/twilio/sms
   ```

   On the new trial console the corresponding location is Messaging → SMS → Try out SMS → Inbound → Auto-Reply → Custom webhook; this does not remove the new trial's outbound-content restrictions. Avoid a Studio/Function/default auto-reply that would generate an extra SMS. The application sends no TwiML message reply. No Twilio voice routing changes are required.
7. Status callbacks are supplied by the app per outbound message, to `/api/webhooks/twilio/status?recovery=…`. Do not manually replace that callback or strip its query string. Use HTTPS and the exact production origin. The two exact Twilio paths bypass only the dashboard password middleware; signatures, account and sender validation still apply. Keep Vercel protection/firewall settings compatible with provider webhooks; never disable signature checking to bypass a 401/403.
8. Commit/push/deploy the Task 6 application when authorized. The additive migration has been verified separately; deploy the matching code. Redeploy after environment-variable changes. Credentials entered in Vercel do not update an already-running deployment.
9. Perform **one** real Retell call using the allowlisted callback number, explicitly leaving an unresolved need. Expect one Recovery SMS. Check Twilio Messaging Logs for accepted/delivered/failed and the dashboard's existing Reload control/Caller Detail for its safe body. Reply `URGENT`, then (if demonstrating structured reprioritization) `medical_equipment_dependency=yes;power_disruption=yes`. Reload and inspect calculated versus effective priority, prior history and preserved override. Replying costs/segments may apply. Do not replay a new call just to troubleshoot a pending SMS; inspect its claim and provider logs first. Disable `TWILIO_ENABLED` when finished (redeploy).

## Database and operator checks

Migration `20261017184903_sms_recovery.sql` adds optional provider/provider-message/call columns to existing `public.messages`, a unique provider-message receipt index, and private recovery, encrypted inbound receipts and opt-out tables. Existing message/activity tables remain canonical. Service-role-only SECURITY INVOKER RPCs use the same facility lock/revision transaction as operator saves. Anonymous/authenticated roles have no new permissions; RLS is enabled on all new tables.

Use Supabase SQL Editor as an authorized operator for unresolved delivery/reply review; do not publish this data or expose service-role credentials:

```sql
select call_id, case_id, state, created_at
from zianecomms_private.sms_recovery
where state in ('sending','unknown') order by created_at desc;

select provider_message_id, case_id, reason, created_at
from zianecomms_private.sms_receipts
where review_required order by created_at desc;
```

Raw encrypted body is intentionally omitted. Review flags are persisted for every reply, including text whose interpretation is uncertain. There is no new inbox or review UI in this task. The synthetic live check is clearly labelled and uses a provider mock, not Twilio test/live credentials.

## Verification and sources

Unit/integration tests use a replaceable provider mock and actual PostgreSQL via PGlite, without paid SMS. Live-demo verification uses the real Supabase RPCs with synthetic contacts/messages and a provider mock. This proves application/database behavior, not carrier delivery or account eligibility.

Official documentation checked October 17, 2026:
- [Retell call status, call success and disconnection reasons](https://docs.retellai.com/api-references/get-call)
- [Twilio official request validation](https://www.twilio.com/docs/usage/security)
- [Current SMS trial, content restrictions and inbound setup](https://www.twilio.com/docs/usage/trials/try-out-sms)
- [Current trial account limits](https://www.twilio.com/docs/usage/trials)
- [Legacy trial restrictions and toll-free verification](https://help.twilio.com/articles/11853148778523-Trial-Limits-and-US-Toll-Free-Number-Restrictions)

## Changed files

- New messaging boundary/config/provider/service/reply/HTTP handling/tests: `lib/messaging/provider.ts`, `config.ts`, `twilio.ts`, `service.ts`, `reply.ts`, `handler.ts`, `messaging.test.ts`.
- New routes: `app/api/webhooks/twilio/sms/route.ts`, `app/api/webhooks/twilio/status/route.ts`.
- Retell recovery hook and documented outcome retention: `app/api/webhooks/retell/route.ts`, `lib/retell/handler.ts`, `lib/retell/normalize.ts`, `lib/retell/ingest.ts`.
- Shared encrypted-contact decryption and exact structured-fact label reuse: `lib/retell/contact.ts`, `lib/retell/disaster-facts.ts`.
- Narrow server access, webhook exclusions and timeline type/icon support: `lib/persistence/admin.ts`, `lib/security/operator-access.ts`, `middleware.ts`, `types/index.ts`, `components/CallerDetailModal.tsx`.
- Database: `supabase/migrations/20261017184903_sms_recovery.sql`.
- Dependencies and documentation: `package.json`, `package-lock.json`, `.env.example`, `README.md`, `docs/codex-log.md`, `docs/twilio-setup.md`.

Validation: 215 tests passed (177 unchanged + 38 new), zero failures. TypeScript, lint and production build passed. A separate live Supabase provider-mocked round trip passed. Isolated production HTTP smoke checks confirmed the dashboard/API remain gated and both unsigned Twilio endpoints reject with 401; the temporary verification server was stopped. All runtime source files matched the final isolated build. No real SMS/carrier delivery has been tested.
