import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { Download } from 'lucide-react';
import { formatPoNumber, formatPrNumber } from '@/src/lib/docNumbers';
import { formatItemInline } from '@/src/lib/itemLabel';
import { fetchPos, updatePoCheckAndSent, type Po, type PoItem } from '@/src/lib/purchaseRequests';
import { fetchQueueCheckPo, type CheckPoQueueRow, type QueueFilters } from '@/src/lib/queues';
import { cn } from '@/src/lib/utils';
import { fetchSpecifications, type Specification } from '@/src/lib/masters';
import { ExportCsvButton, inputClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';
import Pagination from '@/src/components/common/Pagination';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function displayPoNumber(raw: string) {
  return formatPoNumber(String(raw ?? '').trim()) || '-';
}

function itemTotalNumber(it: PoItem) {
  const qty = Number(it.quantity ?? 0);
  const rate = Number(it.rate ?? 0);
  const disc = Number(it.discountPercent ?? 0);
  const gst = Number(it.taxPercent ?? 0);
  const base = qty * rate;
  const afterDisc = base - (base * disc) / 100;
  return afterDisc + (afterDisc * gst) / 100;
}

export default function CheckPoQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
  const masters = useQueueMasters({ includeSuppliers: true, includeUsers: true });
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', projectId: '', supplierId: '', from: '', to: '' });
  const [rows, setRows] = useState<CheckPoQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;
  const [page, setPage] = useState(1);

  const mastersForFilters = useMemo(
    () => ({ firms: masters.firms, projects: masters.projects, suppliers: masters.suppliers }),
    [masters.firms, masters.projects, masters.suppliers]
  );

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchQueueCheckPo(filters, ac.signal)
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
  const [active, setActive] = useState<CheckPoQueueRow | null>(null);
  const [activePoDetails, setActivePoDetails] = useState<{ po: Po; items: PoItem[] } | null>(null);
  const [checkUserId, setCheckUserId] = useState('');
  const [checkDate, setCheckDate] = useState(todayIsoDate());
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedPoId, setExpandedPoId] = useState<string>('');
  const [expandedLoadingPoId, setExpandedLoadingPoId] = useState<string>('');
  const [expandedDetailsByPoId, setExpandedDetailsByPoId] = useState<Record<string, { po: Po; items: PoItem[] }>>({});
  const [expandedErrorByPoId, setExpandedErrorByPoId] = useState<Record<string, string>>({});

  useEffect(() => {
    const ac = new AbortController();
    fetchSpecifications(ac.signal).then(setSpecs).catch(() => setSpecs([]));
    return () => ac.abort();
  }, []);

  const specNameById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);

  const activePoTotal = useMemo(() => {
    const items = activePoDetails?.items ?? [];
    if (!items.length) return 0;
    return items.reduce((sum, it) => sum + itemTotalNumber(it), 0);
  }, [activePoDetails]);

  const eligibleUsers = useMemo(() => {
    const itemsPresent = Boolean(activePoDetails?.items?.length);
    if (!itemsPresent) return masters.users.filter((u) => u.isActive !== false);

    return masters.users.filter((u) => {
      if (u.isActive === false) return false;
      const limit = Number(u.poApprovalAmount ?? 0);
      if (!Number.isFinite(limit) || limit <= 0) return false;
      return activePoTotal <= limit + 1e-9;
    });
  }, [activePoDetails?.items?.length, activePoTotal, masters.users]);

  useEffect(() => {
    if (!modalOpen) return;
    if (checkUserId) return;
    if (masters.loading) return;
    if (eligibleUsers.length) setCheckUserId(eligibleUsers[0]!.id);
  }, [checkUserId, eligibleUsers, masters.loading, modalOpen]);

  useEffect(() => {
    if (!modalOpen) return;
    if (!checkUserId) return;
    if (!eligibleUsers.length) return;
    if (eligibleUsers.some((u) => u.id === checkUserId)) return;
    setCheckUserId(eligibleUsers[0]!.id);
  }, [checkUserId, eligibleUsers, modalOpen]);

  const userOptions = useMemo(
    () => [{ value: '', label: 'Select user' }, ...eligibleUsers.map((u) => ({ value: u.id, label: u.name }))],
    [eligibleUsers]
  );

  useEffect(() => {
    if (!modalOpen || !active) return;
    const ac = new AbortController();
    setDetailLoading(true);
    setModalError(null);
    setActivePoDetails(null);
    fetchPos(active.prId, ac.signal)
      .then((pos) => {
        const found = (pos ?? []).find((p) => String(p?.po?.id ?? '').trim() === String(active.poId ?? '').trim());
        if (!found) throw new Error('PO details not found');
        setActivePoDetails({ po: found.po, items: Array.isArray(found.items) ? found.items : [] });
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setModalError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setDetailLoading(false));
    return () => ac.abort();
  }, [active, modalOpen]);

  function closeModal() {
    setModalOpen(false);
    setActive(null);
    setActivePoDetails(null);
    setCheckUserId('');
    setCheckDate(todayIsoDate());
    setSaving(false);
    setModalError(null);
    setDetailLoading(false);
  }

  async function toggleExpandRow(row: CheckPoQueueRow) {
    const poId = String(row.poId ?? '').trim();
    if (!poId) return;
    if (expandedPoId === poId) {
      setExpandedPoId('');
      return;
    }
    setExpandedPoId(poId);
    if (expandedDetailsByPoId[poId] || expandedLoadingPoId === poId) return;
    setExpandedLoadingPoId(poId);
    setExpandedErrorByPoId((prev) => ({ ...prev, [poId]: '' }));
    try {
      const pos = await fetchPos(row.prId);
      const found = (pos ?? []).find((p) => String(p?.po?.id ?? '').trim() === poId);
      if (!found) throw new Error('PO details not found');
      setExpandedDetailsByPoId((prev) => ({
        ...prev,
        [poId]: { po: found.po, items: Array.isArray(found.items) ? found.items : [] },
      }));
    } catch (e) {
      setExpandedErrorByPoId((prev) => ({
        ...prev,
        [poId]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setExpandedLoadingPoId((prev) => (prev === poId ? '' : prev));
    }
  }

  function itemTotal(it: PoItem) {
    const qty = Number(it.quantity ?? 0);
    const rate = Number(it.rate ?? 0);
    const disc = Number(it.discountPercent ?? 0);
    const gst = Number(it.taxPercent ?? 0);
    const base = qty * rate;
    const afterDisc = base - (base * disc) / 100;
    const total = afterDisc + (afterDisc * gst) / 100;
    return total.toFixed(2);
  }

	  return (
	    <div className="space-y-6">
	      {masters.error ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load masters: {masters.error}</div> : null}
	      <div className="hidden">
	        <div className="text-sm text-on-surface-variant">Check PO</div>
	        <ExportCsvButton id="pending-export-btn" filename={`queue-check-po-${new Date().toISOString().slice(0, 10)}.csv`} rows={rows} disabled={loading} />
	      </div>
	      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} />

	      {loading ? (
	        <LoadingCard label="Loading POs pending check..." />
	      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
      ) : (
        <QueueCard title="Check PO" subtitle={`${rows.length} pending`}>
          <div className="overflow-x-auto">
	            <table className="w-full min-w-[1240px] table-fixed text-left border-collapse border border-outline-variant">
	              <colgroup>
	                <col className="w-[150px]" />
	                <col className="w-[150px]" />
	                <col className="w-[190px]" />
	                <col className="w-[200px]" />
		                <col className="w-[140px]" />
		                <col className="w-[140px]" />
		                <col className="w-[260px]" />
	              </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PR</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Firm</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
		                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Order Date</th>
		                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Priority</th>
		                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Actions</th>
	                </tr>
              </thead>
              <tbody>
                {pagedRows.length ? (
                  pagedRows.map((r) => {
                    const poId = String(r.poId ?? '').trim();
                    const isExpanded = expandedPoId === poId;
                    const expandedDetails = expandedDetailsByPoId[poId];
                    const expandedError = expandedErrorByPoId[poId];
                    const isExpandedLoading = expandedLoadingPoId === poId;
                    const items = expandedDetails?.items?.length
                      ? expandedDetails.items
                      : expandedDetails
                      ? ([{ poId, itemId: '', item: '-', quantity: 0, rate: 0 } as any] as PoItem[])
                      : [];
	                    return (
	                      <React.Fragment key={r.poId}>
	                        <tr
	                          className={cn(
	                            'transition-colors cursor-pointer',
	                            isExpanded ? 'bg-primary/5' : 'hover:bg-surface-container-high/40'
	                          )}
	                          onClick={() => toggleExpandRow(r)}
	                        >
	                          <td className="px-3 py-2 text-sm text-primary font-semibold border border-outline-variant">
	                            {formatPoNumber(r.poNumber ?? r.poId) || '-'}
	                          </td>
	                          <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{formatPrNumber((r as any).prNumber ?? r.prId) || '-'}</td>
	                          <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.firmName}</td>
	                          <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.supplierName || '-'}</td>
		                          <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.orderDate ? formatDateDDMMYYYYOnly(r.orderDate) : '-'}</td>
		                          <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{String((r as any).priority ?? '').trim() || '-'}</td>
		                          <td className="px-3 py-2 border border-outline-variant" onClick={(e) => e.stopPropagation()}>
	                            <div className="flex items-center gap-2 flex-wrap">
	                              <a
	                                className="btn btn-sm inline-flex items-center justify-center w-9 h-9 p-0"
	                                href={`/api/pos/${encodeURIComponent(String(r.poId ?? ''))}.pdf`}
	                                target="_blank"
	                                rel="noreferrer"
	                                title="Download PO PDF"
	                                aria-label="Download PO PDF"
	                              >
	                                <Download size={16} />
	                              </a>
	                              <button
	                                type="button"
	                                className="btn-primary btn-sm"
	                                onClick={() => {
                                  setActive(r);
                                  setModalOpen(true);
                                }}
                              >
                                Mark Checked
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr>
	                            <td colSpan={7} className="px-3 py-3 border border-outline-variant bg-surface-container-lowest">
                              {isExpandedLoading ? <div className="text-sm text-on-surface-variant">Loading PO details...</div> : null}
                              {!isExpandedLoading && expandedError ? (
                                <div className="text-sm text-error">Failed to load details: {expandedError}</div>
                              ) : null}
                              {!isExpandedLoading && expandedDetails ? (
                                <div className="space-y-2">
                                  <div className="text-sm text-on-surface">
                                    Supplier: {expandedDetails.po.supplier || '-'} | Payment Terms: {expandedDetails.po.paymentTerms || '-'}
                                  </div>
                                  <div className="overflow-x-auto">
                                    <table className="w-full min-w-[980px] table-fixed border-collapse border border-outline-variant text-sm">
                                      <colgroup>
                                        <col className="w-[38%]" />
                                        <col className="w-[10%]" />
                                        <col className="w-[12%]" />
                                        <col className="w-[10%]" />
                                        <col className="w-[10%]" />
                                        <col className="w-[20%]" />
                                      </colgroup>
                                      <thead>
                                        <tr className="bg-surface-container-high">
                                          <th className="px-3 py-2 text-left border border-outline-variant">Item</th>
                                          <th className="px-3 py-2 text-left border border-outline-variant">PO Qty</th>
                                          <th className="px-3 py-2 text-left border border-outline-variant">PO Rate</th>
                                          <th className="px-3 py-2 text-left border border-outline-variant">Disc %</th>
                                          <th className="px-3 py-2 text-left border border-outline-variant">GST %</th>
                                          <th className="px-3 py-2 text-left border border-outline-variant">Total</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {items.map((it, idx) => (
                                          <tr key={`${String(it.itemId ?? idx)}-${idx}`}>
                                            <td className="px-3 py-2 border border-outline-variant">{formatItemInline(it.item, it.specificationsJson, specNameById)}</td>
                                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.quantity ?? 0)}</td>
                                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.rate ?? 0)}</td>
                                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.discountPercent ?? 0)}</td>
                                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.taxPercent ?? 0)}</td>
                                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{itemTotal(it)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })
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
        title="PO Pending for Checking"
        onClose={() => (saving ? null : closeModal())}
        fullScreen
        contentClassName="p-3"
        titleCentered
        titleClassName="text-blue-600 text-base font-bold"
        footer={
          <>
            <button type="button" className="btn btn-sm" disabled={saving} onClick={closeModal}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={saving || !active || !checkUserId || !checkDate}
              onClick={() => {
                if (!active) return;
                const by = masters.users.find((u) => u.id === checkUserId)?.name ?? 'Purchase Team';
                setSaving(true);
                setModalError(null);
                updatePoCheckAndSent(active.poId, {
                  checkPo: true,
                  checkPoUserId: checkUserId,
                  checkDate,
                  updatedBy: by,
                })
                  .then(() => fetchQueueCheckPo(filters).then(setRows))
                  .then(() => closeModal())
                  .catch((e) => setModalError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSaving(false));
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        }
      >
        {modalError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{modalError}</div> : null}

        {detailLoading ? (
          <div className="text-sm text-on-surface-variant">Loading PO details...</div>
        ) : active && activePoDetails ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1300px] table-fixed text-left border-collapse border border-black text-sm [&_th]:border-black [&_td]:border-black">
              <colgroup>
                <col className="w-[120px]" />
                <col className="w-[160px]" />
                <col className="w-[120px]" />
                <col className="w-[420px]" />
                <col className="w-[90px]" />
                <col className="w-[90px]" />
                <col className="w-[80px]" />
                <col className="w-[80px]" />
                <col className="w-[200px]" />
                <col className="w-[150px]" />
              </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-black">PO No</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-black">Supplier</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-black">Terms</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-black">Items</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-black">PO Qty</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-black">PO Rate</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-black">Disc %</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-black">GST %</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-black">Checked By</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-black">Check Date</th>
                </tr>
              </thead>
              <tbody>
                {(activePoDetails.items.length ? activePoDetails.items : [{ poId: activePoDetails.po.id, itemId: '', item: '-', quantity: 0, rate: 0 } as any]).map(
                  (it: PoItem, idx: number) => {
                    const rowSpan = activePoDetails.items.length || 1;
                    return (
                      <tr key={`${String(it.itemId ?? idx)}-${idx}`}>
                        {idx === 0 ? (
                          <>
                            <td rowSpan={rowSpan} className="px-3 py-2 text-sm font-semibold text-on-surface border border-black align-top">
			                          {displayPoNumber(activePoDetails.po.poNumber ?? activePoDetails.po.id)}
                            </td>
                            <td rowSpan={rowSpan} className="px-3 py-2 text-sm text-on-surface-variant border border-black align-top">
                              {activePoDetails.po.supplier || '-'}
                            </td>
                            <td rowSpan={rowSpan} className="px-3 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums">
                              {activePoDetails.po.paymentTerms || '-'}
                            </td>
                          </>
                        ) : null}
                        <td className="px-3 py-2 text-sm text-on-surface border border-black align-top whitespace-normal break-words">
			                        {formatItemInline(it.item, it.specificationsJson, specNameById)}
                        </td>
                        <td className="px-3 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums">{Number(it.quantity ?? 0)}</td>
                        <td className="px-3 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums">{Number(it.rate ?? 0)}</td>
                        <td className="px-3 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums">{it.discountPercent ?? '-'}</td>
                        <td className="px-3 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums">{it.taxPercent ?? '-'}</td>
                        {idx === 0 ? (
                          <>
                            <td rowSpan={rowSpan} className="px-3 py-2 border border-black align-top">
                              <select
                                className={cn(inputClass, 'py-1.5')}
                                value={checkUserId}
                                disabled={saving || masters.loading}
                                onChange={(e) => {
                                  setCheckUserId(e.target.value);
                                  setCheckDate(todayIsoDate());
                                }}
                              >
                                {userOptions.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td rowSpan={rowSpan} className="px-3 py-2 border border-black align-top">
                              <div
                                className={cn(
                                  inputClass,
                                  'py-1.5 h-[38px] flex items-center bg-surface-container-low text-on-surface-variant cursor-default'
                                )}
                              >
                                {checkDate ? formatDateDDMMYYYYOnly(checkDate) : '-'}
                              </div>
                            </td>
                          </>
                        ) : null}
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
