'use client';
import {useEffect,useState} from 'react';
import {useOrganization,OrganizationBar} from './OrganizationProvider';
import {Editor,Intro,type EditorSection} from './Editors';
const STEPS:{section:EditorSection;title:string;description:string}[]=[
 {section:'organization',title:'Organization',description:'Who are you helping, and where?'},
 {section:'line',title:'Phone line / use case',description:'Set purpose, channels and expectations.'},
 {section:'questionnaire',title:'Agent Setup',description:'Review the questions callers will hear.'},
 {section:'knowledge',title:'Knowledge Base',description:'Approve only verified organization information.'},
 {section:'responders',title:'Responders',description:'Who can provide human follow-up?'},
 {section:'dispatch',title:'Priority / Dispatch',description:'Explain attention order and responder recommendations.'},
 {section:'deployment',title:'Deployment',description:'Review local language, location and offline capabilities.'},
 {section:'review',title:'Review & Activate',description:'Approve a configuration version without modifying the working agents.'},
];
export default function OnboardingWizard(){
 const o=useOrganization(),[step,setStep]=useState(0);
 useEffect(()=>{const stored=Number(localStorage.getItem(`onboarding-step:${o.selectedId}`)??0);setStep(Number.isInteger(stored)&&stored>=0&&stored<STEPS.length?stored:0);},[o.selectedId]);
 const move=async(next:number)=>{if(await o.save()){localStorage.setItem(`onboarding-step:${o.selectedId}`,String(next));setStep(next);}};
 return <main className="min-h-screen bg-[#0f1929] p-4 sm:p-8"><div className="max-w-5xl mx-auto space-y-6"><header className="flex justify-between items-center"><a href={o.publicDemo?"/":"/operator"} className="text-lg font-black">ZIANE<span className="text-blue-400">COMMS</span></a><a className="text-sm text-blue-300 underline" href={o.publicDemo?"/":"/operator"}>Return to operations</a></header><OrganizationBar/>{!o.draft?<Intro/>:<><div><p className="text-xs text-blue-300 font-semibold">ORGANIZATION ONBOARDING · DRAFT</p><h1 className="text-2xl sm:text-3xl font-bold mt-2">{o.draft.name||'Your organization'}</h1><p className="text-sm text-slate-400 mt-2">Create → configure → preview → approve → operate. Draft edits stay separate from active configuration.</p></div><ol className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2" aria-label="Onboarding progress">{STEPS.map((s,i)=><li key={s.section} aria-current={i===step?'step':undefined} className={`border rounded-lg p-2 text-xs ${i===step?'border-blue-500 bg-blue-900/40 text-white':'border-slate-700 text-slate-400'}`}><span className="font-bold">{i+1}.</span> {s.title}</li>)}</ol><div className="rounded-2xl border border-[#2a3650] bg-[#131f33] p-4 sm:p-6 space-y-5"><div><p className="text-xs text-blue-300">STEP {step+1} / {STEPS.length}</p><h2 className="text-xl font-bold mt-1">{STEPS[step].title}</h2><p className="text-sm text-slate-400 mt-1">{STEPS[step].description}</p></div><fieldset disabled={o.busy||o.pending} className="space-y-4 min-w-0"><Editor key={`${o.selectedId}:${step}`} section={STEPS[step].section}/></fieldset></div><footer className="flex items-center flex-wrap gap-4"><button className="border border-slate-600 px-4 py-2 rounded-lg disabled:opacity-30" disabled={step===0||o.busy||o.pending} onClick={()=>void move(step-1)}>Back</button><button disabled={o.busy} className="underline" onClick={()=>void o.save()}>{o.pending?'Retry pending save':'Save draft'}</button><span className="text-xs text-slate-400">{o.busy?'Saving…':o.publicDemo?(o.dirty?'Unsaved demo changes.':'Demo saved on this device.'):(o.dirty?'Draft retained on this device; save for Supabase synchronization.':'Draft saved in Supabase.')}</span>{step<STEPS.length-1&&<button disabled={o.busy||o.pending} className="ml-auto bg-blue-700 rounded-lg px-5 py-2 font-semibold disabled:opacity-30" onClick={()=>void move(step+1)}>Continue</button>}</footer></>}</div></main>;
}
