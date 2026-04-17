import React, { useEffect, useMemo, useState } from 'react';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import {
  approveInvoice,
  approvePr,
  createGrn,
  createInvoice,
  createPo,
  fetchFirms,
  fetchPos,
  fetchWorkflow,
  payInvoice,
  recordQc,
  rejectPr,
  saveLogistics,
  statusPillClass,
  type Firm,
  type Po,
  type PoItem,
  type WorkflowSummary,
} from '@/src/lib/purchaseRequests';
import { cn } from '@/src/lib/utils';
import { formatDateDDMMYYYY } from '@/src/lib/date';
import { fetchSuppliers, type Supplier } from '@/src/lib/masters';

type NumMap = Record<string, string>;
type TextMap = Record<string, string>;

function isAbortError(e: unknown) {
  const anyErr = e as any;
  const name = String(anyErr?.name ?? '');
  const message = String(anyErr?.message ?? anyErr ?? '');
  if (e instanceof DOMException && e.name === 'AbortError') return true;
  if (name.toLowerCase() === 'aborterror') return true;
  if (message.toLowerCase().includes('aborterror')) return true;
  if (message.toLowerCase().includes('signal is aborted')) return true;
  return false;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container-low rounded-xl p-4 border border-outline-variant/10 space-y-3">
      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{title}</div>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1">
      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{label}</div>
      {children}
    </label>
  );
}

const inputClass =
  'w-full bg-surface-container-lowest border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary-container';

