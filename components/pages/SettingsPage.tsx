export default function SettingsPage() {
  return (
    <PlaceholderPage
      title="Settings"
      icon="⚙"
      description="System-wide configuration for ZianeComms including integrations, notifications, access control, and operational parameters."
      comingSoon={[
        'Retell AI voice agent configuration',
        'Twilio phone number management',
        'Supabase / database connection',
        'User roles and permissions',
        'Notification preferences',
        'Audit log export',
      ]}
    />
  );
}

function PlaceholderPage({
  title,
  icon,
  description,
  comingSoon,
}: {
  title: string;
  icon: string;
  description: string;
  comingSoon: string[];
}) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="text-5xl mb-4">{icon}</div>
        <h1 className="text-2xl font-black text-white mb-3">{title}</h1>
        <p className="text-sm text-slate-400 leading-relaxed mb-6">{description}</p>
        <div className="bg-[#1e2d45] border border-[#2a3650] rounded-xl p-4 text-left">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Planned integrations</div>
          <ul className="space-y-2">
            {comingSoon.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                <span className="text-blue-400 mt-0.5">○</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-4 text-xs text-slate-600">Coming after V1 frontend workflow is validated</div>
      </div>
    </div>
  );
}
