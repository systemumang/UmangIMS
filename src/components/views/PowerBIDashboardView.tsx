import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FilePlus2,
  FileText,
  Link2,
  PackagePlus,
  Receipt,
  SearchCheck,
  Send,
  Truck,
  Boxes,
  Package,
  ArrowUpRight,
  ArrowDownLeft,
  AlertTriangle,
  Repeat2,
  Plus,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { type PendingQueueKey, pendingQueueItems } from '../Sidebar';
	import {
	  fetchQueueApprovePr,
	  fetchQueueCheckPo,
	  fetchQueueCreateGrn,
	  fetchQueueCreatePo,
	  fetchQueueEnterInvoice,
	  fetchQueueEnterCreditVoucher,
	  fetchQueueApproveInvoice,
	  fetchQueueApproveCreditVoucher,
	  fetchQueueLinkInvoiceGrn,
	  fetchQueuePayment,
	  fetchQueueCreditVoucherPayment,
	  fetchQueueTallyEntry,
	  fetchQueueQc,
	  fetchQueueSendPo,
		} from '@/src/lib/queues';

function formatDDMMYYYY(d: Date) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function PowerBIDashboardView({
  onNavigatePendingQueue,
  onNewPurchaseRequest,
  onDirectPo,
  onNavigateStock,
}: {
  onNavigatePendingQueue: (key: PendingQueueKey) => void;
  onNewPurchaseRequest: () => void;
  onDirectPo: () => void;
  onNavigateStock: (view: 'inventory' | 'issueMaster' | 'returnMaster' | 'damageMaster' | 'transferMaster') => void;
}) {
  const [pendingCounts, setPendingCounts] = useState<Record<PendingQueueKey, number>>(() => ({} as any));
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const dayTabs = useMemo(() => {
    const list: Array<{ iso: string; label: string }> = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      list.push({ iso: isoDate(d), label: formatDDMMYYYY(d) });
    }
    return list;
  }, []);
  const [activeDayIso, setActiveDayIso] = useState(dayTabs[0]?.iso ?? isoDate(new Date()));
  const [dailyLoading, setDailyLoading] = useState(true);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [dailyCounts, setDailyCounts] = useState<Record<string, number>>({});
  const [catalogueUrl, setCatalogueUrl] = useState<string>('');

  useEffect(() => {
    const ac = new AbortController();
    setDailyLoading(true);
    setDailyError(null);
    fetch(`/api/dashboard/activity?date=${encodeURIComponent(activeDayIso)}`, { signal: ac.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data as any)?.error ? String((data as any).error) : `Failed to load daily activity (${res.status})`);
        const counts = (data as any)?.counts;
        setDailyCounts(counts && typeof counts === 'object' ? counts : {});
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setDailyError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setDailyLoading(false));
    return () => ac.abort();
  }, [activeDayIso]);

	  useEffect(() => {
	    // Fast path: show button even if API call is slow/blocked.
	    try {
	      const raw = localStorage.getItem('ims.settings.catalogueLink') ?? localStorage.getItem('ims.settings.catelougeLink');
	      const v = String(raw ?? '').trim();
	      if (v) setCatalogueUrl(v);
	    } catch {}

    const ac = new AbortController();
    fetch('/api/settings/links', { signal: ac.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) return;
        const rows = Array.isArray((data as any)?.links) ? ((data as any).links as any[]) : [];
	        const found = rows.find((r) => String((r as any)?.name ?? '').trim().toLowerCase() === 'catalogue');
	        const url = String(found?.link ?? '').trim();
	        setCatalogueUrl(url);
	        try {
	          if (url) {
	            localStorage.setItem('ims.settings.catalogueLink', url);
	            localStorage.setItem('ims.settings.catelougeLink', url);
	          }
	        } catch {}
      })
      .catch(() => {});
    return () => ac.abort();
  }, []);

  const pendingTotal = useMemo(() => pendingQueueItems.reduce((sum, it) => sum + (pendingCounts[it.key] ?? 0), 0), [pendingCounts]);

  const pendingIconByKey: Record<PendingQueueKey, React.ComponentType<{ size?: number; className?: string }>> = useMemo(
    () => ({
      queueApprovePr: ClipboardCheck,
      queueCreatePo: FilePlus2,
      queueCheckPo: SearchCheck,
      queueSendPo: Send,
      queueCreateGrn: PackagePlus,
	      queueCheckQuality: BadgeCheck,
	      queueEnterInvoice: Receipt,
	      queueEnterCreditVoucher: Receipt,
	      queueApproveInvoice: BadgeCheck,
	      queueApproveCreditVoucher: Repeat2,
	      queueTallyEntry: Receipt,
	      queueLinkInvoiceGrn: Link2,
	      queuePayment: CreditCard,
	      queueExcessPaidInvoices: CreditCard,
	      queueCreditVoucherPayment: CreditCard,
	    }),
	    []
	  );

  const pendingRowBg = (idx: number) =>
    idx % 6 === 0
      ? 'bg-blue-50'
      : idx % 6 === 1
        ? 'bg-emerald-50'
        : idx % 6 === 2
          ? 'bg-amber-50'
          : idx % 6 === 3
            ? 'bg-fuchsia-50'
            : idx % 6 === 4
              ? 'bg-teal-50'
              : 'bg-indigo-50';

  return (
	    <div className="space-y-6">
	      <div className="flex items-start justify-between gap-4">
	        <div>
	          <div className="text-sm font-bold text-on-surface">Dashboard</div>
	          <div className="text-xs text-on-surface-variant mt-0.5">Overview & shortcuts</div>
	        </div>
	        <div className="text-xs font-semibold text-on-surface-variant">{formatDDMMYYYY(new Date())}</div>
	      </div>

			        <div className="bg-surface-container-lowest rounded-md border-2 border-[#374151] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.15)]">
	              <div className="flex items-center justify-between gap-3 mb-3 pb-2 border-b-2 border-[#374151]">
	                <div className="font-headline font-bold text-sm text-on-surface">Quick Actions</div>
                    <button
                      type="button"
                      className="btn btn-sm whitespace-nowrap !bg-sky-400 hover:!bg-sky-500 text-white border-2 border-[#111827] hover:border-[#0f172a]"
                      onClick={async () => {
                        const cached = String(catalogueUrl ?? '').trim();
                        if (cached) {
                          window.open(cached, '_blank', 'noopener,noreferrer');
                          return;
                        }
                        try {
                          const res = await fetch('/api/settings/links');
                          const data = await res.json().catch(() => null);
                          if (!res.ok) throw new Error((data as any)?.error ? String((data as any).error) : 'Failed to load catalogue link');
                          const rows = Array.isArray((data as any)?.links) ? ((data as any).links as any[]) : [];
	                          const found = rows.find((r) => String((r as any)?.name ?? '').trim().toLowerCase() === 'catalogue');
	                          const url = String(found?.link ?? '').trim();
                          if (!url) {
                            window.alert('Catalogue link not set. Go to Settings → Links and add/update the Catalogue link.');
                            return;
                          }
	                          setCatalogueUrl(url);
	                          try {
	                            localStorage.setItem('ims.settings.catalogueLink', url);
	                            localStorage.setItem('ims.settings.catelougeLink', url);
	                          } catch {}
                          window.open(url, '_blank', 'noopener,noreferrer');
                        } catch (e) {
                          window.alert(e instanceof Error ? e.message : String(e));
                        }
                      }}
                      title="Open Catalogue"
                    >
                      Catalogue
                    </button>
	              </div>
			          <div className="flex items-center gap-2 overflow-x-auto">
			            <button type="button" className="btn btn-sm whitespace-nowrap border-2 border-[#111827] hover:border-[#0f172a]" onClick={onNewPurchaseRequest}>
		              <Plus size={14} />
	              Purchase Request
	            </button>
	            <button type="button" className="btn btn-sm whitespace-nowrap border-2 border-[#111827] hover:border-[#0f172a]" onClick={onDirectPo}>
              <Plus size={14} />
              Direct PO
            </button>
	            <button type="button" className="btn btn-sm whitespace-nowrap border-2 border-[#111827] hover:border-[#0f172a]" onClick={() => onNavigateStock('inventory')}>
              <Package size={14} />
              Inventory
            </button>
	            <button type="button" className="btn btn-sm whitespace-nowrap border-2 border-[#111827] hover:border-[#0f172a]" onClick={() => onNavigateStock('issueMaster')}>
              <ArrowUpRight size={14} />
              Issue
            </button>
		            <button type="button" className="btn btn-sm whitespace-nowrap border-2 border-[#111827] hover:border-[#0f172a]" onClick={() => onNavigateStock('returnMaster')}>
	              <ArrowDownLeft size={14} />
	              Return
	            </button>
		            <button type="button" className="btn btn-sm whitespace-nowrap border-2 border-[#111827] hover:border-[#0f172a]" onClick={() => onNavigateStock('damageMaster')}>
	              <AlertTriangle size={14} />
	              Damage
	            </button>
				            <button type="button" className="btn btn-sm whitespace-nowrap border-2 border-[#111827] hover:border-[#0f172a]" onClick={() => onNavigateStock('transferMaster')}>
				              <Boxes size={14} />
				              Transfer
				            </button>
		          </div>
		        </div>

	        <div className="bg-surface-container-lowest rounded-md border-2 border-[#374151] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.15)]">
	          <div className="flex items-center justify-between gap-2 mb-3">
	            <div className="font-headline font-bold text-sm text-on-surface">Daily Activity</div>
	            {dailyLoading ? <div className="text-xs text-on-surface-variant">Loading...</div> : null}
	          </div>
          <div className="flex items-center gap-2 overflow-x-auto mb-4">
	            {dayTabs.map((t) => (
	              <button
	                key={t.iso}
	                type="button"
	                className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition-colors',
                    activeDayIso === t.iso
                      ? 'bg-primary text-on-primary border-[#111827]'
                      : 'bg-surface-container-lowest text-on-surface-variant border-[#111827] hover:bg-surface-container-high'
                  )}
	                onClick={() => setActiveDayIso(t.iso)}
	              >
	                {t.label}
	              </button>
	            ))}
	          </div>
          {dailyError ? <div className="text-xs text-error">{dailyError}</div> : null}
          {!dailyError ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { key: 'masters', label: 'Masters', color: 'bg-indigo-600' },
                { key: 'prs', label: 'Requisitions', color: 'bg-blue-600' },
                { key: 'pos', label: 'Purchase Orders', color: 'bg-emerald-600' },
                { key: 'grns', label: 'GRN', color: 'bg-amber-500' },
                { key: 'invoices', label: 'Invoices', color: 'bg-fuchsia-600' },
                { key: 'payments', label: 'Payments', color: 'bg-teal-600' },
	                { key: 'stock', label: 'Stock Item', color: 'bg-sky-600' },
                { key: 'total', label: 'Total', color: 'bg-slate-800' },
              ].map((c) => (
                <div key={c.key} className="rounded-md border-2 border-[#111827] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.15)]">
                  <div className={cn('px-4 py-2 text-xs font-bold text-white', c.color)}>{c.label}</div>
                  <div className="px-4 py-3 bg-white">
                    <div className="text-2xl font-extrabold text-on-surface tabular-nums">{Number(dailyCounts[c.key] ?? 0)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

		      <div className="bg-surface-container-lowest rounded-md border-2 border-[#374151] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.15)]">
		        <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <div className="font-headline font-bold text-sm text-on-surface">Pending Tasks</div>
              <div className="text-xs text-on-surface-variant mt-0.5">
                Total pending: <span className="font-bold text-on-surface tabular-nums">{pendingTotal}</span>
              </div>
            </div>
            {pendingLoading ? <div className="text-xs text-on-surface-variant">Loading...</div> : null}
          </div>
          {pendingError ? <div className="text-xs text-error">Failed to load: {pendingError}</div> : null}
          {!pendingError ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left border-collapse border-2 border-[#111827]">
                <thead>
                  <tr className="bg-primary text-on-primary">
                    <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-[#111827] border-b-2">Task</th>
                    <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-[#111827] border-b-2">Pending</th>
                    <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-[#111827] border-b-2">Open</th>
                  </tr>
                </thead>
                <tbody>
	                  {pendingQueueItems.map((item, idx) => {
	                    const Icon = pendingIconByKey[item.key] ?? ClipboardList;
	                    return (
                      <tr key={item.key} className={cn(pendingRowBg(idx), 'border-b border-[#111827]/70')}>
                        <td className="px-3 py-2 text-sm border border-[#111827]/70">
                          <span className="inline-flex items-center gap-2 font-semibold text-on-surface">
                            <Icon size={16} />
                            {item.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-sm border border-[#111827]/70 tabular-nums font-bold text-on-surface">
                          {pendingCounts[item.key] ?? 0}
                        </td>
	                        <td className="px-3 py-2 text-sm border border-[#111827]/70">
	                          <button type="button" className="btn btn-sm border-2 border-[#111827] hover:border-[#0f172a]" onClick={() => onNavigatePendingQueue(item.key)}>
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
	      </div>
    </div>
  );
}
