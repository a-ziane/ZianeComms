import {QUESTION_DEFAULTS,SCOPE,type OrganizationConfig,type Suggestion} from './model';
export function questionnaireSuggestion(config:OrganizationConfig,id:string):Suggestion{
 return {id,kind:'questionnaire',status:'pending',questions:structuredClone(QUESTION_DEFAULTS[config.rulebook])};
}
export function knowledgeSuggestion(config:OrganizationConfig,id:string):Suggestion{
 const topic=config.rulebook==='clinic'?'Prescription hours and contact policy':'Verified evacuation guidance';
 return {id,kind:'knowledge',status:'pending',item:{id:`knowledge-${id}`,title:topic,content:'Add verified organization information here before approving. This template contains no verified service or emergency information.',status:'ai_suggestion',updatedAt:new Date().toISOString(),source:'Demo gap suggestion — deterministic template, no model call'}};
}
export function reviewSuggestion(config:OrganizationConfig,id:string,accept:boolean):OrganizationConfig{
 const next=structuredClone(config),suggestion=next.suggestions.find(s=>s.id===id);if(!suggestion||suggestion.status!=='pending')return next;
 suggestion.status=accept?'accepted':'rejected';
 if(accept&&suggestion.kind==='questionnaire'&&suggestion.questions){
  const scope=SCOPE(next.deploymentId,next.rulebook),current=next.questionnaires[scope];
  next.questionnaires[scope]=[...current.map(q=>suggestion.questions!.find(x=>x.id===q.id)??q),...suggestion.questions.filter(q=>!current.some(x=>x.id===q.id))];
 }
 if(accept&&suggestion.item)next.knowledge.push({...suggestion.item,status:'draft'});
 return next;
}
