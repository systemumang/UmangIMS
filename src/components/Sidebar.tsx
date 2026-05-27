import React, { useMemo } from 'react';
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
  IndianRupee,
  LayoutDashboard,
  Package,
  Receipt,
  ShoppingCart,
  Truck,
  LogOut,
  Settings,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { motion } from 'motion/react';
import { MASTERS_TABS, type MastersTab } from '@/src/lib/mastersTabs';

export type NavView =
  | 'dashboard'
  | 'purchasing'
  | 'operations'
  | 'inventory'
  | 'masters'
  | 'pendingTasks'
  | 'quotation'
  | 'pendingSupplierRate'
  | 'quotationMaster'
  | 'stockMaster'
  | 'material'
  | 'materialRequest'
  | 'materialPendingIssue'
  | 'settings'
  | 'settingsCatalogue'
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
  | 'queueEnterCreditVoucher'
  | 'queueApproveInvoice'
  | 'queueApproveCreditVoucher'
  | 'queueTallyEntry'
  | 'queueLinkInvoiceGrn'
  | 'queuePayment'
  | 'queueCreditVoucherPayment';

export const pendingQueueItems: Array<{ key: PendingQueueKey; label: string }> = [
  { key: 'queueApprovePr', label: 'Approve PR' },
  { key: 'queueCreatePo', label: 'Create PO' },
  { key: 'queueCheckPo', label: 'Check PO' },
  { key: 'queueSendPo', label: 'Send PO' },
  { key: 'queueCreateGrn', label: 'Create GRN' },
  { key: 'queueCheckQuality', label: 'Check Quality' },
  { key: 'queueEnterInvoice', label: 'Enter Invoice' },
  { key: 'queueEnterCreditVoucher', label: 'Enter Credit Voucher' },
  { key: 'queueApproveInvoice', label: 'Approve Invoice' },
  { key: 'queueApproveCreditVoucher', label: 'Approve Credit Voucher' },
  { key: 'queueTallyEntry', label: 'Tally Entry' },
  { key: 'queueLinkInvoiceGrn', label: 'Link Invoice ↔ GRN' },
  { key: 'queuePayment', label: 'Pending Payment' },
  { key: 'queueCreditVoucherPayment', label: 'Pending Credit Voucher Payment' },
];

export const stockMenuItems: Array<{ key: NavView; label: string }> = [
  { key: 'inventory', label: 'Inventory' },
  { key: 'issueMaster', label: 'Issue Master' },
  { key: 'returnMaster', label: 'Return Master' },
  { key: 'damageMaster', label: 'Damage Master' },
  { key: 'transferMaster', label: 'Transfer Master' },
];

export const purchaseMastersMenuItems: Array<{ key: 'prs' | 'pos' | 'pendingAdjustments' | 'grns' | 'invoices' | 'payments'; label: string }> = [
  { key: 'prs', label: 'Requisitions' },
  { key: 'pos', label: 'Purchase Orders' },
  { key: 'pendingAdjustments', label: 'Pending Advance Adjustment' },
  { key: 'grns', label: 'GRN' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'payments', label: 'Payments' },
];

export const topLevelMenuItems: Array<{ key: NavView; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'settingsCatalogue', label: 'Catalogue' },
  { key: 'masters', label: 'Masters' },
  { key: 'pendingTasks', label: 'Pending Tasks' },
  { key: 'stockMaster', label: 'Stock' },
  { key: 'material', label: 'Material' },
  { key: 'operations', label: 'Purchase Masters' },
  { key: 'quotation', label: 'Quotation' },
  { key: 'settings', label: 'Settings' },
];

export const quotationMenuItems: Array<{ key: 'pendingSupplierRate' | 'quotationMaster'; label: string }> = [
  { key: 'pendingSupplierRate', label: 'Pending Supplier Rate' },
  { key: 'quotationMaster', label: 'Quotation Master' },
];

export const materialMenuItems: Array<{ key: NavView; label: string }> = [
  { key: 'materialRequest', label: 'Request Material' },
  { key: 'materialPendingIssue', label: 'Pending Issue' },
];
export const settingsMenuItems: Array<{ key: NavView; label: string }> = [
  { key: 'settingsCatalogue', label: 'Links' },
];

