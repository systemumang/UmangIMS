import React from 'react';
import { 
		  LayoutDashboard, 
		  ShoppingCart, 
		  Package, 
		  ClipboardCheck, 
		  Database,
		  Plus, 
		  LogOut,
		  Building2
		} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { motion } from 'motion/react';
import { MASTERS_TABS, type MastersTab } from '@/src/lib/mastersTabs';

export type NavView = 'dashboard' | 'purchasing' | 'inventory' | 'qualityControl' | 'masters';

const navItems: Array<{
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  view: NavView;
}> = [
  { icon: LayoutDashboard, label: 'Dashboard', view: 'dashboard' },
  { icon: ShoppingCart, label: 'Purchasing', view: 'purchasing' },
  { icon: Package, label: 'Inventory', view: 'inventory' },
  { icon: Database, label: 'Masters', view: 'masters' },
  { icon: ClipboardCheck, label: 'Quality Control', view: 'qualityControl' },
];

export default function Sidebar({
  activeView,
  activeMastersTab,
  onNavigate,
  onNavigateMastersTab,
  onNewPurchaseRequest,
}: {
  activeView: NavView;
  activeMastersTab?: MastersTab;
  onNavigate: (view: NavView) => void;
  onNavigateMastersTab?: (tab: MastersTab) => void;
  onNewPurchaseRequest: () => void;
}) {
  return (
    <aside className="h-screen w-64 fixed left-0 top-0 bg-surface-container-low flex flex-col py-4 space-y-2 z-40">
      <div className="px-6 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-on-primary">
            <Building2 size={18} />
          </div>
          <div>
            <div className="font-headline font-bold text-on-surface text-sm">Global Operations</div>
            <div className="font-sans text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">Enterprise Ledger</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => (
          <React.Fragment key={item.label}>
            <motion.button
              whileHover={{ x: 4 }}
              type="button"
              onClick={() => onNavigate(item.view)}
              className={cn(
                "flex items-center px-4 py-2.5 mx-2 rounded-lg transition-colors font-sans text-sm tracking-wide w-[calc(100%-1rem)] text-left",
                activeView === item.view
                  ? "bg-surface-container-highest text-on-surface font-semibold"
                  : "text-on-surface-variant hover:bg-surface-container-high"
              )}
            >
              <item.icon className={cn("mr-3", activeView === item.view ? "text-primary" : "text-on-surface-variant")} size={18} />
              {item.label}
            </motion.button>

            {item.view === 'masters' && activeView === 'masters' ? (
              <div className="ml-7 mr-3 mt-1 space-y-1">
                {MASTERS_TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => onNavigateMastersTab?.(t.key)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-colors',
                      activeMastersTab === t.key
                        ? 'bg-surface-container-high text-on-surface'
                        : 'text-on-surface-variant hover:bg-surface-container-high'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            ) : null}
          </React.Fragment>
        ))}
      </nav>

      <div className="px-4 mt-auto space-y-4">
        <motion.button 
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-br from-primary to-primary-dim text-on-primary py-2.5 rounded-md font-semibold text-sm shadow-sm"
          type="button"
          onClick={onNewPurchaseRequest}
        >
          <Plus size={16} />
          New Purchase Request
        </motion.button>
        
        <div className="pt-4 border-t border-outline-variant/20">
          <button
            type="button"
            className="flex items-center px-4 py-2 text-on-surface-variant hover:bg-surface-container-high mx-2 rounded-lg transition-colors font-sans text-sm tracking-wide w-[calc(100%-1rem)] text-left"
            onClick={() => {}}
          >
            <LogOut className="mr-3" size={18} />
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
}
