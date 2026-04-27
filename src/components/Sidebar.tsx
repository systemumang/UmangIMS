import React from 'react';
				import { 
						  LayoutDashboard, 
						  ShoppingCart, 
						  Boxes, 
						  Database,
						  ClipboardList,
						  ChevronDown,
						  Plus, 
						  LogOut,
					} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { motion } from 'motion/react';
import { MASTERS_TABS, type MastersTab } from '@/src/lib/mastersTabs';

export type NavView = 'dashboard' | 'purchasing' | 'operations' | 'inventory' | 'masters' | 'pendingTasks' | 'stockMaster' | 'issueMaster' | 'returnMaster' | 'damageMaster';
export type PendingQueueKey =
  | 'queueApprovePr'
  | 'queueCreatePo'
  | 'queueCheckPo'
  | 'queueSendPo'
  | 'queueCreateGrn'
  | 'queueCheckQuality'
  | 'queueEnterInvoice'
  | 'queueLinkInvoiceGrn'
  | 'queuePayment';

const pendingQueueItems: Array<{ key: PendingQueueKey; label: string }> = [
  { key: 'queueApprovePr', label: 'Approve PR' },
  { key: 'queueCreatePo', label: 'Create PO' },
  { key: 'queueCheckPo', label: 'Check PO' },
  { key: 'queueSendPo', label: 'Send PO' },
  { key: 'queueCreateGrn', label: 'Create GRN' },
  { key: 'queueCheckQuality', label: 'Check Quality' },
  { key: 'queueEnterInvoice', label: 'Enter Invoice' },
  { key: 'queueLinkInvoiceGrn', label: 'Link Invoice ↔ GRN' },
  { key: 'queuePayment', label: 'Pending Payment' },
];

export type StockMasterTab = 'itemIssue' | 'return' | 'damage';

const stockMasterItems: Array<{ key: StockMasterTab; label: string }> = [
  { key: 'itemIssue', label: 'Issue' },
  { key: 'return', label: 'Return' },
  { key: 'damage', label: 'Damage' },
];

	const navItems: Array<{
	  icon: React.ComponentType<{ size?: number; className?: string }>;
	  label: string;
	  view: NavView;
	}> = [
	  { icon: LayoutDashboard, label: 'Dashboard', view: 'dashboard' },
			  { icon: ShoppingCart, label: 'Purchase Requests', view: 'purchasing' },
			  { icon: ClipboardList, label: 'Pending Tasks', view: 'pendingTasks' },
			  { icon: Boxes, label: 'Operations', view: 'operations' },
			  { icon: Boxes, label: 'Inventory', view: 'inventory' },
			  { icon: Database, label: 'Issue Master', view: 'issueMaster' },
			  { icon: Database, label: 'Return Master', view: 'returnMaster' },
			  { icon: Database, label: 'Damage Master', view: 'damageMaster' },
			  { icon: Database, label: 'Masters', view: 'masters' },
			];

