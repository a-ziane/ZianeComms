'use client';
import {createContext,useContext,useEffect,useState,useCallback,useRef,type ReactNode} from 'react';
import {newOrganization,DEFAULT_ORGANIZATION,type OrganizationConfig,type OrganizationRecord} from '@/lib/organization/model';
import {PublicOrganizationProvider} from './PublicOrganizationProvider';
import {deviceStore} from '@/lib/offline/storage';
interface PendingWrite {id:string;revision:number;commandId:string;operation:'create'|'save'|'activate';config:OrganizationConfig}
export interface ContextValue {
 publicDemo?:boolean;
 records:OrganizationRecord[];selectedId:string;select:(id:string)=>void;record:OrganizationRecord|undefined;draft:OrganizationConfig|undefined;
 edit:(config:OrganizationConfig)=>void;save:(activate?:boolean)=>Promise<boolean>;create:(dental:boolean)=>Promise<void>;
 reload:()=>Promise<void>;discard:()=>Promise<void>;error:string;busy:boolean;dirty:boolean;integrations:Record<string,string>;pending:boolean;
}
export const Context=createContext<ContextValue|null>(null);
const SELECTION='ziane-selected-organization';
export function OrganizationProvider({children,publicDemo=false}:{children:ReactNode;publicDemo?:boolean}){
 return publicDemo?<PublicOrganizationProvider>{children}</PublicOrganizationProvider>:<PrivateOrganizationProvider>{children}</PrivateOrganizationProvider>;
}
function PrivateOrganizationProvider({children}:{children:ReactNode}){
 const [records,setRecords]=useState<OrganizationRecord[]>([]),[selectedId,setSelectedId]=useState(DEFAULT_ORGANIZATION),[draft,setDraft]=useState<OrganizationConfig>();
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[integrations,setIntegrations]=useState<Record<string,string>>({});
 const [pending,setPending]=useState(false);const operation=useRef<PendingWrite>();const draftRef=useRef(draft);const revision=useRef(0);
 const record=records.find(r=>r.id===selectedId);
 const reload=useCallback(async()=>{
  try{const response=await fetch('/api/organization',{cache:'no-store'});if(!response.ok)throw Error('Organization configuration unavailable. Check operator access, connection and migrations.');const data=await response.json();setRecords(data.records);setIntegrations(data.integrations);setError('');}
  catch(e){setError((e as Error).message);}
 },[]);
 useEffect(()=>{setSelectedId(localStorage.getItem(SELECTION)??DEFAULT_ORGANIZATION);void reload();},[reload]);
 useEffect(()=>{
  let mounted=true;
  if(!record){setDraft(undefined);draftRef.current=undefined;setDirty(false);return;}
  revision.current=record.revision;const remote=structuredClone(record.draft);setDraft(remote);draftRef.current=remote;setDirty(false);
  void deviceStore.get<{revision:number;config:OrganizationConfig}>(`organization-draft:${record.id}`).then(local=>{
   if(!mounted||!local)return;
   if(local.revision===record.revision){setDraft(local.config);draftRef.current=local.config;setDirty(JSON.stringify(local.config)!==JSON.stringify(record.draft));}
   else if(JSON.stringify(local.config)!==JSON.stringify(record.draft))setError('An older local draft exists. Server configuration was retained; review before making changes.');
  }).catch(()=>setError('Device draft cache unavailable. Use Save draft before refreshing.'));
  return()=>{mounted=false;};
 },[record]);
 const select=useCallback((id:string)=>{if(operation.current){setError('Resolve the pending save before switching organization.');return;}localStorage.setItem(SELECTION,id);setSelectedId(id);},[]);
 const edit=useCallback((next:OrganizationConfig)=>{
  if(operation.current)return;setDraft(next);draftRef.current=next;setDirty(true);
  void deviceStore.put(`organization-draft:${next.id}`,{revision:revision.current,config:next}).catch(()=>setError('Local draft cache failed. Save to the server before refreshing.'));
 },[]);
 const write=useCallback(async(body:PendingWrite):Promise<boolean>=>{
  setBusy(true);operation.current=body;setPending(true);
  try{const response=await fetch('/api/organization',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();
   if(!response.ok){if(response.status===400){operation.current=undefined;setPending(false);}throw Error(data.error||'Configuration save not confirmed.');}
   operation.current=undefined;setPending(false);await deviceStore.remove(`organization-draft:${body.id}`);setRecords(data.records);setIntegrations(data.integrations);setDirty(false);setError('');return true;
  }catch(e){setError((e as Error).message+' Your draft is retained; retry the same save or reload to review.');return false;}
  finally{setBusy(false);}
 },[]);
 const save=useCallback(async(activate=false)=>{
  if(operation.current)return write(operation.current);
  const current=draftRef.current;if(!current)return false;
  return write({id:current.id,revision:revision.current,commandId:crypto.randomUUID(),operation:activate?'activate':'save',config:current});
 },[write]);
 const discard=useCallback(async()=>{if(operation.current)await deviceStore.remove(`organization-draft:${operation.current.id}`);operation.current=undefined;setPending(false);await reload();},[reload]);
 const create=useCallback(async(dental:boolean)=>{if(operation.current)return;const id=`org-${crypto.randomUUID()}`;const config=newOrganization(id,dental);if(await write({id,revision:0,commandId:crypto.randomUUID(),operation:'create',config}))select(id);},[write,select]);
 useEffect(()=>{const protect=(event:BeforeUnloadEvent)=>{if(dirty||operation.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect);},[dirty]);
 return <Context.Provider value={{records,selectedId,select,record,draft,edit,save,create,reload,discard,error,busy,dirty,integrations,pending}}>{children}</Context.Provider>;
}
export function useOrganization(){const value=useContext(Context);if(!value)throw Error('Organization context missing');return value;}
export function OrganizationBar(){
 const o=useOrganization();
 return <section className="flex flex-wrap gap-3 items-center border border-slate-700 rounded-xl p-3 text-sm bg-[#131f33]">
  <label>Organization <select aria-label="Organization workspace" value={o.selectedId} className="ml-2 bg-slate-800 p-2 rounded max-w-64" onChange={e=>o.select(e.target.value)}><option value={DEFAULT_ORGANIZATION}>Working Disaster / Clinic demo</option>{o.records.map(r=><option key={r.id} value={r.id}>{r.active?.configuration.name||r.draft.name||'Untitled draft'}{r.active?` · Active v${r.active.version}`:' · Draft'}</option>)}</select></label>
  <a className="text-blue-300 underline" href={o.publicDemo?"/onboarding":"/operator/onboarding"}>Organization onboarding</a>
  {o.record&&<span className="text-xs text-slate-400">{o.dirty?'Unsaved draft changes':'Draft saved'} · {o.record.active?`Active v${o.record.active.version}`:'Not activated'}</span>}
  {o.error&&<p role="alert" className="w-full text-amber-300 text-xs">{o.error} <button className="underline" onClick={()=>void o.reload()}>Reload server configuration</button></p>}
 {o.pending&&<button className="text-xs underline text-amber-300" onClick={()=>{if(window.confirm('Discard the pending local save intention and reload server configuration? Already accepted versions stay in history.'))void o.discard();}}>Discard pending intention and review server state</button>}</section>;
}
