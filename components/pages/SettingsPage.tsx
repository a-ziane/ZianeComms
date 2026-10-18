'use client';
import { DEPLOYMENTS, type DeploymentId } from '@/config/deployments';
import { useDeployment } from '@/hooks/useDeployment';
import { useOrganization } from '@/components/organization/OrganizationProvider';
import { Integrations, ResponsibleUse } from '@/components/organization/Editors';
import NetworkControl from '@/components/NetworkControl';
export default function SettingsPage() {
  const organization = useOrganization();
  const active = organization.record?.active;
  const { profile, selectDeployment } = useDeployment();
  return <div className="p-8 overflow-auto max-w-3xl space-y-5">
    <h1 className="text-2xl font-bold">Settings · Organization & Deployment</h1>
    {active&&<div className="border border-slate-700 rounded-xl p-4 space-y-2 text-sm"><h2 className="font-bold">{active.configuration.name} · ACTIVE v{active.version}</h2><p>{active.configuration.description}</p><p>Service area: {active.configuration.serviceArea}</p><p>Languages: {active.configuration.languages.join(' / ')}</p><p>Communication: {active.configuration.channels.join(', ')} · Recovery preference: {active.configuration.recoveryEnabled?'enabled':'disabled'}</p><p>Emergency guidance: {active.configuration.emergencyGuidance}</p><p>Callback expectations: {active.configuration.callbackExpectations}</p><p className="text-xs text-amber-200">Configuration Ready. Existing published agents are unchanged until reviewed provider connection/publishing.</p></div>}
    <Integrations/>
    <h2 className="font-bold">Device deployment & offline demo</h2>
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
    <ResponsibleUse/>
    <p className="text-xs text-slate-400">Privacy / retention: cases follow the existing protected persistence path; no automatic production deletion is configured. Manual demo reset is documented and never deletes real cases.</p>
    <p className="text-xs text-slate-400">Offline data is stored in this browser for the demo, without application-level encryption. Use a trusted device. Synchronized caller payloads are cleared; operators can clear their cache when no actions are pending.</p>
  </div>;
}
