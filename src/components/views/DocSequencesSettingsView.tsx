import React, { useEffect, useState } from 'react';
import Spinner from '@/src/components/common/Spinner';
import { Trash2, Plus, Check, X } from 'lucide-react';

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

const DOC_TYPE_LABELS: Record<string, string> = {
  PR: 'Purchase Request',
  PO: 'Purchase Order',
  GRN: 'Goods Received Note',
  MR: 'Material Request',
  RFQ: 'Request for Quotation',
  CV: 'Credit Voucher',
};

export default function DocSequencesSettingsView() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sequences, setSequences] = useState<DocSequence[]>([]);
  const [pristineSequences, setPristineSequences] = useState<DocSequence[]>([]);
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

      const seqs = seqData.sequences || [];
      setSequences(JSON.parse(JSON.stringify(seqs)));
      setPristineSequences(JSON.parse(JSON.stringify(seqs)));
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

  const onUpsertSequence = async (firmId: string, kind: string, fy: string, nextNo: number, isNew: boolean = false) => {
    if (!firmId || !kind || !fy || nextNo < 1) return;

    if (isNew) {
      const isDuplicate = pristineSequences.some(s => s.firm_id === firmId && s.kind === kind && s.fy === fy);
      if (isDuplicate) {
        setError(`Sequence already exists for this Firm, Type, and FY (${fy}).`);
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/doc-sequences/starting-number', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId, kind, fy, startingNo: nextNo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update sequence');
      await load(); 
      if (isNew) setIsAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onUpdateRow = async (originalS: DocSequence, updatedFy: string, updatedNextNo: number) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/doc-sequences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firmId: originalS.firm_id,
          kind: originalS.kind,
          oldFy: originalS.fy,
          newFy: updatedFy,
          nextNo: updatedNextNo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update sequence');
      await load();
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
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onCancelEdit = (idx: number) => {
    const original = pristineSequences[idx];
    if (!original) return;
    setSequences(prev => prev.map((s, i) => i === idx ? { ...original } : s));
  };

  const filteredIndices = sequences
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => selectedFirm === 'all' || s.firm_id === selectedFirm);

  const grouped = filteredIndices.reduce((acc, { s, i }) => {
    const key = s.firm_id;
    if (!acc[key]) acc[key] = { name: s.firmName || s.firm_id, items: [] };
    acc[key].items.push({ s, i });
    return acc;
  }, {} as Record<string, { name: string; items: { s: DocSequence; i: number }[] }>);

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
            onClick={() => {
              setIsAdding(!isAdding);
              setError(null);
            }}
          >
            <Plus size={14} />
            {isAdding ? 'Close' : 'Add Sequence'}
          </button>
        </div>
      </div>

      {error ? <div className="p-3 bg-error/10 text-error text-xs rounded-lg">{error}</div> : null}

      {/* Add New Sequence Row */}
      {isAdding && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-5 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="text-xs font-bold text-on-surface uppercase tracking-wider mb-4 flex items-center gap-2">
            <Plus size={16} className="text-primary" />
            Add New Sequence
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-on-surface-variant">Firm</label>
              <select className="w-full bg-surface-container-low border border-outline-variant/20 rounded px-2 py-1.5 text-sm outline-none" value={newSeq.firmId} onChange={(e) => setNewSeq(prev => ({ ...prev, firmId: e.target.value }))}>
                {firms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-on-surface-variant">Type</label>
              <select className="w-full bg-surface-container-low border border-outline-variant/20 rounded px-2 py-1.5 text-sm outline-none" value={newSeq.kind} onChange={(e) => setNewSeq(prev => ({ ...prev, kind: e.target.value }))}>
                {Object.keys(DOC_TYPE_LABELS).map(k => <option key={k} value={k}>{k} ({DOC_TYPE_LABELS[k]})</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-on-surface-variant">FY</label>
              <input type="text" placeholder="e.g. 26-27" className="w-full bg-surface-container-low border border-outline-variant/20 rounded px-2 py-1.5 text-sm outline-none" value={newSeq.fy} onChange={(e) => setNewSeq(prev => ({ ...prev, fy: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-on-surface-variant">Start No.</label>
              <input type="number" min="1" className="w-full bg-surface-container-low border border-outline-variant/20 rounded px-2 py-1.5 text-sm outline-none" value={newSeq.nextNo} onChange={(e) => setNewSeq(prev => ({ ...prev, nextNo: parseInt(e.target.value, 10) || 1 }))} />
            </div>
            <button disabled={busy || !newSeq.firmId || !newSeq.fy} onClick={() => onUpsertSequence(newSeq.firmId, newSeq.kind, newSeq.fy, newSeq.nextNo, true)} className="btn btn-primary h-[34px] flex items-center justify-center gap-2">
              <Plus size={16} /> Save
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
                      <th className="px-3 py-2 border border-blue-600 w-[100px]">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map(({ s, i }) => {
                      const pristine = pristineSequences[i];
                      const isModified = pristine && (pristine.fy !== s.fy || pristine.next_no !== s.next_no);

                      return (
                        <tr key={`${s.firm_id}-${s.kind}-${i}`} className="hover:bg-surface-container-low/30 transition-colors">
                          <td className="px-3 py-2 border border-blue-600 font-semibold">{s.kind} {DOC_TYPE_LABELS[s.kind] ? `(${DOC_TYPE_LABELS[s.kind]})` : ''}</td>
                          <td className="px-3 py-2 border border-blue-600 bg-blue-50/40">
                            <input
                              type="text"
                              className="w-full bg-transparent border-none px-1 text-sm outline-none focus:ring-1 focus:ring-primary/30 rounded"
                              value={s.fy}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSequences(prev => prev.map((item, idx) => idx === i ? { ...item, fy: val } : item));
                              }}
                            />
                          </td>
                          <td className="px-3 py-2 border border-blue-600 bg-amber-50/40">
                            <input
                              type="number"
                              min="1"
                              className="w-full bg-transparent border-none px-1 text-sm outline-none focus:ring-1 focus:ring-primary/30 rounded"
                              value={s.next_no}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                if (!isNaN(val)) {
                                  setSequences(prev => prev.map((item, idx) => idx === i ? { ...item, next_no: val } : item));
                                }
                              }}
                            />
                          </td>
                          <td className="px-3 py-2 border border-blue-600 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {isModified ? (
                                <>
                                  <button 
                                    onClick={() => onUpdateRow(pristine, s.fy, s.next_no)}
                                    disabled={busy}
                                    title="Save changes"
                                    className="p-1 text-primary hover:bg-primary/10 rounded transition-colors"
                                  >
                                    <Check size={18} />
                                  </button>
                                  <button 
                                    onClick={() => onCancelEdit(i)}
                                    disabled={busy}
                                    title="Cancel"
                                    className="p-1 text-on-surface-variant hover:bg-surface-container-high rounded transition-colors"
                                  >
                                    <X size={18} />
                                  </button>
                                </>
                              ) : (
                                <button 
                                  onClick={() => onDeleteSequence(s)}
                                  disabled={busy}
                                  title="Delete"
                                  className="p-1 text-on-surface-variant hover:text-error hover:bg-error/10 rounded transition-colors"
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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


