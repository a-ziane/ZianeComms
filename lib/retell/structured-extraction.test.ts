import { describe, expect, it } from 'vitest';
import { LEGACY_EXTRACTION_CONCEPTS, EXTRACTION_CONCEPTS, parseExtractionMap, type ExtractionMap } from '@/config/retell';
import { DISASTER_FACT_FIELDS } from './disaster-facts';
import { normalizeRetell } from './normalize';
import { buildRetellCase } from './ingest';
import { scoreCallerInput } from '@/lib/engine';
import { serializeCase, deserializeCase } from '@/lib/persistence/mapping';
import type { CaseState } from '@/lib/cases';

const mapping = Object.fromEntries(EXTRACTION_CONCEPTS.map(k=>[k,`native_${k}`])) as ExtractionMap;
const state:CaseState={rulebook:'disaster',callersByMode:{disaster:[],clinic:[]},responders:[]};
const timestamp=Date.parse('2026-10-17T19:00:00Z');
function payload(changes:Record<string,unknown>={}) {
  const fields:Record<string,unknown>={...Object.fromEntries(DISASTER_FACT_FIELDS.map(k=>[k,'no'])),
    requested_service:'shelter',affected_by_active_crisis:'yes',location_zone:'affected_area',
    human_requested:'yes',unresolved_need:'yes',automation_resolved_request:'no',emergency_guidance_provided:'no',
    caller_name:'Synthetic structured caller',preferred_language:'English',location:'Stated affected district',
    reason_for_contact:'Displaced family requesting shelter; currently safe.',phone_number:'+12025550188',
    safety_context_signals:'Family displaced by wildfire. Currently safe; no medical or mobility need.',...changes};
  return {event:'call_analyzed',call:{call_id:'structured_fixture',agent_id:'fixture_agent',call_type:'web_call',call_status:'ended',
    start_timestamp:timestamp,end_timestamp:timestamp+60000,call_analysis:{call_summary:'Synthetic extraction test.',
      custom_analysis_data:Object.fromEntries(Object.entries(fields).map(([k,v])=>[`native_${k}`,v]))}}};
}
const intake=(changes:Record<string,unknown>={})=>normalizeRetell(payload(changes),'disaster',mapping);
const scored=(changes:Record<string,unknown>={})=>scoreCallerInput(intake(changes).input);

