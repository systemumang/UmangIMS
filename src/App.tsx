import React, { useMemo, useState } from 'react';
import Sidebar, { type NavView } from './components/Sidebar';
import TopBar from './components/TopBar';
import DashboardView from './components/views/DashboardView';
import InventoryView from './components/views/InventoryView';
import PurchasingView from './components/views/PurchasingView';
import QualityControlView from './components/views/QualityControlView';
import NewPurchaseRequestView from './components/views/NewPurchaseRequestView';
import PurchaseRequestDetailView from './components/views/PurchaseRequestDetailView';
import MastersView from './components/views/MastersView';
import { type MastersTab } from '@/src/lib/mastersTabs';

export default function App() {
  type View = NavView | 'newPurchaseRequest' | 'purchaseRequestDetail';
  const [view, setView] = useState<View>('purchasing');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [mastersTab, setMastersTab] = useState<MastersTab>('firms');

  const topBar = useMemo(() => {
    if (view === 'dashboard') return { title: 'Dashboard', showSearch: false };
    if (view === 'inventory') return { title: 'Inventory', showSearch: false };
    if (view === 'masters') return { title: 'Masters', showSearch: false };
    if (view === 'qualityControl') return { title: 'Quality Control', showSearch: false };
    if (view === 'newPurchaseRequest') return { title: 'Purchasing', subtitle: 'New Request', showSearch: false };
    if (view === 'purchaseRequestDetail') return { title: 'Purchasing', subtitle: 'Request Details', showSearch: false };
    return { title: 'Purchasing', subtitle: 'Purchase Requests', showSearch: true };
  }, [view]);

  const sidebarActive: NavView = useMemo(() => {
    if (view === 'newPurchaseRequest' || view === 'purchaseRequestDetail') return 'purchasing';
    return view;
  }, [view]);

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar
        activeView={sidebarActive}
        activeMastersTab={sidebarActive === 'masters' ? mastersTab : undefined}
        onNavigate={(next) => {
          setSelectedRequestId(null);
          setView(next);
        }}
        onNavigateMastersTab={(tab) => {
          setMastersTab(tab);
          setSelectedRequestId(null);
          setView('masters');
        }}
        onNewPurchaseRequest={() => {
          setSelectedRequestId(null);
          setView('newPurchaseRequest');
        }}
      />
      
      <main className="flex-1 ml-64 min-h-screen flex flex-col">
        <TopBar title={topBar.title} subtitle={topBar.subtitle} showSearch={topBar.showSearch} />
        
        <div className="p-6 space-y-6 max-w-7xl mx-auto w-full">
          {view === 'dashboard' ? <DashboardView /> : null}
          {view === 'purchasing' ? (
            <PurchasingView
              onSelectRequest={(id) => {
                setSelectedRequestId(id);
                setView('purchaseRequestDetail');
              }}
            />
          ) : null}
          {view === 'purchaseRequestDetail' ? (
            <PurchaseRequestDetailView
              requestId={selectedRequestId}
              onBack={() => {
                setSelectedRequestId(null);
                setView('purchasing');
              }}
            />
          ) : null}
          {view === 'newPurchaseRequest' ? (
            <NewPurchaseRequestView
              onCreated={(newId) => {
                setSelectedRequestId(newId ?? null);
                setView(newId ? 'purchaseRequestDetail' : 'purchasing');
              }}
              onCancel={() => {
                setSelectedRequestId(null);
                setView('purchasing');
              }}
            />
          ) : null}
          {view === 'inventory' ? <InventoryView /> : null}
          {view === 'masters' ? <MastersView tab={mastersTab} onTabChange={setMastersTab} /> : null}
          {view === 'qualityControl' ? <QualityControlView /> : null}
        </div>
      </main>
    </div>
  );
}
