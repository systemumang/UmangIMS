import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import Sidebar, { type NavView, type PendingQueueKey, type StockMasterTab } from './components/Sidebar';
import TopBar from './components/TopBar';
import PowerBIDashboardView from './components/views/PowerBIDashboardView';
import InventoryView from './components/views/InventoryView';
import PurchasingView from './components/views/PurchasingView';
import OperationsView from './components/views/OperationsView';
import NewPurchaseRequestView from './components/views/NewPurchaseRequestView';
import PurchaseRequestDetailView from './components/views/PurchaseRequestDetailView';
import MastersView from './components/views/MastersView';
import ApprovePrQueueView from './components/views/queues/ApprovePrQueueView';
import CreatePoQueueView from './components/views/queues/CreatePoQueueView';
import CheckPoQueueView from './components/views/queues/CheckPoQueueView';
import SendPoQueueView from './components/views/queues/SendPoQueueView';
import CreateGrnQueueView from './components/views/queues/CreateGrnQueueView';
import QcQueueView from './components/views/queues/QcQueueView';
import EnterInvoiceQueueView from './components/views/queues/EnterInvoiceQueueView';
import ApproveInvoiceQueueView from './components/views/queues/ApproveInvoiceQueueView';
import LinkInvoiceGrnQueueView from './components/views/queues/LinkInvoiceGrnQueueView';
import PaymentQueueView from './components/views/queues/PaymentQueueView';
import Spinner from './components/common/Spinner';
import ItemIssueView from './components/views/ItemIssueView';
import ReturnView from './components/views/ReturnView';
import DamageView from './components/views/DamageView';
import StockTransferView from './components/views/StockTransferView';
import IssueMasterView from './components/views/IssueMasterView';
import ReturnMasterView from './components/views/ReturnMasterView';
import DamageMasterView from './components/views/DamageMasterView';
import TransferMasterView from './components/views/TransferMasterView';
import DirectPoView from './components/views/DirectPoView';
import { type MastersTab } from '@/src/lib/mastersTabs';
import { cn } from '@/src/lib/utils';
import { loginWithLoginId, type AuthUser } from '@/src/lib/auth';
import {
  fetchCustomers,
  fetchDepartments,
  fetchFirms,
  fetchItemCategories,
  fetchItemNames,
  fetchItems,
  fetchPriorities,
  fetchProjects,
  fetchSpecificationValues,
  fetchSpecifications,
  fetchStores,
  fetchSuppliers,
  fetchTransporters,
  fetchUnits,
  fetchUsers,
} from '@/src/lib/masters';
import {
  fetchOperationsGrns,
  fetchOperationsInvoices,
  fetchOperationsPayments,
  fetchOperationsPos,
  fetchOperationsPrs,
} from '@/src/lib/operations';
import {
  fetchQueueApprovePr,
  fetchQueueCheckPo,
  fetchQueueCreateGrn,
  fetchQueueCreatePo,
  fetchQueueEnterInvoice,
  fetchQueueApproveInvoice,
  fetchQueueLinkInvoiceGrn,
  fetchQueuePayment,
  fetchQueueTallyEntry,
  fetchQueueQc,
  fetchQueueSendPo,
} from '@/src/lib/queues';

import RequestMaterialView from './components/views/RequestMaterialView';
import PendingIssueView from './components/views/PendingIssueView';
import SettingsCatalogueView from './components/views/SettingsCatalogueView';
	import PendingSupplierRateView from './components/views/PendingSupplierRateView';
	import QuotationMasterView from './components/views/QuotationMasterView';