export type StockMasterTab = 'itemIssue' | 'return' | 'damage' | 'transfer';

type PurchaseMastersTab = 'prs' | 'pos' | 'pendingAdjustments' | 'grns' | 'invoices' | 'payments';

export default function Sidebar({
  activeView,
  activePendingQueue,
  pendingQueueCounts,
  mastersCounts,
  activeMastersTab,
  mastersExpanded,
  pendingExpanded,
  stockMasterExpanded,
  materialExpanded,
  settingsExpanded,
  purchaseMastersExpanded,
  quotationExpanded,
  activeQuotationView,
  activeOperationsTab,
  purchaseMastersCounts,
  isNewPurchaseRequestActive,
  onNavigate,
  onNavigatePendingQueue,
  onNavigateMastersTab,
  onNavigateStockView,
  onNavigateMaterialView,
  onNavigateSettingsView,
  onNavigatePurchaseMasters,
  onNewPurchaseRequest,
  onDirectPo,
  currentUserName,
  menuAccessKeys,
  onLogout,
  open = true,
			}: {
		  activeView: NavView;
		  activePendingQueue?: PendingQueueKey;
      pendingQueueCounts?: Partial<Record<PendingQueueKey, number>>;
      mastersCounts?: Partial<Record<MastersTab, number>>;
		  activeMastersTab?: MastersTab;
		  mastersExpanded?: boolean;
		  pendingExpanded?: boolean;
		  stockMasterExpanded?: boolean;
        materialExpanded?: boolean;
      settingsExpanded?: boolean;
      purchaseMastersExpanded?: boolean;
      activeOperationsTab?: PurchaseMastersTab;
  purchaseMastersCounts?: Partial<Record<PurchaseMastersTab, number>>;
  quotationExpanded?: boolean;
  activeQuotationView?: 'pendingSupplierRate' | 'quotationMaster';
  isNewPurchaseRequestActive?: boolean;
  onNavigate: (view: NavView) => void;
	  onNavigatePendingQueue?: (key: PendingQueueKey) => void;
	  onNavigateMastersTab?: (tab: MastersTab) => void;
	  onNavigateStockView?: (view: NavView) => void;
  onNavigateMaterialView?: (view: NavView) => void;
  onNavigateSettingsView?: (view: NavView) => void;
      onNavigatePurchaseMasters?: (tab: PurchaseMastersTab) => void;
	  onNewPurchaseRequest: () => void;
  onDirectPo?: () => void;
  currentUserName?: string;
  menuAccessKeys?: string[];
  onLogout?: () => void;
  open?: boolean;
			}) {
		  const allowed = useMemo(() => new Set((menuAccessKeys ?? []).map((x) => String(x))), [menuAccessKeys]);
		  const hasAny = allowed.size > 0;
		  const isAllowed = (key: string) => (!hasAny ? true : allowed.has(String(key)));
		  const isMasterTabAllowed = (tab: MastersTab) => {
		    if (!hasAny) return true;
		    if (allowed.has(`masters:${tab}`)) return true;
		    // Backward compatibility: older users may have top-level Masters access
		    // or only legacy masters:* keys saved before newly added master tabs existed.
		    if (tab === 'priorities' || tab === 'states' || tab === 'cities') {
		      if (allowed.has('masters')) return true;
		      for (const k of allowed) {
		        if (k.startsWith('masters:')) return true;
		      }
		    }
		    return false;
		  };
			  const hasPrefix = (prefix: string) => {
			    if (!hasAny) return true;
			    for (const k of allowed) if (k.startsWith(prefix)) return true;
			    return false;
			  };

			  const isQuotationAllowed = () => {
			    if (!hasAny) return true;
			    if (allowed.has('quotation')) return true;
			    if (hasPrefix('quotation:')) return true;
			    // Backward compatibility: older users may have this view access saved directly.
			    if (allowed.has('pendingSupplierRate')) return true;
			    return false;
			  };

			  const isQuotationViewAllowed = (k: 'pendingSupplierRate' | 'quotationMaster') => {
			    if (!hasAny) return true;
			    if (allowed.has(`quotation:${k}`)) return true;
			    if (allowed.has('quotation')) return true;
			    if (k === 'pendingSupplierRate' && allowed.has('pendingSupplierRate')) return true;
			    return false;
			  };

	  const borderClass = 'border-2 border-[#1f2937]';
	  const baseRowClass = `flex items-center px-4 py-2.5 rounded-md transition-colors font-sans text-sm tracking-wide w-full text-left ${borderClass}`;
	  const sectionRowClass = cn(baseRowClass, 'bg-[#3b82f6] text-white hover:bg-[#60a5fa] border-[#1f2937]');
	  const viewRowClass = cn(baseRowClass, 'bg-[#3b82f6] text-white hover:bg-[#60a5fa] border-[#1f2937]');
	  const activeRowClass = 'bg-[#dc2626] hover:bg-[#dc2626] text-white font-semibold border-[#7f1d1d] shadow-[inset_0_0_0_1px_#7f1d1d]';

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
	          {isAllowed('dashboard') ? (
	            <motion.button whileHover={{ x: 4 }} type="button" onClick={() => onNavigate('dashboard')} className={cn(viewRowClass, activeView === 'dashboard' ? activeRowClass : '')}>
	              <LayoutDashboard className="mr-3 text-white" size={18} />
	              <span className="flex-1">Dashboard</span>
	            </motion.button>
	          ) : null}

		          {isAllowed('masters') || hasPrefix('masters:') ? (
	            <motion.button whileHover={{ x: 4 }} type="button" onClick={() => onNavigate('masters')} className={cn(sectionRowClass, activeView === 'masters' ? activeRowClass : '')}>
	              <Database className="mr-3 text-white" size={18} />
	              <span className="flex-1">Masters</span>
	              <ChevronDown size={16} className={cn('ml-2 transition-transform text-white', mastersExpanded ? 'rotate-180' : 'rotate-0')} />
	            </motion.button>
	          ) : null}
		          {mastersExpanded ? (
		            <div className="ml-7 mr-1 space-y-1">
			              {MASTERS_TABS.filter((t) => isMasterTabAllowed(t.key)).map((t) => (
			                <button key={t.key} type="button" onClick={() => onNavigateMastersTab?.(t.key)} className={cn(subRowClass, activeMastersTab === t.key ? subActiveClass : subInactiveClass)}>
		                    <span className="flex items-center justify-between gap-2 w-full">
			                     <span>{t.label}</span>
	                      <span className="inline-flex min-w-[20px] h-5 px-1.5 items-center justify-center rounded bg-primary/15 text-on-surface text-[11px] font-bold">
	                        {Number(mastersCounts?.[t.key] ?? 0)}
	                      </span>
	                    </span>
		                </button>
		              ))}
	            </div>
	          ) : null}

	          {isAllowed('pendingTasks') || hasPrefix('pending:') ? (
	            <motion.button whileHover={{ x: 4 }} type="button" onClick={() => onNavigate('pendingTasks')} className={cn(sectionRowClass, pendingExpanded ? activeRowClass : '')}>
	              <ClipboardList className="mr-3 text-white" size={18} />
	              <span className="flex-1">Pending Tasks</span>
	              <ChevronDown size={16} className={cn('ml-2 transition-transform text-white', pendingExpanded ? 'rotate-180' : 'rotate-0')} />
	            </motion.button>
	          ) : null}
          {pendingExpanded && onNavigatePendingQueue ? (
            <div className="ml-7 mr-1 space-y-1">
			              {pendingQueueItems
			                .filter((q) => {
			                  const direct = isAllowed(`pending:${q.key}`);
			                  if (direct) return true;
			                  if (q.key === 'queueApproveInvoice') return isAllowed('pending:queueEnterInvoice');
			                  if (q.key === 'queueTallyEntry') return isAllowed('pending:queuePayment');
			                  return false;
			                })
			                .map((q) => (
			                <motion.button
	                  key={q.key}
                  whileHover={{ x: 4 }}
                  type="button"
                  onClick={() => onNavigatePendingQueue(q.key)}
	                  className={cn(subRowClass, activePendingQueue === q.key ? subActiveClass : subInactiveClass)}
	                >
                    {(() => {
                      const count = Number(pendingQueueCounts?.[q.key] ?? 0);
                      return (
                    <span className="flex items-center justify-between gap-2 w-full">
                      <span>{q.label}</span>
                      <span
                        className={cn(
                          'inline-flex min-w-[20px] h-5 px-1.5 items-center justify-center rounded text-[11px] font-bold',
                          count > 0 ? 'bg-red-100 text-red-700 border border-red-500' : 'bg-primary/15 text-on-surface'
                        )}
                      >
                        {count}
                      </span>
                    </span>
                      );
                    })()}
	                </motion.button>
	              ))}
	            </div>
	          ) : null}

	          {isAllowed('stockMaster') || hasPrefix('stock:') ? (
	            <motion.button whileHover={{ x: 4 }} type="button" onClick={() => onNavigate('stockMaster')} className={cn(sectionRowClass, stockMasterExpanded ? activeRowClass : '')}>
	              <Package className="mr-3 text-white" size={18} />
	              <span className="flex-1">Stock</span>
	              <ChevronDown size={16} className={cn('ml-2 transition-transform text-white', stockMasterExpanded ? 'rotate-180' : 'rotate-0')} />
	            </motion.button>
	          ) : null}
		          {stockMasterExpanded && onNavigateStockView ? (
		            <div className="ml-7 mr-1 space-y-1">
                {stockMenuItems.filter((it) => isAllowed(`stock:${it.key}`)).map((it) => (
	                  <button
                    key={it.key}
                    type="button"
                    onClick={() => onNavigateStockView(it.key)}
                    className={cn(subRowClass, activeView === it.key ? subActiveClass : subInactiveClass)}
                  >
                    <span className="inline-flex items-center gap-2">
                      {it.key === 'inventory' ? (
                        <Package size={14} />
                      ) : it.key === 'issueMaster' ? (
                        <ArrowUpRight size={14} />
                      ) : it.key === 'returnMaster' ? (
                        <ArrowDownLeft size={14} />
                      ) : it.key === 'damageMaster' ? (
                        <AlertTriangle size={14} />
                      ) : (
                        <Boxes size={14} />
                      )}
                      {it.label}
                    </span>
                  </button>
	                ))}
		            </div>
		          ) : null}

	          {isAllowed('material') || hasPrefix('material:') ? (
	            <motion.button whileHover={{ x: 4 }} type="button" onClick={() => onNavigate('material')} className={cn(sectionRowClass, materialExpanded ? activeRowClass : '')}>
	              <FileText className="mr-3 text-white" size={18} />
	              <span className="flex-1">Material</span>
	              <ChevronDown size={16} className={cn('ml-2 transition-transform text-white', materialExpanded ? 'rotate-180' : 'rotate-0')} />
	            </motion.button>
	          ) : null}
	          {materialExpanded && onNavigateMaterialView ? (
	            <div className="ml-7 mr-1 space-y-1">
	              {materialMenuItems.filter((it) => isAllowed(`material:${it.key}`)).map((it) => (
	                <button
	                  key={it.key}
	                  type="button"
	                  onClick={() => onNavigateMaterialView(it.key)}
	                  className={cn(subRowClass, activeView === it.key ? subActiveClass : subInactiveClass)}
	                >
	                  <span className="inline-flex items-center gap-2">
	                    {it.key === 'materialRequest' ? <FileText size={14} /> : <ArrowUpRight size={14} />}
	                    {it.label}
	                  </span>
	                </button>
	              ))}
	            </div>
	          ) : null}

		          {isAllowed('operations') || hasPrefix('purchase:') ? (
	            <motion.button whileHover={{ x: 4 }} type="button" onClick={() => onNavigate('operations')} className={cn(sectionRowClass, purchaseMastersExpanded ? activeRowClass : '')}>
	              <ShoppingCart className="mr-3 text-white" size={18} />
	              <span className="flex-1">Purchase Masters</span>
	              <ChevronDown size={16} className={cn('ml-2 transition-transform text-white', purchaseMastersExpanded ? 'rotate-180' : 'rotate-0')} />
	            </motion.button>
	          ) : null}
				          {purchaseMastersExpanded && onNavigatePurchaseMasters ? (
			            <div className="ml-7 mr-1 space-y-1">
                  {purchaseMastersMenuItems.filter((it) => isAllowed(`purchase:${it.key}`)).map((it) => (
	                    <button
                      key={it.key}
                      type="button"
                      onClick={() => onNavigatePurchaseMasters(it.key)}
                      className={cn(
                        subRowClass,
                        it.key === 'prs'
                          ? activeView === 'purchasing'
                            ? subActiveClass
                            : subInactiveClass
                          : activeView === 'operations' && activeOperationsTab === it.key
                            ? subActiveClass
                            : subInactiveClass
                      )}
                    >
                      <span className="inline-flex items-center justify-between gap-2 w-full">
                        <span className="inline-flex items-center gap-2">
                          {it.key === 'pos' ? <Receipt size={14} /> : it.key === 'grns' ? <Truck size={14} /> : it.key === 'payments' ? <CreditCard size={14} /> : <FileText size={14} />}
                          {it.label}
                        </span>
                        <span className="inline-flex min-w-[20px] h-5 px-1.5 items-center justify-center rounded bg-primary/15 text-on-surface text-[11px] font-bold">
                          {Number((purchaseMastersCounts as any)?.[it.key] ?? 0)}
                        </span>
                      </span>
                    </button>
                  ))}
		            </div>
				          ) : null}

	          {isQuotationAllowed() ? (
	            <>
	              <motion.button
	                whileHover={{ x: 4 }}
	                type="button"
	                onClick={() => onNavigate('quotation')}
	                className={cn(sectionRowClass, quotationExpanded || activeQuotationView ? activeRowClass : '')}
	              >
	                <FileText className="mr-3 text-white" size={18} />
	                <span className="flex-1">Quotation</span>
	                <ChevronDown size={16} className={cn('ml-2 transition-transform text-white', quotationExpanded ? 'rotate-180' : 'rotate-0')} />
	              </motion.button>
	              {quotationExpanded ? (
	                <div className="ml-7 mr-1 space-y-1">
	                  {quotationMenuItems.filter((it) => isQuotationViewAllowed(it.key)).map((it) => (
	                    <button
	                      key={it.key}
	                      type="button"
	                      onClick={() => onNavigate(it.key)}
	                      className={cn(subRowClass, activeQuotationView === it.key ? subActiveClass : subInactiveClass)}
	                    >
	                      <span className="inline-flex items-center gap-2">
	                        {it.key === 'pendingSupplierRate' ? <IndianRupee size={14} /> : <ClipboardList size={14} />}
	                        {it.label}
	                      </span>
	                    </button>
	                  ))}
	                </div>
	              ) : null}
	            </>
	          ) : null}

	          {isAllowed('settings') || hasPrefix('settings:') ? (
	            <motion.button whileHover={{ x: 4 }} type="button" onClick={() => onNavigate('settings')} className={cn(sectionRowClass, settingsExpanded ? activeRowClass : '')}>
	              <Settings className="mr-3 text-white" size={18} />
	              <span className="flex-1">Settings</span>
	              <ChevronDown size={16} className={cn('ml-2 transition-transform text-white', settingsExpanded ? 'rotate-180' : 'rotate-0')} />
	            </motion.button>
	          ) : null}
          {settingsExpanded && onNavigateSettingsView ? (
            <div className="ml-7 mr-1 space-y-1">
	              {settingsMenuItems.filter((it) => isAllowed(`settings:${it.key}`) || isAllowed(it.key)).map((it) => (
	                <button
	                  key={it.key}
	                  type="button"
	                  onClick={() => onNavigateSettingsView(it.key)}
	                  className={cn(subRowClass, activeView === it.key ? subActiveClass : subInactiveClass)}
	                >
	                  <span className="inline-flex items-center gap-2">
	                    {it.key === 'settingsCatalogue' ? <FileText size={14} /> : <Settings size={14} />}
	                    {it.label}
	                  </span>
	                </button>
	              ))}
            </div>
          ) : null}
	        </nav>

			      <div className="px-4 py-6 border-t border-outline-variant/10 shrink-0 bg-surface-container-lowest space-y-2">
			        {currentUserName ? (
			          <div className="text-xs text-on-surface-variant">
			            Logged in as: <span className="font-semibold text-on-surface">{currentUserName}</span>
			          </div>
			        ) : null}
				        <button
				          type="button"
				          className="flex items-center px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors font-sans text-sm tracking-wide w-full text-left border border-red-700/70"
				          onClick={() => onLogout?.()}
				        >
				          <LogOut className="mr-3" size={18} />
				          Logout
				        </button>
			      </div>
		    </aside>
		  );
		}
