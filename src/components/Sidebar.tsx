import React from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Database,
  FileText,
  Home,
  LayoutDashboard,
  Package,
  Receipt,
  ShoppingCart,
  Truck,
  LogOut,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { motion } from 'motion/react';
import { MASTERS_TABS, type MastersTab } from '@/src/lib/mastersTabs';

export type NavView =
  | 'dashboard'
  | 'home'
  | 'purchasing'
  | 'operations'
  | 'inventory'
  | 'masters'
  | 'pendingTasks'
  | 'stockMaster'
  | 'issueMaster'
  | 'returnMaster'
  | 'damageMaster'
  | 'transferMaster';
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

export const pendingQueueItems: Array<{ key: PendingQueueKey; label: string }> = [
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

export type StockMasterTab = 'itemIssue' | 'return' | 'damage' | 'transfer';

type PurchaseMastersTab = 'prs' | 'pos' | 'grns' | 'invoices' | 'payments';

export default function Sidebar({
  activeView,
  activePendingQueue,
  activeMastersTab,
  mastersExpanded,
  pendingExpanded,
  stockMasterExpanded,
  purchaseMastersExpanded,
  activeOperationsTab,
  isNewPurchaseRequestActive,
  onNavigate,
  onNavigatePendingQueue,
  onNavigateMastersTab,
  onNavigateStockView,
  onNavigatePurchaseMasters,
  onNewPurchaseRequest,
  onDirectPo,
  open = true,
		}: {
		  activeView: NavView;
		  activePendingQueue?: PendingQueueKey;
		  activeMastersTab?: MastersTab;
		  mastersExpanded?: boolean;
		  pendingExpanded?: boolean;
		  stockMasterExpanded?: boolean;
      purchaseMastersExpanded?: boolean;
      activeOperationsTab?: PurchaseMastersTab;
	  isNewPurchaseRequestActive?: boolean;
	  onNavigate: (view: NavView) => void;
	  onNavigatePendingQueue?: (key: PendingQueueKey) => void;
	  onNavigateMastersTab?: (tab: MastersTab) => void;
	  onNavigateStockView?: (view: NavView) => void;
      onNavigatePurchaseMasters?: (tab: PurchaseMastersTab) => void;
	  onNewPurchaseRequest: () => void;
	  onDirectPo?: () => void;
	  open?: boolean;
	}) {
  const borderClass = 'border-2 border-[#1f2937]';
  const baseRowClass = `flex items-center px-4 py-2.5 rounded-md transition-colors font-sans text-sm tracking-wide w-full text-left ${borderClass}`;
  const sectionRowClass = cn(baseRowClass, 'bg-surface-container-high text-on-surface hover:border-[#111827]');
  const viewRowClass = cn(baseRowClass, 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high hover:border-[#111827]');
  const activeRowClass = 'bg-primary/15 text-on-surface font-semibold border-[#111827] shadow-[inset_0_0_0_1px_#111827]';

	  const subRowClass = `w-full text-left px-3 py-2 rounded-md text-xs font-semibold transition-colors ${borderClass} bg-surface-container-lowest hover:border-[#111827]`;
  const subActiveClass = 'bg-primary/10 text-on-surface border-[#111827]';
  const subInactiveClass = 'text-on-surface-variant hover:bg-surface-container-high';

  return (
		    <aside
	      className={cn(
	        'w-72 fixed inset-y-0 left-0 bg-surface-container-low flex flex-col z-40 transition-transform duration-200 border-r-2 border-[#1f2937] shadow-lg',
	        open ? 'translate-x-0' : '-translate-x-full'
	      )}
	      aria-hidden={!open}
	    >
	      <div className="px-6 pt-8 pb-6 shrink-0 border-b-2 border-[#1f2937]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-on-primary">
            <Boxes size={18} />
          </div>
		          <div className="font-headline font-bold text-on-surface text-sm">Inventory Management</div>
		        </div>
	      </div>

	      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
          <motion.button whileHover={{ x: 4 }} type="button" onClick={() => onNavigate('dashboard')} className={cn(viewRowClass, activeView === 'dashboard' ? activeRowClass : '')}>
            <LayoutDashboard className={cn('mr-3', activeView === 'dashboard' ? 'text-on-surface' : 'text-on-surface-variant')} size={18} />
            <span className="flex-1">Dashboard</span>
          </motion.button>

          <motion.button whileHover={{ x: 4 }} type="button" onClick={() => onNavigate('home')} className={cn(viewRowClass, activeView === 'home' ? activeRowClass : '')}>
            <Home className={cn('mr-3', activeView === 'home' ? 'text-on-surface' : 'text-on-surface-variant')} size={18} />
            <span className="flex-1">Home</span>
          </motion.button>

          <motion.button whileHover={{ x: 4 }} type="button" onClick={() => onNavigate('masters')} className={cn(sectionRowClass, activeView === 'masters' ? activeRowClass : '')}>
            <Database className={cn('mr-3', activeView === 'masters' ? 'text-on-surface' : 'text-on-surface')} size={18} />
            <span className="flex-1">Masters</span>
            <ChevronDown size={16} className={cn('ml-2 transition-transform', mastersExpanded ? 'rotate-180' : 'rotate-0', activeView === 'masters' ? 'text-on-surface' : 'text-on-surface')} />
          </motion.button>
          {mastersExpanded ? (
            <div className="ml-7 mr-1 space-y-1">
              {MASTERS_TABS.map((t) => (
                <button key={t.key} type="button" onClick={() => onNavigateMastersTab?.(t.key)} className={cn(subRowClass, activeMastersTab === t.key ? subActiveClass : subInactiveClass)}>
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}

          <motion.button whileHover={{ x: 4 }} type="button" onClick={() => onNavigate('pendingTasks')} className={cn(sectionRowClass, pendingExpanded ? activeRowClass : '')}>
            <ClipboardList className={cn('mr-3', pendingExpanded ? 'text-on-surface' : 'text-on-surface')} size={18} />
            <span className="flex-1">Pending Tasks</span>
            <ChevronDown size={16} className={cn('ml-2 transition-transform', pendingExpanded ? 'rotate-180' : 'rotate-0', pendingExpanded ? 'text-on-surface' : 'text-on-surface')} />
          </motion.button>
          {pendingExpanded && onNavigatePendingQueue ? (
            <div className="ml-7 mr-1 space-y-1">
              {pendingQueueItems.map((q) => (
                <motion.button
                  key={q.key}
                  whileHover={{ x: 4 }}
                  type="button"
                  onClick={() => onNavigatePendingQueue(q.key)}
                  className={cn(subRowClass, activePendingQueue === q.key ? subActiveClass : subInactiveClass)}
                >
                  {q.label}
                </motion.button>
              ))}
            </div>
          ) : null}

          <motion.button whileHover={{ x: 4 }} type="button" onClick={() => onNavigate('stockMaster')} className={cn(sectionRowClass, stockMasterExpanded ? activeRowClass : '')}>
            <Package className={cn('mr-3', stockMasterExpanded ? 'text-on-surface' : 'text-on-surface')} size={18} />
            <span className="flex-1">Stock</span>
            <ChevronDown size={16} className={cn('ml-2 transition-transform', stockMasterExpanded ? 'rotate-180' : 'rotate-0', stockMasterExpanded ? 'text-on-surface' : 'text-on-surface')} />
          </motion.button>
          {stockMasterExpanded && onNavigateStockView ? (
            <div className="ml-7 mr-1 space-y-1">
              <button type="button" onClick={() => onNavigateStockView('inventory')} className={cn(subRowClass, activeView === 'inventory' ? subActiveClass : subInactiveClass)}>
                <span className="inline-flex items-center gap-2">
                  <Package size={14} />
                  Inventory
                </span>
              </button>
              <button type="button" onClick={() => onNavigateStockView('issueMaster')} className={cn(subRowClass, activeView === 'issueMaster' ? subActiveClass : subInactiveClass)}>
                <span className="inline-flex items-center gap-2">
                  <ArrowUpRight size={14} />
                  Issue Master
                </span>
              </button>
              <button type="button" onClick={() => onNavigateStockView('returnMaster')} className={cn(subRowClass, activeView === 'returnMaster' ? subActiveClass : subInactiveClass)}>
                <span className="inline-flex items-center gap-2">
                  <ArrowDownLeft size={14} />
                  Return Master
                </span>
              </button>
              <button type="button" onClick={() => onNavigateStockView('damageMaster')} className={cn(subRowClass, activeView === 'damageMaster' ? subActiveClass : subInactiveClass)}>
                <span className="inline-flex items-center gap-2">
                  <AlertTriangle size={14} />
                  Damage Master
                </span>
              </button>
              <button type="button" onClick={() => onNavigateStockView('transferMaster')} className={cn(subRowClass, activeView === 'transferMaster' ? subActiveClass : subInactiveClass)}>
                <span className="inline-flex items-center gap-2">
                  <Boxes size={14} />
                  Transfer Master
                </span>
              </button>
            </div>
          ) : null}

          <motion.button whileHover={{ x: 4 }} type="button" onClick={() => onNavigate('operations')} className={cn(sectionRowClass, purchaseMastersExpanded ? activeRowClass : '')}>
            <ShoppingCart className={cn('mr-3', purchaseMastersExpanded ? 'text-on-surface' : 'text-on-surface')} size={18} />
            <span className="flex-1">Purchase Masters</span>
            <ChevronDown size={16} className={cn('ml-2 transition-transform', purchaseMastersExpanded ? 'rotate-180' : 'rotate-0', purchaseMastersExpanded ? 'text-on-surface' : 'text-on-surface')} />
          </motion.button>
          {purchaseMastersExpanded && onNavigatePurchaseMasters ? (
            <div className="ml-7 mr-1 space-y-1">
              <button type="button" onClick={() => onNavigatePurchaseMasters('prs')} className={cn(subRowClass, activeView === 'purchasing' ? subActiveClass : subInactiveClass)}>
                <span className="inline-flex items-center gap-2">
                  <FileText size={14} />
                  Requisitions
                </span>
              </button>
              <button type="button" onClick={() => onNavigatePurchaseMasters('pos')} className={cn(subRowClass, activeView === 'operations' && activeOperationsTab === 'pos' ? subActiveClass : subInactiveClass)}>
                <span className="inline-flex items-center gap-2">
                  <Receipt size={14} />
                  Purchase Orders
                </span>
              </button>
              <button type="button" onClick={() => onNavigatePurchaseMasters('grns')} className={cn(subRowClass, activeView === 'operations' && activeOperationsTab === 'grns' ? subActiveClass : subInactiveClass)}>
                <span className="inline-flex items-center gap-2">
                  <Truck size={14} />
                  GRN
                </span>
              </button>
              <button type="button" onClick={() => onNavigatePurchaseMasters('invoices')} className={cn(subRowClass, activeView === 'operations' && activeOperationsTab === 'invoices' ? subActiveClass : subInactiveClass)}>
                <span className="inline-flex items-center gap-2">
                  <FileText size={14} />
                  Invoices
                </span>
              </button>
              <button type="button" onClick={() => onNavigatePurchaseMasters('payments')} className={cn(subRowClass, activeView === 'operations' && activeOperationsTab === 'payments' ? subActiveClass : subInactiveClass)}>
                <span className="inline-flex items-center gap-2">
                  <CreditCard size={14} />
                  Payments
                </span>
              </button>
            </div>
          ) : null}
        </nav>

		      <div className="px-4 py-6 border-t border-outline-variant/10 shrink-0 bg-surface-container-lowest">
		        <button
		          type="button"
		          className="flex items-center px-4 py-2 bg-surface-container-high text-on-surface-variant hover:bg-surface-container rounded-lg transition-colors font-sans text-sm tracking-wide w-full text-left border border-outline-variant/20"
		          onClick={() => {}}
		        >
		          <LogOut className="mr-3" size={18} />
		          Logout
		        </button>
		      </div>
		    </aside>
		  );
		}
