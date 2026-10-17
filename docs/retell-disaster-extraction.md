# Disaster structured extraction — manual Retell configuration

This follow-up improves Task 5 extraction only. The user verified the production pipeline with two real Retell Test Audio calls: a safe family needing shelter reached the queue but scored only the unresolved-need adjustment because classification stayed free text; an approaching-fire/neighbor evacuation case received emergency guidance and correctly became hard Priority 0, Awaiting Callback. Those production records are not rewritten by this change.

The updated adapter consumes native Retell Selector fields. Retell extracts facts; ZianeComms maps explicit facts to existing rule keys; the unchanged Priority Engine assigns all points and priority. No keyword inference, geocoding, new scoring weights or thresholds are added. No new database migration or environment variable name is needed.

## Apply in this order

1. Deploy the updated application code before adding the new mapping keys in production. The preceding application version rejects unknown mapping keys. Code changes from this follow-up remain local until committed/pushed and deployed.
2. In Retell, open the existing production agent identified by `RETELL_AGENT_ID`. Expand **Post call extraction** (for conversation-flow agents, open **Global settings** first). Add the new fields below, using the exact names shown, or explicitly map different actual names later. These are proposed new machine names to create, not claims that the fields already exist.
3. Keep the existing Text fields for caller details and fallback context. Change the four existing outcome fields to Selector with `yes`, `no`, `unknown` if the UI permits editing their types. Otherwise recreate those extraction fields with the same names/types; do not change the voice agent itself or its emergency prompt. Existing Boolean values remain accepted by the updated adapter.
4. Add/update `RETELL_EXTRACTION_FIELDS` in **Vercel → Project → Settings → Environment Variables → Production**, using the complete JSON below. Keep the other credentials, rulebook, signature verification, allowed agent and webhook URL unchanged. Redeploy so the production deployment receives the new mapping.
5. Save/publish the Retell extraction changes to the agent version used by Test Audio/your actual call route. Keep **`call_analyzed`** enabled at `https://ziane-comms.vercel.app/api/webhooks/retell`.
6. Make fresh fictional routine/critical test conversations after both sides are ready. Do not rely on the dashboard's sample-webhook button to prove actual post-call extraction. Successful call IDs are idempotent: rerunning analysis on an already ingested call does not rewrite its history or score.

Retell's current UI supports Text, Boolean, Number and Selector fields. Selectors allow uncertainty to be explicit. Official reference: [Post Call Extraction types and setup](https://docs.retellai.com/features/post-call-analysis-overview).

## Shared extraction instruction

Include this instruction in the descriptions below:

> Extract only facts established in this conversation about the caller or the person they are requesting help for. For yes/no facts, choose `yes` only when supported, `no` only when its absence is established, and `unknown` when missing or uncertain. Do not treat silence as no. Do not invent a diagnosis, address, crisis zone, service availability, successful dispatch, priority or score. Preserve uncertain details in `safety_context_signals`.

This is a post-call extraction instruction, not a replacement for the existing voice prompt.

## Add these fields

Every yes/no field below is a **Selector**, with exactly `yes`, `no`, `unknown` as choices. A missing, null, unsupported or otherwise invalid fact becomes unknown and triggers operator review. Boolean true/false is also accepted for compatibility, but cannot itself represent uncertainty.

| New machine name | Type / choices | Extraction description |
| --- | --- | --- |
| `requested_service` | Selector: `shelter`, `evacuation`, `transportation`, `welfare_check`, `outage_information`, `medical_assistance`, `other`, `unknown` | The primary service the caller currently requests. Shelter means temporary accommodation/shelter; evacuation means help leaving an unsafe area; transportation means a ride/transport; welfare_check means checking another person's welfare; outage_information means outage status/information; medical_assistance means health-related help. Use other for an established request outside these categories, unknown when not established. Do not extract a priority. |
| `location_zone` | Selector: `active_danger`, `near_danger`, `affected_area`, `outside`, `unknown` | The person's current physical crisis context, only from explicit statements: inside active danger; near an active danger boundary; in a broader affected area; explicitly outside affected areas; or unknown. Being displaced does not prove the person is still inside an affected area. Currently safe does not establish a geographic zone. Do not infer a zone from an address/city alone. |
| `immediate_danger` | yes/no/unknown Selector | Is an immediate threat to life or severe immediate physical danger explicitly reported for the caller or the person they need help for? General concern, a past threat, a routine request, or uncertain proximity is not confirmed immediate danger. |
| `medical_need` | yes/no/unknown Selector | Is a current medical/health-related assistance need reported? Preserve the actual description in reason/questionnaire/context. Do not infer severity or a diagnosis. |
| `mobility_limitation` | yes/no/unknown Selector | Is a physical mobility limitation explicitly reported? Age alone does not establish a mobility limitation. A transportation request alone does not establish disability. |
| `medical_equipment_dependency` | yes/no/unknown Selector | Does the person depend on powered medical equipment, such as an oxygen concentrator? Do not infer dependency from a generic medical request. |
| `affected_by_active_crisis` | yes/no/unknown Selector | Is this current need directly affected by an active wildfire/disaster/crisis, including displacement by the current event? This does not identify the person's current physical zone. |
| `unable_to_self_evacuate` | yes/no/unknown Selector | Is the person explicitly unable to leave/self-evacuate during the crisis without assistance? A general question about evacuation does not establish inability. |
| `no_transportation_available` | yes/no/unknown Selector | Is it explicitly established that no transportation is available to the person? Requesting transport does not by itself establish absence of all available transportation. |
| `person_unresponsive` | yes/no/unknown Selector | For the person whose welfare is at issue, is it reported that they are unresponsive/not responding to contact and there is concern for their safety? A generic welfare-check request without that information is unknown. Do not infer unconsciousness. |
| `person_trapped` | yes/no/unknown Selector | Is someone explicitly physically trapped or unable to escape a physical obstruction? Do not equate a lack of a ride with being physically trapped. |
| `power_disruption` | yes/no/unknown Selector | Is a current outage/loss of usable electricity explicitly affecting the person? A general outage-timeline question does not establish that their powered medical equipment is affected. |

