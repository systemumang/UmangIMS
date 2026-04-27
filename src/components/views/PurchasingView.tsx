import React, { useEffect, useMemo, useState } from 'react';
import PurchaseTable from '../PurchaseTable';
import { fetchFirms, fetchRequests, type Firm, type PurchaseRequest } from '@/src/lib/purchaseRequests';
import Spinner from '@/src/components/common/Spinner';
import { cn } from '@/src/lib/utils';

export default function PurchasingView({ onSelectRequest }: { onSelectRequest: (id: string) => void }) {
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewFilter, setViewFilter] = useState<'all' | 'pending' | 'completed'>('all');

  const viewRequests = useMemo(() => {
    if (viewFilter === 'pending') return requests.filter((r) => r.status === 'Pending Approval');
    if (viewFilter === 'completed') return requests.filter((r) => r.status !== 'Pending Approval');
    return requests;
  }, [requests, viewFilter]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([fetchFirms(ac.signal), fetchRequests(ac.signal)])
      .then(([firmRows, requestRows]) => {
        setFirms(firmRows);
        setRequests(requestRows);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (String((e as any)?.name ?? '').toLowerCase() === 'aborterror') return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

			  return (
			    <div className="space-y-6">
		      {error ? (
		        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface shadow-sm">
		          Failed to load requests: {error}
		        </div>
		      ) : null}
			      {loading ? (
		        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-6 shadow-sm text-sm text-on-surface-variant">
		          <div className="flex items-center gap-2 text-on-surface">
		            <Spinner />
		            <span>Loading requests...</span>
		          </div>
		        </div>
				      ) : (
              <>
                <div className="flex items-center gap-2">
                  {(['all', 'pending', 'completed'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setViewFilter(k)}
                      className={cn(
                        'px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors',
                        viewFilter === k
                          ? 'bg-primary text-on-primary border-primary'
                          : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/30 hover:bg-surface-container-low'
                      )}
                    >
                      {k === 'all' ? 'All' : k === 'pending' ? 'Pending' : 'Completed'}
                    </button>
                  ))}
                </div>
			        <PurchaseTable
			          requests={viewRequests}
			          firms={firms}
			          onSelectRequest={onSelectRequest}
			          onExportExcel={() => {
			            window.location.href = '/api/requests.xlsx';
		          }}
                showStatusFilter={false}
		        />
              </>
		      )}

					    </div>
					  );
}
