'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
interface Session {
 caseId:string;name:string;chatId?:string;beforePriority:number;calculatedPriority:number;effectivePriority:number;
 status:string;analyzed:boolean;opening:string;messages:{id:string;direction:'inbound'|'outbound';body:string}[];
}
export default function RecoveryChatDemo({caseId}:{caseId:string}){
 const [session,setSession]=useState<Session>();
 const [text,setText]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const locked=useRef(false);
 const pendingSend=useRef<{body:string;id:string}>();
 const request=useCallback(async(action?:string,content?:string)=>{
  if(locked.current)return;
  locked.current=true;if(action)setBusy(true);
  try{
   if(action==='send'&&pendingSend.current?.body!==content)pendingSend.current={body:content!,id:crypto.randomUUID()};
   const response=await fetch(action?'/api/recovery-chat':`/api/recovery-chat?caseId=${encodeURIComponent(caseId)}`,action?
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caseId,action,content,chatId:session?.chatId,requestId:action==='send'?pendingSend.current?.id:undefined})}:{cache:'no-store'});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Recovery is unavailable');
   setSession(result);setError('');if(action==='send'){setText('');pendingSend.current=undefined;}
  }catch(e){setError((e as Error).message);}finally{locked.current=false;setBusy(false);}
 },[caseId,session?.chatId]);
 useEffect(()=>{void request();},[request]);
 useEffect(()=>{
  if(!session?.chatId||session.analyzed)return;
  const timer=window.setInterval(()=>{if(!document.hidden)void request();},5000);
  return()=>window.clearInterval(timer);
 },[session?.chatId,session?.analyzed,request]);
 const complete=session?.status==='ended'||session?.status==='error';
 return <main className="min-h-screen bg-[#080f1c] text-slate-100 px-4 py-8">
  <div className="max-w-lg mx-auto space-y-5">
   <a href="/" className="text-sm text-cyan-300">← Back to operations</a>
   <header><h1 className="text-2xl font-bold">Recovery Chat</h1>
    <p className="mt-2 text-sm text-amber-200">Carrier simulated for hackathon demo. Real Retell conversation.</p>
    {session&&<p className="mt-3 text-sm text-slate-300">{session.name} · Calculated priority <strong>{session.beforePriority} → {session.calculatedPriority}</strong>
     {session.effectivePriority!==session.calculatedPriority&&<span> · Human override: Priority {session.effectivePriority}</span>}</p>}
   </header>
   <section aria-label="Recovery conversation" className="rounded-3xl border border-slate-700 bg-slate-900 overflow-hidden shadow-xl">
    <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
     <span className="font-semibold">ZianeComms</span><span className="text-xs text-slate-400">{complete?'Conversation complete':session?.chatId?'Chat active':'Ready to start'}</span>
    </div>
    <div aria-live="polite" role="log" aria-label="Chat messages" className="min-h-72 max-h-[55vh] overflow-y-auto px-4 py-5 space-y-4">
     {session?.opening&&<div className="mr-8 rounded-2xl bg-slate-800 px-4 py-3 text-sm whitespace-pre-wrap"><p className="text-xs text-cyan-300 mb-1">ZianeComms recovery invitation</p>{session.opening}</div>}
     {session?.messages.map(message=><div key={message.id} className={`rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${message.direction==='inbound'?'ml-8 bg-cyan-900':'mr-8 bg-slate-800'}`}>
      <p className="text-xs text-slate-300 mb-1">{message.direction==='inbound'?'You':'ZianeComms'}</p>{message.body}
     </div>)}
     {!session?.chatId&&<p className="text-sm text-slate-400">Start the recovery conversation for this unresolved case.</p>}
    </div>
    <div className="p-4 border-t border-slate-700">
     {!session?.chatId?<button disabled={busy||session?.status==='unknown'} onClick={()=>void request('start')} className="rounded-xl bg-cyan-700 px-4 py-3 font-semibold disabled:opacity-50">{busy?'Starting…':'Start recovery chat'}</button>:
      <form onSubmit={e=>{e.preventDefault();if(text.trim())void request('send',text);}} className="flex gap-2">
       <label htmlFor="recovery-reply" className="sr-only">Your reply</label>
       <textarea id="recovery-reply" value={text} onChange={e=>setText(e.target.value)} maxLength={4000} disabled={busy||complete} rows={2}
        placeholder={complete?'Conversation complete':'Type your reply…'} className="flex-1 min-w-0 bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm" />
       <button disabled={busy||complete||!text.trim()} className="rounded-xl bg-cyan-700 px-4 font-semibold disabled:opacity-50">{busy?'Sending…':'Send'}</button>
      </form>}
    </div>
   </section>
   <div className="flex flex-wrap gap-3 text-sm">
    <button disabled={busy} onClick={()=>void request()} className="text-cyan-300 disabled:opacity-50">Refresh conversation & priority</button>
    {session?.chatId&&!complete&&<button disabled={busy} onClick={()=>void request('end')} className="text-slate-300 disabled:opacity-50">End conversation & request analysis</button>}
   </div>
   {complete&&<p role="status" className="text-sm text-emerald-300">{session?.analyzed?'Recovery analysis received. Latest calculated priority shown above.':'Conversation ended. Waiting for signed Retell analysis…'}</p>}
   {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
   <p className="text-xs text-slate-500">No carrier SMS is sent from this demo. In immediate danger, contact emergency services.</p>
  </div>
 </main>;
}
