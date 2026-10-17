# ZianeComms — IBM Bob Development Log

This file tracks every task completed with IBM Bob's assistance.
It serves as an audit trail and handoff document for future developers.

---

## Task 1 — ZianeComms V1 Frontend

**Date:** 2025  
**Mode:** Agent  
**Status:** ✅ Complete

### What was built

A fully clickable V1 simulation of the ZianeComms operator experience — a missed-caller recovery and prioritization system.

### Architecture established

```
zianecomms/
├── app/
│   ├── layout.tsx          — Root Next.js layout (dark mode, metadata)
│   ├── page.tsx            — Main dashboard page (all state orchestration)
│   └── globals.css         — Tailwind base + dark scrollbars
├── components/
│   ├── Header.tsx          — Brand, system status, rulebook switcher, surge mode toggle
│   ├── MetricCards.tsx     — Four metric cards + recovery status bar
│   ├── CallbackQueue.tsx   — Ranked caller table (Tier 1→2→3, score desc)
│   ├── CallerDetailPanel.tsx — Slide-in panel: score breakdown, override, callback workflow
│   ├── SimulateMissedCall.tsx — Form to add a mock caller + live score preview
│   └── ResolvedSection.tsx — Closed/resolved callers display
├── data/
│   └── callers.ts          — Mock disaster + clinic caller datasets (pre-scored)
├── types/
│   └── index.ts            — All TypeScript interfaces (Caller, Rulebook, etc.)
├── lib/
│   └── scoring/
│       └── index.ts        — Deterministic scoring engine (no LLM/ML)
├── config/
│   └── rulebooks/
│       └── index.ts        — Disaster + Clinic rulebook configs (weights, tiers, thresholds)
└── docs/
    └── bob-log.md          — This file
```

### Features implemented

| Feature | Status |
|---|---|
| Operations Dashboard | ✅ |
| Callback Queue (ranked, Tier 1→3, score desc) | ✅ |
| Caller Detail Panel with score breakdown | ✅ |
| Manual priority override | ✅ |
| Callback workflow (Awaiting → Calling → Outcome) | ✅ |
| Simulate Missed Call form with live score preview | ✅ |
| Disaster / Clinic rulebook switching | ✅ |
| Surge Mode toggle | ✅ |
| Resolved callers section | ✅ |
| Dashboard metrics (Abandoned, Recovered, Critical, Awaiting) | ✅ |
| "Nobody Gets Forgotten" recovery status bar | ✅ |

### Mock datasets

**Disaster callers (6):**
- Maria Gonzalez — Oxygen equipment, Tier 1, score 95
- Robert Tran — Welfare check / neighbor, Tier 1, score 72
- Carlos Mendoza — Wildfire shelter (Spanish), Tier 2, score 55
- Sarah Chen — Evacuation zone confirmation, Tier 2, score 40
- John Harrington — Power restoration timeline, Tier 3, score 28
- David Okafor — General disaster info, Tier 3, score 12

**Clinic callers (6):**
- Patricia Wells — Chest tightness / cardiac concern, Tier 1, score 88
- Ahmed Hassan — Allergic reaction / anaphylaxis risk, Tier 1, score 75
- Linda Kowalski — Cardiac medication refill authorization, Tier 2, score 45
- James Okoro — New patient, persistent headaches, Tier 2, score 32
- Diane Moreau — Routine appointment reschedule (French), Tier 3, score 14
- Terry Sullivan — Billing inquiry, Tier 3, score 8

### Design principles enforced

1. **Everyone gets contacted** — priority = order, not eligibility
2. **Humans in control** — manual tier override with override flag displayed
3. **Explainable scores** — every score has a named breakdown (no AI black box)
4. **Modular for V2** — all mock data, scoring, and rulebook config are separated from UI

### Not implemented in V1 (by design)

- FastAPI / Python backend
- Supabase / PostgreSQL
- Retell AI telephony
- Twilio SMS
- Authentication
- LLM / AI scoring
- Real phone calls or SMS

---

## Task 2 — Configurable Priority Engine

**Date:** 2025
**Mode:** Agent
**Status:** ✅ Complete

### What was built

A generic, deterministic, configurable priority scoring engine running entirely in TypeScript — no LLM, no ML, no external services.

### Architecture changes

```
lib/
├── engine/
│   ├── index.ts          — Generic 5-category priority engine + override + repeat-caller helpers
│   └── engine.test.ts    — 11 automated unit tests (all passing)
├── customerFit/
│   └── index.ts          — Customer Fit engine (separate from urgency — clinic V1)
└── scoring/
    └── index.ts          — Thin re-export wrapper (backward compat)

config/
├── engine.ts             — Global thresholds, category caps, hard-escalation rules
└── rulebooks/
    └── index.ts          — DISASTER + CLINIC rulebooks (full 5-category config)
```

