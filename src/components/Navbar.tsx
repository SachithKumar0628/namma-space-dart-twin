import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Compass,
  FileSpreadsheet,
  ShieldCheck,
  Layers,
  Box,
  FileText,
  Download,
  Camera,
  Sparkles,
  FolderOpen,
  ChevronDown,
  HelpCircle,
  ScanLine,
} from 'lucide-react';
import { ValidationSummary } from '../utils/dartValidator';
import { useAuth } from '../hooks/useAuth';
import { User, LogIn, LogOut, Plus, ShieldAlert } from 'lucide-react';
import { NammaProject } from '../types/dart';

export type ActiveTab =
  | 'landing'
  | 'library'
  | 'viewer'
  | 'photoreal'
  | 'sop'
  | 'reconstruction'
  | 'guide'
  | 'rooms'
  | 'manifest'
  | 'inspector'
  | 'pipeline';

interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  validationSummary: ValidationSummary;
  projects?: NammaProject[];
  currentProjectId?: string;
  onSelectProject?: (id: string) => void;
  onExportJSON: () => void;
  onOpenHowToUse?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  validationSummary,
  projects = [],
  currentProjectId,
  onSelectProject,
  onExportJSON,
  onOpenHowToUse,
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { user, loading, signOut, signIn, signUp, authenticated, supabaseConfigured } = useAuth();
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);


  // Primary workspace flow only. Everything secondary lives under "More".
  // The walkthrough and photoreal tabs only exist once a space is generated.
  const primaryNavItems: { id: ActiveTab; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'library', label: 'Spaces', icon: FolderOpen },
    { id: 'sop', label: 'Capture Studio', icon: Camera },
    { id: 'reconstruction', label: 'Reconstruction', icon: Sparkles },
    ...(projects.length > 0
      ? [
          { id: 'viewer' as ActiveTab, label: '3D Walkthrough', icon: Box },
          { id: 'photoreal' as ActiveTab, label: 'Photoreal Scan', icon: ScanLine },
        ]
      : []),
  ];

  const activeProject = projects.find((project) => project.id === currentProjectId);
  const scanRunning =
    activeProject?.reconstructionModelStats?.jobStatus === 'queued' ||
    activeProject?.reconstructionModelStats?.jobStatus === 'running';

  const secondaryNavItems: {
    id: ActiveTab;
    label: string;
    icon: React.FC<{ className?: string }>;
  }[] = [
    { id: 'landing', label: 'Platform', icon: Layers },
    { id: 'guide', label: 'SOP Guide', icon: Compass },
    { id: 'inspector', label: 'Quality Gate', icon: ShieldCheck },
    { id: 'manifest', label: 'Manifest', icon: FileSpreadsheet },
    { id: 'pipeline', label: 'Compliance & Docs', icon: FileText },
  ];

  const isMoreActive = secondaryNavItems.some((item) => item.id === activeTab);

  // Close the "More" menu on outside click or Escape.
  useEffect(() => {
    if (!isMoreOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMoreOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMoreOpen]);

  const handleSecondaryNav = (tab: ActiveTab) => {
    setActiveTab(tab);
    setIsMoreOpen(false);
  };

  return (
    <header className="bg-slate-900/95 backdrop-blur border-b border-slate-800 text-slate-100 sticky top-0 z-40 select-none">
      {/* Top Header Bar: Brand, Space Selector, and System Actions */}
      <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/60">
        {/* Left: Brand & Badges */}
        <div className="flex items-center gap-3 shrink-0">
          <div
            className="flex items-center gap-2 cursor-pointer hover:opacity-90 transition"
            onClick={() => setActiveTab('landing')}
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center font-mono font-black text-slate-950 text-sm shadow-md shrink-0">
              NS
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="font-extrabold text-sm tracking-tight font-mono text-white">
                Namma Space
              </span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                Spatial Twin
              </span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-teal-500/20 text-teal-400 border border-teal-500/40 hidden sm:inline-block">
                DART Engine
              </span>
            </div>
          </div>
        </div>

        {/* Right: Space Switcher + Guide + Global Actions */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {/* Active Space Selector */}
          {projects.length > 0 && onSelectProject && currentProjectId ? (
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs font-mono">
              <span className="text-slate-500 text-[10px] uppercase font-semibold">Space:</span>
              <select
                value={currentProjectId}
                onChange={(e) => onSelectProject(e.target.value)}
                className="bg-transparent text-cyan-300 font-bold outline-none cursor-pointer max-w-[150px] truncate"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                    {p.name.replace(/ \(.*\)/, '')}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-[11px] font-mono">
              <span className="text-slate-500 text-[10px] uppercase font-semibold">Space:</span>
              <span className="text-slate-500">No space yet</span>
            </div>
          )}

          {/* Prominent How to Use Guide Button */}
          {onOpenHowToUse && (
            <button
              onClick={onOpenHowToUse}
              className="flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 text-amber-300 hover:text-amber-200 border border-amber-500/50 rounded-lg text-xs font-mono font-bold shadow-sm transition"
              title="Quick start: 4 simple steps"
            >
              <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>Quick Start</span>
            </button>
          )}

          {/* DART Validation Status Indicator */}
          {validationSummary.isValid ? (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/70 border border-emerald-800/80 rounded-lg text-[11px] font-mono text-emerald-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>DART Passed</span>
            </div>
          ) : (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-amber-950/70 border border-amber-800/80 rounded-lg text-[11px] font-mono text-amber-300">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
              <span>{validationSummary.errorCount} Audit Issues</span>
            </div>
          )}

          {/* Export JSON */}
          <button
            onClick={onExportJSON}
            className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 rounded-lg text-xs font-mono transition"
            title="Export project state as JSON"
          >
            <Download className="w-3 h-3 text-cyan-400" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </div>

      {/* Primary Navigation Bar */}
      <div className="max-w-7xl mx-auto px-4 py-1.5 flex items-center gap-1.5">
        <nav
          className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-none"
          aria-label="Primary"
        >
          {primaryNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition whitespace-nowrap ${
                  isActive
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-sm font-bold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
                {item.id === 'viewer' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
                )}
                {item.id === 'photoreal' && scanRunning && (
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse ml-0.5" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Secondary navigation lives behind "More" */}
        <div className="relative shrink-0" ref={moreMenuRef}>
          <button
            onClick={() => setIsMoreOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={isMoreOpen}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition whitespace-nowrap border ${
              isMoreActive || isMoreOpen
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-sm font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border-transparent'
            }`}
          >
            <span>More</span>
            {isMoreActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" aria-hidden="true" />
            )}
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${isMoreOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {/* Session / auth controls */}
          <div className="flex items-center gap-2 ml-3">
            {authenticated && !loading && (
              <>
                <span className="text-[10px] font-mono text-slate-300 truncate w-36" title={user?.email ?? ''}>{user?.email}</span>
                <button onClick={() => { void signOut(); }} title="Sign out" className="px-2.5 py-1 bg-red-950/40 hover:bg-red-950/60 text-red-300 border border-red-800 rounded text-[10px] font-mono transition">
                  <LogOut className="w-3 h-3 shrink-0" />
                </button>
              </>
            )}
            {!authenticated && !loading && (
              <button onClick={() => setIsAuthOpen(true)} title="Sign in" className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded text-[10px] font-mono transition">
                <LogIn className="w-3 h-3 shrink-0" />
              </button>
            )}
            {loading && <span className="text-[10px] font-mono text-cyan-400 animate-pulse">Auth…</span>}
            {!supabaseConfigured && !loading && <span className="text-[9px] font-mono text-amber-400" title="Supabase not configured — using cookie session auth">SESSION</span>}
          </div>

          {isMoreOpen && (
            <div
              role="menu"
              aria-label="More sections"
              className="absolute right-0 top-full mt-1.5 w-60 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl shadow-slate-950/70 p-1.5 z-50"
            >
              <div className="px-2.5 pt-1 pb-1 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                Workspace
              </div>
              {secondaryNavItems.slice(0, 2).map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    role="menuitem"
                    onClick={() => handleSecondaryNav(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-mono text-left transition ${
                      isActive
                        ? 'bg-cyan-500/15 text-cyan-300'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                  </button>
                );
              })}

              <div className="my-1 border-t border-slate-800" />
              <div className="px-2.5 pt-1 pb-1 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                Audit & data
              </div>
              {secondaryNavItems.slice(2).map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    role="menuitem"
                    onClick={() => handleSecondaryNav(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-mono text-left transition ${
                      isActive
                        ? 'bg-cyan-500/15 text-cyan-300'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.id === 'inspector' && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${
                          validationSummary.isValid
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                            : 'bg-amber-950 text-amber-300 border-amber-800'
                        }`}
                      >
                        {validationSummary.isValid
                          ? 'Passed'
                          : `${validationSummary.errorCount} issues`}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {/* Auth modal */}
      {isAuthOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex min-h-screen items-center justify-center overflow-y-auto bg-black/70 p-4" onClick={() => setIsAuthOpen(false)}>
          <div className="w-80 bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-mono text-cyan-300">Sign in</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setAuthBusy(true);
                setAuthError(null);
                const fn = authMode === 'signin' ? signIn : signUp;
                const r = await fn(authEmail, authPassword);
                setAuthBusy(false);
                if (r.ok) {
                  setIsAuthOpen(false);
                  setAuthEmail('');
                  setAuthPassword('');
                } else {
                  setAuthError(r.error ?? 'Authentication failed');
                }
              }}
              className="space-y-2"
            >
              <input
                type="email"
                required
                placeholder="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs font-mono text-slate-200"
              />
              <input
                type="password"
                required
                placeholder="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs font-mono text-slate-200"
              />
              {authError && <p className="text-[10px] font-mono text-red-400">{authError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={authBusy} className="flex-1 px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-mono disabled:opacity-50">
                  {authBusy ? '…' : authMode === 'signin' ? 'Sign in' : 'Sign up'}
                </button>
                <button type="button" onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')} className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded text-xs font-mono">
                  {authMode === 'signin' ? 'Sign up' : 'Sign in'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </header>
  );
};
