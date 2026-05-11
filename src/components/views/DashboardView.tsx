import React, { useMemo } from 'react';
import { Plus, ClipboardList, Database, TrendingUp, Activity, Layers } from 'lucide-react';
import { type PendingQueueKey, pendingQueueItems } from '../Sidebar';
import { MASTERS_TABS, type MastersTab } from '@/src/lib/mastersTabs';

type StockMasterTab = 'itemIssue' | 'return' | 'damage' | 'transfer';

export default function DashboardView({
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

  return (
    <div className="space-y-6">
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

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6 shadow-sm">
        <div className="font-headline font-bold text-sm text-on-surface mb-4">Quick Actions</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-md font-semibold text-sm shadow-sm transition-colors bg-gradient-to-br from-primary to-primary-dim text-on-primary"
            onClick={onNewPurchaseRequest}
          >
            <Plus size={16} />
            Purchase Request
          </button>

          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-md font-semibold text-sm shadow-sm transition-colors bg-gradient-to-br from-primary to-primary-dim text-on-primary"
            onClick={() => onNavigateStockMasterTab('itemIssue')}
          >
            <Plus size={16} />
            Issue
          </button>

          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-md font-semibold text-sm shadow-sm transition-colors bg-gradient-to-br from-primary to-primary-dim text-on-primary"
            onClick={() => onNavigateStockMasterTab('return')}
          >
            <Plus size={16} />
            Return
          </button>

          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-md font-semibold text-sm shadow-sm transition-colors bg-gradient-to-br from-primary to-primary-dim text-on-primary"
            onClick={() => onNavigateStockMasterTab('damage')}
          >
            <Plus size={16} />
            Damage
          </button>

          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-md font-semibold text-sm shadow-sm transition-colors bg-gradient-to-br from-primary to-primary-dim text-on-primary"
            onClick={() => onNavigateStockMasterTab('transfer')}
          >
            <Plus size={16} />
            Transfer
          </button>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6 shadow-sm">
        <div className="font-headline font-bold text-sm text-on-surface mb-4">Pending Tasks</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {pendingQueueItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className="w-full flex items-center justify-center gap-2 py-3 rounded-md font-semibold text-sm shadow-sm transition-colors bg-gradient-to-br from-primary to-primary-dim text-on-primary"
              onClick={() => onNavigatePendingQueue(item.key)}
            >
              <ClipboardList size={16} />
              {item.label}
            </button>
          ))}
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
