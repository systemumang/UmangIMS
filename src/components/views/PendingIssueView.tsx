import React, { useEffect, useState } from 'react';
import { fetchPendingMaterialRequests, type MaterialRequest } from '@/src/lib/materialRequests';
import Spinner from '@/src/components/common/Spinner';
import { ArrowUpRight, Search, Calendar, User, Briefcase, FileText } from 'lucide-react';

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((mr) => (
          <div key={mr.id} className="bg-surface-container-lowest border border-outline-variant/10 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
            <div className="p-4 border-b border-outline-variant/10 bg-surface-container-low flex justify-between items-start">
              <div>
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Request No</div>
                <div className="font-bold text-primary">{mr.requestNo}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Date</div>
                <div className="text-xs font-semibold">{new Date(mr.date).toLocaleDateString()}</div>
              </div>
            </div>

            <div className="p-4 space-y-3">
              <div className="flex items-start gap-2">
                <Briefcase size={16} className="text-on-surface-variant shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Project / Customer</div>
                  <div className="text-sm font-medium">{mr.projectName || 'N/A'}</div>
                  <div className="text-xs text-on-surface-variant">{mr.customerName || 'N/A'}</div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <User size={16} className="text-on-surface-variant shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Requested By</div>
                  <div className="text-sm font-medium">{mr.requestByType === 'Inhouse' ? mr.userName : mr.supplierName}</div>
                  <div className="text-[10px] text-on-surface-variant uppercase">{mr.requestByType}</div>
                </div>
              </div>

              {mr.remarks && (
                <div className="flex items-start gap-2">
                  <FileText size={16} className="text-on-surface-variant shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Remarks</div>
                    <div className="text-xs text-on-surface-variant line-clamp-2">{mr.remarks}</div>
                  </div>
                </div>
              )}

              <div className="pt-2">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-2">Items</div>
                <div className="space-y-1">
                  {mr.items?.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-xs p-2 bg-surface-container-low rounded">
                      <span className="font-medium truncate mr-2">{item.itemName}</span>
                      <span className="font-bold whitespace-nowrap">{item.issuedQuantity} / {item.quantity}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 bg-surface-container-low border-t border-outline-variant/10">
              <button
                onClick={() => onIssue(mr)}
                className="w-full bg-primary text-on-primary py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors"
              >
                <ArrowUpRight size={18} />
                Create Issue
              </button>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center bg-surface-container-lowest rounded-xl border border-dashed border-outline-variant/20">
            <div className="text-on-surface-variant">No pending material requests found</div>
          </div>
        )}
      </div>
    </div>
  );
}