### Engine architecture

```
PriorityScore = Facility Signals (need severity)
              + Context (zone proximity — capped at 25)
              + Access Difficulty (attempts, wait — CAPPED AT 15)
              + Agent Outcome (automation result — ±20 max)

Hard escalation → Priority 0 immediately (bypasses score thresholds)
Score ≥ 70 → Priority 1
Score ≥ 35 → Priority 2
Score < 35 → Priority 3
```

### Key design decisions

| Decision | Why |
|---|---|
| Access Difficulty capped at 15 | Prevents persistence signal from overpowering genuine safety need |
| Hard escalation stored alongside score | Caller stays in queue; full audit trail preserved |
| `calculatedPriority` never overwritten | Human override co-exists with engine output |
| Customer Fit is entirely separate | Prevents commercial value from influencing safety ranking |
| Thresholds in `config/engine.ts` | Not scattered in UI — admin-editable in future |
| Rulebook contains all config | Generic engine reads it — zero business logic in the engine itself |

### Disasters rulebook signals

| Signal | Points | Notes |
|---|---|---|
| `immediate_life_threat` | Hard escalation | Priority 0, bypass score |
| `medical_equipment_dependency` | +50 | Powered medical equipment |
| `person_trapped` | +50 | Physical entrapment |
| `mobility_vulnerability` | +40 | Crisis + mobility limitation |
| `welfare_check_needed` | +35 | Unresponsive person |
| `urgent_evacuation_shelter` | +30 | Displacement need |
| `no_transportation` | +20 | Cannot self-evacuate |
| `service_problem_human_needed` | +20 | Automation failed |
| `info_unresolved` | +10 | Information gap |
| `non_english_speaker` | +8 | Language access signal |

### Clinic rulebook signals (⚠️ demo weights — not medically validated)

| Signal | Points |
|---|---|
| `immediate_life_threat` | Hard escalation |
| `severe_symptoms` | +48 |
| `severe_pain` | +45 |
| `swelling_allergic` | +42 |
| `prescription_urgent` | +28 |
| `new_patient_urgent` | +20 |
| `appointment_reschedule` | +5 |
| `billing_inquiry` | +2 |

### Test results

```
 ✓ lib/engine/engine.test.ts (11 tests) 12ms
   ✓ 1. life-threatening signal → Priority 0 hard escalation
   ✓ 2. agent directed to 911 → Priority 0, caller not removed
   ✓ 3. medical equipment + affected zone → Priority 1 or above with high score
   ✓ 4. routine request + many attempts → attempts boost but can't overpower safety cases
   ✓ 5. agent resolved request → score reduction applied
   ✓ 6. repeat caller with escalated signal → higher priority
   ✓ 7. human override preserves calculated priority alongside new priority
   ✓ 8. clinic severe symptoms outranks appointment and billing
   ✓ 9. customer fit score is independent of urgency priority
   ✓ 10. same input produces different scores under different rulebooks
   ✓ access difficulty total never exceeds 15 regardless of input
```

### UI connections

- "Why this priority?" section now renders real engine output with category badges (facility / context / access / agentOutcome)
- Hard escalation callers show a pulsing red ⚠ HARD ESCALATION banner
- Human override shows purple context block with original calculated priority visible
- Customer Fit score displayed in Caller Detail modal (clinic callers only) with explicit note that it does not affect urgency priority

### Future learning — data structure prepared

Every scoring event, override, and outcome is stored in `activityLog` with enough detail to later:
- Analyze which callers responders choose first
- Surface patterns in human overrides
- Suggest rule weight adjustments (administrator-approved only)

### Not implemented (by design)

- LLM / ML scoring
- Real geographic zone lookup (mocked via `locationZone` enum — interface ready for real geo data)
- Administrator UI for editing rulebook weights
- Learning/suggestion system

---

## Upcoming — V3 Tasks (not yet started)

- [ ] Connect FastAPI backend
- [ ] Supabase caller persistence
- [ ] Retell AI inbound call integration
- [ ] Twilio two-way SMS recovery
- [ ] LLM structured extraction of caller needs → feeds engineInput.facilitySignals
- [ ] Authentication (operator login)
- [ ] Offline / fallback behavior
- [ ] Administrator UI for rulebook weight editing
- [ ] Geographic zone lookup (replace mocked locationZone)
- [ ] Learning suggestion system (analyze override patterns → suggest rule changes)
- [ ] Multi-line / multi-agent support
