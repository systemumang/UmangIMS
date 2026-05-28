import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { createPo, createRfq, fetchLastSupplierByItemIds, fetchPos, fetchRequest } from '@/src/lib/purchaseRequests';
import { fetchInventorySheet } from '@/src/lib/inventory';
import { fetchQueueCreatePo, type CreatePoQueueRow, type QueueFilters } from '@/src/lib/queues';
import { formatItemInline } from '@/src/lib/itemLabel';
import { fetchSpecifications, fetchSuppliers, type Specification, type Supplier } from '@/src/lib/masters';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import SupplierCreateModal from '@/src/components/common/SupplierCreateModal';
import { cn } from '@/src/lib/utils';
import { clampPercentString, sanitizeDecimalInput, sanitizePercentInput } from '@/src/lib/numberInput';
import { ExportCsvButton, inputClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';
import Pagination from '@/src/components/common/Pagination';

type Line = {
  itemId: string;
  item: string;
  specification: string;
  prItemId: string;
  unit?: string | null;
  approvedQty: number;
  orderedQty: number;
  remainingQty: number;
  lastSupplierName: string;
  lastRate: number;
  supplierId: string;
  paymentTerms: string;
  length?: string;
  breadth?: string;
  pcs?: string;
  quantity: string;
  rate: string;
  discountPercent: string;
  taxPercent: string;
};

export default function CreatePoQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
  function normalizeAreaUnitName(unitName: string) {
    const u = String(unitName ?? '').trim().toLowerCase();
    if (!u) return null;
    if (u === 'sq ft' || u === 'sqft' || u === 'sq. ft' || u === 'sqft.' || u === 'sq feet') return 'sqft';
    if (u === 'sq mtr' || u === 'sq mtrs' || u === 'sqmtr' || u === 'sq. mtr' || u === 'sq meter' || u === 'sq metre' || u === 'sq m' || u === 'sqm')
      return 'sqm';
    return null;
  }

  function baseDimUnitForAreaUnit(areaUnit: 'sqft' | 'sqm' | null) {
    if (areaUnit === 'sqft') return 'ft';
    if (areaUnit === 'sqm') return 'm';
    return '';
  }

  function round2(n: number) {
    if (!Number.isFinite(n)) return NaN;
    return Math.round(n * 100) / 100;
  }

  function computeAreaQty(length: number, breadth: number, pcs: number) {
    const l = round2(length);
    const b = round2(breadth);
    const p = Math.trunc(pcs);
    if (!Number.isFinite(l) || l <= 0) return NaN;
    if (!Number.isFinite(b) || b <= 0) return NaN;
    if (!Number.isFinite(p) || p < 1) return NaN;
    return l * b * p;
  }

  const masters = useQueueMasters({ includeSuppliers: true });
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', projectId: '', supplierId: '', from: '', to: '' });
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [rows, setRows] = useState<CreatePoQueueRow[]>([]);
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
    fetchQueueCreatePo(filters, ac.signal)
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
    setSelectedRowId(null);
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
  const [modalKind, setModalKind] = useState<'po' | 'rfq'>('po');
  const [activePrId, setActivePrId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
		  const [modalLoading, setModalLoading] = useState(false);
  const [availableStockByItemId, setAvailableStockByItemId] = useState<Record<string, number>>({});
  const [supplierRows, setSupplierRows] = useState<Supplier[]>([]);
  const [supplierCreateOpen, setSupplierCreateOpen] = useState(false);
  const [supplierCreateLineIndex, setSupplierCreateLineIndex] = useState<number | null>(null);
  const [newSupplierName, setNewSupplierName] = useState('');

  useEffect(() => {
    setSupplierRows(masters.suppliers);
  }, [masters.suppliers]);

  const supplierOptions = useMemo(
    () =>
      supplierRows
        .slice()
        .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }))
        .map((s) => ({ value: s.id, label: s.name })),
    [supplierRows]
  );
  const gstPercentOptions = ['0', '0.25', '3', '5', '12', '18', '28', '40'];

  const specNameById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);

  useEffect(() => {
    const ac = new AbortController();
    fetchSpecifications(ac.signal).then(setSpecs).catch(() => setSpecs([]));
    return () => ac.abort();
  }, []);

		  function closeModal() {
		    setModalOpen(false);
      setModalKind('po');
		    setActivePrId(null);
		    setLines([]);
      setSelectedLineId(null);
	    setModalError(null);
	    setSaving(false);
	    setModalLoading(false);
    setAvailableStockByItemId({});
  }

  useEffect(() => {
    if (!modalOpen || !activePrId) return;
    const ac = new AbortController();
    setModalError(null);
    setModalLoading(true);
    setSelectedLineId(null);
    Promise.all([fetchRequest(activePrId, ac.signal), fetchPos(activePrId, ac.signal)])
      .then(async ([pr, pos]) => {
        const activeRow = rows.find((r) => r.prId === activePrId);
        if (activeRow?.firmId) {
          try {
            const invRows = await fetchInventorySheet(activeRow.firmId, undefined, ac.signal, { includeEmpty: true });
            const byItem: Record<string, number> = {};
            for (const r of invRows ?? []) {
              const itemId = String(r.itemId ?? '').trim();
              if (!itemId) continue;
              byItem[itemId] = (byItem[itemId] ?? 0) + Number(r.balance ?? 0);
            }
            setAvailableStockByItemId(byItem);
          } catch {
            setAvailableStockByItemId({});
          }
        }
        const orderedByItemId = new Map<string, number>();
        for (const p of pos ?? []) {
          for (const it of p.items ?? []) {
            orderedByItemId.set(it.itemId, (orderedByItemId.get(it.itemId) ?? 0) + Number(it.quantity ?? 0));
          }
        }

        const itemIds = pr.items.map((it) => it.itemId).filter(Boolean);
        const lastSupplier = itemIds.length ? await fetchLastSupplierByItemIds(itemIds, ac.signal) : {};

	        const nextLines: Line[] = pr.items.map((it) => {
	          const approvedQty = Number((it as any).approvedQty ?? it.quantity ?? 0);
          const orderedQty = Number(orderedByItemId.get(it.itemId) ?? 0);
          const remainingQty = Math.max(0, approvedQty - orderedQty);
          const suggested = lastSupplier[it.itemId];
          const suggestedSupplierId = suggested?.supplierId ? String(suggested.supplierId) : '';
          const suggestedTerms = suggestedSupplierId
            ? String(masters.suppliers.find((s) => s.id === suggestedSupplierId)?.paymentTerms ?? '').trim()
            : '';
          const unit = (it as any).unit != null ? String((it as any).unit) : null;
          const areaUnit = normalizeAreaUnitName(unit || '');
          const isArea = !!areaUnit;
          const dimUnit = baseDimUnitForAreaUnit(areaUnit);
          const length = String((it as any).approvedDimLength ?? (it as any).dimLength ?? '').trim();
          const breadth = String((it as any).approvedDimBreadth ?? (it as any).dimBreadth ?? '').trim();
          const pcs = String((it as any).approvedDimPcs ?? (it as any).dimPcs ?? '1').trim() || '1';
          const qty = isArea ? computeAreaQty(Number(length), Number(breadth), Number(pcs)) : remainingQty;
	          return {
            itemId: it.itemId,
            item: it.item,
            specification: it.specification ?? '',
            prItemId: it.id,
            unit,
            approvedQty,
            orderedQty,
            remainingQty,
            lastSupplierName: suggested?.supplierName ? String(suggested.supplierName) : '',
            lastRate: Number(suggested?.rate ?? 0),
            supplierId: suggestedSupplierId,
            paymentTerms: suggestedTerms,
            length: isArea ? length : '',
            breadth: isArea ? breadth : '',
            pcs: isArea ? pcs : '',
	            quantity: isArea ? (Number.isFinite(qty) && qty > 0 ? String(qty) : '') : remainingQty > 0 ? String(remainingQty) : '',
	            rate: suggested && Number.isFinite(suggested.rate) ? String(suggested.rate) : '',
	            discountPercent: '',
		            taxPercent: '0',
	          };
	        });

        const filtered = nextLines.filter((l) => l.remainingQty > 0);
        setLines(filtered);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setModalError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setModalLoading(false));
    return () => ac.abort();
  }, [activePrId, modalOpen, rows]);

	  return (
	    <div className="space-y-6">
	      {masters.error ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load masters: {masters.error}</div> : null}
	      <div className="hidden">
	        <div className="text-sm text-on-surface-variant">Create PO</div>
	        <ExportCsvButton id="pending-export-btn" filename={`queue-create-po-${new Date().toISOString().slice(0, 10)}.csv`} rows={rows} disabled={loading} />
	      </div>
	      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} />

	      {loading ? (
	        <LoadingCard label="Loading PRs pending PO..." />
	      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
      ) : (
        <QueueCard title="Create PO" subtitle={`${rows.length} pending`} hideHeader>
          <div className="overflow-x-auto">
		            <table className="w-full min-w-[1180px] table-fixed text-left border-collapse border border-outline-variant">
	              <colgroup>
	                <col className="w-[130px]" />
	                <col className="w-[180px]" />
	                <col className="w-[200px]" />
		                <col className="w-[140px]" />
		                <col className="w-[160px]" />
		                <col className="w-[140px]" />
		                <col className="w-[240px]" />
	              </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PR</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Firm</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Project</th>
		                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Req Date</th>
		                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Priority</th>
		                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Remaining Qty</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Actions</th>
	                </tr>
              </thead>
              <tbody>
                {pagedRows.length ? (
                  pagedRows.map((r) => (
                    <tr
                      key={r.prId}
                      className={cn('cursor-pointer hover:bg-surface-container-low transition-colors', selectedRowId === r.prId && 'bg-primary/10')}
                      onClick={() => setSelectedRowId(selectedRowId === r.prId ? null : r.prId)}
                    >
                      <td className="px-3 py-2 text-sm text-primary font-semibold border border-outline-variant">{r.prNumber ?? r.prId}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.firmName}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.projectName ?? '-'}</td>
		                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.requisitionDate ? formatDateDDMMYYYYOnly(r.requisitionDate) : '-'}</td>
		                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{String((r as any).priority ?? '').trim() || '-'}</td>
		                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{r.remainingQty}</td>
	                      <td className="px-3 py-2 border border-outline-variant">
		                        <div className="flex items-center gap-2 flex-wrap">
		                        <button
	                          type="button"
	                          className="btn-primary btn-sm"
	                          onClick={() => {
	                            setModalKind('po');
	                            setActivePrId(r.prId);
	                            setModalOpen(true);
	                          }}
	                        >
	                          Create PO
	                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            setModalKind('rfq');
                            setActivePrId(r.prId);
                            setModalOpen(true);
                          }}
                        >
                          RFQ
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
        title={modalKind === 'rfq' ? 'Create RFQ' : `Make PO`}
        onClose={() => (saving ? null : closeModal())}
        fullScreen
        titleCentered
        titleClassName="text-primary text-base font-bold"
        footer={
          <>
            <button type="button" className="btn btn-sm" disabled={saving} onClick={closeModal}>
              Cancel
            </button>
		            <button
		              type="button"
		              className="btn-primary btn-sm"
		              disabled={saving || modalLoading || !activePrId || !lines.some((l) => Number(l.quantity) > 0)}
			              onClick={() => {
			                if (!activePrId) return;
	                    if (modalKind === 'rfq') {
	                      const picked = lines
	                        .map((l) => ({
	                          itemId: l.itemId,
	                          supplierId: String(l.supplierId ?? '').trim(),
	                          quantity: String(l.quantity ?? '').trim() ? Number(l.quantity) : 0,
	                          remainingQty: l.remainingQty,
	                          specification: l.specification,
	                        }))
	                        .filter((x) => Number.isFinite(x.quantity) && x.quantity > 0);

	                      if (!picked.length) {
	                        setModalError('Enter Qty for at least one item.');
	                        return;
	                      }
	                      const missingSupplier = picked.find((x) => !x.supplierId);
	                      if (missingSupplier) {
	                        setModalError('Select supplier for all items where Qty is entered.');
	                        return;
	                      }
	                      for (const it of picked) {
	                        if (it.quantity > it.remainingQty + 1e-9) {
	                          setModalError('Qty cannot exceed remaining PR quantity');
	                          return;
	                        }
	                      }

	                      setSaving(true);
	                      setModalError(null);
	                      createRfq(activePrId, {
	                        items: picked.map((x) => ({
	                          itemId: x.itemId,
	                          supplierId: x.supplierId,
	                          quantity: x.quantity,
	                          specification: x.specification,
	                        })),
	                      })
	                        .then(() => {
	                          closeModal();
	                          return fetchQueueCreatePo(filters).then(setRows);
	                        })
                        .catch((e) => setModalError(e instanceof Error ? e.message : String(e)))
                        .finally(() => setSaving(false));
                      return;
                    }
		                const picked = lines
		                  .map((l) => {
                        const areaUnit = normalizeAreaUnitName(String(l.unit ?? ''));
                        const isAreaUnit = !!areaUnit;
                        const length = String(l.length ?? '').trim() ? Number(l.length) : NaN;
                        const breadth = String(l.breadth ?? '').trim() ? Number(l.breadth) : NaN;
                        const pcs = String(l.pcs ?? '').trim() ? Number(l.pcs) : 1;
                        return {
                          itemId: l.itemId,
                          supplierId: String(l.supplierId ?? '').trim(),
                          paymentTerms: String(l.paymentTerms ?? '').trim(),
                          quantity: String(l.quantity ?? '').trim() ? Number(l.quantity) : 0,
                          rate: String(l.rate ?? '').trim() ? Number(l.rate) : 0,
                          discountPercent: String(l.discountPercent ?? '').trim() ? Number(l.discountPercent) : 0,
                          taxPercent: String(l.taxPercent ?? '').trim() ? Number(l.taxPercent) : 0,
                          remainingQty: l.remainingQty,
                          ...(isAreaUnit ? { length, breadth, pcs } : {}),
                        };
                      })
	                  .filter((x) => Number.isFinite(x.quantity) && x.quantity > 0);

	                const missingSupplier = picked.find((x) => !x.supplierId);
	                if (missingSupplier) {
	                  setModalError('Select supplier for all items where Qty PO is entered.');
	                  return;
	                }
	                const missingTerms = picked.find((x) => !x.paymentTerms);
	                if (missingTerms) {
	                  setModalError('Payment terms are required for all items where Qty PO is entered.');
	                  return;
	                }

	                for (const it of picked) {
	                  if (it.quantity > it.remainingQty + 1e-9) {
	                    setModalError('PO quantity cannot exceed remaining PR quantity');
	                    return;
	                  }
                    if ('length' in it || 'breadth' in it || 'pcs' in it) {
                      const q = computeAreaQty(Number((it as any).length), Number((it as any).breadth), Number((it as any).pcs ?? 1));
                      if (!Number.isFinite(q) || q <= 0) {
                        setModalError('Enter valid Length, Breadth and PCs for area-unit items.');
                        return;
                      }
                    }
	                  if (!Number.isFinite(it.rate) || it.rate < 0) {
	                    setModalError('Invalid rate');
	                    return;
	                  }
	                  if (!Number.isFinite(it.discountPercent) || it.discountPercent < 0 || it.discountPercent > 100) {
	                    setModalError('Invalid discount percent');
	                    return;
	                  }
	                  if (!Number.isFinite(it.taxPercent) || it.taxPercent < 0 || it.taxPercent > 100) {
	                    setModalError('Invalid tax percent');
	                    return;
	                  }
		                  if (!supplierRows.some((s) => s.id === it.supplierId)) {
		                    setModalError('Select a valid supplier for all PO lines.');
		                    return;
		                  }
	                }

		                const groups = new Map<
		                  string,
		                  {
		                    supplierId: string;
		                    supplierName: string;
		                    paymentTerms: string;
		                    items: Array<{
                          itemId: string;
                          quantity: number;
                          rate: number;
                          discountPercent: number;
                          taxPercent: number;
                          length?: number;
                          breadth?: number;
                          pcs?: number;
                        }>;
		                  }
		                >();
	                for (const it of picked) {
		                  const supplierName = String(supplierRows.find((s) => s.id === it.supplierId)?.name ?? '').trim();
	                  if (!supplierName) {
	                    setModalError('Supplier name is missing for a selected supplier.');
	                    return;
	                  }
		                  const key = `${it.supplierId}||${it.paymentTerms}`;
		                  const existing = groups.get(key);
		                  const itemLine = {
                        itemId: it.itemId,
                        quantity: it.quantity,
                        rate: it.rate,
                        discountPercent: it.discountPercent,
                        taxPercent: it.taxPercent,
                        ...(('length' in it || 'breadth' in it || 'pcs' in it)
                          ? { length: (it as any).length, breadth: (it as any).breadth, pcs: (it as any).pcs }
                          : {}),
                      };
		                  if (existing) existing.items.push(itemLine);
		                  else groups.set(key, { supplierId: it.supplierId, supplierName, paymentTerms: it.paymentTerms, items: [itemLine] });
		                }

	                setSaving(true);
	                setModalError(null);
		                Promise.resolve()
		                  .then(async () => {
			                    for (const [, g] of groups.entries()) {
                      await createPo(activePrId, {
                        supplier: g.supplierName,
                        paymentTerms: g.paymentTerms,
                        paymentType: null,
                        paymentMode: null,
                        advanceAmount: 0,
                        advanceDate: null,
                        items: g.items,
				                      });
				                    }
			                  })
	                  .then(() => fetchQueueCreatePo(filters).then(setRows))
	                  .then(() => closeModal())
	                  .catch((e) => setModalError(e instanceof Error ? e.message : String(e)))
	                  .finally(() => setSaving(false));
	              }}
	            >
	              {saving ? 'Creating...' : modalKind === 'rfq' ? 'Create RFQ' : 'Make PO'}
	            </button>
	          </>
	        }
	      >
        {modalError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{modalError}</div> : null}

        {modalLoading ? (
          <div className="text-sm text-on-surface-variant">Loading PR items...</div>
        ) : (
          <div className="space-y-3">
	          <div className="overflow-x-auto">
		            <table
	              className={cn(
		                'w-full table-fixed text-left border-collapse border border-outline-variant',
		                modalKind === 'rfq' ? 'min-w-[1060px]' : 'min-w-[1620px]'
		              )}
		            >
	              <colgroup>
	                <col className="w-[420px]" />
	                <col className="w-[90px]" />
	                {modalKind === 'po' ? (
                  <>
                    <col className="w-[130px]" />
                    <col className="w-[110px]" />
                    <col className="w-[110px]" />
                    <col className="w-[90px]" />
                    <col className="w-[90px]" />
                    <col className="w-[80px]" />
                    <col className="w-[90px]" />
                    <col className="w-[90px]" />
                    <col className="w-[90px]" />
                    <col className="w-[90px]" />
                    <col className="w-[150px]" />
                    <col className="w-[90px]" />
	                    <col className="w-[220px]" />
	                    <col className="w-[140px]" />
			                  </>
		                ) : (
	                  <>
	                    <col className="w-[160px]" />
	                    <col className="w-[220px]" />
	                  </>
	                )}
	              </colgroup>
	              <thead>
	                <tr className="bg-surface-container-high">
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Item</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PR Qty</th>
	                  {modalKind === 'rfq' ? (
	                    <>
	                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Qty</th>
	                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
	                    </>
	                  ) : (
	                    <>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO Qty (Already Created)</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Pending Qty</th>
	                    <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Available Stock</th>
                    <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Length</th>
                    <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Breadth</th>
                    <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PCs</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Qty PO</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Rate</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Disc %</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">GST %</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Last Supplier</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Last Rate</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Terms</th>
		                    </>
		                  )}
                </tr>
              </thead>
              <tbody>
                {lines.length ? (
                  lines
                    .filter((l) => !selectedLineId || l.itemId === selectedLineId)
                    .map((l) => {
                      const idx = lines.findIndex((x) => x.itemId === l.itemId);
                      const areaUnit = normalizeAreaUnitName(String(l.unit ?? ''));
                      const isAreaUnit = !!areaUnit;
                      const dimUnit = baseDimUnitForAreaUnit(areaUnit);
                      return (
                        <tr
                          key={l.itemId}
                          className={cn('cursor-pointer hover:bg-surface-container-low transition-colors', selectedLineId === l.itemId && 'bg-primary/10')}
                          onClick={() => setSelectedLineId(selectedLineId === l.itemId ? null : l.itemId)}
                        >
                          <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words">
                            {formatItemInline(l.item, l.specification, specNameById)}
                          </td>
                          <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{l.approvedQty}</td>
                          {modalKind === 'rfq' ? (
                            <>
                              <td className="px-3 py-2 border border-outline-variant" onClick={(e) => e.stopPropagation()}>
                                <input
                                  className={cn(inputClass, 'py-1.5')}
                                  value={l.quantity}
                                  onChange={(e) =>
                                    setLines((prev) => {
                                      const next = prev.slice();
                                      next[idx] = { ...next[idx]!, quantity: sanitizeDecimalInput(e.target.value) };
                                      return next;
                                    })
                                  }
                                  type="text"
                                  inputMode="decimal"
                                />
                              </td>
                              <td className="px-3 py-2 border border-outline-variant" onClick={(e) => e.stopPropagation()}>
                                <SearchableSelect
                                  value={l.supplierId}
                                  options={supplierOptions}
                                  allowClear
                                  disabled={masters.loading}
                                  placeholder=""
                                  onChange={(nextId) => {
                                    const safeId = String(nextId ?? '').trim();
                                    setLines((prev) => {
                                      const next = prev.slice();
                                      next[idx] = { ...next[idx]!, supplierId: safeId };
                                      return next;
                                    });
                                  }}
                                  showCreateWhenEmpty
                                  alwaysShowCreate
                                  allowEmptyCreate
                                  closeOnCreate
                                  createLabel={(q) => (q ? `+ Add Supplier "${q}"` : '+ Add Supplier')}
                                  onCreate={async (label) => {
                                    setSupplierCreateLineIndex(idx);
                                    setNewSupplierName(String(label ?? '').trim());
                                    setSupplierCreateOpen(true);
                                    return null;
                                  }}
                                />
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{l.orderedQty}</td>
                              <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{l.remainingQty}</td>
                              <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">
                                {Number(availableStockByItemId[l.itemId] ?? 0).toFixed(2)}
                              </td>
                              <td className="px-3 py-2 border border-outline-variant" onClick={(e) => e.stopPropagation()}>
                                {isAreaUnit ? (
                                  <input
                                    className={cn(inputClass, 'py-1.5')}
                                    value={String(l.length ?? '')}
                                    onChange={(e) =>
                                      setLines((prev) => {
                                        const next = prev.slice();
                                        const nextLength = e.target.value;
                                        const breadth = String(next[idx]?.breadth ?? '');
                                        const pcs = String(next[idx]?.pcs ?? '1') || '1';
                                        const qty = computeAreaQty(Number(nextLength), Number(breadth), Number(pcs));
                                        next[idx] = {
                                          ...next[idx]!,
                                          length: nextLength,
                                          quantity: Number.isFinite(qty) && qty > 0 ? String(qty) : '',
                                        };
                                        return next;
                                      })
                                    }
                                    type="text"
                                    inputMode="decimal"
                                    placeholder={dimUnit ? `L (${dimUnit})` : 'Length'}
                                  />
                                ) : (
                                  <div className="text-xs text-on-surface-variant opacity-70">-</div>
                                )}
                              </td>
                              <td className="px-3 py-2 border border-outline-variant" onClick={(e) => e.stopPropagation()}>
                                {isAreaUnit ? (
                                  <input
                                    className={cn(inputClass, 'py-1.5')}
                                    value={String(l.breadth ?? '')}
                                    onChange={(e) =>
                                      setLines((prev) => {
                                        const next = prev.slice();
                                        const nextBreadth = e.target.value;
                                        const length = String(next[idx]?.length ?? '');
                                        const pcs = String(next[idx]?.pcs ?? '1') || '1';
                                        const qty = computeAreaQty(Number(length), Number(nextBreadth), Number(pcs));
                                        next[idx] = {
                                          ...next[idx]!,
                                          breadth: nextBreadth,
                                          quantity: Number.isFinite(qty) && qty > 0 ? String(qty) : '',
                                        };
                                        return next;
                                      })
                                    }
                                    type="text"
                                    inputMode="decimal"
                                    placeholder={dimUnit ? `B (${dimUnit})` : 'Breadth'}
                                  />
                                ) : (
                                  <div className="text-xs text-on-surface-variant opacity-70">-</div>
                                )}
                              </td>
                              <td className="px-3 py-2 border border-outline-variant" onClick={(e) => e.stopPropagation()}>
                                {isAreaUnit ? (
                                  <input
                                    className={cn(inputClass, 'py-1.5')}
                                    value={String(l.pcs ?? '1')}
                                    onChange={(e) =>
                                      setLines((prev) => {
                                        const next = prev.slice();
                                        const nextPcs = e.target.value;
                                        const length = String(next[idx]?.length ?? '');
                                        const breadth = String(next[idx]?.breadth ?? '');
                                        const qty = computeAreaQty(Number(length), Number(breadth), Number(nextPcs || 1));
                                        next[idx] = {
                                          ...next[idx]!,
                                          pcs: nextPcs,
                                          quantity: Number.isFinite(qty) && qty > 0 ? String(qty) : '',
                                        };
                                        return next;
                                      })
                                    }
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="PCs"
                                  />
                                ) : (
                                  <div className="text-xs text-on-surface-variant opacity-70">-</div>
                                )}
                              </td>
                              <td className="px-3 py-2 border border-outline-variant" onClick={(e) => e.stopPropagation()}>
                                <input
                                  className={cn(inputClass, 'py-1.5')}
                                  value={l.quantity}
                                  disabled={isAreaUnit}
                                  onChange={(e) =>
                                    setLines((prev) => {
                                      if (isAreaUnit) return prev;
                                      const next = prev.slice();
                                      next[idx] = { ...next[idx]!, quantity: sanitizeDecimalInput(e.target.value) };
                                      return next;
                                    })
                                  }
                                  type="text"
                                  inputMode="decimal"
                                />
                              </td>
                              <td className="px-3 py-2 border border-outline-variant" onClick={(e) => e.stopPropagation()}>
                                <input
                                  className={cn(inputClass, 'py-1.5')}
                                  value={l.rate}
                                  onChange={(e) =>
                                    setLines((prev) => {
                                      const next = prev.slice();
                                      next[idx] = { ...next[idx]!, rate: sanitizeDecimalInput(e.target.value) };
                                      return next;
                                    })
                                  }
                                  type="text"
                                  inputMode="decimal"
                                />
                              </td>
                              <td className="px-3 py-2 border border-outline-variant" onClick={(e) => e.stopPropagation()}>
                                <input
                                  className={cn(inputClass, 'py-1.5')}
                                  value={l.discountPercent}
                                  onChange={(e) =>
                                    setLines((prev) => {
                                      const next = prev.slice();
                                      next[idx] = { ...next[idx]!, discountPercent: sanitizePercentInput(e.target.value) };
                                      return next;
                                    })
                                  }
                                  onBlur={() =>
                                    setLines((prev) => {
                                      const next = prev.slice();
                                      next[idx] = { ...next[idx]!, discountPercent: clampPercentString(next[idx]!.discountPercent) };
                                      return next;
                                    })
                                  }
                                  type="text"
                                  inputMode="decimal"
                                />
                              </td>
                              <td className="px-3 py-2 border border-outline-variant" onClick={(e) => e.stopPropagation()}>
                                <select
                                  className={cn(inputClass, 'py-1.5')}
                                  value={String(l.taxPercent ?? '')}
                                  onChange={(e) =>
                                    setLines((prev) => {
                                      const next = prev.slice();
                                      next[idx] = { ...next[idx]!, taxPercent: clampPercentString(e.target.value) };
                                      return next;
                                    })
                                  }
                                >
                                  {gstPercentOptions.map((v) => (
                                    <option key={v} value={v}>
                                      {v}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2 text-xs text-on-surface-variant border border-outline-variant">{l.lastSupplierName || '-'}</td>
                              <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(l.lastRate ?? 0) || '-'}</td>
                              <td className="px-3 py-2 border border-outline-variant" onClick={(e) => e.stopPropagation()}>
                                <SearchableSelect
                                  value={l.supplierId}
                                  options={supplierOptions}
                                  allowClear
                                  disabled={masters.loading}
                                  placeholder=""
                                  onChange={(nextId) => {
                                    const safeId = String(nextId ?? '').trim();
                                    setLines((prev) => {
                                      const next = prev.slice();
                                      if (!safeId) {
                                        next[idx] = { ...next[idx]!, supplierId: '', paymentTerms: '' };
                                        return next;
                                      }
                                      const suggested = String(supplierRows.find((s) => s.id === safeId)?.paymentTerms ?? '').trim();
                                      const currentTerms = String(next[idx]?.paymentTerms ?? '').trim();
                                      next[idx] = { ...next[idx]!, supplierId: safeId, paymentTerms: currentTerms || suggested };
                                      return next;
                                    });
                                  }}
                                  showCreateWhenEmpty
                                  alwaysShowCreate
                                  allowEmptyCreate
                                  closeOnCreate
                                  createLabel={(q) => (q ? `+ Add Supplier "${q}"` : '+ Add Supplier')}
                                  onCreate={async (label) => {
                                    setSupplierCreateLineIndex(idx);
                                    setNewSupplierName(String(label ?? '').trim());
                                    setSupplierCreateOpen(true);
                                    return null;
                                  }}
                                />
                              </td>
                              <td className="px-3 py-2 border border-outline-variant" onClick={(e) => e.stopPropagation()}>
                                <input
                                  className={cn(inputClass, 'py-1.5')}
                                  value={l.paymentTerms}
                                  onChange={(e) =>
                                    setLines((prev) => {
                                      const next = prev.slice();
                                      next[idx] = { ...next[idx]!, paymentTerms: e.target.value };
                                      return next;
                                    })
                                  }
                                />
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })
			                ) : (
			                  <tr>
					                    <td className="px-3 py-5 text-sm text-on-surface-variant border border-outline-variant" colSpan={modalKind === 'rfq' ? 4 : 13}>
				                      No remaining items to order.
				                    </td>
			                  </tr>
			                )}
	              </tbody>
            </table>
          </div>
          </div>
        )}
	      </Modal>
	      {supplierCreateOpen ? (
	        <SupplierCreateModal
            initialName={newSupplierName}
            onClose={() => setSupplierCreateOpen(false)}
            onCreated={async (supplier) => {
              const fresh = await fetchSuppliers();
              setSupplierRows(fresh);
              if (supplierCreateLineIndex != null) {
                setLines((prev) => {
                  const next = prev.slice();
                  const currentTerms = String(next[supplierCreateLineIndex]?.paymentTerms ?? '').trim();
                  next[supplierCreateLineIndex] = {
                    ...next[supplierCreateLineIndex]!,
                    supplierId: supplier.id,
                    paymentTerms: currentTerms || String(supplier.paymentTerms ?? '').trim(),
                  };
                  return next;
                });
              }
              setSupplierCreateOpen(false);
            }}
          />
	      ) : null}
	    </div>
	  );
}