export default function App() {
		  type PendingQueueView = PendingQueueKey;
		  type View =
		    | NavView
		    | PendingQueueView
		    | 'newPurchaseRequest'
		    | 'purchaseRequestDetail'
		    | 'directPo'
		    | 'stockMaster'
		    | 'issueMaster'
		    | 'returnMaster'
		    | 'damageMaster'
		    | 'transferMaster'
        | 'settingsCatalogue';
			  const isPendingQueueView = (v: View): v is PendingQueueView => String(v).startsWith('queue');
			  const [view, setView] = useState<NavView>('dashboard');
			  const [activeMaterialRequest, setActiveMaterialRequest] = useState<any | null>(null);

			  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
			    try {
			      const raw = sessionStorage.getItem('ims.currentUser');
			      if (!raw) return null;
			      return JSON.parse(raw) as AuthUser;
			    } catch {
			      return null;
			    }
			  });
			  const [loginId, setLoginId] = useState('');
			  const [loginPassword, setLoginPassword] = useState('');
			  const [loginBusy, setLoginBusy] = useState(false);
			  const [loginError, setLoginError] = useState<string | null>(null);
			  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
		  const [detailBackView, setDetailBackView] = useState<View>('dashboard');
			  const [mastersTab, setMastersTab] = useState<MastersTab>('firms');
			  const [mastersExpanded, setMastersExpanded] = useState(false);
			  const [pendingExpanded, setPendingExpanded] = useState(false);
			  const [stockMasterTab, setStockMasterTab] = useState<StockMasterTab>('itemIssue');
			  const [stockMasterExpanded, setStockMasterExpanded] = useState(false);
			  const [materialExpanded, setMaterialExpanded] = useState(false);
	        const [settingsExpanded, setSettingsExpanded] = useState(false);
	        const [purchaseMastersExpanded, setPurchaseMastersExpanded] = useState(false);
	        const [quotationExpanded, setQuotationExpanded] = useState(false);
	        const [operationsTab, setOperationsTab] = useState<'prs' | 'pos' | 'grns' | 'invoices' | 'payments'>('prs');
		  const [sidebarOpen, setSidebarOpen] = useState(true);
      const [pendingQueueCounts, setPendingQueueCounts] = useState<Partial<Record<PendingQueueKey, number>>>({});
      const [mastersCounts, setMastersCounts] = useState<Partial<Record<MastersTab, number>>>({});
      const [purchaseMastersCounts, setPurchaseMastersCounts] = useState<Partial<Record<'prs' | 'pos' | 'grns' | 'invoices' | 'payments', number>>>({});

		  const [inFlightCount, setInFlightCount] = useState(0);  const [writeFlowActive, setWriteFlowActive] = useState(false);
  const inFlightRef = useRef(0);
  const mountedRef = useRef(true);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const originalFetch = window.fetch.bind(window);

    const getMethod = (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method) return String(init.method).toUpperCase();
      if (typeof Request !== 'undefined' && input instanceof Request) return String(input.method || 'GET').toUpperCase();
      return 'GET';
    };

    // Track ALL fetches, but show overlay only during write flows (POST/PUT/PATCH/DELETE + their refresh GETs).
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const method = getMethod(input, init);
      const isWrite = method !== 'GET' && method !== 'HEAD';

      if (hideTimerRef.current != null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      inFlightRef.current += 1;
      if (mountedRef.current) setInFlightCount(inFlightRef.current);
      if (isWrite) {
        if (mountedRef.current) setWriteFlowActive(true);
      }

      const p = Promise.resolve(originalFetch(input as any, init as any));
      return p.finally(() => {
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
        if (mountedRef.current) setInFlightCount(inFlightRef.current);

        if (inFlightRef.current === 0) {
          hideTimerRef.current = window.setTimeout(() => {
            hideTimerRef.current = null;
            if (!mountedRef.current) return;
            setWriteFlowActive(false);
          }, 200);
        }
      });
    }) as typeof window.fetch;

    return () => {
      mountedRef.current = false;
      if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
      window.fetch = originalFetch;
    };
  }, []);

	  useEffect(() => {
	    if (!currentUser) return;
	    const ac = new AbortController();
	    Promise.all([
	      fetchQueueApprovePr(undefined, ac.signal).then((r) => ['queueApprovePr', r.length] as const),
      fetchQueueCreatePo(undefined, ac.signal).then((r) => ['queueCreatePo', r.length] as const),
      fetchQueueCheckPo(undefined, ac.signal).then((r) => ['queueCheckPo', r.length] as const),
      fetchQueueSendPo(undefined, ac.signal).then((r) => ['queueSendPo', r.length] as const),
      fetchQueueCreateGrn(undefined, ac.signal).then((r) => ['queueCreateGrn', r.length] as const),
	      fetchQueueQc(undefined, ac.signal).then((r) => ['queueCheckQuality', r.length] as const),
	      fetchQueueEnterInvoice(undefined, ac.signal).then((r) => ['queueEnterInvoice', r.length] as const),
	      fetchQueueApproveInvoice(undefined, ac.signal).then((r) => ['queueApproveInvoice', r.length] as const),
	      fetchQueueTallyEntry(undefined, ac.signal).then((r) => ['queueTallyEntry', r.length] as const),
	      fetchQueueLinkInvoiceGrn(undefined, ac.signal).then((r) => ['queueLinkInvoiceGrn', r.length] as const),
      fetchQueuePayment(undefined, ac.signal).then((r) => ['queuePayment', r.length] as const),
    ])
      .then((pairs) => {
        const next: Partial<Record<PendingQueueKey, number>> = {};
        for (const [k, v] of pairs) next[k] = v;
        setPendingQueueCounts(next);
      })
      .catch(() => {});
    return () => ac.abort();
	  }, [currentUser, view]);

	  useEffect(() => {
	    if (!currentUser) return;
	    const ac = new AbortController();
	    Promise.all([
	      fetchOperationsPrs(undefined, ac.signal).then((r) => ['prs', r.length] as const),
      fetchOperationsPos(undefined, ac.signal).then((r) => ['pos', r.length] as const),
      fetchOperationsGrns(undefined, ac.signal).then((r) => ['grns', r.length] as const),
      fetchOperationsInvoices(undefined, ac.signal).then((r) => ['invoices', r.length] as const),
      fetchOperationsPayments(undefined, ac.signal).then((r) => ['payments', r.length] as const),
    ])
      .then((pairs) => {
        const next: Partial<Record<'prs' | 'pos' | 'grns' | 'invoices' | 'payments', number>> = {};
        for (const [k, v] of pairs) next[k] = v;
        setPurchaseMastersCounts(next);
      })
      .catch(() => {});
    return () => ac.abort();
	  }, [currentUser, view]);

	  useEffect(() => {
	    if (!currentUser) return;
	    const ac = new AbortController();
	    Promise.all([
	      fetchFirms(ac.signal).then((r) => ['firms', r.length] as const),
      fetchStores(ac.signal).then((r) => ['stores', r.length] as const),
      fetchDepartments(ac.signal).then((r) => ['departments', r.length] as const),
      fetchUsers(ac.signal).then((r) => ['users', r.length] as const),
      fetchSuppliers(ac.signal).then((r) => ['suppliers', r.length] as const),
      fetchCustomers(ac.signal).then((r) => ['customers', r.length] as const),
	      fetchTransporters(ac.signal).then((r) => ['transporters', r.length] as const),
	      fetchProjects(ac.signal).then((r) => ['projects', r.length] as const),
	      fetchUnits(ac.signal).then((r) => ['units', r.length] as const),
	      fetchPriorities(ac.signal).then((r) => ['priorities', r.length] as const),
	      fetchItemCategories(ac.signal).then((r) => ['itemCategories', r.length] as const),
	      fetchItemNames(ac.signal).then((r) => ['itemNames', r.length] as const),
	      fetchSpecifications(ac.signal).then((r) => ['specs', r] as const),
      fetchItems(ac.signal).then((r) => ['items', r.length] as const),
    ])
      .then(async (pairs) => {
        const next: Partial<Record<MastersTab, number>> = {};
        let specs: Array<{ id: string }> = [];
        for (const [k, v] of pairs as any) {
          if (k === 'specs') {
            specs = Array.isArray(v) ? v : [];
            next.specs = specs.length;
          } else {
            (next as any)[k] = Number(v ?? 0);
          }
        }
        if (specs.length) {
          const valueCounts = await Promise.all(
            specs.map((s) =>
              fetchSpecificationValues(String(s.id ?? ''), ac.signal)
                .then((rows) => rows.length)
                .catch(() => 0)
            )
          );
          next.specValues = valueCounts.reduce((a, b) => a + b, 0);
        } else {
          next.specValues = 0;
        }
        setMastersCounts(next);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [view]);

				  const topBar = useMemo(() => {
				    if (view === 'dashboard') return { title: 'Dashboard', showSearch: false };
				    if (view === 'inventory') return { title: 'Inventory', showSearch: false };
				    if (view === 'operations') return { title: 'Operations', showSearch: false };
				    if (view === 'pendingSupplierRate') return { title: 'Pending Supplier Rate', showSearch: false };
				    if (view === 'quotationMaster') return { title: 'Quotation Master', showSearch: false };
				    if (view === 'stockMaster') {
			      if (stockMasterTab === 'itemIssue') return { title: 'Stock Master', subtitle: 'Item Issue', showSearch: false };
			      if (stockMasterTab === 'return') return { title: 'Stock Master', subtitle: 'Return', showSearch: false };
			      if (stockMasterTab === 'damage') return { title: 'Stock Master', subtitle: 'Damage', showSearch: false };
			      if (stockMasterTab === 'transfer') return { title: 'Stock Master', subtitle: 'Transfer', showSearch: false };
		      return { title: 'Stock Master', showSearch: false };
		    }
		    if (view === 'issueMaster') return { title: 'Issue Master', showSearch: false };
		    if (view === 'returnMaster') return { title: 'Return Master', showSearch: false };
		    if (view === 'damageMaster') return { title: 'Damage Master', showSearch: false };
		    if (view === 'transferMaster') return { title: 'Transfer Master', showSearch: false };
		    if (view === 'masters') return { title: 'Masters', showSearch: false };
		    if (view === 'pendingTasks') return { title: 'Pending Tasks', showSearch: false };
		    if (view === 'materialRequest') return { title: 'Material', subtitle: 'Request Material', showSearch: false };
		    if (view === 'materialPendingIssue') return { title: 'Material', subtitle: 'Pending Issue', showSearch: false };
        if (view === 'settingsCatalogue') return { title: 'Catalogue', showSearch: false };
		    if (view === 'newPurchaseRequest') return { title: 'Purchase Requests', subtitle: 'New Purchase Request', showSearch: false };
		    if (view === 'purchaseRequestDetail') return { title: 'Purchase Requests', subtitle: 'Request Details', showSearch: false };
	    if (isPendingQueueView(view)) {
	      const subtitleByKey: Record<PendingQueueView, string> = {
	        queueApprovePr: 'Approve PR',
	        queueCreatePo: 'Create PO',
	        queueCheckPo: 'Check PO',
	        queueSendPo: 'Send PO',
	        queueCreateGrn: 'Create GRN',
		        queueCheckQuality: 'Check Quality',
		        queueEnterInvoice: 'Enter Invoice',
		        queueApproveInvoice: 'Approve Invoice',
		        queueTallyEntry: 'Tally Entry',
	        queueLinkInvoiceGrn: 'Link Invoice ↔ GRN',
		        queuePayment: 'Pending Payment',
		      };
	      return { title: 'Pending Tasks', subtitle: subtitleByKey[view], showSearch: false };
	    }
	    return { title: 'Purchase Requests', showSearch: true };
	  }, [view, stockMasterTab]);

		  const sidebarActive: NavView = useMemo(() => {
		    if (view === 'newPurchaseRequest' || view === 'purchaseRequestDetail') return 'purchasing';
		    if (isPendingQueueView(view)) return 'pendingTasks';
		    if (view === 'pendingSupplierRate' || view === 'quotationMaster') return 'quotation';
		    return view as NavView;
		  }, [currentUser, view]);

	  const activePendingQueue = isPendingQueueView(view) ? view : undefined;

		  const [prDetailScrollTarget, setPrDetailScrollTarget] = useState<'top' | 'existingPos'>('top');
		  const [prDetailInitialView, setPrDetailInitialView] = useState<'full' | 'existingPosOnly' | 'recordedGrnsOnly' | 'recordedInvoicesOnly'>('full');

		  const openPrDetail = (
		    prId: string,
		    opts?: {
		      scrollTo?: 'top' | 'existingPos';
		      view?: 'full' | 'existingPosOnly' | 'recordedGrnsOnly' | 'recordedInvoicesOnly';
		    }
		  ) => {
		    setDetailBackView(view);
		    setSelectedRequestId(prId);
		    setPrDetailScrollTarget(opts?.scrollTo === 'existingPos' ? 'existingPos' : 'top');
		    setPrDetailInitialView(
		      opts?.view === 'existingPosOnly'
		        ? 'existingPosOnly'
		        : opts?.view === 'recordedGrnsOnly'
		          ? 'recordedGrnsOnly'
		          : opts?.view === 'recordedInvoicesOnly'
		            ? 'recordedInvoicesOnly'
		            : 'full'
		    );
		    setView('purchaseRequestDetail');
		  };

				  const showBusyOverlay = inFlightCount > 0;
	        const hideSidebarAfterViewChange = () => setSidebarOpen(false);

		  if (!currentUser) {
		    return (
		      <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-100 via-blue-50 to-cyan-100 flex items-center justify-center p-4 sm:p-6">
		        <div className="pointer-events-none absolute -top-24 -left-16 w-64 h-64 rounded-full bg-blue-300/30 blur-3xl" />
		        <div className="pointer-events-none absolute -bottom-24 -right-10 w-72 h-72 rounded-full bg-cyan-300/30 blur-3xl" />
		        <div className="w-full max-w-md bg-white/95 backdrop-blur rounded-3xl border border-white/80 shadow-[0_20px_60px_rgba(15,23,42,0.18)] overflow-hidden">
		          <div className="px-6 sm:px-7 pt-7 pb-5 border-b border-slate-200/80 bg-gradient-to-r from-white via-blue-50/70 to-cyan-50/70">
		            <div className="text-2xl font-extrabold text-slate-900 tracking-tight">Welcome Back</div>
		            <div className="text-sm text-slate-600 mt-1">Sign in with your Login ID and Password</div>
		          </div>
		          <div className="p-6 sm:p-7 space-y-5">
		            {loginError ? (
		              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{loginError}</div>
		            ) : null}
		            <label className="space-y-1.5 block">
		              <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Login ID</div>
		              <input
		                className="w-full h-11 bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
		                value={loginId}
		                onChange={(e) => setLoginId(e.target.value)}
		                placeholder="amit"
		                autoFocus
		              />
		            </label>
		            <label className="space-y-1.5 block">
		              <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Password</div>
		              <input
		                className="w-full h-11 bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
		                value={loginPassword}
		                onChange={(e) => setLoginPassword(e.target.value)}
		                type="password"
		                placeholder="Password"
		                onKeyDown={(e) => {
		                  if (e.key !== 'Enter') return;
		                  if (loginBusy) return;
		                  const lid = loginId.trim();
		                  const pw = loginPassword;
		                  if (!lid || !pw) return;
		                  setLoginBusy(true);
		                  setLoginError(null);
		                  loginWithLoginId(lid, pw)
		                    .then((u) => {
		                      sessionStorage.setItem('ims.currentUser', JSON.stringify(u));
		                      setCurrentUser(u);
		                      setLoginId('');
		                      setLoginPassword('');
		                    })
		                    .catch((err) => setLoginError(err instanceof Error ? err.message : String(err)))
		                    .finally(() => setLoginBusy(false));
		                }}
		              />
		            </label>
		            <button
		              type="button"
		              className="w-full h-11 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-[0.99] transition-all shadow-lg shadow-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
		              disabled={loginBusy || !loginId.trim() || !loginPassword}
		              onClick={() => {
		                if (loginBusy) return;
		                const lid = loginId.trim();
		                const pw = loginPassword;
		                if (!lid || !pw) return;
		                setLoginBusy(true);
		                setLoginError(null);
		                loginWithLoginId(lid, pw)
		                  .then((u) => {
		                    sessionStorage.setItem('ims.currentUser', JSON.stringify(u));
		                    setCurrentUser(u);
		                    setLoginId('');
		                    setLoginPassword('');
		                  })
		                  .catch((err) => setLoginError(err instanceof Error ? err.message : String(err)))
		                  .finally(() => setLoginBusy(false));
		              }}
		            >
		              {loginBusy ? 'Logging in...' : 'Login'}
		            </button>
		            <div className="text-[12px] text-slate-500 text-center">
		              Only active users can sign in.
		            </div>
		          </div>
		        </div>
		      </div>
		    );
		  }
		
		  return (
	    <div className="flex min-h-screen bg-surface">
						      <Sidebar
						        activeView={sidebarActive}
						        activePendingQueue={activePendingQueue}
	                pendingQueueCounts={pendingQueueCounts}
	                mastersCounts={mastersCounts}
	                purchaseMastersCounts={purchaseMastersCounts}
				        activeMastersTab={sidebarActive === 'masters' ? mastersTab : undefined}
				        mastersExpanded={mastersExpanded}
				        pendingExpanded={pendingExpanded}
				        stockMasterExpanded={stockMasterExpanded}
				        materialExpanded={materialExpanded}
	              settingsExpanded={settingsExpanded}
				        purchaseMastersExpanded={purchaseMastersExpanded}
				        quotationExpanded={quotationExpanded}
				        activeQuotationView={view === 'pendingSupplierRate' || view === 'quotationMaster' ? view : undefined}
				        activeOperationsTab={operationsTab}
				        isNewPurchaseRequestActive={view === 'newPurchaseRequest'}
				        currentUserName={currentUser?.name || currentUser?.loginId || ''}
			        menuAccessKeys={currentUser?.menuAccess ?? []}
			        onLogout={() => {
			        sessionStorage.removeItem('ims.currentUser');
			        setCurrentUser(null);
			        setLoginError(null);
			        setLoginBusy(false);
			        }}
			        open={sidebarOpen}
				        onNavigate={(next) => {
				          if (next === 'masters') {
				            setSelectedRequestId(null);
				            setPendingExpanded(false);
				            setStockMasterExpanded(false);
				            setMaterialExpanded(false);
	                  setSettingsExpanded(false);
				        setPurchaseMastersExpanded(false);
				        setQuotationExpanded(false);
				            setMastersExpanded((prev) => !prev);
				            return;
				          }

					        if (next === 'pendingTasks') {
					        setSelectedRequestId(null);
					        setMastersExpanded(false);
					        setStockMasterExpanded(false);
					        setMaterialExpanded(false);
	                setSettingsExpanded(false);
					        setPurchaseMastersExpanded(false);
					        setQuotationExpanded(false);
				        setPendingExpanded((prev) => !prev);
				        return;
				        }

					        if (next === 'stockMaster') {
				        setSelectedRequestId(null);
				        setMastersExpanded(false);
				        setPendingExpanded(false);
					        setMaterialExpanded(false);
	                setSettingsExpanded(false);
					        setPurchaseMastersExpanded(false);
					        setQuotationExpanded(false);
				        setStockMasterExpanded((prev) => !prev);
				        return;
				        }

					        if (next === 'material') {
				        setSelectedRequestId(null);
				        setMastersExpanded(false);
				        setPendingExpanded(false);
					        setStockMasterExpanded(false);
	                setSettingsExpanded(false);
					        setPurchaseMastersExpanded(false);
					        setQuotationExpanded(false);
					        setMaterialExpanded((prev) => !prev);
					        return;
					        }

	                if (next === 'settings') {
	                setSelectedRequestId(null);
	                setMastersExpanded(false);
	                setPendingExpanded(false);
	                setStockMasterExpanded(false);
	                setMaterialExpanded(false);
	                setPurchaseMastersExpanded(false);
	                setQuotationExpanded(false);
	                setSettingsExpanded((prev) => !prev);
	                return;
	                }

					        if (next === 'operations') {
				        setSelectedRequestId(null);
				        setMastersExpanded(false);
				        setPendingExpanded(false);
					        setStockMasterExpanded(false);
					        setMaterialExpanded(false);
	                setSettingsExpanded(false);
	                setQuotationExpanded(false);
					        setPurchaseMastersExpanded((prev) => !prev);
				        return;
				        }

				        if (next === 'quotation') {
				        setSelectedRequestId(null);
				        setMastersExpanded(false);
				        setPendingExpanded(false);
				        setStockMasterExpanded(false);
				        setMaterialExpanded(false);
	              setSettingsExpanded(false);
				        setPurchaseMastersExpanded(false);
				        setQuotationExpanded((prev) => !prev);
				        return;
				        }

				        setSelectedRequestId(null);
				        setMastersExpanded(false);
				        setPendingExpanded(false);
					        setStockMasterExpanded(false);
					        setMaterialExpanded(false);
	                setSettingsExpanded(false);
					        setPurchaseMastersExpanded(false);
					        setQuotationExpanded(next === 'pendingSupplierRate' || next === 'quotationMaster');
				        hideSidebarAfterViewChange();
				        setView(next);
				        }}
				        onNavigatePendingQueue={(key) => {
				        setSelectedRequestId(null);
				        setMastersExpanded(false);
					        setStockMasterExpanded(false);
					        setMaterialExpanded(false);
	                setSettingsExpanded(false);
					        setPurchaseMastersExpanded(false);
					        setQuotationExpanded(false);
				        setPendingExpanded(true);
				        hideSidebarAfterViewChange();
				        setView(key);
				        }}
				        onNavigateMastersTab={(tab) => {
				        setMastersTab(tab);
				        setSelectedRequestId(null);
				        setMastersExpanded(true);
					        setPendingExpanded(false);
					        setStockMasterExpanded(false);
					        setMaterialExpanded(false);
	                setSettingsExpanded(false);
					        setPurchaseMastersExpanded(false);
					        setQuotationExpanded(false);
				        hideSidebarAfterViewChange();
				        setView('masters');
				        }}
				        onNavigateStockView={(next) => {
				        setSelectedRequestId(null);
				        setMastersExpanded(false);
					        setPendingExpanded(false);
					        setMaterialExpanded(false);
	                setSettingsExpanded(false);
					        setPurchaseMastersExpanded(false);
					        setQuotationExpanded(false);
				        setStockMasterExpanded(true);
				        hideSidebarAfterViewChange();
				        setView(next);
				        }}
				        onNavigateMaterialView={(next) => {
				        setSelectedRequestId(null);
				        setMastersExpanded(false);
					        setPendingExpanded(false);
					        setStockMasterExpanded(false);
					        setPurchaseMastersExpanded(false);
	                setSettingsExpanded(false);
					        setQuotationExpanded(false);
					        setMaterialExpanded(true);
					        hideSidebarAfterViewChange();
					        setView(next);
					        }}
	                onNavigateSettingsView={(next) => {
	                setSelectedRequestId(null);
	                setMastersExpanded(false);
	                setPendingExpanded(false);
	                setStockMasterExpanded(false);
	                setMaterialExpanded(false);
	                setPurchaseMastersExpanded(false);
	                setQuotationExpanded(false);
	                setSettingsExpanded(true);
	                hideSidebarAfterViewChange();
	                setView(next);
	                }}
					        onNavigatePurchaseMasters={(tab) => {
					        setSelectedRequestId(null);
					        setMastersExpanded(false);
					        setPendingExpanded(false);
					        setStockMasterExpanded(false);
					        setMaterialExpanded(false);
	                setSettingsExpanded(false);
	                setQuotationExpanded(false);
					        setPurchaseMastersExpanded(true);
				        setOperationsTab(tab);
				        hideSidebarAfterViewChange();
				        setView(tab === 'prs' ? 'purchasing' : 'operations');
				        }}

		        onNewPurchaseRequest={() => {
		          setSelectedRequestId(null);
              hideSidebarAfterViewChange();
		          setView('newPurchaseRequest');
		        }}
		        onDirectPo={() => {
	          setSelectedRequestId(null);
	          setMastersExpanded(false);
		          setStockMasterExpanded(false);
		          setPendingExpanded(false);
	            setQuotationExpanded(false);
	            hideSidebarAfterViewChange();
		          setView('directPo');
		        }}
      />
      
		      <main className={cn('flex-1 min-h-screen flex flex-col transition-all duration-200 border-l-2 border-[#1f2937]', sidebarOpen ? 'ml-72' : 'ml-0')}>
		        <TopBar
	            title={topBar.title}
	            subtitle={topBar.subtitle}
	            showSearch={topBar.showSearch}
	            headerRight={
	              isPendingQueueView(view) ? (
	                <button
	                  type="button"
	                  className="btn btn-sm"
	                  onClick={() => {
	                    const btn = document.getElementById('pending-export-btn') as HTMLButtonElement | null;
	                    btn?.click();
	                  }}
	                >
	                  Export Excel
	                </button>
	              ) : null
	            }
	            sidebarOpen={sidebarOpen}
	            onToggleSidebar={() => {
	              setSidebarOpen((prev) => !prev);
	            }}
	          />
	        
		        <div className="px-3 md:px-4 py-4 space-y-6 w-full">
					          {view === 'dashboard' ? (
					            <PowerBIDashboardView
					              onNavigatePendingQueue={(key) => {
					                setSelectedRequestId(null);
					                setMastersExpanded(false);
					                setStockMasterExpanded(false);
	                          setPurchaseMastersExpanded(false);
						                setPendingExpanded(true);
                            hideSidebarAfterViewChange();
						                setView(key);
						              }}
	                        onNewPurchaseRequest={() => {
	                          setSelectedRequestId(null);
                            hideSidebarAfterViewChange();
	                          setView('newPurchaseRequest');
	                        }}
	                        onDirectPo={() => {
	                          setSelectedRequestId(null);
                            hideSidebarAfterViewChange();
	                          setView('directPo');
	                        }}
                        onNavigateStock={(next) => {
                          setSelectedRequestId(null);
                          setMastersExpanded(false);
                          setPendingExpanded(false);
	                          setPurchaseMastersExpanded(false);
	                          setStockMasterExpanded(true);
                            hideSidebarAfterViewChange();
	                          setView(next);
	                        }}
					            />
					          ) : null}

				          {view === 'directPo' ? (
				            <DirectPoView
				              onCreated={() => {
				                setSelectedRequestId(null);
				                setMastersExpanded(false);
					                setStockMasterExpanded(false);
					                setPendingExpanded(true);
                          hideSidebarAfterViewChange();
					                setView('queueCheckPo');
					              }}
				              onCancel={() => {
				                setView('dashboard');
				              }}
				            />
				          ) : null}
	          {view === 'purchasing' ? (
	            <PurchasingView
	              onSelectRequest={(id) => {
	                setDetailBackView('purchasing');
	                setSelectedRequestId(id);
                    setPrDetailScrollTarget('top');
                    setPrDetailInitialView('full');
                        hideSidebarAfterViewChange();
	                setView('purchaseRequestDetail');
	              }}
	                    onAddPurchaseRequest={() => {
	                      setSelectedRequestId(null);
                        hideSidebarAfterViewChange();
	                      setView('newPurchaseRequest');
	                    }}
		            />
		          ) : null}
		          {view === 'purchaseRequestDetail' ? (
		            <PurchaseRequestDetailView
		              requestId={selectedRequestId}
		              initialScrollTo={prDetailScrollTarget}
		              initialView={prDetailInitialView}
		              onBack={() => {
		                setSelectedRequestId(null);
		                setPrDetailScrollTarget('top');
		                setPrDetailInitialView('full');
		                setView(detailBackView);
		              }}
		            />
		          ) : null}
	          {view === 'newPurchaseRequest' ? (
	            <NewPurchaseRequestView
	              onCreated={(newId) => {
	                setSelectedRequestId(newId ?? null);
	                setMastersExpanded(false);
	                setStockMasterExpanded(false);
	                setPurchaseMastersExpanded(false);
	                setPendingExpanded(true);
	                hideSidebarAfterViewChange();
	                setDetailBackView('pendingTasks');
	                setView('queueApprovePr');
	              }}
	              onCancel={() => {
	                setSelectedRequestId(null);
	                setView('purchasing');
              }}
            />
		          ) : null}
				          {view === 'operations' ? <OperationsView key={operationsTab} onViewPr={openPrDetail} initialTab={operationsTab} /> : null}
		          {view === 'inventory' ? <InventoryView /> : null}
		          {view === 'masters' ? <MastersView tab={mastersTab} onTabChange={setMastersTab} /> : null}

		          {view === 'materialRequest' ? <RequestMaterialView /> : null}
	          {view === 'materialPendingIssue' ? (
	            <PendingIssueView
	              onIssue={(mr) => {
	                setActiveMaterialRequest(mr);
	                setStockMasterTab('itemIssue');
	                setView('stockMaster');
	              }}
	            />
	          ) : null}
	            {view === 'pendingSupplierRate' ? <PendingSupplierRateView /> : null}
	            {view === 'quotationMaster' ? <QuotationMasterView /> : null}
	              {view === 'settingsCatalogue' ? <SettingsCatalogueView /> : null}

		          {view === 'stockMaster' ? (
		            <>
		              {stockMasterTab === 'itemIssue' ? (
		                <ItemIssueView
		                  materialRequest={activeMaterialRequest}
		                  onCreated={() => {
		                    setActiveMaterialRequest(null);
		                    setView('issueMaster');
		                  }}
		                  onCancel={() => {
		                    setActiveMaterialRequest(null);
		                    setView('issueMaster');
		                  }}
		                />
		              ) : null}
		              {stockMasterTab === 'return' ? <ReturnView onCreated={() => setView('returnMaster')} onCancel={() => setView('returnMaster')} /> : null}
		              {stockMasterTab === 'damage' ? <DamageView onCreated={() => setView('damageMaster')} onCancel={() => setView('damageMaster')} /> : null}
		              {stockMasterTab === 'transfer' ? <StockTransferView onCreated={() => setView('transferMaster')} onCancel={() => setView('transferMaster')} /> : null}
		            </>
		          ) : null}
              {view === 'issueMaster' ? <IssueMasterView onAdd={() => { setStockMasterTab('itemIssue'); setView('stockMaster'); }} /> : null}
              {view === 'returnMaster' ? <ReturnMasterView onAdd={() => { setStockMasterTab('return'); setView('stockMaster'); }} /> : null}
              {view === 'damageMaster' ? <DamageMasterView onAdd={() => { setStockMasterTab('damage'); setView('stockMaster'); }} /> : null}
              {view === 'transferMaster' ? <TransferMasterView onAdd={() => { setStockMasterTab('transfer'); setView('stockMaster'); }} /> : null}
	          {view === 'queueApprovePr' ? <ApprovePrQueueView onViewPr={openPrDetail} /> : null}
	          {view === 'queueCreatePo' ? <CreatePoQueueView onViewPr={openPrDetail} /> : null}
	          {view === 'queueCheckPo' ? <CheckPoQueueView onViewPr={openPrDetail} /> : null}
	          {view === 'queueSendPo' ? <SendPoQueueView onViewPr={openPrDetail} /> : null}
	          {view === 'queueCreateGrn' ? <CreateGrnQueueView onViewPr={openPrDetail} /> : null}
			          {view === 'queueCheckQuality' ? <QcQueueView onViewPr={openPrDetail} /> : null}
			          {view === 'queueEnterInvoice' ? <EnterInvoiceQueueView onViewPr={openPrDetail} /> : null}
			          {view === 'queueApproveInvoice' ? <ApproveInvoiceQueueView onViewPr={openPrDetail} /> : null}
			          {view === 'queueTallyEntry' ? <PaymentQueueView onViewPr={openPrDetail} queueLabel="Tally Entry" queuePathLabel="Pending Tasks / Tally Entry" exportPrefix="queue-tally-entry" fetchRows={fetchQueueTallyEntry} mode="tally" /> : null}
			          {view === 'queueLinkInvoiceGrn' ? <LinkInvoiceGrnQueueView onViewPr={openPrDetail} /> : null}
		          {view === 'queuePayment' ? <PaymentQueueView onViewPr={openPrDetail} /> : null}
		        </div>
		      </main>

      {showBusyOverlay ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/20">
          <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl px-6 py-5 shadow-2xl flex items-center gap-3">
            <Spinner className="h-10 w-10 border-[3px]" />
            <div className="text-sm font-semibold text-on-surface">Processing...</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
