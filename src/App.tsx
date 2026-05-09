import React, { useEffect, useMemo, useRef, useState } from 'react';
import Sidebar, { type NavView, type PendingQueueKey, type StockMasterTab } from './components/Sidebar';
import TopBar from './components/TopBar';
import DashboardView from './components/views/DashboardView';
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
import { type MastersTab } from '@/src/lib/mastersTabs';
import { cn } from '@/src/lib/utils';

export default function App() {
		  type PendingQueueView = PendingQueueKey;
		  type View = NavView | PendingQueueView | 'newPurchaseRequest' | 'purchaseRequestDetail' | 'stockMaster' | 'issueMaster' | 'returnMaster' | 'damageMaster' | 'transferMaster';
		  const isPendingQueueView = (v: View): v is PendingQueueView => String(v).startsWith('queue');
		  const [view, setView] = useState<View>('purchasing');
		  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
		  const [detailBackView, setDetailBackView] = useState<View>('purchasing');
		  const [mastersTab, setMastersTab] = useState<MastersTab>('firms');
		  const [mastersExpanded, setMastersExpanded] = useState(false);
		  const [pendingExpanded, setPendingExpanded] = useState(false);
		  const [stockMasterTab, setStockMasterTab] = useState<StockMasterTab>('itemIssue');
		  const [stockMasterExpanded, setStockMasterExpanded] = useState(false);
		  const [sidebarOpen, setSidebarOpen] = useState(() => {
		    try {
	      const v = window.localStorage.getItem('sidebarOpen');
      if (v === '0') return false;
      if (v === '1') return true;
      return true;
    } catch {
      return true;
    }
  });

  const [inFlightCount, setInFlightCount] = useState(0);
  const [writeFlowActive, setWriteFlowActive] = useState(false);
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

		  const topBar = useMemo(() => {
		    if (view === 'dashboard') return { title: 'Dashboard', showSearch: false };
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

		  const openPrDetail = (prId: string, opts?: { scrollTo?: 'top' | 'existingPos' }) => {
		    setDetailBackView(view);
		    setSelectedRequestId(prId);
		    setPrDetailScrollTarget(opts?.scrollTo === 'existingPos' ? 'existingPos' : 'top');
		    setView('purchaseRequestDetail');
		  };

	  const showBusyOverlay = writeFlowActive && inFlightCount > 0;

  return (
    <div className="flex min-h-screen bg-surface">
		      <Sidebar
		        activeView={sidebarActive}
		        activePendingQueue={activePendingQueue}
		        activeMastersTab={sidebarActive === 'masters' ? mastersTab : undefined}
		        activeStockMasterTab={sidebarActive === 'stockMaster' ? stockMasterTab : undefined}
		        mastersExpanded={mastersExpanded}
		        pendingExpanded={pendingExpanded}
		        stockMasterExpanded={stockMasterExpanded}
		        isNewPurchaseRequestActive={view === 'newPurchaseRequest'}
		        open={sidebarOpen}
		        onNavigate={(next) => {
		          if (next === 'masters') {
		            setSelectedRequestId(null);
		            setPendingExpanded(false);
		            setStockMasterExpanded(false);
		            if (sidebarActive === 'masters') {
		              setMastersExpanded((prev) => !prev);
		              setView('masters');
		              return;
		            }
		            setMastersExpanded(true);
		            setView('masters');
		            return;
		          }

		          if (next === 'pendingTasks') {
		            setSelectedRequestId(null);
		            setMastersExpanded(false);
		            setStockMasterExpanded(false);
		            if (isPendingQueueView(view)) {
		              setPendingExpanded((prev) => !prev);
		              return;
		            }
		            setPendingExpanded(true);
		            setView('queueApprovePr');
		            return;
		          }

		          if (next === 'stockMaster') {
		            setSelectedRequestId(null);
		            setMastersExpanded(false);
		            setPendingExpanded(false);
		            if (sidebarActive === 'stockMaster') {
		              setStockMasterExpanded((prev) => !prev);
		              setView('stockMaster');
		              return;
		            }
		            setStockMasterExpanded(true);
		            setView('stockMaster');
		            return;
		          }

		          setSelectedRequestId(null);
		          setMastersExpanded(false);
		          setPendingExpanded(false);
		          setStockMasterExpanded(false);
		          setView(next);
		        }}
		        onNavigatePendingQueue={(key) => {
		          setSelectedRequestId(null);
		          setMastersExpanded(false);
		          setStockMasterExpanded(false);
		          setPendingExpanded(true);
		          setView(key);
		        }}
		        onNavigateMastersTab={(tab) => {
		          setMastersTab(tab);
		          setSelectedRequestId(null);
		          setMastersExpanded(true);
		          setPendingExpanded(false);
		          setStockMasterExpanded(false);
		          setView('masters');
	        }}
	        onNavigateStockMasterTab={(tab) => {
	          setStockMasterTab(tab);
	          setSelectedRequestId(null);
	          setStockMasterExpanded(true);
	          setMastersExpanded(false);
	          setPendingExpanded(false);
	          setView('stockMaster');
	        }}
        onNewPurchaseRequest={() => {
          setSelectedRequestId(null);
          setView('newPurchaseRequest');
        }}
      />
      
	      <main className={cn('flex-1 min-h-screen flex flex-col transition-all duration-200', sidebarOpen ? 'ml-72' : 'ml-0')}>
	        <TopBar
            title={topBar.title}
            subtitle={topBar.subtitle}
            showSearch={topBar.showSearch}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => {
              setSidebarOpen((prev) => {
                const next = !prev;
                try {
                  window.localStorage.setItem('sidebarOpen', next ? '1' : '0');
                } catch {
                  // ignore
                }
                return next;
              });
            }}
          />
	        
		        <div className="px-3 md:px-4 py-4 space-y-6 w-full">
			          {view === 'dashboard' ? <DashboardView /> : null}
		          {view === 'purchasing' ? (
			            <PurchasingView
			              onSelectRequest={(id) => {
		                setDetailBackView('purchasing');
		                setSelectedRequestId(id);
		                setView('purchaseRequestDetail');
	              }}
	            />
	          ) : null}
		          {view === 'purchaseRequestDetail' ? (
		            <PurchaseRequestDetailView
		              requestId={selectedRequestId}
		              initialScrollTo={prDetailScrollTarget}
		              onBack={() => {
		                setSelectedRequestId(null);
		                setPrDetailScrollTarget('top');
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
			          {view === 'operations' ? <OperationsView onViewPr={openPrDetail} /> : null}
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
