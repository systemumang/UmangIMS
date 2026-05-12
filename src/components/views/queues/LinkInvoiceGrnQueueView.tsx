import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { fetchPendingGrnInvoiceLinks, setGrnItemInvoiceLinks, type PendingGrnInvoiceLinkRow } from '@/src/lib/purchaseRequests';
import { fetchQueueLinkInvoiceGrn, type LinkInvoiceGrnQueueRow, type QueueFilters } from '@/src/lib/queues';
import { formatItemInline } from '@/src/lib/itemLabel';
import { formatPoNumber } from '@/src/lib/docNumbers';
import { cn } from '@/src/lib/utils';
import { fetchSpecifications, type Specification } from '@/src/lib/masters';
import { inputClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';
import Pagination from '@/src/components/common/Pagination';

type RowDraft = { invoiceItemId: string; linkQty: string };

export default function LinkInvoiceGrnQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
  const masters = useQueueMasters({ includeSuppliers: true });
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', department: '', projectId: '', supplierId: '', from: '', to: '' });
  const [rows, setRows] = useState<LinkInvoiceGrnQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;
  const [page, setPage] = useState(1);

  const mastersForFilters = useMemo(
    () => ({ firms: masters.firms, departments: masters.departments, projects: masters.projects, suppliers: masters.suppliers }),
    [masters.departments, masters.firms, masters.projects, masters.suppliers]
  );

  useEffect(() => {
    const ac = new AbortController();
    fetchSpecifications(ac.signal).then(setSpecs).catch(() => setSpecs([]));
    return () => ac.abort();
  }, []);

  const specNameById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchQueueLinkInvoiceGrn(filters, ac.signal)
      .then(setRows)
      .catch((e) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [filters]);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    if (page > totalPages) setPage(totalPages);
  }, [page, pageSize, rows.length]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [page, pageSize, rows]);

  const [modalOpen, setModalOpen] = useState(false);
  const [active, setActive] = useState<LinkInvoiceGrnQueueRow | null>(null);
  const [pending, setPending] = useState<PendingGrnInvoiceLinkRow[]>([]);
  const [draftByGrnItemId, setDraftByGrnItemId] = useState<Record<string, RowDraft>>({});
  const [modalLoading, setModalLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  function closeModal() {
    setModalOpen(false);
    setActive(null);
    setPending([]);
    setDraftByGrnItemId({});
    setModalLoading(false);
    setSaving(false);
    setModalError(null);
  }

  useEffect(() => {
    if (!modalOpen || !active) return;
    const ac = new AbortController();
    setModalError(null);
    setModalLoading(true);
    fetchPendingGrnInvoiceLinks(active.grnId, ac.signal)
      .then((rows2) => {
        if (ac.signal.aborted) return;
        setPending(rows2);
        const draft: Record<string, RowDraft> = {};
        for (const r of rows2 ?? []) draft[r.grnItemId] = { invoiceItemId: '', linkQty: '' };
        setDraftByGrnItemId(draft);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setModalError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setModalLoading(false));
    return () => ac.abort();
  }, [active, modalOpen]);

  return (
    <div className="space-y-6">
      {masters.error ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load masters: {masters.error}</div> : null}
      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} />

      {loading ? (
        <LoadingCard label="Loading GRNs pending invoice linking..." />
      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
      ) : (
        <QueueCard title="Link Invoice ↔ GRN" subtitle={`${rows.length} pending`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] table-fixed text-left border-collapse border border-outline-variant">
              <colgroup>
                <col className="w-[180px]" />
                <col className="w-[140px]" />
                <col className="w-[160px]" />
                <col className="w-[230px]" />
                <col className="w-[210px]" />
                <col className="w-[140px]" />
                <col className="w-[200px]" />
              </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">GRN</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Received</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Firm</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Pending Items</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.length ? (
                  pagedRows.map((r) => (
                    <tr key={r.grnId}>
                      <td className="px-3 py-2 text-sm text-primary font-semibold border border-outline-variant">{r.grnNumber ?? r.grnId}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.receivedDate ? formatDateDDMMYYYYOnly(r.receivedDate) : '-'}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{formatPoNumber(r.poNumber ?? r.poId) || '-'}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.firmName}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.supplierName || '-'}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{r.pendingItems}</td>
                      <td className="px-3 py-2 border border-outline-variant">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button type="button" className="btn btn-sm" onClick={() => onViewPr(r.prId)}>
                            View PR
                          </button>
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            onClick={() => {
                              setActive(r);
                              setModalOpen(true);
                            }}
                          >
                            Link
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-5 text-sm text-on-surface-variant border border-outline-variant" colSpan={7}>
                      No records.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pt-3">
            <Pagination totalItems={rows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
          </div>
        </QueueCard>
      )}

      <Modal
        open={modalOpen}
        title="GRN → Invoice Link"
        titleCentered
        onClose={() => (saving ? null : closeModal())}
        fullScreen
        maxWidthClass="max-w-7xl"
        footer={
          <>
            <button type="button" className="btn btn-sm" disabled={saving} onClick={closeModal}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={saving || modalLoading || !active || !pending.length}
              onClick={async () => {
                const work = pending
                  .map((r) => {
                    const d = draftByGrnItemId[r.grnItemId] ?? { invoiceItemId: '', linkQty: '' };
                    const qty = String(d.linkQty ?? '').trim() ? Number(d.linkQty) : 0;
                    return { row: r, invoiceItemId: d.invoiceItemId, linkQty: qty };
                  })
                  .filter((x) => Number.isFinite(x.linkQty) && x.linkQty > 0);

                for (const x of work) {
                  const maxGrn = Number(x.row.pendingLinkingQty ?? 0);
                  if (!x.invoiceItemId) return setModalError('Select invoice for all rows with Link Qty');
                  if (!Number.isFinite(x.linkQty) || x.linkQty <= 0) return setModalError('Invalid Link Qty');
                  if (x.linkQty > maxGrn + 1e-9) return setModalError('Link Qty cannot exceed Pending Linking Qty');
                  const cand = (x.row.candidates ?? []).find((c) => c.invoiceItemId === x.invoiceItemId);
                  if (!cand) return setModalError('Invalid invoice selection');
                  if (x.linkQty > Number(cand.pendingLinkingQty ?? 0) + 1e-9) return setModalError('Link Qty cannot exceed invoice pending qty');
                }

                setSaving(true);
                setModalError(null);
                try {
                  // SQLite uses a single connection; save sequentially to avoid nested transactions.
                  for (const x of work) {
                    await setGrnItemInvoiceLinks(x.row.grnItemId, {
                      updatedBy: 'Accounts Team',
                      links: [{ invoiceItemId: x.invoiceItemId, linkedQty: x.linkQty }],
                    });
                  }
                  await fetchQueueLinkInvoiceGrn(filters).then(setRows);
                  closeModal();
                } catch (e) {
                  setModalError(e instanceof Error ? e.message : String(e));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? 'Saving...' : 'Save Links'}
            </button>
          </>
        }
      >
        {modalError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{modalError}</div> : null}

        <div className="text-sm font-bold text-on-surface">Pending Links</div>

        {modalLoading ? (
          <div className="text-sm text-on-surface-variant">Loading pending links...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1400px] table-fixed text-left border-collapse border border-outline-variant">
              <colgroup>
                <col className="w-[120px]" />
                <col className="w-[110px]" />
                <col className="w-[120px]" />
                <col className="w-[360px]" />
                <col className="w-[90px]" />
                <col className="w-[160px]" />
                <col className="w-[110px]" />
                <col className="w-[110px]" />
                <col className="w-[110px]" />
                <col className="w-[110px]" />
                <col className="w-[120px]" />
                <col className="w-[110px]" />
              </colgroup>
              <thead>
                <tr className="bg-primary text-on-primary">
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">GRN</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Received</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">PO</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Item</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">GRN Qty</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Invoice No</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Invoice Date</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Total Invoice Qty</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Already Link Qty</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Approved Qty</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Pending Linking Qty</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Link Qty</th>
                </tr>
              </thead>
              <tbody>
                {pending.length ? (
                  pending.map((r) => {
                    const d = draftByGrnItemId[r.grnItemId] ?? { invoiceItemId: '', linkQty: '' };
                    const cand = (r.candidates ?? []).find((c) => c.invoiceItemId === d.invoiceItemId);
                    return (
                      <tr key={r.grnItemId}>
                        <td className="px-3 py-2 text-sm border border-outline-variant">{r.grnNumber}</td>
                        <td className="px-3 py-2 text-sm border border-outline-variant">{r.receivedDate ? formatDateDDMMYYYYOnly(r.receivedDate) : '-'}</td>
                        <td className="px-3 py-2 text-sm border border-outline-variant">{r.poNumber}</td>
	                        <td className="px-3 py-2 text-sm border border-outline-variant">{formatItemInline(r.item, r.specificationsJson, specNameById)}</td>
	                        <td className="px-3 py-2 text-sm border border-outline-variant tabular-nums">{r.grnQty}</td>
	                        <td className="px-3 py-2 border border-outline-variant">
	                          <select
                            className={cn(inputClass, 'py-1.5')}
                            value={d.invoiceItemId}
                            onChange={(e) => {
                              const invoiceItemId = e.target.value;
                              setDraftByGrnItemId((prev) => ({
                                ...prev,
                                [r.grnItemId]: {
                                  invoiceItemId,
                                  linkQty: invoiceItemId
                                    ? String(
                                        Math.min(
                                          Number(r.pendingLinkingQty ?? 0),
                                          Number((r.candidates ?? []).find((c) => c.invoiceItemId === invoiceItemId)?.pendingLinkingQty ?? 0)
                                        )
                                      )
                                    : '',
                                },
                              }));
                            }}
                          >
                            <option value="">Select invoice</option>
                            {(r.candidates ?? []).map((c) => (
                              <option key={c.invoiceItemId} value={c.invoiceItemId}>
                                {c.invoiceNo}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-sm border border-outline-variant">{cand?.invoiceDate ? formatDateDDMMYYYYOnly(cand.invoiceDate) : '-'}</td>
                        <td className="px-3 py-2 text-sm border border-outline-variant tabular-nums">{cand ? cand.invoiceQty : '-'}</td>
                        <td className="px-3 py-2 text-sm border border-outline-variant tabular-nums">{cand ? cand.alreadyLinkedQty : '-'}</td>
                        <td className="px-3 py-2 text-sm border border-outline-variant tabular-nums">{r.approvedQty}</td>
                        <td className="px-3 py-2 text-sm border border-outline-variant tabular-nums">{r.pendingLinkingQty}</td>
                        <td className="px-3 py-2 border border-outline-variant">
                          <input
                            className={cn(inputClass, 'py-1.5')}
                            value={d.linkQty}
                            onChange={(e) => setDraftByGrnItemId((prev) => ({ ...prev, [r.grnItemId]: { ...d, linkQty: e.target.value } }))}
                            inputMode="decimal"
                          />
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="px-3 py-5 text-sm text-on-surface-variant border border-outline-variant" colSpan={12}>
                      No pending links.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
