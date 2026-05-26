import React from 'react';
import { Search, Menu, X } from 'lucide-react';

export default function TopBar({
  title,
  subtitle,
  showSearch,
  sidebarOpen,
  onToggleSidebar,
  headerRight,
}: {
  title: string;
  subtitle?: string;
  showSearch?: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  headerRight?: React.ReactNode;
}) {
  return (
    <header className="bg-surface-container-lowest top-0 sticky z-50 flex justify-between items-center w-full px-4 py-3 border-b border-outline-variant/20">
      <div className="flex items-center gap-6">
        <button
          type="button"
          className={[
            'transition-colors p-1.5 rounded-md border focus:outline-none focus:ring-2 focus:ring-primary/40',
            sidebarOpen
              ? 'bg-primary text-white border-white/70 hover:bg-primary-dim'
              : 'bg-white text-primary border-primary hover:bg-blue-50',
          ].join(' ')}
          aria-label={sidebarOpen ? 'Hide menu' : 'Show menu'}
          title={sidebarOpen ? 'Hide menu' : 'Show menu'}
          onClick={onToggleSidebar}
        >
          {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
	        <h1 className="font-headline text-on-surface font-bold text-3xl leading-tight tracking-tight">
          {title}
          {subtitle ? (
            <>
              {' '}
              <span className="text-outline-variant font-normal">/</span> {subtitle}
            </>
          ) : null}
        </h1>
        {showSearch ? (
          <div className="relative group">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors"
              size={16}
            />
            <input
              className="bg-surface-container-low border-none rounded-full py-1.5 pl-10 pr-4 text-sm w-64 focus:ring-1 focus:ring-primary-container outline-none transition-all"
              placeholder="Search..."
              type="text"
            />
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">{headerRight ?? null}</div>
    </header>
  );
}