export default function PurchaseRequestDetailView({
  requestId,
  onBack,
}: {
  requestId: string | null;
  onBack: () => void;
}) {
  const [workflow, setWorkflow] = useState<WorkflowSummary | null>(null);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [approveBy, setApproveBy] = useState('Dept Head');
  const [rejectBy, setRejectBy] = useState('Dept Head');
  const [rejectReason, setRejectReason] = useState('');
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
	  const [posList, setPosList] = useState<Array<{ po: Po; items: PoItem[] }>>([]);
	  const [loadingPos, setLoadingPos] = useState(true);

	  const [poSupplierByItemId, setPoSupplierByItemId] = useState<TextMap>({});
	  const [poPaymentTermsByItemId, setPoPaymentTermsByItemId] = useState<TextMap>({});
	  const [poQty, setPoQty] = useState<NumMap>({});
	  const [poRates, setPoRates] = useState<NumMap>({});

  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [invoiceQty, setInvoiceQty] = useState<NumMap>({});
  const [invoiceRates, setInvoiceRates] = useState<NumMap>({});

  const [dispatchProof, setDispatchProof] = useState('Tax Invoice + E-way bill');
  const [cnOrCourierNo, setCnOrCourierNo] = useState('');
  const [transporterName, setTransporterName] = useState('');

  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [grnQty, setGrnQty] = useState<NumMap>({});

  const [inspectedBy, setInspectedBy] = useState('QC');
  const [location, setLocation] = useState('Main Store');
  const [qcAccepted, setQcAccepted] = useState<NumMap>({});
  const [qcRejected, setQcRejected] = useState<NumMap>({});
  const [qcRemarks, setQcRemarks] = useState<TextMap>({});

  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('Bank Transfer');
  const [paymentRef, setPaymentRef] = useState('');

  const pr = workflow?.pr.pr;
  const prItems = workflow?.pr.items ?? [];
  const po = workflow?.po?.po;
  const poItems = workflow?.po?.items ?? [];
  const invoice = workflow?.invoice?.invoice;
  const invoiceItems = workflow?.invoice?.items ?? [];
  const logistics = workflow?.invoice?.logistics;
  const grn = workflow?.grn?.grn;
  const grnItems = workflow?.grn?.items ?? [];
  const qc = workflow?.qc ?? [];

  const firmName = useMemo(() => {
    const firmId = pr?.firmId;
    if (!firmId) return '';
    return firms.find((f) => f.id === firmId)?.name ?? firmId;
  }, [firms, pr?.firmId]);

  const orderedQtyByItemId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of posList) {
      for (const it of p.items ?? []) {
        const id = String((it as any).itemId ?? '').trim();
        if (!id) continue;
        map[id] = (map[id] ?? 0) + Number((it as any).quantity ?? 0);
      }
    }
    return map;
  }, [posList]);

  const remainingQtyByItemId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of prItems) {
      const id = String((it as any).itemId ?? '').trim();
      const reqQty = Number((it as any).quantity ?? 0);
      const ordered = Number(orderedQtyByItemId[id] ?? 0);
      map[id] = Math.max(0, reqQty - ordered);
    }
    return map;
  }, [orderedQtyByItemId, prItems]);

  const refresh = async (signal?: AbortSignal) => {
    if (!requestId) return;
    const [firmRows, wf, posRows, supplierRows] = await Promise.all([
      fetchFirms(signal),
      fetchWorkflow(requestId, signal),
      fetchPos(requestId, signal),
      fetchSuppliers(signal),
    ]);
    setFirms(firmRows);
    setWorkflow(wf);
	    setPosList(posRows);
	    setSuppliers(supplierRows);

	    if (wf.pr.items.length) {
	      const supplierTermsById = new Map(supplierRows.map((s) => [s.id, String(s.paymentTerms ?? '').trim()] as const));
	      const supplierIdSet = new Set(supplierRows.map((s) => s.id));

	      const nextSupplier: TextMap = { ...poSupplierByItemId };
	      const nextTerms: TextMap = { ...poPaymentTermsByItemId };
	      const itemIdSet = new Set<string>();
	      for (const it of wf.pr.items) {
	        const id = String(it.itemId ?? '').trim();
	        if (!id) continue;
	        itemIdSet.add(id);
	        const currentSupplier = String(nextSupplier[id] ?? '').trim();
	        const safeSupplier = currentSupplier && supplierIdSet.has(currentSupplier) ? currentSupplier : '';
	        nextSupplier[id] = safeSupplier;

	        const currentTerms = String(nextTerms[id] ?? '').trim();
	        if (!safeSupplier) {
	          nextTerms[id] = '';
	        } else {
	          nextTerms[id] = currentTerms || (supplierTermsById.get(safeSupplier) ?? '');
	        }
	      }
	      for (const key of Object.keys(nextSupplier)) if (!itemIdSet.has(key)) delete nextSupplier[key];
	      for (const key of Object.keys(nextTerms)) if (!itemIdSet.has(key)) delete nextTerms[key];

	      setPoSupplierByItemId(nextSupplier);
	      setPoPaymentTermsByItemId(nextTerms);
	    }

	    if (wf.pr.items.length && Object.keys(poRates).length === 0) {
	      const next: NumMap = {};
	      wf.pr.items.forEach((it) => (next[it.itemId] = ''));
	      setPoRates(next);
	    }
	    if (wf.pr.items.length && Object.keys(poQty).length === 0) {
	      const next: NumMap = {};
	      wf.pr.items.forEach((it) => (next[it.itemId] = ''));
      setPoQty(next);
    }
    if (wf.po && !wf.invoice) {
      const nextQty: NumMap = {};
      const nextRates: NumMap = {};
      wf.po.items.forEach((it) => {
        nextQty[it.item] = String(it.quantity);
        nextRates[it.item] = String(it.rate);
      });
      setInvoiceQty((prev) => (Object.keys(prev).length ? prev : nextQty));
      setInvoiceRates((prev) => (Object.keys(prev).length ? prev : nextRates));
    }
    if (wf.invoice && !wf.grn) {
      const next: NumMap = {};
      wf.invoice.items.forEach((it) => (next[it.item] = String(it.quantity)));
      setGrnQty((prev) => (Object.keys(prev).length ? prev : next));
    }
    if (wf.grn && !wf.qc) {
      const nextAcc: NumMap = {};
      const nextRej: NumMap = {};
      wf.grn.items.forEach((it) => {
        nextAcc[it.item] = String(it.quantityReceived);
        nextRej[it.item] = '0';
      });
      setQcAccepted((prev) => (Object.keys(prev).length ? prev : nextAcc));
      setQcRejected((prev) => (Object.keys(prev).length ? prev : nextRej));
    }
  };

		  useEffect(() => {
		    if (!requestId) return;
		    const ac = new AbortController();
		    setLoading(true);
		    setLoadingSuppliers(true);
		    setLoadingPos(true);
		    setError(null);
		    refresh(ac.signal)
		      .catch((e) => {
		        if (isAbortError(e)) return;
		        setError(e instanceof Error ? e.message : String(e));
		      })
		      .finally(() => {
		        setLoading(false);
		        setLoadingSuppliers(false);
		        setLoadingPos(false);
		      });
		    return () => ac.abort();
		    // eslint-disable-next-line react-hooks/exhaustive-deps
		  }, [requestId]);

  const run = (fn: () => Promise<any>) => {
    setBusy(true);
    setError(null);
    return fn()
      .then(() => refresh())
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const closeApproveDialog = () => setApproveDialogOpen(false);
  const closeRejectDialog = () => setRejectDialogOpen(false);

	  const headerRight = (
	    <div className="flex items-center gap-2">
	      <button
	        type="button"
	        onClick={() => (window.location.href = `/api/requests/${encodeURIComponent(requestId)}.pdf`)}
	        className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-colors"
	      >
	        Download PR PDF
	      </button>
	      <button
	        type="button"
	        onClick={() => (window.location.href = '/api/requests.xlsx')}
	        className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-colors"
      >
        Download Excel
      </button>
      <button
        type="button"
        onClick={onBack}
        className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-colors"
      >
        Back
      </button>
    </div>
  );

  if (!requestId) return null;

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-headline font-bold text-sm text-on-surface">Purchase Cycle</h3>
          <p className="text-sm text-on-surface-variant">{requestId}</p>
        </div>
        {headerRight}
      </div>

      {error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">
          {error}
        </div>
      ) : null}
      {loading ? <div className="text-sm text-on-surface-variant">Loading...</div> : null}

      {workflow && pr ? (
        <div className="space-y-4">
          <Section title="SL 1–2: PR Creation + Approval (No rate in PR)">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-on-surface">{pr.id}</div>
              <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider', statusPillClass(pr.status))}>
                {pr.status}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="text-sm text-on-surface-variant">Firm: <span className="text-on-surface">{firmName}</span></div>
              <div className="text-sm text-on-surface-variant">Department: <span className="text-on-surface">{pr.department}</span></div>
	              <div className="text-sm text-on-surface-variant">Required Date: <span className="text-on-surface">{formatDateDDMMYYYY(pr.requiredDate)}</span></div>
            </div>
            <div className="text-sm text-on-surface-variant">Requested By: <span className="text-on-surface">{pr.requestedBy}</span></div>
	            <div className="space-y-1">
	              <div className="text-xs text-on-surface-variant">Items</div>
	              {prItems.map((it, idx) => {
	                const specInline = (it.specification || '')
	                  .split(/\r?\n/)
	                  .map((s) => s.trim())
	                  .filter(Boolean)
	                  .join(' - ');
	                const full = [it.item, specInline || null, String(it.quantity)].filter(Boolean).join(' - ');
	                return (
	                  <div key={`${it.item}-${idx}`} className="text-sm text-on-surface font-medium">
	                    {full}
	                  </div>
	                );
	              })}
	              {/*
	              {prItems.map((it) => (
	                <div key={it.item} className="text-sm text-on-surface">
	                  <div className="font-medium">
                    {it.item} — Qty {it.quantity}
                  </div>
                  {it.specification ? (
                    <ul className="mt-1 list-disc pl-5 text-on-surface-variant">
                      {it.specification
                        .split(/\r?\n/)
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .map((s, idx) => (
                          <li key={idx}>{s}</li>
                        ))}
                    </ul>
                  ) : null}
                </div>
	              ))}
	              */}
	            </div>
	            {pr.status === 'Pending Approval' ? (
	              <div className="flex justify-end gap-2">
	                <button
	                  type="button"
	                  disabled={busy}
	                  className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
	                  onClick={() => {
	                    setError(null);
	                    setApproveDialogOpen(true);
	                  }}
	                >
	                  Approve PR
	                </button>
	                <button
	                  type="button"
	                  disabled={busy}
	                  className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors disabled:opacity-50"
	                  onClick={() => {
	                    setError(null);
	                    setRejectDialogOpen(true);
	                  }}
	                >
	                  Reject PR
	                </button>
	              </div>
	            ) : null}
          </Section>

          {approveDialogOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={closeApproveDialog} />
              <div className="relative w-full max-w-lg bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-xl">
                <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10">
                  <div className="text-sm font-bold text-on-surface">Approve PR</div>
                  <button
                    type="button"
                    className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
                    onClick={closeApproveDialog}
                  >
                    Close
                  </button>
                </div>
                <div className="p-5 space-y-3">
                  <Field label="Approved By">
                    <input
                      className={inputClass}
                      autoFocus
                      value={approveBy}
                      onChange={(e) => setApproveBy(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') closeApproveDialog();
                        if (e.key === 'Enter') {
                          const by = approveBy.trim();
                          if (!by) {
                            setError('Approved By is required.');
                            return;
                          }
                          closeApproveDialog();
                          run(() => approvePr(pr.id, by));
                        }
                      }}
                    />
                  </Field>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
                      onClick={closeApproveDialog}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
                      disabled={busy || !approveBy.trim()}
                      onClick={() => {
                        const by = approveBy.trim();
                        if (!by) {
                          setError('Approved By is required.');
                          return;
                        }
                        closeApproveDialog();
                        run(() => approvePr(pr.id, by));
                      }}
                    >
                      Approve
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {rejectDialogOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={closeRejectDialog} />
              <div className="relative w-full max-w-lg bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-xl">
                <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10">
                  <div className="text-sm font-bold text-on-surface">Reject PR</div>
                  <button
                    type="button"
                    className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
                    onClick={closeRejectDialog}
                  >
                    Close
                  </button>
                </div>
                <div className="p-5 space-y-3">
                  <Field label="Rejected By">
                    <input className={inputClass} autoFocus value={rejectBy} onChange={(e) => setRejectBy(e.target.value)} />
                  </Field>
                  <Field label="Reason (Required)">
                    <input
                      className={inputClass}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') closeRejectDialog();
                        if (e.key === 'Enter') {
                          const by = rejectBy.trim();
                          const reason = rejectReason.trim();
                          if (!by) {
                            setError('Rejected By is required.');
                            return;
                          }
                          if (!reason) {
                            setError('Reject reason is required.');
                            return;
                          }
                          closeRejectDialog();
                          run(() => rejectPr(pr.id, by, reason));
                        }
                      }}
                    />
                  </Field>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
                      onClick={closeRejectDialog}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
                      disabled={busy || !rejectBy.trim() || !rejectReason.trim()}
                      onClick={() => {
                        const by = rejectBy.trim();
                        const reason = rejectReason.trim();
                        if (!by) {
                          setError('Rejected By is required.');
                          return;
                        }
                        if (!reason) {
                          setError('Reject reason is required.');
                          return;
                        }
                        closeRejectDialog();
                        run(() => rejectPr(pr.id, by, reason));
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <Section title="SL 3: Make PO (Multiple suppliers allowed)">
	            {loadingPos ? <div className="text-sm text-on-surface-variant">Loading POs...</div> : null}
	            {!loadingPos && posList.length ? (
	              <div className="space-y-2">
	                <div className="text-sm font-semibold text-on-surface">Existing POs</div>
	                <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant/50">
	                  <div className="overflow-x-auto">
	                    <table className="w-full text-left border-collapse border border-outline-variant/50">
	                      <thead>
	                        <tr className="bg-surface-container-low/50">
	                          <th className="px-4 py-3 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant/50">PO No</th>
	                          <th className="px-4 py-3 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant/50">Supplier</th>
	                          <th className="px-4 py-3 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant/50">Terms</th>
	                          <th className="px-4 py-3 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant/50">Items</th>
	                          <th className="px-4 py-3 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant/50">Download</th>
	                        </tr>
	                      </thead>
	                      <tbody>
	                        {posList.map((p) => (
	                          <tr key={p.po.id}>
	                            <td className="px-4 py-3 text-sm font-semibold text-on-surface border border-outline-variant/50">{p.po.id}</td>
	                            <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant/50">{p.po.supplier || '-'}</td>
	                            <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant/50">{p.po.paymentTerms || '-'}</td>
	                            <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant/50">
	                              {p.items?.length ? (
	                                <div className="space-y-1">
	                                  {p.items.map((it, idx) => {
	                                    const prRow = prItems.find((r) => r.itemId === it.itemId);
	                                    const specInline = (prRow?.specification || '')
	                                      .split(/\r?\n/)
	                                      .map((s) => s.trim())
	                                      .filter(Boolean)
	                                      .join(' - ');
	                                    const label = [prRow?.item || it.item, specInline || null, String(it.quantity)].filter(Boolean).join(' - ');
	                                    return (
	                                      <div key={`${it.itemId}-${idx}`} className="whitespace-nowrap">
	                                        {label}
	                                      </div>
	                                    );
	                                  })}
	                                </div>
	                              ) : (
	                                '-'
	                              )}
	                            </td>
	                            <td className="px-4 py-3 border border-outline-variant/50">
	                              <button
	                                type="button"
	                                className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-colors"
	                                onClick={() => (window.location.href = `/api/pos/${encodeURIComponent(p.po.id)}.pdf`)}
	                              >
	                                Download PO PDF
	                              </button>
	                            </td>
	                          </tr>
	                        ))}
	                      </tbody>
	                    </table>
	                  </div>
	                </div>
	              </div>
	            ) : null}

		            {pr.status === 'Approved' ? (
		              <div className="space-y-3">
		                <div className="text-sm font-semibold text-on-surface">Make PO</div>
		                <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant/50">
		                  <div className="overflow-x-auto">
		                    <table className="w-full text-left border-collapse border border-outline-variant/50">
		                      <thead>
		                        <tr className="bg-surface-container-low/50">
		                          <th className="px-4 py-3 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant/50">Item</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant/50">PR Qty</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant/50">
		                            PO Qty (Already Created)
		                          </th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant/50">Pending Qty</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant/50">Qty PO</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant/50">Rate</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant/50">Supplier</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant/50">Terms</th>
		                        </tr>
		                      </thead>
		                      <tbody>
		                        {(() => {
		                          const makePoItems = prItems.filter((it) => Number(remainingQtyByItemId[it.itemId] ?? 0) > 0);
		                          if (!makePoItems.length) {
		                            return (
		                              <tr>
		                                <td colSpan={8} className="px-4 py-6 text-sm text-on-surface-variant text-center border border-outline-variant/50">
		                                  All items are already fully ordered.
		                                </td>
		                              </tr>
		                            );
		                          }
		                          return makePoItems.map((it) => {
		                            const specInline = (it.specification || '')
		                              .split(/\r?\n/)
		                              .map((s) => s.trim())
		                              .filter(Boolean)
		                              .join(' - ');
		                            const label = [it.item, specInline || null].filter(Boolean).join(' - ');
		                            const ordered = orderedQtyByItemId[it.itemId] ?? 0;
		                            const pending = remainingQtyByItemId[it.itemId] ?? 0;
		                            return (
		                              <tr key={it.itemId}>
		                                <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant/50">{label}</td>
		                                <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant/50">{it.quantity}</td>
		                                <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant/50">{ordered}</td>
		                                <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant/50">{pending}</td>
		                                <td className="px-4 py-3 border border-outline-variant/50">
		                                  <input
		                                    className={inputClass}
		                                    value={poQty[it.itemId] ?? ''}
		                                    onChange={(e) => setPoQty((prev) => ({ ...prev, [it.itemId]: e.target.value }))}
		                                    inputMode="numeric"
		                                    placeholder=""
		                                    disabled={pending <= 0}
		                                  />
		                                </td>
		                                <td className="px-4 py-3 border border-outline-variant/50">
		                                  <input
		                                    className={inputClass}
		                                    value={poRates[it.itemId] ?? ''}
		                                    onChange={(e) => setPoRates((prev) => ({ ...prev, [it.itemId]: e.target.value }))}
		                                    inputMode="decimal"
		                                    placeholder=""
		                                  />
		                                </td>
		                                <td className="px-4 py-3 min-w-[220px] border border-outline-variant/50">
		                                  <SearchableSelect
		                                    value={poSupplierByItemId[it.itemId] ?? ''}
		                                    options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
		                                    onChange={(id) => {
		                                      setPoSupplierByItemId((prev) => ({ ...prev, [it.itemId]: id }));
		                                      const row = suppliers.find((s) => s.id === id);
		                                      setPoPaymentTermsByItemId((prev) => ({ ...prev, [it.itemId]: String(row?.paymentTerms ?? '').trim() }));
		                                    }}
		                                    disabled={loadingSuppliers}
		                                    placeholder="Select supplier..."
		                                  />
		                                </td>
		                                <td className="px-4 py-3 min-w-[180px] border border-outline-variant/50">
		                                  <input
		                                    className={inputClass}
		                                    value={poPaymentTermsByItemId[it.itemId] ?? ''}
		                                    onChange={(e) => setPoPaymentTermsByItemId((prev) => ({ ...prev, [it.itemId]: e.target.value }))}
		                                    placeholder="30 days"
		                                  />
		                                </td>
		                              </tr>
		                            );
		                          });
		                        })()}
		                      </tbody>
		                    </table>
		                  </div>
		                </div>

	                <div className="flex justify-end">
		                  <button
		                    type="button"
		                    disabled={busy || prItems.every((it) => Number(remainingQtyByItemId[it.itemId] ?? 0) <= 0)}
		                    className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
		                    onClick={() => {
		                      const supplierById = new Map(suppliers.map((s) => [s.id, s] as const));
		                      const makePoItems = prItems.filter((it) => Number(remainingQtyByItemId[it.itemId] ?? 0) > 0);
		                      const lines = makePoItems
		                        .map((it) => {
		                          const itemId = String(it.itemId ?? '').trim();
		                          return {
		                            itemId,
		                            quantity: Number(poQty[itemId] ?? 0),
		                            rate: Number(poRates[itemId] ?? 0),
		                            remaining: Number(remainingQtyByItemId[itemId] ?? 0),
		                            supplierId: String(poSupplierByItemId[itemId] ?? '').trim(),
		                            paymentTerms: String(poPaymentTermsByItemId[itemId] ?? '').trim(),
		                          };
		                        })
		                        .filter((x) => x.itemId && Number.isFinite(x.quantity) && x.quantity > 0);
	
		                      if (!lines.length) {
		                        setError('Enter Qty PO for at least one item.');
		                        return;
		                      }
		                      if (lines.some((x) => !Number.isFinite(x.rate) || x.rate < 0)) {
		                        setError('Enter valid rate for all items where Qty PO is entered.');
		                        return;
		                      }
		                      const missingSupplier = lines.find((x) => !x.supplierId);
		                      if (missingSupplier) {
		                        setError('Select supplier for all items where Qty PO is entered.');
		                        return;
		                      }
	                      const missingTerms = lines.find((x) => !x.paymentTerms);
	                      if (missingTerms) {
	                        setError('Payment terms are required for all items where Qty PO is entered.');
	                        return;
	                      }
	                      const invalidSupplier = lines.find((x) => !supplierById.get(x.supplierId));
	                      if (invalidSupplier) {
	                        setError('Select a valid supplier for all PO lines.');
	                        return;
	                      }
	                      const over = lines.find((x) => x.quantity > x.remaining);
	                      if (over) {
	                        setError('Qty PO cannot be more than Pending Qty.');
	                        return;
	                      }
	
	                      const groups = new Map<
	                        string,
	                        { supplier: string; paymentTerms: string; items: Array<{ itemId: string; quantity: number; rate: number }> }
	                      >();
	                      for (const l of lines) {
	                        const row = supplierById.get(l.supplierId);
	                        const supplierName = String(row?.name ?? '').trim();
	                        if (!supplierName) {
	                          setError('Supplier name is missing for a selected supplier.');
	                          return;
	                        }
	                        const key = `${l.supplierId}||${l.paymentTerms}`;
	                        const existing = groups.get(key);
	                        const itemLine = { itemId: l.itemId, quantity: l.quantity, rate: l.rate };
	                        if (existing) existing.items.push(itemLine);
	                        else groups.set(key, { supplier: supplierName, paymentTerms: l.paymentTerms, items: [itemLine] });
	                      }
	
	                      run(async () => {
	                        for (const g of groups.values()) {
	                          await createPo(pr.id, g);
	                        }
	                        setPoQty((prev) => {
	                          const next = { ...prev };
	                          for (const l of lines) next[l.itemId] = '';
	                          return next;
	                        });
	                      });
	                    }}
	                  >
	                    Make PO
	                  </button>
	                </div>
	              </div>
	            ) : (
              <div className="text-sm text-on-surface-variant">Approve PR first.</div>
            )}
          </Section>

          <Section title="SL 4–7: Invoice + Rate Check + Logistics (CN/Courier)">
            <div className="text-sm font-semibold text-on-surface">{invoice ? invoice.id : 'Invoice not recorded'}</div>
            {po && !invoice ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <Field label="Supplier Invoice No">
                    <input className={inputClass} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
                  </Field>
                  <Field label="Invoice Date">
                    <input className={inputClass} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} type="date" />
                  </Field>
                </div>
                {poItems.map((it) => (
                  <div key={it.item} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                    <div className="md:col-span-5 text-sm text-on-surface">{it.item}</div>
                    <Field label="Qty">
                      <input
                        className={inputClass}
                        value={invoiceQty[it.item] ?? String(it.quantity)}
                        onChange={(e) => setInvoiceQty((prev) => ({ ...prev, [it.item]: e.target.value }))}
                        inputMode="numeric"
                      />
                    </Field>
                    <Field label="Rate">
                      <input
                        className={inputClass}
                        value={invoiceRates[it.item] ?? String(it.rate)}
                        onChange={(e) => setInvoiceRates((prev) => ({ ...prev, [it.item]: e.target.value }))}
                        inputMode="decimal"
                      />
                    </Field>
                  </div>
                ))}
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
                    onClick={() => {
                      if (!po) return;
                      if (!invoiceNo.trim() || !invoiceDate.trim()) {
                        setError('Invoice no and date are required.');
                        return;
                      }
                      const items = poItems.map((it) => ({
                        item: it.item,
                        quantity: Number(invoiceQty[it.item] ?? it.quantity),
                        rate: Number(invoiceRates[it.item] ?? it.rate),
                      }));
                      if (items.some((x) => !Number.isFinite(x.quantity) || x.quantity <= 0 || !Number.isFinite(x.rate))) {
                        setError('Enter valid invoice qty/rate.');
                        return;
                      }
                      run(() => createInvoice(po.id, { supplierInvoiceNo: invoiceNo, invoiceDate, items }).then(() => undefined));
                    }}
                  >
                    Record Invoice
                  </button>
                </div>
              </div>
            ) : null}

            {invoice ? (
              <div className="space-y-2">
                <div className="text-sm text-on-surface-variant">
                  Status: <span className="text-on-surface">{invoice.status}</span>
                  {invoice.status === 'On Hold' && invoice.holdReason ? ` (Hold: ${invoice.holdReason})` : ''}
                </div>
                <div className="text-xs text-on-surface-variant">
                  SL 6 flags: {workflow.flags.invoiceRateMismatch ? 'Rate mismatch' : 'Rate OK'};{' '}
                  {workflow.flags.quantityMismatch ? 'Quantity mismatch' : 'Quantity OK'}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <Field label="Dispatch Proof">
                    <input className={inputClass} value={dispatchProof} onChange={(e) => setDispatchProof(e.target.value)} />
                  </Field>
                  <Field label="CN/Courier No">
                    <input className={inputClass} value={cnOrCourierNo} onChange={(e) => setCnOrCourierNo(e.target.value)} />
                  </Field>
                  <Field label="Transporter">
                    <input className={inputClass} value={transporterName} onChange={(e) => setTransporterName(e.target.value)} />
                  </Field>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
                    onClick={() => {
                      if (!invoice) return;
                      if (!dispatchProof.trim() || !cnOrCourierNo.trim() || !transporterName.trim()) {
                        setError('Dispatch proof, CN/Courier, and transporter required.');
                        return;
                      }
                      run(() => saveLogistics(invoice.id, { dispatchProof, cnOrCourierNo, transporterName }).then(() => undefined));
                    }}
                  >
                    {logistics ? 'Update Logistics' : 'Save Logistics'}
                  </button>
                </div>
              </div>
            ) : null}
          </Section>

          <Section title="SL 8–9: GRN (Received qty must not exceed PO qty)">
            <div className="text-sm font-semibold text-on-surface">{grn ? grn.id : 'GRN not created'}</div>
            {invoice && !grn ? (
              <div className="space-y-2">
                <Field label="Received Date">
                  <input className={inputClass} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} type="date" />
                </Field>
                {invoiceItems.map((it) => (
                  <div key={it.item} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                    <div className="md:col-span-6 text-sm text-on-surface">{it.item}</div>
                    <Field label="Received Qty">
                      <input
                        className={inputClass}
                        value={grnQty[it.item] ?? String(it.quantity)}
                        onChange={(e) => setGrnQty((prev) => ({ ...prev, [it.item]: e.target.value }))}
                        inputMode="numeric"
                      />
                    </Field>
                  </div>
                ))}
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
                    onClick={() => {
                      if (!invoice) return;
                      const items = invoiceItems.map((it) => ({ item: it.item, quantityReceived: Number(grnQty[it.item] ?? it.quantity) }));
                      if (items.some((x) => !Number.isFinite(x.quantityReceived) || x.quantityReceived < 0)) {
                        setError('Enter valid received qty.');
                        return;
                      }
                      run(() => createGrn(invoice.id, { receivedDate, items }).then(() => undefined));
                    }}
                  >
                    Create GRN
                  </button>
                </div>
              </div>
            ) : grn ? (
              <div className="space-y-1 text-sm text-on-surface">
                {grnItems.map((it) => (
                  <div key={it.item}>
                    {it.item}: {it.quantityReceived}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-on-surface-variant">Record invoice first.</div>
            )}
          </Section>

          <Section title="SL 10–13: QC + Stock Posting (Only accepted qty posted)">
            <div className="text-sm font-semibold text-on-surface">{qc.length ? 'QC recorded' : 'QC pending'}</div>
            {grn && !qc.length ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <Field label="Inspected By">
                    <input className={inputClass} value={inspectedBy} onChange={(e) => setInspectedBy(e.target.value)} />
                  </Field>
                  <Field label="Location">
                    <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} />
                  </Field>
                </div>
                {grnItems.map((it) => (
                  <div key={it.item} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                    <div className="md:col-span-4 text-sm text-on-surface">{it.item} (Received {it.quantityReceived})</div>
                    <Field label="Accepted">
                      <input
                        className={inputClass}
                        value={qcAccepted[it.item] ?? String(it.quantityReceived)}
                        onChange={(e) => setQcAccepted((prev) => ({ ...prev, [it.item]: e.target.value }))}
                        inputMode="numeric"
                      />
                    </Field>
                    <Field label="Rejected">
                      <input
                        className={inputClass}
                        value={qcRejected[it.item] ?? '0'}
                        onChange={(e) => setQcRejected((prev) => ({ ...prev, [it.item]: e.target.value }))}
                        inputMode="numeric"
                      />
                    </Field>
                    <Field label="Remarks">
                      <input
                        className={inputClass}
                        value={qcRemarks[it.item] ?? ''}
                        onChange={(e) => setQcRemarks((prev) => ({ ...prev, [it.item]: e.target.value }))}
                      />
                    </Field>
                  </div>
                ))}
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
                    onClick={() => {
                      if (!grn) return;
                      const items = grnItems.map((it) => ({
                        item: it.item,
                        quantityAccepted: Number(qcAccepted[it.item] ?? it.quantityReceived),
                        quantityRejected: Number(qcRejected[it.item] ?? 0),
                        remarks: qcRemarks[it.item] ?? '',
                      }));
                      if (items.some((x) => !Number.isFinite(x.quantityAccepted) || !Number.isFinite(x.quantityRejected) || x.quantityAccepted < 0 || x.quantityRejected < 0)) {
                        setError('Enter valid QC quantities.');
                        return;
                      }
                      run(() => recordQc(grn.id, { inspectedBy, location, items }).then(() => undefined));
                    }}
                  >
                    Record QC + Post Stock
                  </button>
                </div>
              </div>
            ) : qc.length ? (
              <div className="space-y-1 text-sm text-on-surface">
                {qc.map((r) => (
                  <div key={r.item}>
                    {r.item}: accepted {r.quantityAccepted}, rejected {r.quantityRejected} ({r.remarks || '—'})
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-on-surface-variant">Create GRN before QC.</div>
            )}
          </Section>

          <Section title="SL 14–16: 3-Way Match (PO vs Invoice vs GRN) + Payment">
            <div className="text-sm font-semibold text-on-surface">{invoice ? `Invoice ${invoice.status}` : 'No invoice'}</div>
            {invoice ? (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
                    onClick={() => run(() => approveInvoice(invoice.id).then(() => undefined))}
                  >
                    Run 3-Way Match
                  </button>
                </div>
                {invoice.status === 'Approved' ? (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                    <Field label="Payment Date">
                      <input className={inputClass} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} type="date" />
                    </Field>
                    <Field label="Amount">
                      <input className={inputClass} value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} inputMode="decimal" />
                    </Field>
                    <Field label="Mode">
                      <input className={inputClass} value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} />
                    </Field>
                    <Field label="Reference No">
                      <input className={inputClass} value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} />
                    </Field>
                    <div className="md:col-span-4 flex justify-end">
                      <button
                        type="button"
                        disabled={busy}
                        className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
                        onClick={() => {
                          const amount = Number(paymentAmount);
                          if (!Number.isFinite(amount) || amount <= 0 || !paymentRef.trim()) {
                            setError('Enter payment amount and reference.');
                            return;
                          }
                          run(() => payInvoice(invoice.id, { paymentDate, amount, mode: paymentMode, referenceNo: paymentRef }).then(() => undefined));
                        }}
                      >
                        Mark Paid
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-on-surface-variant">Record invoice before matching/payment.</div>
            )}
          </Section>
        </div>
      ) : null}
    </div>
  );
}
