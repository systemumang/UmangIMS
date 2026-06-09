import React, { useEffect, useState } from 'react';
import Spinner from '@/src/components/common/Spinner';

type DocSequence = {
  firm_id: string;
  firmName: string;
  kind: string;
  fy: string;
  next_no: number;
};

type Firm = {
  id: string;
  name: string;
};

export default function DocSequencesSettingsView() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sequences, setSequences] = useState<DocSequence[]>([]);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [selectedFirm, setSelectedFirm] = useState<string>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [seqRes, firmRes] = await Promise.all([
        fetch('/api/settings/doc-sequences'),
        fetch('/api/masters/firms')
      ]);
      
      const seqData = await seqRes.json();
      const firmData = await firmRes.json();

      if (!seqRes.ok) throw new Error(seqData?.error || 'Failed to load sequences');
      if (!firmRes.ok) throw new Error(firmData?.error || 'Failed to load firms');

      setSequences(seqData.sequences || []);
      setFirms(firmData.firms || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onUpdateNextNo = async (seq: DocSequence, newNextNo: number) => {
    if (newNextNo < 1) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/doc-sequences/starting-number', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firmId: seq.firm_id,
          kind: seq.kind,
          fy: seq.fy,
          startingNo: newNextNo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update sequence');
      
      setSequences(prev => prev.map(s => 
        (s.firm_id === seq.firm_id && s.kind === seq.kind && s.fy === seq.fy)
          ? { ...s, next_no: newNextNo }
          : s
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const filteredSequences = sequences.filter(s => 
    selectedFirm === 'all' || s.firm_id === selectedFirm
  );

  if (loading) return <div className="p-8 flex justify-center"><Spinner /></div>;

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <div className="text-sm font-bold text-on-surface uppercase tracking-wider">Document Sequences</div>
            <div className="text-xs text-on-surface-variant">Set starting serial numbers for each firm</div>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-xs text-on-surface-variant">Filter by Firm:</span>
            <select 
              className="bg-surface-container-low border border-outline-variant/20 rounded px-2 py-1 text-xs outline-none"
              value={selectedFirm}
              onChange={(e) => setSelectedFirm(e.target.value)}
            >
              <option value="all">All Firms</option>
              {firms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>

        {error ? <div className="text-xs text-error mb-3">{error}</div> : null}

        <div className="overflow-auto">
          <table className="min-w-[720px] w-full text-sm border-collapse border border-blue-600">
            <thead className="text-xs uppercase tracking-wider text-on-surface-variant bg-surface-container-low">
              <tr>
                <th className="text-left px-3 py-2 border border-blue-600">Firm</th>
                <th className="text-left px-3 py-2 border border-blue-600">Type</th>
                <th className="text-left px-3 py-2 border border-blue-600">FY</th>
                <th className="text-left px-3 py-2 border border-blue-600 w-[150px]">Next No.</th>
              </tr>
            </thead>
            <tbody>
              {filteredSequences.length ? (
                filteredSequences.map((s, idx) => (
                  <tr key={`${s.firm_id}-${s.kind}-${s.fy}-${idx}`}>
                    <td className="px-3 py-2 border border-blue-600">{s.firmName || s.firm_id}</td>
                    <td className="px-3 py-2 border border-blue-600 font-semibold">{s.kind}</td>
                    <td className="px-3 py-2 border border-blue-600">{s.fy}</td>
                    <td className="px-3 py-2 border border-blue-600">
                      <input
                        type="number"
                        min="1"
                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded px-2 py-1 text-sm outline-none focus:border-primary"
                        value={s.next_no}
                        disabled={busy}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val)) onUpdateNextNo(s, val);
                        }}
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-2 border border-blue-600 text-on-surface-variant" colSpan={4}>No sequences found. Create a document to initialize.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
