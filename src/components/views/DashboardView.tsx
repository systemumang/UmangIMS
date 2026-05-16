import React, { useState } from 'react';
import { Plus, ClipboardList, BookOpen } from 'lucide-react';
import { type PendingQueueKey, pendingQueueItems } from '../Sidebar';

type StockMasterTab = 'itemIssue' | 'return' | 'damage' | 'transfer';

export default function DashboardView({
  onNewPurchaseRequest,
  onDirectPo,
  onNavigateStockMasterTab,
  onNavigatePendingQueue,
}: {
  onNewPurchaseRequest: () => void;
  onDirectPo: () => void;
  onNavigateStockMasterTab: (tab: StockMasterTab) => void;
  onNavigatePendingQueue: (key: PendingQueueKey) => void;
}) {
  const [catLoading, setCatLoading] = useState(false);

  return (
    <div className="space-y-6">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <div className="font-headline font-bold text-sm text-on-surface">Quick Actions</div>
          <button
            type="button"
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-md font-semibold text-sm shadow-sm transition-colors !bg-sky-400 hover:!bg-sky-500 text-white disabled:opacity-50"
            disabled={catLoading}
            onClick={async () => {
              if (catLoading) return;
              setCatLoading(true);
              try {
                const fromCache = String(localStorage.getItem('ims.settings.catelougeLink') ?? '').trim();
                let url = fromCache;
                if (!url) {
                  const res = await fetch('/api/settings/links');
                  const data = await res.json();
                  if (!res.ok) throw new Error(String(data?.error ?? 'Failed to load catalogue link'));
                  const links = Array.isArray(data?.links) ? data.links : [];
                  const found = links.find((r: any) => String(r?.name ?? '').trim().toLowerCase() === 'catelouge');
                  url = String(found?.link ?? '').trim();
                  if (url) localStorage.setItem('ims.settings.catelougeLink', url);
                }
                if (!url) {
                  window.alert('Catalogue link not set. Go to Settings → Links and add name "Catelogue".');
                  return;
                }
                window.open(url, '_blank', 'noreferrer');
              } catch (e) {
                window.alert(e instanceof Error ? e.message : String(e));
              } finally {
                setCatLoading(false);
              }
            }}
          >
            <BookOpen size={16} />
            {catLoading ? 'Opening...' : 'Catalogue'}
          </button>
        </div>
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
            onClick={onDirectPo}
          >
            <Plus size={16} />
            Direct PO
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

    </div>
  );
}
