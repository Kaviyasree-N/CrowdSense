import { Menu, X } from 'lucide-react';
import { useState } from 'react';

export type AppPage =
  | 'home'
  | 'results'
  | 'details'
  | 'map'
  | 'analytics'
  | 'explorer';

interface NavbarProps {
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
  onRunSampleDemo: () => void;
}

const NAV_ITEMS: { id: AppPage; label: string }[] = [
  { id: 'home', label: 'Journey Planner' },
  { id: 'map', label: 'Crowding Map' },
  { id: 'analytics', label: 'Operator Analytics' },
  { id: 'explorer', label: 'Data & Model' },
];

export function Navbar({ currentPage, onNavigate, onRunSampleDemo }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const isNavActive = (id: AppPage) => {
    if (id === 'home' && (currentPage === 'home' || currentPage === 'results' || currentPage === 'details')) {
      return true;
    }
    return currentPage === id;
  };

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element Brand wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 rounded"
        >
          CrowdSense
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-7" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const active = isNavActive(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                  active
                    ? 'text-teal-800 border-teal-700'
                    : 'text-slate-600 border-transparent hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary CTA + Mobile toggle */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onRunSampleDemo}
            className="hidden sm:inline-flex items-center justify-center px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          >
            Run 6 PM Demo
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="md:hidden p-2 rounded-lg text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile navigation drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isNavActive(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onNavigate(item.id);
                  setMobileOpen(false);
                }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-teal-50 text-teal-900'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {item.label}
              </button>
            );
          })}
          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                onRunSampleDemo();
                setMobileOpen(false);
              }}
              className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
            >
              Run 6 PM Demo (Anand Vihar to CP)
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
