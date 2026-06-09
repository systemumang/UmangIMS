import React, { useEffect, useState } from 'react';
import Spinner from '@/src/components/common/Spinner';
import { Trash2, Plus, Save } from 'lucide-react';

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

  const [newSeq, setNewSeq] = useState<{ firmId: string; kind: string; fy: string; nextNo: number }>({
    firmId: '',
    kind: 'PR',
    fy: new Date().getFullYear().toString().slice(-2) + '-' + (new Date().getFullYear() + 1).toString().slice(-2),
    nextNo: 1,
  });

  const [isAdding, setIsAdding] = useState(false);

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
      if (firmData.firms?.length && !newSeq.firmId) {
        setNewSeq(prev => ({ ...prev, firmId: firmData.firms[0].id }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onUpsertSequence = async (firmId: string, kind: string, fy: string, nextNo: number) => {
    if (!firmId || !kind || !fy || nextNo < 1) return;

    // Validation: Check for duplicates
    const isDuplicate = sequences.some(s => s.firm_id === firmId && s.kind === kind && s.fy === fy);
    if (isDuplicate) {
      setError(`Sequence already exists for this Firm, Type, and FY (${fy}).`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/doc-sequences/starting-number', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firmId,
          kind,
          fy,
          startingNo: nextNo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update sequence');
      await load(); // Reload to get fresh data and updated firm names
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteSequence = async (s: DocSequence) => {
    if (!window.confirm(`Delete sequence for ${s.firmName} ${s.kind} ${s.fy}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/settings/doc-sequences?firmId=${encodeURIComponent(s.firm_id)}&kind=${encodeURIComponent(s.kind)}&fy=${encodeURIComponent(s.fy)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to delete sequence');
      setSequences(prev => prev.filter(item => !(item.firm_id === s.firm_id && item.kind === s.kind && item.fy === s.fy)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const filteredSequences = sequences.filter(s => 
    selectedFirm === 'all' || s.firm_id === selectedFirm
  );

  // Group by firm
  const grouped = filteredSequences.reduce((acc, s) => {
    const key = s.firm_id;
    if (!acc[key]) acc[key] = { name: s.firmName || s.firm_id, items: [] };
    acc[key].items.push(s);
    return acc;
  }, {} as Record<string, { name: string; items: DocSequence[] }>);

  if (loading) return <div className="p-8 flex justify-center"><Spinner /></div>;

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      {/* Header Section */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-sm font-bold text-on-surface uppercase tracking-wider">Document Sequences</div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-on-surface-variant">Filter:</span>
            <select 
              className="bg-surface-container-low border border-outline-variant/20 rounded px-2 py-1 text-xs outline-none"
              value={selectedFirm}
              onChange={(e) => setSelectedFirm(e.target.value)}
            >
              <option value="all">All Firms</option>
              {firms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>

          <button 
            type="button"
            className="btn btn-primary text-xs h-8 px-3 flex items-center gap-1.5"
            onClick={() => setIsAdding(!isAdding)}
          >
            <Plus size={14} />
            {isAdding ? 'Close' : 'Add Sequence'}
          </button>
        </div>
      </div>

      {error ? <div className="p-3 bg-error/10 text-error text-xs rounded-lg">{error}</div> : null}

      {/* Add New Sequence Row - Conditional */}
      {isAdding && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-5 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="text-xs font-bold text-on-surface uppercase tracking-wider mb-4 flex items-center gap-2">
            <Plus size={16} className="text-primary" />
            Add New Sequence
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-on-surface-variant">Firm</label>
              <select 
                className="w-full bg-surface-container-low border border-outline-variant/20 rounded px-2 py-1.5 text-sm outline-none"
                value={newSeq.firmId}
                onChange={(e) => setNewSeq(prev => ({ ...prev, firmId: e.target.value }))}
              >
                {firms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-on-surface-variant">Type</label>
              <select 
                className="w-full bg-surface-container-low border border-outline-variant/20 rounded px-2 py-1.5 text-sm outline-none"
                value={newSeq.kind}
                onChange={(e) => setNewSeq(prev => ({ ...prev, kind: e.target.value }))}
              >
                {['PR', 'PO', 'GRN', 'MR', 'RFQ', 'CV'].map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-on-surface-variant">FY</label>
              <input 
                type="text"
                placeholder="e.g. 26-27"
                className="w-full bg-surface-container-low border border-outline-variant/20 rounded px-2 py-1.5 text-sm outline-none"
                value={newSeq.fy}
                onChange={(e) => setNewSeq(prev => ({ ...prev, fy: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-on-surface-variant">Start No.</label>
              <input 
                type="number"
                min="1"
                className="w-full bg-surface-container-low border border-outline-variant/20 rounded px-2 py-1.5 text-sm outline-none"
                value={newSeq.nextNo}
                onChange={(e) => setNewSeq(prev => ({ ...prev, nextNo: parseInt(e.target.value, 10) || 1 }))}
              />
            </div>
            <button 
              disabled={busy || !newSeq.firmId || !newSeq.fy}
              onClick={async () => {
                await onUpsertSequence(newSeq.firmId, newSeq.kind, newSeq.fy, newSeq.nextNo);
                if (!error) setIsAdding(false);
              }}
              className="btn btn-primary h-[34px] flex items-center justify-center gap-2"
            >
              <Plus size={16} />
              Save
            </button>
          </div>
        </div>
      )}

      {/* List Sections */}
      <div className="space-y-6">

        {Object.keys(grouped).length ? (
          Object.entries(grouped).map(([fId, group]) => (
            <div key={fId} className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-5 shadow-sm">
              <div className="text-sm font-bold text-primary uppercase tracking-wider mb-3 border-b border-outline-variant/10 pb-2">
                {group.name}
              </div>
              <div className="overflow-auto">
                <table className="min-w-[700px] w-full text-sm border-collapse border border-blue-600">
                  <thead className="text-xs uppercase tracking-wider text-on-surface-variant bg-surface-container-low">
                    <tr>
                      <th className="text-left px-3 py-2 border border-blue-600">Type</th>
                      <th className="text-left px-3 py-2 border border-blue-600 w-[120px]">FY</th>
                      <th className="text-left px-3 py-2 border border-blue-600 w-[150px]">Next No.</th>
                      <th className="px-3 py-2 border border-blue-600 w-[80px]">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((s, idx) => (
                      <tr key={`${s.firm_id}-${s.kind}-${s.fy}-${idx}`} className="hover:bg-surface-container-low/30 transition-colors">
                        <td className="px-3 py-2 border border-blue-600 font-semibold">{s.kind}</td>
                        <td className="px-3 py-2 border border-blue-600 bg-blue-50/40">
                          <input
                            type="text"
                            className="w-full bg-transparent border-none px-1 text-sm outline-none focus:ring-1 focus:ring-primary/30 rounded"
                            value={s.fy}
                            onBlur={(e) => {
                              if (e.target.value !== s.fy) onUpsertSequence(s.firm_id, s.kind, e.target.value, s.next_no);
                            }}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSequences(prev => prev.map((item) => (item.firm_id === s.firm_id && item.kind === s.kind && item.fy === s.fy) ? { ...item, fy: val } : item));
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 border border-blue-600 bg-amber-50/40">
                          <input
                            type="number"
                            min="1"
                            className="w-full bg-transparent border-none px-1 text-sm outline-none focus:ring-1 focus:ring-primary/30 rounded"
                            value={s.next_no}
                            onBlur={(e) => {
                              const val = parseInt(e.target.value, 10);
                              if (!isNaN(val) && val !== s.next_no) onUpsertSequence(s.firm_id, s.kind, s.fy, val);
                            }}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              if (!isNaN(val)) {
                                setSequences(prev => prev.map((item) => (item.firm_id === s.firm_id && item.kind === s.kind && item.fy === s.fy) ? { ...item, next_no: val } : item));
                              }
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 border border-blue-600 text-center">
                          <button 
                            onClick={() => onDeleteSequence(s)}
                            disabled={busy}
                            className="p-1.5 text-on-surface-variant hover:text-error hover:bg-error/10 rounded transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        ) : (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-10 text-center text-on-surface-variant">
            No sequences found. Use the form above to add one.
          </div>
        )}
      </div>
    </div>
  );
}

