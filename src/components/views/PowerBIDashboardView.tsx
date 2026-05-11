import React, { useMemo } from 'react';
import {
  Activity,
  ClipboardList,
  Database,
  Layers,
  Plus,
  TrendingUp,
} from 'lucide-react';
import { type PendingQueueKey, pendingQueueItems } from '../Sidebar';
import { MASTERS_TABS, type MastersTab } from '@/src/lib/mastersTabs';

type StockMasterTab = 'itemIssue' | 'return' | 'damage' | 'transfer';

export default function PowerBIDashboardView({
  onNewPurchaseRequest,
  onNavigateStockMasterTab,
  onNavigatePendingQueue,
  onNavigateMastersTab,
}: {
  onNewPurchaseRequest: () => void;
  onNavigateStockMasterTab: (tab: StockMasterTab) => void;
  onNavigatePendingQueue: (key: PendingQueueKey) => void;
  onNavigateMastersTab: (tab: MastersTab) => void;
}) {
  const kpis = useMemo(
    () => [
      { label: 'Pending Queues', value: String(pendingQueueItems.length), icon: Activity },
      { label: 'Masters', value: String(MASTERS_TABS.length), icon: Database },
      { label: 'Stock Actions', value: '4', icon: Layers },
      { label: 'Today', value: new Date().toLocaleDateString(), icon: TrendingUp },
    ],
    []
  );

  const quickLinks = useMemo(
    () => [
      { label: 'New Purchase Request', icon: Plus, onClick: onNewPurchaseRequest },
      { label: 'Issue', icon: ClipboardList, onClick: () => onNavigateStockMasterTab('itemIssue') },
      { label: 'Return', icon: ClipboardList, onClick: () => onNavigateStockMasterTab('return') },
      { label: 'Damage', icon: ClipboardList, onClick: () => onNavigateStockMasterTab('damage') },
      { label: 'Transfer', icon: ClipboardList, onClick: () => onNavigateStockMasterTab('transfer') },
    ],
    [onNavigateStockMasterTab, onNewPurchaseRequest]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-bold text-on-surface">Dashboard</div>
          <div className="text-xs text-on-surface-variant mt-0.5">Overview & shortcuts</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-5 shadow-sm relative overflow-hidden"
            >
              <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-primary/10" />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-on-surface-variant">{kpi.label}</div>
                  <div className="mt-1 text-lg font-bold text-on-surface">{kpi.value}</div>
                </div>
                <div className="h-10 w-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
                  <Icon size={18} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6 shadow-sm">
          <div className="font-headline font-bold text-sm text-on-surface mb-4">Quick Links</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {quickLinks.map((l) => (
              <button
                key={l.label}
                type="button"
                className="w-full flex items-center justify-center gap-2 py-3 rounded-md font-semibold text-sm shadow-sm transition-colors bg-gradient-to-br from-primary to-primary-dim text-on-primary"
                onClick={l.onClick}
              >
                <l.icon size={16} />
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6 shadow-sm">
          <div className="font-headline font-bold text-sm text-on-surface mb-4">Pending Tasks</div>
          <div className="space-y-2">
            {pendingQueueItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors text-on-surface-variant hover:bg-surface-container-high"
                onClick={() => onNavigatePendingQueue(item.key)}
              >
                <span className="flex items-center gap-2">
                  <Activity size={14} className="opacity-70" />
                  {item.label}
                </span>
                <span className="text-[10px] opacity-60">Open</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6 shadow-sm">
        <div className="font-headline font-bold text-sm text-on-surface mb-4">Masters</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {MASTERS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className="w-full flex items-center justify-center gap-2 py-3 rounded-md font-semibold text-sm shadow-sm transition-colors bg-gradient-to-br from-primary to-primary-dim text-on-primary"
              onClick={() => onNavigateMastersTab(tab.key)}
            >
              <Database size={16} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

