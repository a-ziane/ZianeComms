'use client';

import type { NavPage } from '@/types';

interface LeftNavProps {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
}

const NAV_ITEMS: { page: NavPage; label: string; icon: string }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: '⊞' },
  { page: 'agent_setup', label: 'Agent Setup', icon: '🤖' },
  { page: 'knowledge_base', label: 'Knowledge Base', icon: '📚' },
  { page: 'responders', label: 'Responders', icon: '👥' },
  { page: 'dispatch_rules', label: 'Dispatch Rules', icon: '⚡' },
  { page: 'settings', label: 'Settings', icon: '⚙' },
];

export default function LeftNav({ activePage, onNavigate }: LeftNavProps) {
  return (
    <nav className="w-52 shrink-0 bg-[#1a2236] border-r border-[#2a3650] flex flex-col min-h-0">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-[#2a3650]">
        <div className="text-lg font-black tracking-tight text-white">
          ZIANE<span className="text-blue-400">COMMS</span>
        </div>
        <div className="text-xs text-slate-400 mt-0.5">Operations Console</div>
      </div>

      {/* Nav items */}
      <div className="flex-1 py-3">
        {NAV_ITEMS.map(({ page, label, icon }) => {
          const isActive = activePage === page;
          return (
            <button
              key={page}
              onClick={() => onNavigate(page)}
              className={`w-full flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors text-left ${
                isActive
                  ? 'bg-blue-700/30 text-white border-l-2 border-blue-400'
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border-l-2 border-transparent'
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-[#2a3650]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs text-emerald-400 font-semibold">SYSTEM OPERATIONAL</span>
        </div>
        <div className="text-xs text-slate-600 mt-1">v1.0 — Case Operations</div>
      </div>
    </nav>
  );
}
