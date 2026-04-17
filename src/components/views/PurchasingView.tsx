import React, { useEffect, useState } from 'react';
import PurchaseTable from '../PurchaseTable';
import { fetchFirms, fetchRequests, type Firm, type PurchaseRequest } from '@/src/lib/purchaseRequests';

export default function PurchasingView({ onSelectRequest }: { onSelectRequest: (id: string) => void }) {
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
	          Loading requests...
	        </div>
		      ) : (
		        <PurchaseTable
		          requests={requests}
		          firms={firms}
		          onSelectRequest={onSelectRequest}
		          onExportExcel={() => {
		            window.location.href = '/api/requests.xlsx';
	          }}
	        />
	      )}

				    </div>
				  );
}