## Update the existing fields

| Existing machine name | Type / choices | Extraction description |
| --- | --- | --- |
| `human_requested` | Selector: `yes`, `no`, `unknown` | Did the caller request human help, or did the conversation establish a need for human follow-up? Use unknown if not established. This is separate from whether the automation resolved the request. |
| `unresolved_need` | Selector: `yes`, `no`, `unknown` | Does the caller still have an unmet need/unanswered request at the end of the conversation? Giving information or a referral does not establish resolution. |
| `automation_resolved_request` | Selector: `yes`, `no`, `unknown` | Did automation actually resolve the request, supported by the conversation? Do not treat ending the call, giving emergency guidance, acknowledging a request, or promising a callback as resolution. |
| `emergency_guidance_provided` | Selector: `yes`, `no`, `unknown` | Did this agent actually instruct the caller to call 911 or the configured emergency services number for an emergency? General safety advice, routine referral or an ordinary human callback is not emergency-services guidance. This records what the agent said, not whether emergency dispatch happened. |
| `preferred_language` | Text | Caller's stated preferred language. Return unknown if not established; do not use language to assign urgency. |
| `location` | Text | The caller's/person's stated current location or area. Do not invent an address or infer a crisis zone. Return unknown if not established. |
| `reason_for_contact` | Text | Concise actual request and relevant facts, including who needs help. Do not invent classifications or urgency. |
| `caller_name` | Text | Name if provided, otherwise leave unknown. |
| `phone_number` | Text | Callback number if provided, in international format only when the country code is established. Do not invent a code or phone number. |
| `questionnaire_answers` | Text | Return a JSON string containing an array of `question`/`answer` objects reflecting actual answers, or `[]` if none. Existing plain-text question:answer output remains supported. |
| `safety_context_signals` | Text | Preserve relevant safety/context details and uncertainty in ordinary text. Do not output a priority/score or try to decide rule weights. This field is retained for operator review; ZianeComms will not extract signals by scanning its words. |

If Retell cannot change a Boolean field's type, it may remain Boolean for established facts; absent/null values are treated as unknown under the new Disaster contract. A Boolean false still means a negative fact: do not configure the extraction to silently report false for unestablished information. Prefer the Selector types above.

## Production mapping

Use this JSON as the value of `RETELL_EXTRACTION_FIELDS` after deploying the updated code. It contains field names only, no secrets. It assumes you created the names above exactly. If you rename any Retell machine field, change the corresponding value here.

```json
{"caller_name":"caller_name","phone_number":"phone_number","preferred_language":"preferred_language","reason_for_contact":"reason_for_contact","location":"location","questionnaire_answers":"questionnaire_answers","unresolved_need":"unresolved_need","human_requested":"human_requested","emergency_guidance_provided":"emergency_guidance_provided","automation_resolved_request":"automation_resolved_request","safety_context_signals":"safety_context_signals","requested_service":"requested_service","location_zone":"location_zone","immediate_danger":"immediate_danger","medical_need":"medical_need","mobility_limitation":"mobility_limitation","medical_equipment_dependency":"medical_equipment_dependency","affected_by_active_crisis":"affected_by_active_crisis","unable_to_self_evacuate":"unable_to_self_evacuate","no_transportation_available":"no_transportation_available","person_unresponsive":"person_unresponsive","person_trapped":"person_trapped","power_disruption":"power_disruption"}
```

