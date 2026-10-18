'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {deviceStore,withDeviceLock,type DeviceStore} from '@/lib/offline/storage';
import {pendingHelp,saveHelp,syncHelp} from '@/lib/offline/queue';
import {PRODUCT_KEY,PRODUCT_PREFIX,initialWorkspace,offlineScenario,receiveOffline,type ProductWorkspace} from '@/lib/product/workspace';
import {useConnectivity} from './useConnectivity';
import type {HelpRequest} from '@/lib/help/intake';
const demoQueue:DeviceStore={get:<T,>(key:string)=>deviceStore.get<T>(PRODUCT_PREFIX+key),put:(key,value)=>deviceStore.put(PRODUCT_PREFIX+key,value),remove:key=>deviceStore.remove(PRODUCT_PREFIX+key)};
export function useProductWorkspace(){
 const [workspace,setWorkspace]=useState(initialWorkspace),[ready,setReady]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<HelpRequest[]>([]),[localOffline,setLocalOffline]=useState(false);
 const current=useRef(workspace),serial=useRef(Promise.resolve());const network=useConnectivity();const online=network.online&&!localOffline;
 const commit=useCallback(async(update:(w:ProductWorkspace)=>ProductWorkspace)=>{
  let failure:unknown;
  serial.current=serial.current.then(()=>withDeviceLock('product-demo',async()=>{
   try{const saved=await deviceStore.get<ProductWorkspace>(PRODUCT_KEY);const next=update(saved??current.current);await deviceStore.put(PRODUCT_KEY,next);current.current=next;setWorkspace(next);setError('');}catch(e){failure=e;setError((e as Error).message);}
  }));await serial.current;if(failure)throw failure;
 },[]);
 useEffect(()=>{let alive=true;void(async()=>{try{const saved=await deviceStore.get<ProductWorkspace>(PRODUCT_KEY);if(alive){current.current=saved??initialWorkspace();setWorkspace(current.current);setPending(await pendingHelp(demoQueue));setReady(true);}}catch{if(alive)setError('Device storage unavailable. Demo changes cannot be saved.');}})();return()=>{alive=false;};},[]);
 const synchronize=useCallback(async()=>{
  if(!online)return;
  try{await withDeviceLock('product-help',()=>syncHelp(demoQueue,async request=>{
   // Same durable queue, isolated demonstration receiver. Never sends synthetic requests to production.
   await commit(w=>receiveOffline(w,request,new Date().toISOString()));return {acknowledged:true,requestId:request.id};
  },()=>network.online&&!localOffline));setPending(await pendingHelp(demoQueue));}catch(e){setError((e as Error).message);}
 },[online,commit,network.online,localOffline]);
 useEffect(()=>{if(ready&&online)void synchronize();},[ready,online,synchronize]);
 const saveOffline=async()=>{
  try{const request=offlineScenario(new Date().toISOString(),crypto.randomUUID());await withDeviceLock('product-help',()=>saveHelp(demoQueue,request));setPending(await pendingHelp(demoQueue));if(online)await synchronize();}catch(e){setError((e as Error).message);}
 };
 return {workspace,commit,ready,error,pending,online,localOffline,setLocalOffline,saveOffline,synchronize};
}
