'use client';
import {useState,useEffect,useCallback,type ReactNode} from 'react';
import {Context,type ContextValue} from './OrganizationProvider';
import {newOrganization,validateConfig,activationIssues,publishableConfig,type OrganizationConfig,type OrganizationRecord} from '@/lib/organization/model';
import {publicDemoOrganizations,ZIANE_ORG,PUBLIC_ORG_KEY,PUBLIC_SELECTION_KEY} from '@/data/public-demo';
import {deviceStore} from '@/lib/offline/storage';
export function PublicOrganizationProvider({children}:{children:ReactNode}){
 const [records,setRecords]=useState<OrganizationRecord[]>(publicDemoOrganizations),[selectedId,setSelectedId]=useState(ZIANE_ORG),[draft,setDraft]=useState<OrganizationConfig>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const record=records.find(r=>r.id===selectedId);
 const reload=useCallback(async()=>{
  try{setRecords(await deviceStore.get<OrganizationRecord[]>(PUBLIC_ORG_KEY)??publicDemoOrganizations());setError('');}
  catch{setError('Demo device storage unavailable.');}
 },[]);
 useEffect(()=>{setSelectedId(localStorage.getItem(PUBLIC_SELECTION_KEY)??ZIANE_ORG);void reload();},[reload]);
 useEffect(()=>{setDraft(record?structuredClone(record.draft):undefined);},[record]);
 const select=(id:string)=>{localStorage.setItem(PUBLIC_SELECTION_KEY,id);setSelectedId(id);};
 const persist=async(next:OrganizationRecord[])=>{await deviceStore.put(PUBLIC_ORG_KEY,next);setRecords(next);};
 const save=async(activate=false)=>{
  if(!draft)return false;setBusy(true);
  try{
   const c=validateConfig(draft,draft.id);
   if(activate&&activationIssues(c).length)throw Error(activationIssues(c).join(' · '));
   const version=(record?.active?.version??0)+1,activatedAt=new Date().toISOString();
   const next:OrganizationRecord={id:c.id,revision:(record?.revision??0)+1,draft:c,active:activate?{version,activatedAt,configuration:publishableConfig(c)}:record?.active??null,history:activate?[...(record?.history??[]),{version,activatedAt}]:record?.history??[]};
   await persist([...records.filter(r=>r.id!==c.id),next]);setError('');return true;
  }catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}
 };
 const create=async(dental:boolean)=>{
  setBusy(true);try{const id=`org-${crypto.randomUUID()}`,config=newOrganization(id,dental);await persist([...records,{id,revision:1,draft:config,active:null,history:[]}]);select(id);setError('');}catch{setError('Demo organization could not be saved on this device.');}finally{setBusy(false);}
 };
 const value:ContextValue={publicDemo:true,records,selectedId,select,record,draft,edit:setDraft,save,create,reload,discard:reload,error,busy,dirty:JSON.stringify(draft)!==JSON.stringify(record?.draft),integrations:{voice:'Public demo — no provider calls',recovery_chat:'Public demo — no provider calls',sms:'Public demo — no messages sent'},pending:false};
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