describe('Native structured Disaster extraction contract',()=>{
  it('keeps deployment mapping explicit and validates the expanded map',()=>{
    expect(parseExtractionMap(JSON.stringify(mapping))).toEqual(mapping);
    const different={...mapping,requested_service:'actual_provider_service_field'};
    const p=payload();p.call.call_analysis.custom_analysis_data.actual_provider_service_field='evacuation';
    expect(normalizeRetell(p,'disaster',different).input.needCategory).toBe('evacuation');
  });
  it('scores the safe displaced shelter family using existing shelter/context/outcome rules',()=>{
    const n=intake(),r=scoreCallerInput(n.input);
    expect(n.input.needCategory).toBe('shelter');expect(n.input.facilitySignals).toEqual(['urgent_evacuation_shelter']);
    expect(r.breakdown.map(b=>b.points)).toEqual([30,8,15]);expect(r.score).toBe(53);expect(r.priority).toBe(2);expect(r.hardEscalation).toBe(false);
    expect(n.analysisPending).toBe(false);expect(n.questionnaire.find(q=>q.question.includes('Mobility limitation'))?.answer).toBe('no');
    expect(n.questionnaire.find(q=>q.question==='Safety/context signals (unstructured)')?.answer).toContain('Family displaced');
  });
  it('does not infer that a displaced family is physically inside an affected area',()=>{
    const n=intake({location_zone:'outside'});expect(n.input.locationZone).toBe('outside');expect(scoreCallerInput(n.input).score).toBe(45);
    const unknown=intake({location_zone:undefined});expect(unknown.input.locationZone).toBe('unknown');expect(unknown.analysisPending).toBe(true);
    expect(scoreCallerInput(unknown.input).breakdown.some(b=>b.category==='context')).toBe(false);
  });
  it.each(['shelter','evacuation'] as const)('maps confirmed current crisis %s service to the existing signal',service=>{
    expect(intake({requested_service:service}).input.facilitySignals).toContain('urgent_evacuation_shelter');
    expect(intake({requested_service:service,affected_by_active_crisis:'unknown'}).input.facilitySignals).not.toContain('urgent_evacuation_shelter');
    expect(intake({requested_service:service,unresolved_need:'unknown'}).input.facilitySignals).not.toContain('urgent_evacuation_shelter');
    expect(intake({requested_service:service,unresolved_need:'no',automation_resolved_request:'yes',human_requested:'no'}).input.facilitySignals).not.toContain('urgent_evacuation_shelter');
  });
  it('keeps the approaching-fire/mobility/emergency-guidance case hard Priority 0 and active',()=>{
    const n=intake({requested_service:'evacuation',immediate_danger:'yes',mobility_limitation:'yes',unable_to_self_evacuate:'yes',
      emergency_guidance_provided:'yes',location_zone:'near_danger'});
    const c=buildRetellCase(state,n,{call:null,targetIdentity:null},null).caller;
    expect(c.calculatedPriority).toBe(0);expect(c.hardEscalation).toBe(true);expect(c.status).toBe('awaiting_callback');
    expect(c.engineInput?.facilitySignals).toEqual(expect.arrayContaining(['immediate_life_threat','mobility_vulnerability','urgent_evacuation_shelter']));
    expect(c.activityLog.some(e=>e.type==='told_call_911')).toBe(true);
  });
  it('maps confirmed immediate life danger even when guidance/outcome extraction is missing',()=>{
    const n=intake({immediate_danger:true,emergency_guidance_provided:undefined,unresolved_need:undefined,human_requested:undefined,automation_resolved_request:undefined});
    expect(n.analysisPending).toBe(true);expect(scoreCallerInput(n.input).priority).toBe(0);
    const c=buildRetellCase(state,n,{call:null,targetIdentity:null},null).caller;
    expect(c.retell?.outcomes?.emergencyGuidanceProvided).toBeNull();expect(c.retell?.outcomes?.unresolvedNeed).toBeNull();
  });
  it.each(['unknown',undefined,null,'possibly',0,'false'])('does not guess immediate life threat from uncertain/invalid value %s',value=>{
    const n=intake({immediate_danger:value,safety_context_signals:'fire danger 911 oxygen wheelchair trapped evacuation'});
    expect(scoreCallerInput(n.input).hardEscalation).toBe(false);expect(n.analysisPending).toBe(true);
    expect(n.input.facilitySignals).not.toContain('immediate_life_threat');
  });
  it('records medical need without inventing a generic medical severity weight',()=>{
    const n=intake({requested_service:'medical_assistance',medical_need:'yes'});
    expect(n.input.needCategory).toBe('other');expect(n.input.facilitySignals).toEqual([]);expect(n.analysisPending).toBe(true);
    expect(n.questionnaire.find(q=>q.question==='Structured intake — Medical need')?.answer).toBe('yes');
    expect(scoreCallerInput(n.input).score).toBe(23);
  });
  it('requires confirmed power disruption before asserting equipment-at-risk severity',()=>{
    const n=intake({requested_service:'medical_assistance',medical_need:'yes',medical_equipment_dependency:'yes',power_disruption:'yes'});
    expect(n.input.needCategory).toBe('medical_equipment');expect(n.input.facilitySignals).toEqual(['medical_equipment_dependency']);expect(scoreCallerInput(n.input).score).toBe(73);
    expect(intake({medical_equipment_dependency:'yes',power_disruption:'unknown'}).input.facilitySignals).not.toContain('medical_equipment_dependency');
  });
  it('requires mobility, inability to evacuate and crisis context before mapping vulnerability',()=>{
    const fields={requested_service:'transportation',mobility_limitation:'yes',unable_to_self_evacuate:'yes'};
    expect(intake(fields).input.facilitySignals).toContain('mobility_vulnerability');
    for(const change of [{mobility_limitation:'unknown'},{unable_to_self_evacuate:'no'},{affected_by_active_crisis:'unknown'}]){
      expect(intake({...fields,...change}).input.facilitySignals).not.toContain('mobility_vulnerability');
    }
  });
  it('maps transportation without equating it to a medical mobility limitation',()=>{
    const n=intake({requested_service:'transportation',no_transportation_available:'yes',unable_to_self_evacuate:'yes',mobility_limitation:'no'});
    expect(n.input.needCategory).toBe('mobility_issue');expect(n.input.facilitySignals).toEqual(['no_transportation']);expect(scoreCallerInput(n.input).score).toBe(43);
    expect(intake({requested_service:'transportation'}).input.facilitySignals).toEqual([]);
  });
  it('does not equate every welfare check with an unresponsive person',()=>{
    expect(intake({requested_service:'welfare_check'}).input.facilitySignals).toEqual([]);
    expect(intake({requested_service:'welfare_check',person_unresponsive:'unknown'}).analysisPending).toBe(true);
    expect(intake({requested_service:'welfare_check',person_unresponsive:'yes'}).input.facilitySignals).toEqual(['welfare_check_needed']);
  });
  it('maps unresolved outage information to the existing information rule',()=>{
    const n=intake({requested_service:'outage_information'});expect(n.input.needCategory).toBe('outage_information');
    expect(n.input.facilitySignals).toEqual(['info_unresolved']);expect(scoreCallerInput(n.input).score).toBe(33);
  });
  it('maps an explicit trapped-person fact without inventing immediate-life-threat certainty',()=>{
    const r=scored({requested_service:'other',person_trapped:'yes'});expect(r.score).toBe(73);expect(r.hardEscalation).toBe(false);
  });
  it.each(['medical','housing',undefined,'unknown'])('preserves unknown/unsupported requested service %s for review without guessing a category',value=>{
    const n=intake({requested_service:value,reason_for_contact:'Needs shelter and medical equipment'});
    expect(n.input.needCategory).toBe('other');expect(n.input.facilitySignals).toEqual([]);expect(n.analysisPending).toBe(true);
    expect(n.input.needDescription).toContain('shelter');
  });
  it('never interprets reason, location or unstructured safety keywords as structured facts',()=>{
    const n=intake({requested_service:'other',reason_for_contact:'oxygen evacuation shelter',location:'Active danger zone',
      safety_context_signals:'immediate_life_threat medical_equipment_dependency person_trapped no_transportation'});
    expect(n.input.facilitySignals).toEqual([]);expect(n.input.locationZone).toBe('affected_area');expect(scoreCallerInput(n.input).priority).not.toBe(0);
  });
  it('keeps partially extracted cases usable, marks review and preserves unstructured information',()=>{
    const n=intake({requested_service:undefined,immediate_danger:undefined,mobility_limitation:undefined,location_zone:'unknown',human_requested:undefined,
      emergency_guidance_provided:undefined,unresolved_need:undefined,automation_resolved_request:undefined});
    expect(n.input.agentOutcome).toBe('unknown');expect(n.input.needCategory).toBe('other');expect(n.analysisPending).toBe(true);
    const c=buildRetellCase(state,n,{call:null,targetIdentity:null},null).caller;
    expect(c.aiSummary).toContain('operator review');expect(c.retell?.outcomes?.humanRequested).toBeNull();
    expect(c.questionnaire.some(q=>q.answer.includes('Family displaced'))).toBe(true);
  });
  it('does not apply a resolved discount when unresolved/human state is unknown or contradictory',()=>{
    const unknown=intake({requested_service:'other',automation_resolved_request:'yes',unresolved_need:'unknown',human_requested:'no'});
    expect(unknown.input.agentOutcome).toBe('unknown');
    const conflicting=intake({automation_resolved_request:'yes'});expect(conflicting.input.agentOutcome).toBe('could_not_resolve');expect(conflicting.analysisPending).toBe(true);
    expect(intake({requested_service:'other',automation_resolved_request:true,unresolved_need:false,human_requested:false}).input.agentOutcome).toBe('resolved');
  });
  it('preserves malformed legacy safety text without losing valid native facts',()=>{
    const n=intake({safety_context_signals:'{broken legacy JSON'});expect(n.analysisPending).toBe(true);
    expect(n.input.facilitySignals).toEqual(['urgent_evacuation_shelter']);expect(n.questionnaire.some(q=>q.answer==='{broken legacy JSON')).toBe(true);
  });
  it('retains native intake answers, uncertainty, privacy and calculated explanations through existing serialization',()=>{
    const n=intake({location:'Call +12025550188',medical_need:'unknown'});
    const c=buildRetellCase(state,n,{call:null,targetIdentity:null},null).caller;
    const saved=deserializeCase(serializeCase(c));expect(saved.questionnaire).toEqual(c.questionnaire);expect(saved.scoreBreakdown).toEqual(c.scoreBreakdown);
    expect(saved.retell?.analysisPending).toBe(true);expect(JSON.stringify(saved)).not.toContain('+12025550188');
  });
  it('preserves legacy boolean/JSON integrations and does not apply Disaster fact mapping to Clinic',()=>{
    const legacy=Object.fromEntries(LEGACY_EXTRACTION_CONCEPTS.map(k=>[k,`native_${k}`])) as ExtractionMap;
    const old=payload({emergency_guidance_provided:false,human_requested:true,unresolved_need:true,automation_resolved_request:false,
      need_category:'shelter',location_zone:'affected_area',facility_signals:['urgent_evacuation_shelter']});
    expect(normalizeRetell(old,'disaster',legacy).input.facilitySignals).toEqual(['urgent_evacuation_shelter']);
    expect(normalizeRetell(old,'clinic',mapping).input.facilitySignals).toEqual([]);
  });
});
