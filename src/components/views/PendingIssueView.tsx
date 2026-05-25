import React, { useEffect, useState } from 'react';
import { fetchPendingMaterialRequests, type MaterialRequest } from '@/src/lib/materialRequests';
import Spinner from '@/src/components/common/Spinner';
import { ArrowUpRight, Search } from 'lucide-react';

export default function PendingIssueView({ onIssue }: { onIssue: (mr: MaterialRequest) => void }) {
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchPendingMaterialRequests();
        setRequests(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const needle = String(search ?? '').toLowerCase();
  const filtered = requests.filter((r) =>
    String(r.requestNo ?? '').toLowerCase().includes(needle) ||
    String(r.customerName ?? '').toLowerCase().includes(needle) ||
    String(r.projectName ?? '').toLowerCase().includes(needle) ||
    String(r.userName ?? r.supplierName ?? '').toLowerCase().includes(needle)
  );

  if (loading) return <div className="p-8 flex justify-center"><Spinner /></div>;
  if (error) return <div className="p-8 text-error">{error}</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" size={18} />
          <input
            className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl pl-10 pr-4 py-2 text-sm outline-none focus:border-primary/50"
            placeholder="Search material requests..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="overflow-x-auto bg-surface-container-lowest rounded-xl border border-outline-variant/10">
        <table className="w-full min-w-[1100px] text-sm border-collapse">
          <thead>
            <tr className="bg-primary text-on-primary">
              <th className="px-3 py-2 text-left border border-outline-variant/20">Request No</th>
              <th className="px-3 py-2 text-left border border-outline-variant/20">Date</th>
              <th className="px-3 py-2 text-left border border-outline-variant/20">Project</th>
              <th className="px-3 py-2 text-left border border-outline-variant/20">Customer</th>
              <th className="px-3 py-2 text-left border border-outline-variant/20">Requested By</th>
              <th className="px-3 py-2 text-left border border-outline-variant/20">Type</th>
              <th className="px-3 py-2 text-left border border-outline-variant/20">Items</th>
              <th className="px-3 py-2 text-right border border-outline-variant/20">Pending Qty</th>
              <th className="px-3 py-2 text-center border border-outline-variant/20">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((mr) => {
              const pendingQty = (mr.items ?? []).reduce((sum, it) => sum + Math.max(0, Number(it.quantity ?? 0) - Number(it.issuedQuantity ?? 0)), 0);
              const itemList = (mr.items ?? []).map((it) => it.itemName).filter(Boolean).join(', ');
              return (
                <tr key={mr.id}>
                  <td className="px-3 py-2 border border-outline-variant/20 font-semibold text-primary">{mr.requestNo}</td>
                  <td className="px-3 py-2 border border-outline-variant/20">{mr.date ? new Date(mr.date).toLocaleDateString() : '-'}</td>
                  <td className="px-3 py-2 border border-outline-variant/20">{mr.projectName || '-'}</td>
                  <td className="px-3 py-2 border border-outline-variant/20">{mr.customerName || '-'}</td>
                  <td className="px-3 py-2 border border-outline-variant/20">{(mr.requestByType === 'Inhouse' ? mr.userName : mr.supplierName) || '-'}</td>
                  <td className="px-3 py-2 border border-outline-variant/20">{mr.requestByType}</td>
                  <td className="px-3 py-2 border border-outline-variant/20 max-w-[260px] truncate" title={itemList || '-'}>{itemList || '-'}</td>
                  <td className="px-3 py-2 border border-outline-variant/20 text-right font-semibold">{pendingQty}</td>
                  <td className="px-3 py-2 border border-outline-variant/20 text-center">
                    <button
                      onClick={() => onIssue(mr)}
                      className="bg-primary text-on-primary px-3 py-1.5 rounded-lg font-bold text-xs inline-flex items-center gap-1 hover:bg-primary/90 transition-colors"
                    >
                      <ArrowUpRight size={14} />
                      Create Issue
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-on-surface-variant border border-outline-variant/20">
                  No pending material requests found
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
