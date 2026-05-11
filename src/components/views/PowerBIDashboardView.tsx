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

function MiniBarChart({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-1 h-14">
      {values.map((v, idx) => (
        <div
          key={idx}
          className="flex-1 rounded-sm bg-primary/35"
          style={{ height: `${Math.max(6, Math.round((v / max) * 56))}px` }}
          title={String(v)}
        />
      ))}
    </div>
  );
}

function MiniSparkline({ values }: { values: number[] }) {
  const w = 240;
  const h = 56;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const range = Math.max(1, max - min);
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" />
      <polyline points={`${pts} ${w},${h} 0,${h}`} fill="currentColor" className="text-primary/10" />
    </svg>
  );
}

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

  // Placeholder series until we wire real analytics from APIs/DB.
  const series = useMemo(
    () => ({
      prByStatus: [
        { label: 'Draft', value: 3 },
        { label: 'Pending', value: 9 },
        { label: 'Approved', value: 6 },
        { label: 'PO', value: 4 },
        { label: 'GRN', value: 2 },
      ],
      weeklyActivity: [4, 7, 6, 10, 8, 12, 9],
    }),
    []
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <div className="text-sm font-bold text-on-surface">Purchase Requests</div>
              <div className="text-xs text-on-surface-variant mt-0.5">By status (sample)</div>
            </div>
            <div className="text-[10px] font-semibold text-on-surface-variant bg-surface-container-high rounded-full px-2 py-1">
              This week
            </div>
          </div>

          <MiniBarChart values={series.prByStatus.map((x) => x.value)} />
          <div className="mt-3 grid grid-cols-5 gap-2">
            {series.prByStatus.map((x) => (
              <div key={x.label} className="text-center">
                <div className="text-[10px] text-on-surface-variant">{x.label}</div>
                <div className="text-xs font-bold text-on-surface">{x.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <div className="text-sm font-bold text-on-surface">Activity</div>
              <div className="text-xs text-on-surface-variant mt-0.5">Last 7 days (sample)</div>
            </div>
            <div className="text-[10px] font-semibold text-on-surface-variant bg-surface-container-high rounded-full px-2 py-1">
              Trend
            </div>
          </div>

          <MiniSparkline values={series.weeklyActivity} />
          <div className="mt-2 text-xs text-on-surface-variant">
            Pending queues: <span className="text-on-surface font-semibold">{pendingQueueItems.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
