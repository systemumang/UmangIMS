import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import Sidebar, { type NavView, type PendingQueueKey, type StockMasterTab } from './components/Sidebar';
import TopBar from './components/TopBar';
import DashboardView from './components/views/DashboardView';
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
import {
  fetchCustomers,
  fetchDepartments,
  fetchFirms,
  fetchItemCategories,
  fetchItemNames,
  fetchItems,
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
  fetchQueueApprovePr,
  fetchQueueCheckPo,
  fetchQueueCreateGrn,
  fetchQueueCreatePo,
  fetchQueueEnterInvoice,
  fetchQueueLinkInvoiceGrn,
  fetchQueuePayment,
  fetchQueueQc,
  fetchQueueSendPo,
} from '@/src/lib/queues';

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
		    | 'transferMaster';
		  const isPendingQueueView = (v: View): v is PendingQueueView => String(v).startsWith('queue');
		  const [view, setView] = useState<View>('dashboard');
		  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
		  const [detailBackView, setDetailBackView] = useState<View>('dashboard');
			  const [mastersTab, setMastersTab] = useState<MastersTab>('firms');
			  const [mastersExpanded, setMastersExpanded] = useState(false);
			  const [pendingExpanded, setPendingExpanded] = useState(false);
			  const [stockMasterTab, setStockMasterTab] = useState<StockMasterTab>('itemIssue');
			  const [stockMasterExpanded, setStockMasterExpanded] = useState(false);
        const [purchaseMastersExpanded, setPurchaseMastersExpanded] = useState(false);
        const [operationsTab, setOperationsTab] = useState<'prs' | 'pos' | 'grns' | 'invoices' | 'payments'>('prs');
		  const [sidebarOpen, setSidebarOpen] = useState(true);
      const [pendingQueueCounts, setPendingQueueCounts] = useState<Partial<Record<PendingQueueKey, number>>>({});
      const [mastersCounts, setMastersCounts] = useState<Partial<Record<MastersTab, number>>>({});

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
    const ac = new AbortController();
    Promise.all([
      fetchQueueApprovePr(undefined, ac.signal).then((r) => ['queueApprovePr', r.length] as const),
      fetchQueueCreatePo(undefined, ac.signal).then((r) => ['queueCreatePo', r.length] as const),
      fetchQueueCheckPo(undefined, ac.signal).then((r) => ['queueCheckPo', r.length] as const),
      fetchQueueSendPo(undefined, ac.signal).then((r) => ['queueSendPo', r.length] as const),
      fetchQueueCreateGrn(undefined, ac.signal).then((r) => ['queueCreateGrn', r.length] as const),
      fetchQueueQc(undefined, ac.signal).then((r) => ['queueCheckQuality', r.length] as const),
      fetchQueueEnterInvoice(undefined, ac.signal).then((r) => ['queueEnterInvoice', r.length] as const),
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
  }, [view]);

  useEffect(() => {
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
		    if (view === 'home') return { title: 'Home', showSearch: false };
		    if (view === 'inventory') return { title: 'Inventory', showSearch: false };
		    if (view === 'operations') return { title: 'Operations', showSearch: false };
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
	    return view as NavView;
	  }, [view]);

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
	
	  return (
    <div className="flex min-h-screen bg-surface">
				      <Sidebar
				        activeView={sidebarActive}
				        activePendingQueue={activePendingQueue}
                pendingQueueCounts={pendingQueueCounts}
                mastersCounts={mastersCounts}
			        activeMastersTab={sidebarActive === 'masters' ? mastersTab : undefined}
			        mastersExpanded={mastersExpanded}
			        pendingExpanded={pendingExpanded}
			        stockMasterExpanded={stockMasterExpanded}
              purchaseMastersExpanded={purchaseMastersExpanded}
              activeOperationsTab={operationsTab}
			        isNewPurchaseRequestActive={view === 'newPurchaseRequest'}
			        open={sidebarOpen}
				        onNavigate={(next) => {
					          if (next === 'masters') {
					            setSelectedRequestId(null);
					            setPendingExpanded(false);
					            setStockMasterExpanded(false);
	                    setPurchaseMastersExpanded(false);
					            setMastersExpanded((prev) => !prev);
					            return;
					          }

				          if (next === 'pendingTasks') {
				            setSelectedRequestId(null);
				            setMastersExpanded(false);
				            setStockMasterExpanded(false);
                    setPurchaseMastersExpanded(false);
				            setPendingExpanded((prev) => !prev);
				            return;
				          }

			          if (next === 'stockMaster') {
			            setSelectedRequestId(null);
			            setMastersExpanded(false);
			            setPendingExpanded(false);
                  setPurchaseMastersExpanded(false);
			            setStockMasterExpanded((prev) => !prev);
			            return;
			          }

                if (next === 'operations') {
                  setSelectedRequestId(null);
                  setMastersExpanded(false);
                  setPendingExpanded(false);
                  setStockMasterExpanded(false);
                  setPurchaseMastersExpanded((prev) => !prev);
                  return;
                }

			          setSelectedRequestId(null);
			          setMastersExpanded(false);
			          setPendingExpanded(false);
				          setStockMasterExpanded(false);
	                setPurchaseMastersExpanded(false);
                  hideSidebarAfterViewChange();
				          setView(next);
				        }}
			        onNavigatePendingQueue={(key) => {
			          setSelectedRequestId(null);
			          setMastersExpanded(false);
			          setStockMasterExpanded(false);
	                setPurchaseMastersExpanded(false);
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
	                setPurchaseMastersExpanded(false);
                  hideSidebarAfterViewChange();
				          setView('masters');
			        }}
              onNavigateStockView={(next) => {
                setSelectedRequestId(null);
                setMastersExpanded(false);
                setPendingExpanded(false);
	                setPurchaseMastersExpanded(false);
	                setStockMasterExpanded(true);
                  hideSidebarAfterViewChange();
	                setView(next);
	              }}
              onNavigatePurchaseMasters={(tab) => {
                setSelectedRequestId(null);
                setMastersExpanded(false);
                setPendingExpanded(false);
                setStockMasterExpanded(false);
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
            hideSidebarAfterViewChange();
	          setView('directPo');
	        }}
      />
      
	      <main className={cn('flex-1 min-h-screen flex flex-col transition-all duration-200 border-l-2 border-[#1f2937]', sidebarOpen ? 'ml-72' : 'ml-0')}>
	        <TopBar
            title={topBar.title}
            subtitle={topBar.subtitle}
            showSearch={topBar.showSearch}
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

					          {view === 'home' ? (
					            <DashboardView
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
					              onNavigateStockMasterTab={(tab) => {
					                setStockMasterTab(tab);
					                setSelectedRequestId(null);
					                setStockMasterExpanded(true);
					                setMastersExpanded(false);
					                setPendingExpanded(false);
                          hideSidebarAfterViewChange();
					                setView('stockMaster');
					              }}
				              onNavigatePendingQueue={(key) => {
				                setSelectedRequestId(null);
				                setMastersExpanded(false);
					                setStockMasterExpanded(false);
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
                          hideSidebarAfterViewChange();
					                setView('masters');
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
	                setDetailBackView('purchasing');
	                setView(newId ? 'purchaseRequestDetail' : 'purchasing');
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
		          {view === 'stockMaster' ? (
		            <>
		              {stockMasterTab === 'itemIssue' ? <ItemIssueView onCreated={() => setView('issueMaster')} onCancel={() => setView('issueMaster')} /> : null}
		              {stockMasterTab === 'return' ? <ReturnView onCreated={() => setView('returnMaster')} onCancel={() => setView('returnMaster')} /> : null}
		              {stockMasterTab === 'damage' ? <DamageView onCreated={() => setView('damageMaster')} onCancel={() => setView('damageMaster')} /> : null}
		              {stockMasterTab === 'transfer' ? <StockTransferView onCreated={() => setView('transferMaster')} onCancel={() => setView('transferMaster')} /> : null}
		            </>
		          ) : null}
              {view === 'issueMaster' ? <IssueMasterView /> : null}
              {view === 'returnMaster' ? <ReturnMasterView /> : null}
              {view === 'damageMaster' ? <DamageMasterView /> : null}
              {view === 'transferMaster' ? <TransferMasterView /> : null}
	          {view === 'queueApprovePr' ? <ApprovePrQueueView onViewPr={openPrDetail} /> : null}
	          {view === 'queueCreatePo' ? <CreatePoQueueView onViewPr={openPrDetail} /> : null}
	          {view === 'queueCheckPo' ? <CheckPoQueueView onViewPr={openPrDetail} /> : null}
	          {view === 'queueSendPo' ? <SendPoQueueView onViewPr={openPrDetail} /> : null}
	          {view === 'queueCreateGrn' ? <CreateGrnQueueView onViewPr={openPrDetail} /> : null}
		          {view === 'queueCheckQuality' ? <QcQueueView onViewPr={openPrDetail} /> : null}
		          {view === 'queueEnterInvoice' ? <EnterInvoiceQueueView onViewPr={openPrDetail} /> : null}
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
