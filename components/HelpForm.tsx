'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DEPLOYMENTS, type DeploymentId } from '@/config/deployments';
import { useDeployment } from '@/hooks/useDeployment';
import { connected, useConnectivity } from '@/hooks/useConnectivity';
import { deviceStore, withDeviceLock } from '@/lib/offline/storage';
import { pendingHelp, saveHelp, syncHelp } from '@/lib/offline/queue';
import { SERVICES, validateHelpRequest, type HelpRequest, type Answer } from '@/lib/help/intake';
import NetworkControl from './NetworkControl';
export const OFFLINE_SAFETY = "You're offline. This request is saved only on this device until connectivity returns. ZianeComms cannot contact responders while there is no network.";
export default function HelpForm() {
  const { profile, selectDeployment } = useDeployment();
  const { online } = useConnectivity();
  const [pending, setPending] = useState<HelpRequest[]>([]), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [danger, setDanger] = useState<Answer>('unknown');
  const [offlineReady, setOfflineReady] = useState(false);
  const running = useRef(false);
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    let mounted = true;
    if ('serviceWorker' in navigator) void navigator.serviceWorker.ready.then(async () => {
      const cached = await caches.match('/help'); if (mounted) setOfflineReady(!!cached);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  async function refresh() { setPending(await pendingHelp(deviceStore)); }
  async function synchronize() {
    if (running.current || !connected()) return;
    running.current = true; setBusy(true); setError('');
    try {
      const count = await withDeviceLock('help', () => syncHelp(deviceStore, async request => {
        setMessage('Synchronizing…');
        const response = await fetch('/api/help', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
        const result = await response.json(); if (!response.ok) throw Error(result.error || 'Request not confirmed.'); return result;
      }, connected));
      if (count > 0) setMessage('Request sent successfully.');
      await refresh();
    } catch (e) { setError((e as Error).message); setMessage('Saved on this device — waiting for connection or server confirmation.'); await refresh().catch(() => {}); }
    finally { running.current = false; setBusy(false); }
  }
  useEffect(() => {
    void refresh().catch(() => setError('Device storage is unavailable. No request has been saved.'));
    if (online) void synchronize();
    // The connectivity transition is the retry trigger; device queue is authoritative.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const data = new FormData(event.currentTarget);
      const request = validateHelpRequest({ id: crypto.randomUUID(), deploymentId: profile.id, createdOnDeviceAt: new Date().toISOString(), savedOffline: !connected(),
        name: data.get('name') ?? '', contact: data.get('contact') ?? '', language: data.get('language') ?? 'unknown', need: data.get('need'), service: data.get('service'),
        immediateDanger: data.get('immediateDanger'), medicalNeed: data.get('medicalNeed'), mobilityNeed: data.get('mobilityNeed'), equipmentNeed: data.get('equipmentNeed'), crisisContext: data.get('crisisContext'), unableToEvacuate: data.get('unableToEvacuate'), powerDisruption: data.get('powerDisruption'),
        location: Object.fromEntries(profile.locationSchema.map(f => [f.key, data.get(`location-${f.key}`) ?? ''])) });
      await withDeviceLock('help', async () => {
        if ((await pendingHelp(deviceStore)).length >= 20) throw Error('Device queue is full. Synchronize or remove a saved request first.');
        await saveHelp(deviceStore, request);
      });
      setMessage('Saved on this device — waiting for connection.'); await refresh(); formRef.current?.reset();
      await synchronize();
    } catch (e) { setError((e as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  }
  const answer = (name: string, label: string) => <label className="block" key={name}>{label}<select name={name} defaultValue="unknown" className="block w-full bg-slate-800 rounded p-2 mt-1" onChange={name === 'immediateDanger' ? e => setDanger(e.target.value as Answer) : undefined}><option value="unknown">Not sure / not provided</option><option value="yes">Yes</option><option value="no">No</option></select></label>;
  return <main className="max-w-2xl mx-auto p-6 space-y-5">
    <h1 className="text-2xl font-bold">ZianeComms · Request help</h1>
    <p className="text-sm text-slate-300">This form does not contact emergency services or guarantee a response. Share only the details needed to help you. A street address or callback number is not required.</p>
    <NetworkControl />
    <div role="status" className="border border-slate-600 rounded p-3"><strong>{online ? 'ONLINE' : 'OFFLINE'}</strong>{!online && <p>{OFFLINE_SAFETY}</p>}<p className="text-xs mt-2">{offlineReady ? 'Offline interface cached on this device.' : 'Load this page with a connection to cache the offline interface.'}</p></div>
    <label className="block">Deployment<select className="block bg-slate-800 rounded p-2 mt-1" value={profile.id} onChange={e => selectDeployment(e.target.value as DeploymentId)}>{Object.values(DEPLOYMENTS).map(p => <option key={p.id} value={p.id}>{p.flag} {p.name}</option>)}</select></label>
    {danger === 'yes' && <p role="alert" className="border border-red-600 bg-red-950/50 rounded p-3">{profile.emergencyGuidance}</p>}
    <form ref={formRef} onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        <label className="block">Name (optional)<input name="name" maxLength={120} className="block w-full bg-slate-800 rounded p-2" /></label>
        <label className="block">Callback phone (optional, international + country code)<input name="contact" type="tel" maxLength={40} className="block w-full bg-slate-800 rounded p-2" /><span className="text-xs text-slate-400">Leave blank if unavailable. No country code is assumed.</span></label>
        <label className="block">Preferred language<select name="language" key={profile.id} defaultValue="unknown" className="block w-full bg-slate-800 rounded p-2"><option value="unknown">Not provided</option>{profile.languages.map(l => <option key={l.code} value={l.code}>{l.label}{l.ready ? ' (configuration ready; support not guaranteed)' : ''}</option>)}</select></label>
        <label className="block">What happened / what do you need?<textarea name="need" required maxLength={3000} rows={3} className="block w-full bg-slate-800 rounded p-2" /></label>
        <label className="block">Requested assistance<select name="service" defaultValue="other" className="block w-full bg-slate-800 rounded p-2">{SERVICES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        {profile.questionnaire.filter(q => q.key === 'immediateDanger').map(q => answer(q.key, q.label))}
        <fieldset className="space-y-3 border border-slate-700 rounded p-3"><legend>Where are you? Provide whatever you know.</legend>{profile.locationSchema.map(f => <label key={f.key} className="block">{f.label}<input name={`location-${f.key}`} maxLength={300} className="block w-full bg-slate-800 rounded p-2" /></label>)}</fieldset>
        {profile.questionnaire.filter(q => q.key !== 'immediateDanger').map(q => answer(q.key, q.label))}
        <p className="text-xs text-slate-400">Saved requests contain sensitive information in this browser’s IndexedDB, without application-level encryption. Use a trusted device. The local payload is removed after server acknowledgement.</p>
        <button className="bg-blue-700 rounded px-4 py-2 font-semibold" type="submit">{busy ? 'Saving / synchronizing…' : online ? 'Submit help request' : 'Save on this device'}</button>
      </fieldset>
    </form>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="text-amber-300">{error}</p>}
    <section aria-label="Requests saved on this device" className="space-y-2">
      <h2 className="font-bold">{pending.length} requests waiting for confirmation</h2>
      {pending.map(r => <div className="border border-slate-700 rounded p-3 text-sm" key={r.id}><p>Local request ID: {r.id}</p><p>Saved on this device — waiting for connection.</p><p>It has not been confirmed by ZianeComms. It has not contacted emergency services.</p>{r.immediateDanger === 'yes' && <p className="text-amber-200">{DEPLOYMENTS[r.deploymentId].emergencyGuidance}</p>}<button disabled={busy} className="underline mt-2" onClick={async () => { if (window.confirm('Remove this local copy? A previous transmission may already have reached the server. Removing it does not cancel a server case.')) { await withDeviceLock('help', async () => { const all = await pendingHelp(deviceStore); await deviceStore.put('help-requests', all.filter(x => x.id !== r.id)); }); await refresh(); } }}>Remove local copy</button></div>)}
      {pending.length > 0 && <button disabled={!online || busy} onClick={() => void synchronize()} className="underline">Retry synchronization</button>}
    </section>
    <a className="text-blue-300 underline" href="/">Operator dashboard</a>
  </main>;
}
