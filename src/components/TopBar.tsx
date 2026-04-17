import React from 'react';
import { Search, Bell, Settings, HelpCircle } from 'lucide-react';

export default function TopBar({
  title,
  subtitle,
  showSearch,
}: {
  title: string;
  subtitle?: string;
  showSearch?: boolean;
}) {
  return (
    <header className="glass docked full-width top-0 sticky z-50 flex justify-between items-center w-full px-6 py-3 border-b border-outline-variant/10">
      <div className="flex items-center gap-6">
        <h1 className="font-headline text-on-surface font-semibold text-lg tracking-tight">
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

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 pr-4 border-r border-outline-variant/20">
          <button className="text-on-surface-variant hover:text-on-surface transition-colors p-1.5 rounded-full hover:bg-surface-container-high">
            <Bell size={18} />
          </button>
          <button className="text-on-surface-variant hover:text-on-surface transition-colors p-1.5 rounded-full hover:bg-surface-container-high">
            <Settings size={18} />
          </button>
          <button className="text-on-surface-variant hover:text-on-surface transition-colors p-1.5 rounded-full hover:bg-surface-container-high">
            <HelpCircle size={18} />
          </button>
        </div>
        
        <div className="flex items-center gap-3 pl-2">
          <div className="text-right hidden lg:block">
            <p className="text-xs font-bold text-on-surface">Marcus Chen</p>
            <p className="text-[10px] text-on-surface-variant">Sr. Procurement Manager</p>
          </div>
          <img 
            alt="User profile" 
            className="w-8 h-8 rounded-full object-cover ring-2 ring-surface-container" 
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuBMzaMB7X-LOsxEajA9my0Iyt1KgKJJh1mR0iRTMoHzbSu4X6am0wbQ-D09WWxrP71wsyEhQg03oUFqlGKZcaC7etOT3N0PYIPjCGzqWuqxsSO2cZJ_ojXkUPh5CWfQO3vjraRQhGnP7UOx9yDPgCV_MHEFur00wSMECsJ5Sg7RSX5DPQA9cPaLqAc9pAZ65BAq0iU2KAym5mlElg6an7uFm_laaT6gKSDwhaiASpt9xhW4BrfJgwPEzVAkfoeY5i2sFciBDHZAmQ"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    </header>
  );
}