export default function Sidebar({
  activeView,
  activePendingQueue,
  activeMastersTab,
  activeStockMasterTab,
  mastersExpanded,
  pendingExpanded,
  stockMasterExpanded,
  isNewPurchaseRequestActive,
  onNavigate,
  onNavigatePendingQueue,
  onNavigateMastersTab,
  onNavigateStockMasterTab,
  onNewPurchaseRequest,
  open = true,
}: {
  activeView: NavView;
  activePendingQueue?: PendingQueueKey;
  activeStockMasterTab?: StockMasterTab;
  mastersExpanded?: boolean;
  pendingExpanded?: boolean;
  stockMasterExpanded?: boolean;
  isNewPurchaseRequestActive?: boolean;
  onNavigate: (view: NavView) => void;
  onNavigatePendingQueue?: (key: PendingQueueKey) => void;
  onNavigateMastersTab?: (tab: MastersTab) => void;
  onNavigateStockMasterTab?: (tab: StockMasterTab) => void;
  onNewPurchaseRequest: () => void;
  open?: boolean;
}) {
  return (
    <aside
      className={cn(
        'h-screen w-64 fixed left-0 top-0 bg-surface-container-low flex flex-col py-4 space-y-2 z-40 transition-transform duration-200',
        open ? 'translate-x-0' : '-translate-x-full'
      )}
      aria-hidden={!open}
    >
      <div className="px-6 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-on-primary">
            <Boxes size={18} />
          </div>
	          <div>
	            <div className="font-headline font-bold text-on-surface text-sm">BizSkill</div>
	            <div className="font-sans text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">Inventory Management</div>
	          </div>
	        </div>
	      </div>

      <nav className="flex-1 space-y-3">
		        {navItems.map((item) => (
			          <React.Fragment key={item.label}>
		            <motion.button
		              whileHover={{ x: 4 }}
		              type="button"
		              onClick={() => onNavigate(item.view)}
		              className={cn(
		                "flex items-center px-4 py-2.5 mx-2 rounded-lg transition-colors font-sans text-sm tracking-wide w-[calc(100%-1rem)] text-left",
		                activeView === item.view
		                  ? "bg-error text-on-primary font-semibold"
		                  : "text-on-surface-variant hover:bg-surface-container-high"
		              )}
			            >
			              <item.icon className={cn("mr-3", activeView === item.view ? "text-on-primary" : "text-on-surface-variant")} size={18} />
			              <span className="flex-1">{item.label}</span>
			              {item.view === 'masters' || item.view === 'pendingTasks' ? (
			                <ChevronDown
			                  size={16}
			                  className={cn(
			                    'ml-2 transition-transform text-on-surface-variant',
			                    activeView === item.view ? 'text-on-primary' : '',
			                    item.view === 'masters'
			                      ? mastersExpanded
			                        ? 'rotate-180'
			                        : 'rotate-0'
		                      : pendingExpanded
		                        ? 'rotate-180'
		                        : 'rotate-0'
		                  )}
		                />
		              ) : null}
		            </motion.button>



		            {item.view === 'masters' && mastersExpanded ? (
		              <div className="ml-7 mr-3 mt-1 space-y-1">
		                {MASTERS_TABS.map((t) => (
		                  <button
		                    key={t.key}
	                    type="button"
	                    onClick={() => onNavigateMastersTab?.(t.key)}
	                    className={cn(
	                      'w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-colors',
	                      activeMastersTab === t.key
	                        ? 'bg-error text-on-primary'
	                        : 'text-on-surface-variant hover:bg-surface-container-high'
	                    )}
	                  >
		                    {t.label}
		                  </button>
		                ))}
		              </div>
		            ) : null}

			            {item.view === 'pendingTasks' && onNavigatePendingQueue && pendingExpanded ? (
			              <div className="ml-7 mr-3 mt-1 space-y-1">
			                {pendingQueueItems.map((q) => (
			                  <motion.button
			                    key={q.key}
			                    whileHover={{ x: 4 }}
			                    type="button"
			                    onClick={() => onNavigatePendingQueue(q.key)}
			                    className={cn(
			                      'w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-colors',
			                      activePendingQueue === q.key
			                        ? 'bg-error text-on-primary'
			                        : 'text-on-surface-variant hover:bg-surface-container-high'
			                    )}
			                  >
			                    {q.label}
			                  </motion.button>
			                ))}
			              </div>
			            ) : null}
		          </React.Fragment>
		        ))}
		      </nav>

      <div className="px-4 mt-auto space-y-2">
        <motion.button 
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2.5 rounded-md font-semibold text-sm shadow-sm transition-colors",
            isNewPurchaseRequestActive
              ? "bg-error text-on-primary"
              : "bg-gradient-to-br from-primary to-primary-dim text-on-primary"
          )}
          type="button"
          onClick={onNewPurchaseRequest}
        >
          <Plus size={16} />
          New Purchase Request
        </motion.button>

        {stockMasterItems.map((t) => (
          <motion.button
            key={t.key}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={() => onNavigateStockMasterTab?.(t.key)}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2 rounded-md font-semibold text-sm shadow-sm transition-colors',
              activeStockMasterTab === t.key
                ? 'bg-error text-on-primary'
                : 'bg-gradient-to-br from-primary to-primary-dim text-on-primary'
            )}
          >
            <Plus size={16} />
            {t.label}
          </motion.button>
        ))}
        
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
