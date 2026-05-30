import React, { useEffect, useMemo, useState } from 'react';
import { uploadFileToServer } from '@/src/lib/uploads';
import { createInvoice, fetchPendingInvoiceItems, fetchWorkflow } from '@/src/lib/purchaseRequests';
import { fetchQueueEnterInvoice, type EnterInvoiceQueueRow, type QueueFilters } from '@/src/lib/queues';
import { formatItemInline } from '@/src/lib/itemLabel';
import { formatPoNumber, formatPrNumber } from '@/src/lib/docNumbers';
import { clampPercentString, sanitizeDecimalInput, sanitizePercentInput } from '@/src/lib/numberInput';

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(' ');
}
import { fetchSpecifications, type Specification } from '@/src/lib/masters';
import { ExportCsvButton, inputClass, labelClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';
import Pagination from '@/src/components/common/Pagination';
import GstRateSelect from '@/src/components/common/GstRateSelect';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

type PendingItem = { itemId: string; item: string; unit?: string | null; pendingQty: number; rate: number };
type InvoiceLine = {
  itemId: string;
  item: string;
  specificationsJson?: string;
  pendingQty: number;
  poQty: number;
  poRate: number;
  discountPercent: number;
  unit?: string | null;
  poDimUnit?: 'ft' | 'm' | string | null;
  poDimLength?: string;
  poDimBreadth?: string;
  poDimPcs?: string;
  inputUnit?: 'ft' | 'm';
  length?: string;
  breadth?: string;
  pcs?: string;
  isAreaUnit?: boolean;
  invoiceQty: string;
  invRate: string;
  gstPercent: string;
};

export default function EnterInvoiceQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
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

  function convertAreaQty(qty: number, fromDimUnit: string, toDimUnit: string) {
    const q = Number(qty);
    const fromU = String(fromDimUnit ?? '').trim().toLowerCase();
    const toU = String(toDimUnit ?? '').trim().toLowerCase();
    if (!Number.isFinite(q)) return NaN;
    if (!fromU || !toU || fromU === toU) return q;
    const M2_TO_FT2 = 10.7639104167;
    if (fromU === 'm' && toU === 'ft') return q * M2_TO_FT2;
    if (fromU === 'ft' && toU === 'm') return q / M2_TO_FT2;
    return NaN;
  }

  const masters = useQueueMasters({ includeSuppliers: true, includeUsers: true, includeTransporters: true });
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', projectId: '', supplierId: '', from: '', to: '' });
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [rows, setRows] = useState<EnterInvoiceQueueRow[]>([]);
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
    fetchSpecifications(ac.signal).then(setSpecs).catch(() => setSpecs([]));
    return () => ac.abort();
  }, []);

  const specNameById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchQueueEnterInvoice(filters, ac.signal)
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
  const [active, setActive] = useState<EnterInvoiceQueueRow | null>(null);

  const supplierHasGst = useMemo(() => {
    const supplierId = String((active as any)?.supplierId ?? '').trim();
    if (!supplierId) return true;
    const s = masters.suppliers.find((x) => x.id === supplierId);
    if (!s) return true;
    const hasGstInMaster = Boolean(String(s.gstNumber ?? '').trim());
    const isCreditVoucherApplicable = Boolean(s.creditVoucherApplicable);

    // If no Credit Voucher tick AND GST column is blank, hide GST related fields
    if (!isCreditVoucherApplicable && !hasGstInMaster) return false;

    return hasGstInMaster;
  }, [active, masters.suppliers]);
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIsoDate());
  const [courierCharge, setCourierCharge] = useState('');
  const [packingCharge, setPackingCharge] = useState('');
  const [labourCharge, setLabourCharge] = useState('');
  const [otherCharge, setOtherCharge] = useState('');
  const [chargesGstAmount, setChargesGstAmount] = useState('');
  const [updatedBy, setUpdatedBy] = useState('');
  const [transporterId, setTransporterId] = useState('');
  const [cnOrCourierNo, setCnOrCourierNo] = useState('');
  const [ewayBillNumber, setEwayBillNumber] = useState('');
  const [invPdfFile, setInvPdfFile] = useState<File | null>(null);
  const [cnCopyFile, setCnCopyFile] = useState<File | null>(null);
  const [ewayBillFile, setEwayBillFile] = useState<File | null>(null);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [expandedPoId, setExpandedPoId] = useState('');
  const [expandedItemsByPoId, setExpandedItemsByPoId] = useState<Record<string, PendingItem[]>>({});
  const [expandedLoadingPoId, setExpandedLoadingPoId] = useState('');
  const [expandedErrorByPoId, setExpandedErrorByPoId] = useState<Record<string, string>>({});

  function closeModal() {
    setModalOpen(false);
    setActive(null);
		    setSupplierInvoiceNo('');
		    setInvoiceDate(todayIsoDate());
		    setCourierCharge('');
		    setPackingCharge('');
		    setLabourCharge('');
		    setOtherCharge('');
		    setChargesGstAmount('');
		    setUpdatedBy('');
		    setTransporterId('');
	    setCnOrCourierNo('');
	    setEwayBillNumber('');
	    setInvPdfFile(null);
		    setCnCopyFile(null);
		    setEwayBillFile(null);
		    setLines([]);
      setSelectedItemId(null);
	    setModalLoading(false);
	    setSaving(false);
	    setModalError(null);
	    setAttemptedSubmit(false);
  }

  useEffect(() => {
    if (!modalOpen || !active) return;
    const ac = new AbortController();
	    setModalError(null);
	    setModalLoading(true);
      setSelectedItemId(null);
	    Promise.all([fetchPendingInvoiceItems(active.poId, ac.signal), fetchWorkflow(active.prId, ac.signal, active.poId)])
	      .then(([pendingItems, wf]) => {
	        if (ac.signal.aborted) return;
	        const pendingByItemId = new Map<string, PendingItem>();
	        for (const it of pendingItems ?? []) pendingByItemId.set(String(it.itemId), it as PendingItem);

        const poItems = wf.po?.items ?? [];
        const nextLines = poItems
          .map((poi) => {
            const itemId = String((poi as any).itemId ?? '');
            if (!itemId) return null;
            const pending = pendingByItemId.get(itemId);
            const pendingQty = Number(pending?.pendingQty ?? 0);
            if (!Number.isFinite(pendingQty) || pendingQty <= 0) return null;
            const unit = (poi as any).unit != null ? String((poi as any).unit) : null;
            const poDimUnit = String((poi as any).dimUnit ?? '').trim() || baseDimUnitForAreaUnit(normalizeAreaUnitName(unit || ''));
            const isAreaUnit = poDimUnit === 'ft' || poDimUnit === 'm';
            const length = String((poi as any).dimLength ?? (poi as any).dim_length ?? '').trim();
            const breadth = String((poi as any).dimBreadth ?? (poi as any).dim_breadth ?? '').trim();
            const pcs = String((poi as any).dimPcs ?? (poi as any).dim_pcs ?? '1').trim() || '1';
            const inputUnit = (poDimUnit === 'm' ? 'm' : 'ft') as 'ft' | 'm';
            const qtyPoUnit = isAreaUnit ? convertAreaQty(computeAreaQty(Number(length), Number(breadth), Number(pcs)), inputUnit, poDimUnit) : pendingQty;
	            return {
	              itemId,
	              item: String((poi as any).item ?? pending?.item ?? ''),
	              specificationsJson: (poi as any).specificationsJson != null ? String((poi as any).specificationsJson) : undefined,
	              pendingQty,
	              poQty: Number((poi as any).quantity ?? 0),
	              poRate: Number((poi as any).rate ?? 0),
	              discountPercent: Number((poi as any).discountPercent ?? 0),
                unit,
                poDimUnit: poDimUnit || null,
                poDimLength: length,
                poDimBreadth: breadth,
                poDimPcs: pcs,
                inputUnit,
                length: isAreaUnit ? length : '',
                breadth: isAreaUnit ? breadth : '',
                pcs: isAreaUnit ? pcs : '',
                isAreaUnit,
	              invoiceQty: isAreaUnit ? (Number.isFinite(qtyPoUnit) && qtyPoUnit > 0 ? String(qtyPoUnit) : '') : String(pendingQty),
              invRate: String((poi as any).rate ?? pending?.rate ?? 0),
	              gstPercent: (() => {
	                const pct = Number((poi as any).taxPercent ?? 0);
	                return Number.isFinite(pct) && pct !== 0 ? String(pct) : '';
	              })(),
	            } satisfies InvoiceLine;
          })
          .filter(Boolean) as InvoiceLine[];

        setLines(nextLines);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setModalError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setModalLoading(false));
    return () => ac.abort();
  }, [active, modalOpen]);

  const computedGoodsAmount = useMemo(() => {
    let sum = 0;
    for (const l of lines) {
      const q = String(l.invoiceQty ?? '').trim() ? Number(l.invoiceQty) : 0;
      const r = String(l.invRate ?? '').trim() ? Number(l.invRate) : 0;
      if (Number.isFinite(q) && Number.isFinite(r)) sum += q * r;
    }
    return sum;
  }, [lines]);

  const computedTaxAmount = useMemo(() => {
    if (!supplierHasGst) return 0;
    let sum = 0;
    for (const l of lines) {
      const q = String(l.invoiceQty ?? '').trim() ? Number(l.invoiceQty) : 0;
      const r = String(l.invRate ?? '').trim() ? Number(l.invRate) : 0;
      const gst = String(l.gstPercent ?? '').trim() ? Number(l.gstPercent) : 0;
      if (Number.isFinite(q) && Number.isFinite(r) && Number.isFinite(gst) && gst > 0) sum += (q * r * gst) / 100;
    }
    return sum;
  }, [lines, supplierHasGst]);
  const computedTotalAmount = useMemo(() => {
    const c = String(courierCharge ?? '').trim() ? Number(courierCharge) : 0;
    const p = String(packingCharge ?? '').trim() ? Number(packingCharge) : 0;
    const l = String(labourCharge ?? '').trim() ? Number(labourCharge) : 0;
    const o = String(otherCharge ?? '').trim() ? Number(otherCharge) : 0;
    const cg = supplierHasGst && String(chargesGstAmount ?? '').trim() ? Number(chargesGstAmount) : 0;
    const extra = (Number.isFinite(c) ? c : 0) + (Number.isFinite(p) ? p : 0) + (Number.isFinite(l) ? l : 0) + (Number.isFinite(o) ? o : 0);
    const extraTax = Number.isFinite(cg) ? cg : 0;
    return computedGoodsAmount + computedTaxAmount + extra + extraTax;
  }, [computedGoodsAmount, computedTaxAmount, courierCharge, packingCharge, labourCharge, otherCharge, chargesGstAmount, supplierHasGst]);

  const computedInvoiceTotal = useMemo(() => computedGoodsAmount + computedTaxAmount, [computedGoodsAmount, computedTaxAmount]);

  const transporterName = useMemo(() => {
    if (!transporterId) return '';
    return (masters.transporters ?? []).find((t) => t.id === transporterId)?.name ?? '';
  }, [masters.transporters, transporterId]);

  const validation = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!supplierInvoiceNo.trim()) errors.supplierInvoiceNo = 'Supplier Invoice No is required.';
    if (!String(invoiceDate ?? '').trim()) errors.invoiceDate = 'Invoice Date is required.';
    if (!updatedBy.trim()) errors.updatedBy = 'Updated By is required.';

    const items = lines
      .map((ln) => {
        const quantity = String(ln.invoiceQty ?? '').trim() ? Number(ln.invoiceQty) : 0;
        const rate = String(ln.invRate ?? '').trim() ? Number(ln.invRate) : 0;
        const taxPercent = String(ln.gstPercent ?? '').trim() ? Number(ln.gstPercent) : 0;
        const length = String(ln.length ?? '').trim() ? Number(ln.length) : NaN;
        const breadth = String(ln.breadth ?? '').trim() ? Number(ln.breadth) : NaN;
        const pcs = String(ln.pcs ?? '').trim() ? Number(ln.pcs) : 1;
        return {
          itemId: ln.itemId,
          item: ln.item,
          quantity,
          rate,
          taxPercent,
          pendingQty: ln.pendingQty,
          ...(ln.isAreaUnit ? { length, breadth, pcs, inputUnit: ln.inputUnit ?? 'ft' } : {}),
        };
      })
      .filter((x) => Number.isFinite(x.quantity) && x.quantity > 0);

    if (!items.length) errors.items = 'Enter at least one Invoice Qty.';

    for (const it of items) {
      if ('length' in it || 'breadth' in it || 'pcs' in it) {
        const q = computeAreaQty(Number((it as any).length), Number((it as any).breadth), Number((it as any).pcs ?? 1));
        if (!Number.isFinite(q) || q <= 0) {
          errors.items = 'Enter valid Length, Breadth and PCs for area-unit invoice items.';
          break;
        }
      }
      if (it.quantity > it.pendingQty + 1e-9) {
        errors.items = 'Invoice qty cannot exceed pending qty.';
        break;
      }
      if (!Number.isFinite(it.rate) || it.rate < 0) {
        errors.items = 'Invalid invoice rate.';
        break;
      }
      if (supplierHasGst && (!Number.isFinite(it.taxPercent) || it.taxPercent < 0 || it.taxPercent > 100)) {
        errors.items = 'Invalid GST%.';
        break;
      }
    }

    const numericFields: Array<{ key: string; label: string; v: string }> = [
      { key: 'courierCharge', label: 'Courier Charge', v: courierCharge },
      { key: 'packingCharge', label: 'Packing Charge', v: packingCharge },
      { key: 'labourCharge', label: 'Labour Charge', v: labourCharge },
      { key: 'otherCharge', label: 'Other Charge', v: otherCharge },
      ...(supplierHasGst ? [{ key: 'chargesGstAmount', label: 'GST on Charges', v: chargesGstAmount }] : []),
    ];
    for (const f of numericFields) {
      const s = String(f.v ?? '').trim();
      if (!s) continue;
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) errors[f.key] = `${f.label} must be a valid non-negative number.`;
    }

    const firstError = Object.values(errors)[0];
    return { ok: Object.keys(errors).length === 0, errors, firstError, items };
  }, [chargesGstAmount, courierCharge, invoiceDate, labourCharge, lines, otherCharge, packingCharge, supplierHasGst, supplierInvoiceNo, updatedBy]);

  async function toggleExpandRow(row: EnterInvoiceQueueRow) {
    const poId = String(row.poId ?? '').trim();
    if (!poId) return;
    if (expandedPoId === poId) {
      setExpandedPoId('');
      setSelectedItemId(null);
      return;
    }
    setExpandedPoId(poId);
    setSelectedItemId(null);
    if (expandedItemsByPoId[poId] || expandedLoadingPoId === poId) return;
    setExpandedLoadingPoId(poId);
    setExpandedErrorByPoId((prev) => ({ ...prev, [poId]: '' }));
    try {
      const items = await fetchPendingInvoiceItems(poId);
      setExpandedItemsByPoId((prev) => ({ ...prev, [poId]: Array.isArray(items) ? items : [] }));
    } catch (e) {
      setExpandedErrorByPoId((prev) => ({ ...prev, [poId]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setExpandedLoadingPoId((prev) => (prev === poId ? '' : prev));
    }
  }

	  return (
	    <div className="space-y-6">
	      {masters.error ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load masters: {masters.error}</div> : null}
	      <div className="hidden">
	        <div className="text-sm text-on-surface-variant">Enter Invoice</div>
	        <ExportCsvButton id="pending-export-btn" filename={`queue-enter-invoice-${new Date().toISOString().slice(0, 10)}.csv`} rows={rows} disabled={loading} />
	      </div>
	      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} />

	      {loading ? (
        <LoadingCard label="Loading POs pending invoice..." />
      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
      ) : (
        <QueueCard title="Enter Invoice" subtitle={`${rows.length} pending`} hideHeader>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1140px] table-fixed text-left border-collapse border border-outline-variant">
              <colgroup>
                <col className="w-[150px]" />
                <col className="w-[140px]" />
                <col className="w-[190px]" />
                <col className="w-[240px]" />
                <col className="w-[120px]" />
                <col className="w-[260px]" />
              </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PR</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Firm</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Pending Qty</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.length ? (
                  pagedRows.map((r) => {
                    const poId = String(r.poId ?? '').trim();
                    const isExpanded = expandedPoId === poId;
                    const isExpandedLoading = expandedLoadingPoId === poId;
                    const expandedItems = expandedItemsByPoId[poId] ?? [];
                    const expandedError = expandedErrorByPoId[poId];
                    return (
                    <React.Fragment key={r.poId}>
                    <tr
                      onClick={() => {
                        toggleExpandRow(r);
                        setSelectedRowId(selectedRowId === r.poId ? null : r.poId);
                      }}
                      className={cn(
                        'cursor-pointer transition-colors',
                        isExpanded || selectedRowId === r.poId ? 'bg-primary/10' : 'hover:bg-surface-container-high/40'
                      )}
                    >
	                      <td className="px-3 py-2 text-sm text-primary font-semibold border border-outline-variant">{formatPoNumber(r.poNumber ?? r.poId) || '-'}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{formatPrNumber((r as any).prNumber ?? r.prId)}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.firmName}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.supplierName || '-'}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{r.pendingQty}</td>
                      <td className="px-3 py-2 border border-outline-variant" onClick={(e) => e.stopPropagation()}>
	                        <div className="flex items-center gap-2 flex-wrap">
	                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            onClick={() => {
                              setActive(r);
                              setModalOpen(true);
                            }}
                          >
                            Record Invoice
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-3 border border-outline-variant bg-surface-container-lowest">
                          {isExpandedLoading ? <div className="text-sm text-on-surface-variant">Loading PO item details...</div> : null}
                          {!isExpandedLoading && expandedError ? <div className="text-sm text-error">{expandedError}</div> : null}
                          {!isExpandedLoading && !expandedError ? (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[900px] table-fixed text-left border-collapse border border-outline-variant text-sm">
                                <thead>
                                  <tr className="bg-surface-container-high">
                                    <th className="px-3 py-2 border border-outline-variant">Item</th>
                                    <th className="px-3 py-2 border border-outline-variant w-[100px]">Pending Qty</th>
                                    <th className="px-3 py-2 border border-outline-variant w-[80px]">Unit</th>
                                    <th className="px-3 py-2 border border-outline-variant w-[100px]">PO Rate</th>
                                    <th className="px-3 py-2 border border-outline-variant w-[80px]">Disc %</th>
                                    <th className="px-3 py-2 border border-outline-variant w-[80px]">GST %</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {expandedItems.length ? (
                                    expandedItems
                                      .filter((it) => !selectedItemId || it.itemId === selectedItemId)
                                      .map((it) => (
                                        <tr
                                          key={it.itemId}
                                          className={cn('cursor-pointer hover:bg-surface-container-low transition-colors', selectedItemId === it.itemId && 'bg-primary/10')}
                                          onClick={() => setSelectedItemId(selectedItemId === it.itemId ? null : it.itemId)}
                                        >
                                          <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{it.item}</td>
                                          <td className="px-3 py-2 border border-outline-variant tabular-nums">
                                            {Number(it.pendingQty ?? 0)}
                                          </td>
                                          <td className="px-3 py-2 border border-outline-variant">{it.unit ?? '-'}</td>
                                          <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.rate ?? 0)}</td>
                                          <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.discountPercent ?? 0)}%</td>
                                          <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.taxPercent ?? 0)}%</td>
                                        </tr>
                                      ))
                                  ) : (
                                    <tr>
                                      <td className="px-3 py-3 border border-outline-variant text-on-surface-variant" colSpan={6}>
                                        No pending items.
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                    </React.Fragment>
                  )})
                ) : (
                  <tr>
                    <td className="px-3 py-5 text-sm text-on-surface-variant border border-outline-variant" colSpan={6}>
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
	        title={`Record Invoice for PO ${active?.poNumber ?? active?.poId ?? ''}`}
	        onClose={() => (saving ? null : closeModal())}
	        maxWidthClass="max-w-7xl"
	        fullScreen
	        footerClassName="justify-between flex-wrap gap-3"
	        footer={
	          <>
	            <div className="flex items-center gap-4 flex-wrap">
	              <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-4 py-2">
	                <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Invoice Total</div>
	                <div className="text-sm font-bold tabular-nums text-on-surface">{computedInvoiceTotal.toFixed(2)}</div>
	              </div>
	              <div className="rounded-lg border border-outline-variant/30 bg-primary-container/40 px-4 py-2">
	                <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Invoice Total Amount</div>
	                <div className="text-base font-extrabold tabular-nums text-on-surface">{computedTotalAmount.toFixed(2)}</div>
	              </div>
	            </div>
	            <div className="flex items-center gap-2">
	              <button type="button" className="btn btn-sm" disabled={saving} onClick={closeModal}>
	                Cancel
	              </button>
	              <button
	                type="button"
	                className="btn-primary btn-sm"
	                disabled={saving || modalLoading || !active || !validation.ok}
	                onClick={async () => {
	                  setAttemptedSubmit(true);
	                  if (!active) return;
	                  if (!validation.ok) {
	                    setModalError(validation.firstError ?? 'Please fix the errors above.');
	                    return;
	                  }

	                  const items = validation.items;
	                  const c = String(courierCharge ?? '').trim() ? Number(courierCharge) : 0;
	                  const p = String(packingCharge ?? '').trim() ? Number(packingCharge) : 0;
	                  const lb = String(labourCharge ?? '').trim() ? Number(labourCharge) : 0;
	                  const o = String(otherCharge ?? '').trim() ? Number(otherCharge) : 0;
	                  const cg = String(chargesGstAmount ?? '').trim() ? Number(chargesGstAmount) : 0;
	                  if (![c, p, lb, o, cg].every((x) => Number.isFinite(x) && x >= 0)) {
	                    setModalError('Charges must be valid numbers');
	                    return;
	                  }

	                  const invAmt = Number(computedTotalAmount.toFixed(2));
	                  if (!Number.isFinite(invAmt) || invAmt < 0) {
	                    setModalError('Invalid invoice amount');
	                    return;
	                  }

	                  setSaving(true);
	                  setModalError(null);
	                  try {
	                    const documentUrl = invPdfFile ? (await uploadFileToServer(invPdfFile)).url : undefined;
	                    const cnCopyUrl = cnCopyFile ? (await uploadFileToServer(cnCopyFile)).url : undefined;
	                    const ewayBillUrl = ewayBillFile ? (await uploadFileToServer(ewayBillFile)).url : undefined;
		                    await createInvoice(active.poId, {
		                      supplierInvoiceNo: supplierInvoiceNo.trim(),
		                      invoiceDate,
		                      invoiceAmount: invAmt,
	                      courierCharge: c,
	                      packingCharge: p,
	                      labourCharge: lb,
	                      otherCharge: o,
	                      chargesGstAmount: cg,
	                      transporterName: transporterName.trim() ? transporterName.trim() : undefined,
	                      cnNumber: cnOrCourierNo.trim() ? cnOrCourierNo.trim() : undefined,
	                      ewayBillNumber: ewayBillNumber.trim() ? ewayBillNumber.trim() : undefined,
		                      documentUrl,
		                      cnCopyUrl,
		                      ewayBillUrl,
	                      updatedBy: updatedBy.trim(),
	                      paymentMode: 'Credit',
	                      items: items.map((it) => ({
                          itemId: it.itemId,
                          item: it.item,
                          quantity: it.quantity,
                          rate: it.rate,
                          taxPercent: supplierHasGst ? it.taxPercent : 0,
                          ...(('length' in it || 'breadth' in it || 'pcs' in it)
                            ? { length: (it as any).length, breadth: (it as any).breadth, pcs: (it as any).pcs, inputUnit: (it as any).inputUnit }
                            : {}),
                        })),
	                    });
	                    await fetchQueueEnterInvoice(filters).then(setRows);
	                    closeModal();
	                  } catch (e) {
	                    setModalError(e instanceof Error ? e.message : String(e));
	                  } finally {
	                    setSaving(false);
	                  }
	                }}
	              >
	                {saving ? 'Saving...' : 'Record Invoice'}
	              </button>
	            </div>
	          </>
	        }
	      >
        {modalError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{modalError}</div> : null}

		        <div className="invoice-parent-grid">
		          <div className="invoice-parent-card">
		            <div className="invoice-parent-card-header">
		              <div className="text-[11px] font-bold uppercase tracking-widest text-white">PO &amp; Invoice Basic Details</div>
		            </div>
		            <div className="invoice-parent-card-body">
		              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
		                <label className="space-y-1">
		                  <div className={cn(labelClass, 'text-blue-800')}>PO Number</div>
		                  <input className={cn(inputClass, 'py-2')} value={active?.poNumber ?? active?.poId ?? ''} readOnly />
		                </label>
		                <label className="space-y-1">
		                  <div className={cn(labelClass, 'text-blue-800')}>
		                    Supplier Invoice No <span className="text-error">*</span>
		                  </div>
		                  <input className={cn(inputClass, 'py-2')} value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} placeholder="Enter supplier invoice no" />
		                  {attemptedSubmit && validation.errors.supplierInvoiceNo ? <div className="text-xs text-error">{validation.errors.supplierInvoiceNo}</div> : null}
		                </label>
		                <label className="space-y-1">
		                  <div className={cn(labelClass, 'text-blue-800')}>
		                    Invoice Date <span className="text-error">*</span>
		                  </div>
		                  <input className={cn(inputClass, 'py-2')} type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
		                  {attemptedSubmit && validation.errors.invoiceDate ? <div className="text-xs text-error">{validation.errors.invoiceDate}</div> : null}
		                </label>
			                <label className="space-y-1">
			                  <div className={cn(labelClass, 'text-blue-800')}>
			                    Updated By <span className="text-error">*</span>
		                  </div>
		                  <select className={cn(inputClass, 'py-2')} value={updatedBy} onChange={(e) => setUpdatedBy(e.target.value)}>
		                    <option value="">Select user</option>
		                    {(masters.users ?? []).map((u) => (
		                      <option key={u.id} value={u.name}>
		                        {u.name}
		                      </option>
		                    ))}
		                  </select>
			                  {attemptedSubmit && validation.errors.updatedBy ? <div className="text-xs text-error">{validation.errors.updatedBy}</div> : null}
			                </label>
			                <div className="rounded-lg border border-outline-variant/30 bg-primary-container/25 p-3">
			                  <div className="text-[11px] font-bold uppercase tracking-widest text-blue-800">Invoice Amount</div>
			                  <div className="text-lg font-extrabold tabular-nums text-on-surface">{computedTotalAmount.toFixed(2)}</div>
			                  <div className="mt-2 text-[11px] font-bold uppercase tracking-widest text-blue-800">Item Total</div>
			                  <div className="text-sm font-bold tabular-nums text-on-surface">{computedInvoiceTotal.toFixed(2)}</div>
			                </div>
		              </div>
		            </div>
		          </div>

		          <div className="invoice-parent-card">
		            <div className="invoice-parent-card-header">
		              <div className="text-[11px] font-bold uppercase tracking-widest text-white">Charges &amp; Adjustments</div>
		            </div>
		            <div className="invoice-parent-card-body">
		              <div className="grid grid-cols-1 gap-3">
		                <label className="space-y-1">
		                  <div className={cn(labelClass, 'text-blue-800')}>Courier Charge</div>
		                  <input className={cn(inputClass, 'py-2')} value={courierCharge} onChange={(e) => setCourierCharge(sanitizeDecimalInput(e.target.value))} type="text" inputMode="decimal" />
		                  {attemptedSubmit && validation.errors.courierCharge ? <div className="text-xs text-error">{validation.errors.courierCharge}</div> : null}
		                </label>
		                <label className="space-y-1">
		                  <div className={cn(labelClass, 'text-blue-800')}>Packing Charge</div>
		                  <input className={cn(inputClass, 'py-2')} value={packingCharge} onChange={(e) => setPackingCharge(sanitizeDecimalInput(e.target.value))} type="text" inputMode="decimal" />
		                  {attemptedSubmit && validation.errors.packingCharge ? <div className="text-xs text-error">{validation.errors.packingCharge}</div> : null}
		                </label>
		                <label className="space-y-1">
		                  <div className={cn(labelClass, 'text-blue-800')}>Labour Charge</div>
		                  <input className={cn(inputClass, 'py-2')} value={labourCharge} onChange={(e) => setLabourCharge(sanitizeDecimalInput(e.target.value))} type="text" inputMode="decimal" />
		                  {attemptedSubmit && validation.errors.labourCharge ? <div className="text-xs text-error">{validation.errors.labourCharge}</div> : null}
		                </label>
			                <label className="space-y-1">
			                  <div className={cn(labelClass, 'text-blue-800')}>Other Charge</div>
			                  <input className={cn(inputClass, 'py-2')} value={otherCharge} onChange={(e) => setOtherCharge(sanitizeDecimalInput(e.target.value))} type="text" inputMode="decimal" />
			                  {attemptedSubmit && validation.errors.otherCharge ? <div className="text-xs text-error">{validation.errors.otherCharge}</div> : null}
			                </label>
                      {supplierHasGst ? (
			                <label className="space-y-1">
			                  <div className={cn(labelClass, 'text-blue-800')}>GST on Charges</div>
			                  <input className={cn(inputClass, 'py-2')} value={chargesGstAmount} onChange={(e) => setChargesGstAmount(sanitizeDecimalInput(e.target.value))} type="text" inputMode="decimal" />
			                  {attemptedSubmit && validation.errors.chargesGstAmount ? <div className="text-xs text-error">{validation.errors.chargesGstAmount}</div> : null}
			                </label>
                      ) : null}
			              </div>
			            </div>
			          </div>

		          <div className="invoice-parent-card">
		            <div className="invoice-parent-card-header">
		              <div className="text-[11px] font-bold uppercase tracking-widest text-white">Logistics &amp; Compliance</div>
		            </div>
		            <div className="invoice-parent-card-body">
		              <div className="grid grid-cols-1 gap-3">
		                <label className="space-y-1">
		                  <div className={cn(labelClass, 'text-blue-800')}>Transporter</div>
		                  <select className={cn(inputClass, 'py-2')} value={transporterId} onChange={(e) => setTransporterId(e.target.value)}>
		                    <option value="">Select transporter</option>
		                    {(masters.transporters ?? []).map((t) => (
		                      <option key={t.id} value={t.id}>
		                        {t.name}
		                      </option>
		                    ))}
		                  </select>
		                </label>
		                {supplierHasGst && (
		                  <label className="space-y-1">
		                    <div className={cn(labelClass, 'text-blue-800')}>E-way Bill No</div>
		                    <input className={cn(inputClass, 'py-2')} value={ewayBillNumber} onChange={(e) => setEwayBillNumber(e.target.value)} placeholder="Optional" />
		                  </label>
		                )}
		                <label className="space-y-1">
		                  <div className={cn(labelClass, 'text-blue-800')}>CN/Courier No</div>
		                  <input className={cn(inputClass, 'py-2')} value={cnOrCourierNo} onChange={(e) => setCnOrCourierNo(e.target.value)} placeholder="Optional" />
		                </label>
		                {transporterName ? (
		                  <div className="text-xs text-on-surface-variant">
		                    Selected transporter: <span className="font-semibold text-on-surface">{transporterName}</span>
		                  </div>
		                ) : null}
		              </div>
		            </div>
		          </div>

		          <div className="invoice-parent-card">
		            <div className="invoice-parent-card-header">
		              <div className="text-[11px] font-bold uppercase tracking-widest text-white">Attachments &amp; References</div>
		            </div>
		            <div className="invoice-parent-card-body">
		              <div className="grid grid-cols-1 gap-3">
		                <label className="space-y-1">
		                  <div className={cn(labelClass, 'text-blue-800')}>Invoice PDF</div>
		                  <div className="flex items-center gap-2 min-w-0">
		                    <label className="btn btn-sm cursor-pointer select-none whitespace-nowrap" htmlFor="invPdfInput">
		                      Choose File
		                    </label>
		                    <input
		                      id="invPdfInput"
		                      className="hidden"
		                      type="file"
		                      accept=".pdf,application/pdf"
		                      onChange={(e) => setInvPdfFile(e.target.files?.[0] ?? null)}
		                    />
		                    <div className="text-xs text-on-surface-variant truncate min-w-0">{invPdfFile ? invPdfFile.name : 'No file chosen'}</div>
		                  </div>
		                  <div className={cn('text-xs', invPdfFile ? 'text-on-surface' : 'text-on-surface-variant')}>{invPdfFile ? 'Uploaded' : 'Not uploaded'}</div>
		                </label>
		                <label className="space-y-1">
		                  <div className={cn(labelClass, 'text-blue-800')}>CN/Courier Copy</div>
		                  <div className="flex items-center gap-2 min-w-0">
		                    <label className="btn btn-sm cursor-pointer select-none whitespace-nowrap" htmlFor="cnCopyInput">
		                      Choose File
		                    </label>
		                    <input
		                      id="cnCopyInput"
		                      className="hidden"
		                      type="file"
		                      accept=".pdf,application/pdf,image/*"
		                      onChange={(e) => setCnCopyFile(e.target.files?.[0] ?? null)}
		                    />
		                    <div className="text-xs text-on-surface-variant truncate min-w-0">{cnCopyFile ? cnCopyFile.name : 'No file chosen'}</div>
		                  </div>
		                  <div className={cn('text-xs', cnCopyFile ? 'text-on-surface' : 'text-on-surface-variant')}>{cnCopyFile ? 'Uploaded' : 'Not uploaded'}</div>
		                </label>
		                {supplierHasGst && (
		                  <label className="space-y-1">
		                    <div className={cn(labelClass, 'text-blue-800')}>E-way Bill Document</div>
		                    <div className="flex items-center gap-2 min-w-0">
		                      <label className="btn btn-sm cursor-pointer select-none whitespace-nowrap" htmlFor="ewayBillInput">
		                        Choose File
		                      </label>
		                      <input
		                        id="ewayBillInput"
		                        className="hidden"
		                        type="file"
		                        accept=".pdf,application/pdf,image/*"
		                        onChange={(e) => setEwayBillFile(e.target.files?.[0] ?? null)}
		                      />
		                      <div className="text-xs text-on-surface-variant truncate min-w-0">{ewayBillFile ? ewayBillFile.name : 'No file chosen'}</div>
		                    </div>
		                    <div className={cn('text-xs', ewayBillFile ? 'text-on-surface' : 'text-on-surface-variant')}>{ewayBillFile ? 'Uploaded' : 'Not uploaded'}</div>
		                  </label>
		                )}
		              </div>
		            </div>
		          </div>
		        </div>

	        {attemptedSubmit && validation.errors.items ? (
	          <div className="rounded-xl border border-error/30 bg-error-container/30 px-4 py-3 text-sm text-on-surface">{validation.errors.items}</div>
	        ) : null}

        <div className="rounded-xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1900px] table-fixed text-left border-collapse border border-black text-xs [&_th]:border-black [&_td]:border-black">
	              <colgroup>
	                <col className="w-[120px]" />
	                <col className="w-[160px]" />
	                <col className="w-[300px]" />
	                <col className="w-[80px]" />
	                <col className="w-[100px]" />
	                <col className="w-[100px]" />
	                <col className="w-[80px]" />
	                <col className="w-[110px]" />
                  <col className="w-[70px]" />
                  <col className="w-[100px]" />
                  <col className="w-[100px]" />
                  <col className="w-[80px]" />
                  <col className="w-[120px]" />
                  <col className="w-[100px]" />
                  {supplierHasGst ? (
                    <>
                      <col className="w-[100px]" />
                      <col className="w-[120px]" />
                    </>
                  ) : null}
	                <col className="w-[130px]" />
	              </colgroup>
              <thead>
                <tr className="bg-primary text-on-primary">
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black">PO No</th>
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black">Supplier</th>
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black">Item</th>
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black text-center">PO Unit</th>
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black text-center">PO L</th>
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black text-center">PO B</th>
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black text-center">PO PCs</th>
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black text-right">PO Qty</th>
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black text-center bg-orange-600 text-white">Inv Unit</th>
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black text-center bg-orange-600 text-white">Inv L</th>
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black text-center bg-orange-600 text-white">Inv B</th>
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black text-center bg-orange-600 text-white">Inv PCs</th>
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black text-center bg-orange-600 text-white">Invoice Qty</th>
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black text-center bg-orange-600 text-white">Inv Rate</th>
                    {supplierHasGst ? (
                      <>
                        <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black text-center bg-orange-600 text-white">GST %</th>
                        <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black text-center bg-orange-600 text-white">GST Amount</th>
                      </>
                    ) : null}
                  <th className="px-2 py-2 font-bold uppercase tracking-widest border border-black text-center bg-orange-600 text-white">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const filteredLines = lines.filter((ln) => !selectedItemId || ln.itemId === selectedItemId);
                  if (!filteredLines.length) {
                    return (
                      <tr>
                        <td className="px-3 py-5 text-sm text-on-surface-variant border border-black" colSpan={supplierHasGst ? 17 : 15}>
                          No pending items.
                        </td>
                      </tr>
                    );
                  }

                  return filteredLines.map((ln, idx) => {
                      const rowSpan = filteredLines.length;
                      const lineBaseAmount = Number(ln.invoiceQty || 0) * Number(ln.invRate || 0);
                      const lineGstAmount = lineBaseAmount * (Number(ln.gstPercent || 0) / 100);
                      const lineTotalAmount = lineBaseAmount + lineGstAmount;

                      return (
                        <tr
                          key={ln.itemId}
                          className={cn('cursor-pointer hover:bg-surface-container-low transition-colors', selectedItemId === ln.itemId && 'bg-primary/10')}
                          onClick={() => setSelectedItemId(selectedItemId === ln.itemId ? null : ln.itemId)}
                        >
                          {idx === 0 ? (
                            <>
                              <td rowSpan={rowSpan} className="px-2 py-2 font-semibold text-on-surface border border-black align-top break-words">
                                {formatPoNumber(active?.poNumber ?? active?.poId) || '-'}
                              </td>
                              <td rowSpan={rowSpan} className="px-2 py-2 text-on-surface border border-black align-top break-words">
                                {active?.supplierName || '-'}
                              </td>
                            </>
                          ) : null}
                          <td className="px-2 py-2 border border-black font-medium">{formatItemInline(ln.item, ln.specificationsJson, specNameById)}</td>
                          <td className="px-2 py-2 border border-black text-center">{ln.unit || '-'}</td>
                          <td className="px-2 py-2 border border-black text-center">{ln.poDimLength || '-'}</td>
                          <td className="px-2 py-2 border border-black text-center">{ln.poDimBreadth || '-'}</td>
                          <td className="px-2 py-2 border border-black text-center">{ln.poDimPcs || '-'}</td>
                          <td className="px-2 py-2 border border-black tabular-nums text-right font-semibold">{ln.poQty}</td>

                          {/* INVOICE INPUTS */}
                          <td className="px-1 py-2 border border-black align-middle text-center" onClick={(e) => e.stopPropagation()}>
                            {ln.isAreaUnit ? (
                                <select
                                  className={cn(inputClass, 'py-1 px-1 h-8 text-[11px]')}
                                  value={ln.inputUnit ?? 'ft'}
                                  onChange={(e) => {
                                    const v = e.target.value === 'm' ? 'm' : 'ft';
                                    setLines((prev) => {
                                      const next = prev.slice();
                                      const lineIdx = next.findIndex(x => x.itemId === ln.itemId);
                                      if (lineIdx === -1) return prev;
                                      const poDimUnit = String(next[lineIdx]?.poDimUnit ?? '').trim();
                                      const length = String(next[lineIdx]?.length ?? '');
                                      const breadth = String(next[lineIdx]?.breadth ?? '');
                                      const pcs = String(next[lineIdx]?.pcs ?? '1') || '1';
                                      const qty = convertAreaQty(computeAreaQty(Number(length), Number(breadth), Number(pcs)), v, poDimUnit);
                                      next[lineIdx] = { ...next[lineIdx]!, inputUnit: v as any, invoiceQty: Number.isFinite(qty) && qty > 0 ? String(qty) : '' };
                                      return next;
                                    });
                                  }}
                                >
                                  <option value="ft">ft</option>
                                  <option value="m">m</option>
                                </select>
                            ) : '-'}
                          </td>
                          <td className="px-1 py-2 border border-black align-middle" onClick={(e) => e.stopPropagation()}>
                            {ln.isAreaUnit ? (
                                <input
                                  className={cn(inputClass, 'py-1.5 h-8 text-[11px]')}
                                  value={ln.length ?? ''}
                                  onChange={(e) =>
                                    setLines((prev) => {
                                      const next = prev.slice();
                                      const lineIdx = next.findIndex(x => x.itemId === ln.itemId);
                                      if (lineIdx === -1) return prev;
                                      const length = e.target.value;
                                      const breadth = String(next[lineIdx]?.breadth ?? '');
                                      const pcs = String(next[lineIdx]?.pcs ?? '1') || '1';
                                      const inU = String(next[lineIdx]?.inputUnit ?? 'ft');
                                      const poU = String(next[lineIdx]?.poDimUnit ?? '');
                                      const qty = convertAreaQty(computeAreaQty(Number(length), Number(breadth), Number(pcs)), inU, poU);
                                      next[lineIdx] = { ...next[lineIdx]!, length, invoiceQty: Number.isFinite(qty) && qty > 0 ? String(qty) : '' };
                                      return next;
                                    })
                                  }
                                  inputMode="decimal"
                                  placeholder="L"
                                />
                            ) : '-'}
                          </td>
                          <td className="px-1 py-2 border border-black align-middle" onClick={(e) => e.stopPropagation()}>
                            {ln.isAreaUnit ? (
                                <input
                                  className={cn(inputClass, 'py-1.5 h-8 text-[11px]')}
                                  value={ln.breadth ?? ''}
                                  onChange={(e) =>
                                    setLines((prev) => {
                                      const next = prev.slice();
                                      const lineIdx = next.findIndex(x => x.itemId === ln.itemId);
                                      if (lineIdx === -1) return prev;
                                      const breadth = e.target.value;
                                      const length = String(next[lineIdx]?.length ?? '');
                                      const pcs = String(next[lineIdx]?.pcs ?? '1') || '1';
                                      const inU = String(next[lineIdx]?.inputUnit ?? 'ft');
                                      const poU = String(next[lineIdx]?.poDimUnit ?? '');
                                      const qty = convertAreaQty(computeAreaQty(Number(length), Number(breadth), Number(pcs)), inU, poU);
                                      next[lineIdx] = { ...next[lineIdx]!, breadth, invoiceQty: Number.isFinite(qty) && qty > 0 ? String(qty) : '' };
                                      return next;
                                    })
                                  }
                                  inputMode="decimal"
                                  placeholder="B"
                                />
                            ) : '-'}
                          </td>
                          <td className="px-1 py-2 border border-black align-middle" onClick={(e) => e.stopPropagation()}>
                            {ln.isAreaUnit ? (
                                <input
                                  className={cn(inputClass, 'py-1.5 h-8 text-[11px]')}
                                  value={ln.pcs ?? '1'}
                                  onChange={(e) =>
                                    setLines((prev) => {
                                      const next = prev.slice();
                                      const lineIdx = next.findIndex(x => x.itemId === ln.itemId);
                                      if (lineIdx === -1) return prev;
                                      const pcs = e.target.value;
                                      const length = String(next[lineIdx]?.length ?? '');
                                      const breadth = String(next[lineIdx]?.breadth ?? '');
                                      const inU = String(next[lineIdx]?.inputUnit ?? 'ft');
                                      const poU = String(next[lineIdx]?.poDimUnit ?? '');
                                      const qty = convertAreaQty(computeAreaQty(Number(length), Number(breadth), Number(pcs || 1)), inU, poU);
                                      next[lineIdx] = { ...next[lineIdx]!, pcs, invoiceQty: Number.isFinite(qty) && qty > 0 ? String(qty) : '' };
                                      return next;
                                    })
                                  }
                                  inputMode="numeric"
                                  placeholder="PCs"
                                />
                            ) : '-'}
                          </td>
                          <td className="px-1 py-2 border border-black align-middle" onClick={(e) => e.stopPropagation()}>
                            <div className="relative">
                                <input
                                  className={cn(inputClass, 'py-1.5 pl-2 pr-12 h-8 text-[11px] text-right bg-surface-container-low font-bold')}
                                  value={ln.invoiceQty}
                                  readOnly={ln.isAreaUnit}
                                  onChange={(e) =>
                                    setLines((prev) => {
                                      const next = prev.slice();
                                      const lineIdx = next.findIndex(x => x.itemId === ln.itemId);
                                      if (lineIdx === -1) return prev;
                                      next[lineIdx] = { ...next[lineIdx]!, invoiceQty: sanitizeDecimalInput(e.target.value) };
                                      return next;
                                    })
                                  }
                                  type="text"
                                  inputMode="decimal"
                                />
                                {ln.unit && (
                                  <div className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-on-surface-variant/60 font-bold pointer-events-none uppercase">
                                    {ln.unit}
                                  </div>
                                )}
                            </div>
                          </td>
                          <td className="px-1 py-2 border border-black align-middle" onClick={(e) => e.stopPropagation()}>
                            <input
                              className={cn(inputClass, 'py-1.5 h-8 text-[11px] text-right')}
                              value={ln.invRate}
                              onChange={(e) =>
                                setLines((prev) => {
                                  const next = prev.slice();
                                  const lineIdx = next.findIndex(x => x.itemId === ln.itemId);
                                  if (lineIdx === -1) return prev;
                                  next[lineIdx] = { ...next[lineIdx]!, invRate: sanitizeDecimalInput(e.target.value) };
                                  return next;
                                })
                              }
                              type="text"
                              inputMode="decimal"
                            />
                          </td>
                          {supplierHasGst ? (
                            <>
                              <td className="px-1 py-2 border border-black align-middle" onClick={(e) => e.stopPropagation()}>
                                <GstRateSelect
                                  className="w-full"
                                  inputClassName="py-1.5 h-8 text-[11px] text-right"
                                  value={ln.gstPercent}
                                  onChange={(val) =>
                                    setLines((prev) => {
                                      const next = prev.slice();
                                      const lineIdx = next.findIndex(x => x.itemId === ln.itemId);
                                      if (lineIdx === -1) return prev;
                                      next[lineIdx] = { ...next[lineIdx]!, gstPercent: val };
                                      return next;
                                    })
                                  }
                                />
                              </td>
                              <td className="px-2 py-2 border border-black text-right tabular-nums font-medium">
                                {lineGstAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </>
                          ) : null}
                          <td className="px-2 py-2 border border-black text-right tabular-nums font-bold">
                            {lineTotalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}
