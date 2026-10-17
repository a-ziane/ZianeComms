'use client';
import { DEPLOYMENTS, type DeploymentId } from '@/config/deployments';
import { useDeployment } from '@/hooks/useDeployment';
import NetworkControl from '@/components/NetworkControl';
export default function SettingsPage() {
  const { profile, selectDeployment } = useDeployment();
  return <div className="p-8 overflow-auto max-w-3xl space-y-5">
    <h1 className="text-2xl font-bold">Settings · Deployment</h1>
    <label className="block">Deployment
      <select className="block mt-2 p-2 rounded bg-slate-800" value={profile.id} onChange={e => selectDeployment(e.target.value as DeploymentId)}>
        {Object.values(DEPLOYMENTS).map(p => <option key={p.id} value={p.id}>{p.flag} {p.name}</option>)}
      </select>
    </label>
    <p>Languages: {profile.languages.map(l => l.label + (l.ready ? '-ready' : '')).join(' / ')}</p>
    <p>Location: {profile.locationSchema.map(f => f.label).join(' · ')}</p>
    <p>Communication: {profile.connectivityPreferences.join(' · ')}</p>
    <p className="text-sm text-slate-400">This device’s selected profile configures new help requests. Existing cases retain their deployment and rulebook. Voice and Recovery Chat keep their configured deployment; selecting here does not reconfigure Retell.</p>
    <NetworkControl />
    <a className="inline-block underline text-blue-300" href="/help">Open caller help form</a>
    <div className="border border-slate-700 rounded p-4 text-sm"><strong>Twist #2</strong><p className="mt-2">Going global didn&apos;t mean translating ZianeComms. It meant removing assumptions about language, location systems, and reliable connectivity.</p></div>
    <p className="text-xs text-slate-400">Offline data is stored in this browser for the demo, without application-level encryption. Use a trusted device. Synchronized caller payloads are cleared; operators can clear their cache when no actions are pending.</p>
  </div>;
}
