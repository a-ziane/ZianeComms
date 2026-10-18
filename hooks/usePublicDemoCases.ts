'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {caseReducer,synchronizeWorkload,type CaseAction,type CaseState} from '@/lib/cases';
import {applyOperationalCommand} from '@/lib/persistence/commands';
import {deviceStore,withDeviceLock} from '@/lib/offline/storage';
import {publicDemoState,PUBLIC_CASE_KEY} from '@/data/public-demo';
import {useOrganization} from '@/components/organization/OrganizationProvider';
// This adapter never calls a server or reads the private operator cache.
export function usePublicDemoCases(enabled:boolean){
 const o=useOrganization();
 const [state,setState]=useState<CaseState>(publicDemoState),[hasLoaded,setLoaded]=useState(false),[error,setError]=useState('');
 const current=useRef(state);
 const [status,setStatus]=useState<'loading'|'ready'|'saving'|'error'|'offline'>('loading');
 const reload=useCallback(async()=>{
  if(!enabled)return;
  try{const saved=await deviceStore.get<CaseState>(PUBLIC_CASE_KEY);const next=saved??publicDemoState();current.current=next;setState(next);setLoaded(true);setStatus('ready');setError('');}
  catch{setError('Demo device storage unavailable. Changes cannot be saved.');setStatus('error');}
 },[enabled]);
 useEffect(()=>{void reload();},[reload]);
 useEffect(()=>{
  if(!enabled||!hasLoaded)return;
  const config=publicDemoState(o.records);
  const next=synchronizeWorkload({...current.current,activeOrganizations:config.activeOrganizations,responders:[...(current.current.responders??[]).filter(r=>!r.organizationId),...o.records.flatMap(r=>r.active?.configuration.responders??[])]});
  current.current=next;setState(next);
 },[enabled,hasLoaded,o.records]);
 const dispatch=useCallback((action:CaseAction)=>{
  if(!enabled||!hasLoaded)return;
  void withDeviceLock('public-demo',async()=>{
   try{
    const next=action.type==='switch_mode'?caseReducer(current.current,action):applyOperationalCommand(current.current,action,new Date().toISOString());
    await deviceStore.put(PUBLIC_CASE_KEY,next);current.current=next;setState(next);setError('');setStatus('ready');
   }catch(e){setError(`Demo change not saved: ${(e as Error).message}`);setStatus('error');}
  });
 },[enabled,hasLoaded]);
 return {state,dispatch,status,error,reload,retry:reload,cancelPending:reload,hasLoaded,hasPending:false,pendingCount:0,lastSync:'',conflict:false,online:true};
}
