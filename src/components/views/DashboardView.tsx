import React from 'react';
import { Plus, ClipboardList } from 'lucide-react';
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
  return (
    <div className="space-y-6">
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