Mapping `requested_service` explicitly enables the native structured Disaster contract. Without it, the original Boolean/JSON-string contract continues to work, including its strict required-outcome validation. Clinic continues to use its existing adapter behavior. Do not change deployment mode to Clinic for this follow-up.

The new mapping deliberately omits old `facility_signals`, `need_category`, `immediate_life_threat` and `possible_danger` extraction fields: the new explicit facts/service derive the applicable existing signal keys, and the engine calculates priority. Legacy deployments may continue using their explicit structured fields; no keyword matching was introduced for either contract.

## Exact mapping to the existing rulebook

These are adapter gates for existing rule meanings. All points still live only in `config/rulebooks/index.ts`.

| Confirmed structured facts | Existing signal/input |
| --- | --- |
| Immediate danger yes | `immediate_life_threat` → engine hard Priority 0 |
| Emergency-services guidance yes | `agentOutcome=directed_to_911` → engine hard Priority 0 |
| Current shelter/evacuation request + affected by active crisis yes + unresolved yes | `urgent_evacuation_shelter` |
| Mobility limitation yes + unable to self-evacuate yes + affected by active crisis yes | `mobility_vulnerability` |
| No transportation yes + unable to self-evacuate yes + affected by active crisis yes | `no_transportation` |
| Powered medical equipment dependency yes + power disruption yes | `medical_equipment_dependency` |
| Welfare-check request + person unresponsive yes | `welfare_check_needed` |
| Person trapped yes | `person_trapped`; this alone does not invent an immediate-life-threat fact |
| Outage information request + unresolved yes | `info_unresolved` |
| Explicit location zone | Existing context points; displacement alone never chooses a zone |
| Unresolved yes / human yes | Existing `could_not_resolve` / `caller_requested_human`, with unresolved taking precedence |
| Automation resolved yes, unresolved no, human no | Existing `resolved` adjustment; never automatically closes the case |

A generic medical need has no generic severity rule in the current Disaster rulebook. It is recorded and flagged for review rather than assigned an invented weight. `medical_assistance` uses existing category `other`, or `medical_equipment` when powered equipment dependency is established. A transportation request uses existing category `mobility_issue` for compatibility, while its raw requested service remains explicit in the questionnaire; it does not assert a medical mobility limitation. A welfare-check request alone does not claim an unresponsive person. All requested service categories are retained as structured intake answers.

## Fallback, history and verification

- Native selectors are yes/no/unknown; missing/invalid values stay unknown. Ingested cases retain original free-text context and display an operator-review notice whenever required facts/classification are uncertain. A single unknown field does not discard confirmed emergency guidance or other known facts.
- Outcome uncertainty is stored as null in Retell outcome metadata, not false. Structured answers retain `unknown`, survive persistence and remain available in existing Caller Detail. Contradictory resolved/follow-up facts are flagged; unresolved/human facts take precedence. Unknown unresolved/human state never earns a resolved-request discount.
- Complete native facts can coexist with retained free-text context without being labelled incomplete merely because that fallback text exists. Invalid legacy safety JSON is retained with a review flag under the native contract.
- Real production test calls were verified by the user before this follow-up; no extra paid calls, provider configuration edits, production data changes or automatic replay were performed here. Existing historical records stay unchanged.
- Retell signatures, allowed agent, operator access, encryption, idempotency, repeat merging and human override safeguards are unchanged. No database migration, UI redesign, priority weights/thresholds, Twilio, SMS or later task is included.

After deployment/configuration, use fresh calls:

1. Safe displaced family requesting shelter, explicitly affected by the current wildfire, unresolved need yes, no emergency guidance. The existing rules give shelter 30 plus unresolved 15 = **45** before any established physical-zone context. A stated `affected_area` adds 8 = **53**. Both are Priority 2; neither is Priority 0. If the caller is currently outside the area or their zone is unknown, do not manufacture the extra context points.
2. Approaching fire with a neighbor unable to evacuate. Inspect the facts actually collected. Reported emergency-services guidance must still produce hard Priority 0 and Awaiting Callback, regardless of score. Missing other facts should flag review, not erase that escalation.
3. An incomplete test with no confirmed category/medical/mobility information should preserve unknowns, free-text details and operator-review status, without inventing medical severity or a location zone.

Check the questionnaire, Why this priority?, provider timeline and reload persistence. Existing successful call IDs will be ignored as duplicates; use a new call for each scenario.

Implementation validation: **177 tests passed, 0 failed** (146 existing tests plus 31 new regressions), TypeScript passed, lint passed without warnings/errors, and an isolated production build passed. The original Priority/Matching Engines and configured weights/thresholds are unchanged. No production agent settings, deployment, environment values or historical cases were changed automatically.
