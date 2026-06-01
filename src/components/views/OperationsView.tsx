import React, { useEffect, useMemo, useState } from 'react';
import { FileText, IndianRupee, Pencil, Plus, Trash2 } from 'lucide-react';
import Pagination from '@/src/components/common/Pagination';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import { cn } from '@/src/lib/utils';
import { uploadFileToServer } from '@/src/lib/uploads';
import { formatPrNumber } from '@/src/lib/docNumbers';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { downloadTextFile, toCsv } from '@/src/lib/csvFile';
import { sanitizeDecimalInput } from '@/src/lib/numberInput';
import { updatePo } from '@/src/lib/purchaseRequests';
import {
          fetchOperationsCreditVouchers,
					  fetchOperationsGrnDetail,
				  fetchOperationsGrns,
      fetchOperationsInvoiceDetail,
      fetchInvoiceReceipts,
      fetchCreditVoucherReceipts,
      fetchCreditVoucherItems,
      deleteReceiptRow,
      fetchOperationsAdvances,
	  fetchOperationsInvoices,
	  fetchOperationsPaymentDetail,
	  fetchOperationsPayments,
		  fetchOperationsPoDetail,
		  fetchPoAdvances,
      fetchPoReceipts,
		  fetchOperationsPos,
		  fetchOperationsPrDetail,
		  fetchOperationsPrs,
      updatePoReceipts,
		  updatePoAdvances,
		  type OperationsFilters,
      type OperationsAdvanceListRow,
			  type OperationsGrnListRow,
      type OperationsCreditVoucherListRow,
      type OperationsInvoiceListRow,
      type InvoiceReceiptRow,
		  type OperationsPaymentListRow,
		  type OperationsPoListRow,
      type PoReceiptInvoiceRow,
	  type PoAdvanceRow,
	  type OperationsPrListRow,
} from '@/src/lib/operations';
import { inputClass, labelClass, Modal, useQueueMasters } from './queues/shared';

type OpsTab = 'prs' | 'pos' | 'pendingAdjustments' | 'grns' | 'invoices' | 'creditVouchers' | 'payments';
type InvoiceSubTab = 'pendingAdjustments' | 'receipts';

const TAB_LABEL: Record<OpsTab, string> = {
  prs: 'Purchase Requisitions',
  pos: 'Purchase Orders',
  pendingAdjustments: 'Pending Advance Adjustment',
	  grns: 'GRN',
	  invoices: 'Invoices',
  creditVouchers: 'Credit Voucher',
	  payments: 'Payments',
};

const emptyOperationsFilters: OperationsFilters = {
  q: '',
  firmId: '',
  storeId: '',
  projectId: '',
  supplierId: '',
  status: '',
  from: '',
  to: '',
};

function formatDateShort(s: string) {
  const t = String(s ?? '').trim();
  if (!t) return '-';
  return formatDateDDMMYYYYOnly(t) || '-';
}

function uploadDocumentHref(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
  if (raw.startsWith('/api/uploads/')) return raw;
  if (raw.startsWith('/uploads/')) return `/api${raw}`;
  if (raw.startsWith('uploads/')) return `/api/${raw}`;
  return raw;
}

export default function OperationsView({
  onViewPr,
  initialTab = 'prs',
}: {
  onViewPr?: (
    prId: string,
    opts?: { scrollTo?: 'top' | 'existingPos'; view?: 'full' | 'existingPosOnly' | 'recordedGrnsOnly' | 'recordedInvoicesOnly' }
  ) => void;
  initialTab?: OpsTab;
}) {
  const masters = useQueueMasters({ includeSuppliers: true, includeStores: true });
  const [tab, setTab] = useState<OpsTab>(initialTab);
  const [invoiceSubTab, setInvoiceSubTab] = useState<InvoiceSubTab>('receipts');

  useEffect(() => {
    setTab(initialTab);
    setDetailOpen(false);
  }, [initialTab]);

  useEffect(() => {
    if (tab !== 'invoices') return;
    setInvoiceSubTab('receipts');
  }, [tab]);

  const [filters, setFilters] = useState<OperationsFilters>(() => ({ ...emptyOperationsFilters }));

	  const statusOptions = useMemo(() => {
	    if (tab === 'prs') return ['', 'Pending Approval', 'Approved', 'Rejected'];
	    if (tab === 'pos') return ['', 'Open', 'Partial', 'Closed'];
	    if (tab === 'pendingAdjustments') return ['', 'Open', 'Partial', 'Closed'];
		    if (tab === 'invoices') return ['', 'Recorded', 'On Hold', 'Approved', 'Paid'];
    if (tab === 'creditVouchers') return ['', 'Recorded', 'Approved', 'Paid'];
		    if (tab === 'payments') return ['', 'ADVANCE_ADJUSTMENT', 'DIRECT_PAYMENT'];
	    return [''];
	  }, [tab]);

	  useEffect(() => {
	    if (tab !== 'payments') return;
	    setFilters((p) => {
	      const cur = String(p.status ?? '').trim();
	      return cur ? p : { ...p, status: '' };
	    });
	  }, [tab]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

	  const [prs, setPrs] = useState<OperationsPrListRow[]>([]);
	  const [pos, setPos] = useState<OperationsPoListRow[]>([]);
	  const [grns, setGrns] = useState<OperationsGrnListRow[]>([]);
	  const [invoices, setInvoices] = useState<OperationsInvoiceListRow[]>([]);
	  const [payments, setPayments] = useState<OperationsPaymentListRow[]>([]);
  const [creditVouchers, setCreditVouchers] = useState<OperationsCreditVoucherListRow[]>([]);
	  const [advancePos, setAdvancePos] = useState<OperationsAdvanceListRow[]>([]);
  const [expandedGrnIds, setExpandedGrnIds] = useState<string[]>([]);
  const [inlineGrnDetailById, setInlineGrnDetailById] = useState<Record<string, any>>({});
  const [inlineGrnLoadingById, setInlineGrnLoadingById] = useState<Record<string, boolean>>({});
  const [inlineGrnErrorById, setInlineGrnErrorById] = useState<Record<string, string>>({});
  const [expandedInvoiceReceiptIds, setExpandedInvoiceReceiptIds] = useState<string[]>([]);
  const [inlineInvoiceReceiptsById, setInlineInvoiceReceiptsById] = useState<Record<string, InvoiceReceiptRow[]>>({});
  const [inlineInvoiceReceiptTotalsById, setInlineInvoiceReceiptTotalsById] = useState<
    Record<string, { adjustedAmount: number; actualReceiptAmount: number }>
  >({});
  const [inlineInvoiceReceiptsLoadingById, setInlineInvoiceReceiptsLoadingById] = useState<Record<string, boolean>>({});
  const [inlineInvoiceReceiptsErrorById, setInlineInvoiceReceiptsErrorById] = useState<Record<string, string>>({});

  const [expandedInvoiceIds, setExpandedInvoiceIds] = useState<string[]>([]);
  const [inlineInvoiceDetailById, setInlineInvoiceDetailById] = useState<Record<string, any>>({});
  const [inlineInvoiceLoadingById, setInlineInvoiceLoadingById] = useState<Record<string, boolean>>({});
  const [inlineInvoiceErrorById, setInlineInvoiceErrorById] = useState<Record<string, string>>({});

  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [selectedNestedRowId, setSelectedNestedRowId] = useState<string | null>(null);

  const getRowId = (r: any, currentTab: OpsTab) => {
    if (!r) return '';
    return currentTab === 'prs'
      ? String(r.prId)
      : currentTab === 'pos'
        ? String(r.poId)
        : currentTab === 'grns'
          ? String(r.grnId)
          : currentTab === 'pendingAdjustments'
            ? String(r.poId)
            : currentTab === 'invoices'
              ? String(r.invoiceId)
              : currentTab === 'creditVouchers'
                ? String(r.creditVoucherId)
                : String(r.paymentId);
  };

  const formatSpecs = (json: string) => {
    if (!json) return '';
    try {
      const specs = JSON.parse(json);
      if (Array.isArray(specs)) {
        return specs.map((s: any) => s.value).filter(Boolean).join(', ');
      }
      if (specs && typeof specs === 'object') {
        return Object.values(specs).filter(Boolean).join(', ');
      }
    } catch (e) {}
    return String(json || '');
  };

  const [expandedCreditVoucherReceiptIds, setExpandedCreditVoucherReceiptIds] = useState<string[]>([]);
  const [inlineCreditVoucherReceiptsById, setInlineCreditVoucherReceiptsById] = useState<Record<string, InvoiceReceiptRow[]>>({});
  const [inlineCreditVoucherReceiptTotalsById, setInlineCreditVoucherReceiptTotalsById] = useState<
    Record<string, { adjustedAmount: number; actualReceiptAmount: number }>
  >({});
  const [inlineCreditVoucherReceiptsLoadingById, setInlineCreditVoucherReceiptsLoadingById] = useState<Record<string, boolean>>({});
  const [inlineCreditVoucherReceiptsErrorById, setInlineCreditVoucherReceiptsErrorById] = useState<Record<string, string>>({});

  const [inlineCreditVoucherItemsById, setInlineCreditVoucherItemsById] = useState<
    Record<string, Array<{ itemName: string; quantity: number; rate: number; amount: number }>>
  >({});
  const [inlineCreditVoucherItemsLoadingById, setInlineCreditVoucherItemsLoadingById] = useState<Record<string, boolean>>({});
  const [inlineCreditVoucherItemsErrorById, setInlineCreditVoucherItemsErrorById] = useState<Record<string, string>>({});

  const [expandedPoIds, setExpandedPoIds] = useState<string[]>([]);
  const [inlinePoDetailById, setInlinePoDetailById] = useState<Record<string, any>>({});
  const [inlinePoLoadingById, setInlinePoLoadingById] = useState<Record<string, boolean>>({});
  const [inlinePoErrorById, setInlinePoErrorById] = useState<Record<string, string>>({});
  const [inlinePoAdvancesById, setInlinePoAdvancesById] = useState<Record<string, PoAdvanceRow[]>>({});
  const [inlinePoAdvancesLoadingById, setInlinePoAdvancesLoadingById] = useState<Record<string, boolean>>({});
  const [inlinePoAdvancesErrorById, setInlinePoAdvancesErrorById] = useState<Record<string, string>>({});
  const [expandedPoAdvanceIds, setExpandedPoAdvanceIds] = useState<string[]>([]);
  const [advanceModalOpen, setAdvanceModalOpen] = useState(false);
  const [advanceModalBusy, setAdvanceModalBusy] = useState(false);
  const [advanceModalError, setAdvanceModalError] = useState<string | null>(null);
  const [advanceModalPoId, setAdvanceModalPoId] = useState('');
  const [advanceModalPoNumber, setAdvanceModalPoNumber] = useState('');
  const [advanceLines, setAdvanceLines] = useState<
    Array<{ id?: string; advanceDate: string; advanceAmount: string; paymentMode?: string; paymentCopy?: string }>
  >([]);

  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustModalBusy, setAdjustModalBusy] = useState(false);
  const [adjustModalError, setAdjustModalError] = useState<string | null>(null);
  const [adjustModalPoId, setAdjustModalPoId] = useState('');
  const [adjustModalPoNumber, setAdjustModalPoNumber] = useState('');
  const [adjustModalAdvanceAmount, setAdjustModalAdvanceAmount] = useState(0);
  const [adjustModalUsesCreditVoucher, setAdjustModalUsesCreditVoucher] = useState(false);
  const [adjustInvoices, setAdjustInvoices] = useState<PoReceiptInvoiceRow[]>([]);
  const [adjustInvoiceAmounts, setAdjustInvoiceAmounts] = useState<Record<string, string>>({});
  const [adjustInvoicePaymentModes, setAdjustInvoicePaymentModes] = useState<Record<string, string>>({});
  const [advanceUploadBusyByIdx, setAdvanceUploadBusyByIdx] = useState<Record<number, boolean>>({});

  const [editPoOpen, setEditPoOpen] = useState(false);
  const [editPoBusy, setEditPoBusy] = useState(false);
  const [editPoError, setEditPoError] = useState<string | null>(null);
  const [editPoId, setEditPoId] = useState('');
  const [editPoNumber, setEditPoNumber] = useState('');
  const [editPoSupplierId, setEditPoSupplierId] = useState('');
  const [editPoPaymentTerms, setEditPoPaymentTerms] = useState('');
  const [editPoLines, setEditPoLines] = useState<
    Array<{
      itemId: string;
      itemLabel: string;
      poQty: number;
      grnQty: number;
      acceptedQty: number;
      quantity: string;
      rate: string;
      discountPercent: string;
      taxPercent: string;
    }>
  >([]);

	  type SortDir = 'asc' | 'desc';
	  const defaultSortKey = useMemo(() => {
	    if (tab === 'prs') return 'requisitionDate';
	    if (tab === 'pos') return 'createdAt';
		    if (tab === 'grns') return 'createdAt';
		    if (tab === 'invoices') return 'createdAt';
    if (tab === 'creditVouchers') return 'createdAt';
	    return 'createdAt';
	  }, [tab]);
	  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: defaultSortKey, dir: 'desc' });
	  useEffect(() => {
	    setSort({ key: defaultSortKey, dir: 'desc' });
	  }, [defaultSortKey]);

		  const sortedRows = useMemo(() => {
		    const list: any[] =
		        tab === 'prs'
		          ? prs
		          : tab === 'pos'
		            ? pos
		            : tab === 'pendingAdjustments'
		              ? advancePos
			            : tab === 'grns'
			              ? grns
			              : tab === 'invoices'
			                ? invoices
                    : tab === 'creditVouchers'
                      ? creditVouchers
			                : payments;
	    const out = [...(list ?? [])];
	    const key = String(sort.key ?? '');
	    const dir = sort.dir === 'asc' ? 1 : -1;

	    const toNumberMaybe = (v: any) => {
	      if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	      if (typeof v === 'string') {
	        const s = v.trim();
	        if (!s) return null;
	        const n = Number(s);
	        return Number.isFinite(n) ? n : null;
	      }
	      return null;
	    };

	    const toDateMaybe = (v: any) => {
	      if (!v) return null;
	      const s = String(v).trim();
	      if (!s) return null;
	      const t = Date.parse(s);
	      return Number.isFinite(t) ? t : null;
	    };

	    const cmp = (a: any, b: any) => {
	      if (a == null && b == null) return 0;
	      if (a == null) return -1;
	      if (b == null) return 1;

	      const an = toNumberMaybe(a);
	      const bn = toNumberMaybe(b);
	      if (an != null && bn != null) return an === bn ? 0 : an < bn ? -1 : 1;

	      const ad = toDateMaybe(a);
	      const bd = toDateMaybe(b);
	      if (ad != null && bd != null) return ad === bd ? 0 : ad < bd ? -1 : 1;

	      const as = String(a).toLowerCase();
	      const bs = String(b).toLowerCase();
	      return as.localeCompare(bs);
	    };

	    out.sort((ra, rb) => cmp(ra?.[key], rb?.[key]) * dir);
	    return out;
			  }, [advancePos, creditVouchers, grns, invoices, payments, pos, prs, sort.dir, sort.key, tab]);

	  const rowsCount = sortedRows.length;

		  const pageSize = 20;
		  const [page, setPage] = useState(1);

  useEffect(() => {
    setFilters({ ...emptyOperationsFilters });
    setPage(1);
    setPrs([]);
    setPos([]);
    setGrns([]);
	    setInvoices([]);
      setCreditVouchers([]);
	    setPayments([]);
    setAdvancePos([]);
    setExpandedPoIds([]);
    setInlinePoDetailById({});
    setInlinePoLoadingById({});
    setInlinePoErrorById({});
    setInlinePoAdvancesById({});
    setInlinePoAdvancesLoadingById({});
    setInlinePoAdvancesErrorById({});
    setExpandedPoAdvanceIds([]);
    setExpandedInvoiceReceiptIds([]);
    setInlineInvoiceReceiptsById({});
    setInlineInvoiceReceiptTotalsById({});
	    setInlineInvoiceReceiptsLoadingById({});
	    setInlineInvoiceReceiptsErrorById({});
      setExpandedGrnIds([]);
      setInlineGrnDetailById({});
      setInlineGrnLoadingById({});
      setInlineGrnErrorById({});
      setDetailOpen(false);
      setSelectedRowId(null);
      setSelectedNestedRowId(null);
      }, [tab]);

	  useEffect(() => {
	    setPage(1);
	    setSelectedRowId(null);
      setSelectedNestedRowId(null);
	  }, [tab, filters.q, filters.firmId, filters.projectId, filters.supplierId, filters.status, filters.from, filters.to, sort.key, sort.dir]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(rowsCount / pageSize));
    if (page > totalPages) setPage(totalPages);
  }, [page, pageSize, rowsCount]);

	  const paged = useMemo(() => {
	    const start = (page - 1) * pageSize;
	    return sortedRows.slice(start, start + pageSize);
	  }, [page, pageSize, sortedRows]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);

	    const p =
	      tab === 'prs'
	        ? fetchOperationsPrs(filters, ac.signal).then(setPrs)
	        : tab === 'pos'
	          ? fetchOperationsPos(filters, ac.signal).then(setPos)
	          : tab === 'pendingAdjustments'
	            ? fetchOperationsAdvances(filters, ac.signal).then(setAdvancePos)
	            : tab === 'grns'
		              ? fetchOperationsGrns(filters, ac.signal).then(setGrns)
		              : tab === 'invoices'
		                ? fetchOperationsInvoices(filters, ac.signal).then(setInvoices)
                    : tab === 'creditVouchers'
                      ? fetchOperationsCreditVouchers(filters, ac.signal).then(setCreditVouchers)
		                : fetchOperationsPayments(filters, ac.signal).then(setPayments);

    p.catch((e) => {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    }).finally(() => {
      if (ac.signal.aborted) return;
      setLoading(false);
    });

    return () => ac.abort();
	  }, [filters, tab]);

  const firmOptions = useMemo(
	    () => [{ value: '', label: 'All Firms' }, ...masters.firms.map((f) => ({ value: f.id, label: String(f.sortName ?? '').trim() || f.name }))],
	    [masters.firms]
	  );

  const storeOptions = useMemo(
    () => [{ value: '', label: 'All Stores' }, ...(masters.stores ?? []).map((s) => ({ value: s.id, label: s.name }))],
    [masters.stores]
  );
  const projectOptions = useMemo(
    () => [{ value: '', label: 'All Projects' }, ...masters.projects.map((p) => ({ value: p.id, label: p.name }))],
    [masters.projects]
  );
  const supplierOptions = useMemo(
    () => [{ value: '', label: 'All Suppliers' }, ...masters.suppliers.map((s) => ({ value: s.id, label: s.name }))],
    [masters.suppliers]
  );

  const adjustTotals = useMemo(() => {
    const totalAdjusted = Object.values(adjustInvoiceAmounts).reduce((sum, v) => {
      const n = String(v ?? '').trim() ? Number(v) : 0;
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    const remaining = Math.max(0, Number(adjustModalAdvanceAmount ?? 0) - totalAdjusted);
    return { totalAdjusted, remaining };
  }, [adjustInvoiceAmounts, adjustModalAdvanceAmount]);

		  const [detailOpen, setDetailOpen] = useState(false);
		  const [detailLoading, setDetailLoading] = useState(false);
		  const [detailError, setDetailError] = useState<string | null>(null);
		  const [detailTitle, setDetailTitle] = useState('Detail');
		  const [detail, setDetail] = useState<any>(null);
		  const [detailTab, setDetailTab] = useState<OpsTab>('prs');
		  type DetailEntry = { tab: OpsTab; id: string; title: string };
		  const [detailStack, setDetailStack] = useState<DetailEntry[]>([]);
		  const detailAbortRef = React.useRef<AbortController | null>(null);

		  function closeDetail() {
		    if (detailAbortRef.current) detailAbortRef.current.abort();
		    detailAbortRef.current = null;
		    setDetailOpen(false);
		    setDetailLoading(false);
		    setDetailError(null);
		    setDetail(null);
		    setDetailTab('prs');
		    setDetailStack([]);
		  }

		  function entryFromRow(row: any): DetailEntry {
		    if (tab === 'prs') return { tab: 'prs', id: String(row.prId), title: String(row.prNumber ?? row.prId) };
		    if (tab === 'pos') return { tab: 'pos', id: String(row.poId), title: String(row.poNumber ?? row.poId) };
		    if (tab === 'grns') return { tab: 'grns', id: String(row.grnId), title: String(row.grnNumber ?? row.grnId) };
		    if (tab === 'invoices') return { tab: 'invoices', id: String(row.invoiceId), title: String(row.invoiceNo ?? row.invoiceId) };
		    // Payments tab rows represent paid invoices; open invoice detail.
		    return { tab: 'invoices', id: String(row.invoiceId), title: String(row.invoiceNo ?? row.invoiceId) };
		  }

	  function loadDetail(entry: DetailEntry) {
	    if (detailAbortRef.current) detailAbortRef.current.abort();
	    const ac = new AbortController();
	    detailAbortRef.current = ac;

	    setDetailOpen(true);
		    setDetailLoading(true);
		    setDetailError(null);
		    setDetailTitle(entry.title);
		    setDetail(null);
		    setDetailTab(entry.tab);

	    const p =
	      entry.tab === 'prs'
	        ? fetchOperationsPrDetail(entry.id, ac.signal)
	        : entry.tab === 'pos'
	          ? fetchOperationsPoDetail(entry.id, ac.signal)
	          : entry.tab === 'grns'
	            ? fetchOperationsGrnDetail(entry.id, ac.signal)
	            : entry.tab === 'invoices'
	              ? fetchOperationsInvoiceDetail(entry.id, ac.signal)
	              : fetchOperationsPaymentDetail(entry.id, ac.signal);

	    p.then((d: any) => setDetail(d))
	      .catch((e) => {
	        if (ac.signal.aborted) return;
	        setDetailError(e instanceof Error ? e.message : String(e));
	      })
	      .finally(() => {
	        if (ac.signal.aborted) return;
	        setDetailLoading(false);
	      });
	  }

  function openDetailForRow(row: any) {
		    const entry = entryFromRow(row);
		    // PR rows can optionally open the full Purchase Request detail screen.
		    if (entry.tab === 'prs' && typeof onViewPr === 'function') {
		      onViewPr(entry.id);
		      return;
		    }
    // PO rows expand inline in table with item details.
    if (tab === 'pos') {
      const poId = String(row?.poId ?? '').trim();
      if (!poId) return;
      const currentlyExpanded = expandedPoIds.includes(poId);
      if (currentlyExpanded) {
        setExpandedPoIds((prev) => prev.filter((x) => x !== poId));
        setExpandedPoAdvanceIds((prev) => prev.filter((x) => x !== poId));
        return;
      }
      setExpandedPoIds((prev) => [...prev, poId]);
      if (!inlinePoDetailById[poId] && !inlinePoLoadingById[poId]) {
        setInlinePoLoadingById((prev) => ({ ...prev, [poId]: true }));
        setInlinePoErrorById((prev) => {
          const next = { ...prev };
          delete next[poId];
          return next;
        });
        fetchOperationsPoDetail(poId)
          .then((d) => setInlinePoDetailById((prev) => ({ ...prev, [poId]: d })))
          .catch((e) =>
            setInlinePoErrorById((prev) => ({
              ...prev,
              [poId]: e instanceof Error ? e.message : String(e),
            }))
	          )
	          .finally(() => setInlinePoLoadingById((prev) => ({ ...prev, [poId]: false })));
	      }
      if (!inlinePoAdvancesById[poId] && !inlinePoAdvancesLoadingById[poId]) {
        setInlinePoAdvancesLoadingById((prev) => ({ ...prev, [poId]: true }));
        setInlinePoAdvancesErrorById((prev) => {
          const next = { ...prev };
          delete next[poId];
          return next;
        });
        fetchPoAdvances(poId)
          .then((rows) => {
            const list = rows ?? [];
            setInlinePoAdvancesById((prev) => ({ ...prev, [poId]: list }));
            if (list.length > 0) {
              setExpandedPoAdvanceIds((prev) => (prev.includes(poId) ? prev : [...prev, poId]));
            } else {
              setExpandedPoAdvanceIds((prev) => prev.filter((x) => x !== poId));
            }
          })
          .catch((e) =>
            setInlinePoAdvancesErrorById((prev) => ({
              ...prev,
              [poId]: e instanceof Error ? e.message : String(e),
            }))
          )
          .finally(() => setInlinePoAdvancesLoadingById((prev) => ({ ...prev, [poId]: false })));
      } else {
        const cached = inlinePoAdvancesById[poId] ?? [];
        if (cached.length > 0) {
          setExpandedPoAdvanceIds((prev) => (prev.includes(poId) ? prev : [...prev, poId]));
        } else {
          setExpandedPoAdvanceIds((prev) => prev.filter((x) => x !== poId));
        }
      }
      return;
    }
			    if (tab === 'grns') {
			      const grnId = String(row?.grnId ?? '').trim();
            if (!grnId) return;
            if (expandedGrnIds.includes(grnId)) {
              setExpandedGrnIds((prev) => prev.filter((x) => x !== grnId));
              return;
            }
            setExpandedGrnIds((prev) => [...prev, grnId]);
            if (!inlineGrnDetailById[grnId] && !inlineGrnLoadingById[grnId]) {
              setInlineGrnLoadingById((prev) => ({ ...prev, [grnId]: true }));
              setInlineGrnErrorById((prev) => {
                const next = { ...prev };
                delete next[grnId];
                return next;
              });
              fetchOperationsGrnDetail(grnId)
                .then((detail) => setInlineGrnDetailById((prev) => ({ ...prev, [grnId]: detail })))
                .catch((e) => setInlineGrnErrorById((prev) => ({ ...prev, [grnId]: e instanceof Error ? e.message : String(e) })))
                .finally(() => setInlineGrnLoadingById((prev) => ({ ...prev, [grnId]: false })));
            }
            return;
			    }
    if (tab === 'invoices') {
      const invoiceId = String(row?.invoiceId ?? '').trim();
      if (!invoiceId) return;
      if (expandedInvoiceIds.includes(invoiceId)) {
        setExpandedInvoiceIds((prev) => prev.filter((x) => x !== invoiceId));
        return;
      }
      setExpandedInvoiceIds((prev) => [...prev, invoiceId]);
      if (!inlineInvoiceDetailById[invoiceId] && !inlineInvoiceLoadingById[invoiceId]) {
        setInlineInvoiceLoadingById((prev) => ({ ...prev, [invoiceId]: true }));
        setInlineInvoiceErrorById((prev) => {
          const next = { ...prev };
          delete next[invoiceId];
          return next;
        });
        fetchOperationsInvoiceDetail(invoiceId)
          .then((detail) => setInlineInvoiceDetailById((prev) => ({ ...prev, [invoiceId]: detail })))
          .catch((e) => setInlineInvoiceErrorById((prev) => ({ ...prev, [invoiceId]: e instanceof Error ? e.message : String(e) })))
          .finally(() => setInlineInvoiceLoadingById((prev) => ({ ...prev, [invoiceId]: false })));
      }
      return;
    }
		    // Invoice rows can optionally open PR view focused on Recorded Invoices.
		    if (tab === 'invoices' && typeof onViewPr === 'function') {
		      const prId = String(row?.prId ?? '').trim();
		      if (prId) {
		        onViewPr(prId, { view: 'recordedInvoicesOnly' });
		        return;
		      }
		    }
		    setDetailStack([entry]);
		    loadDetail(entry);
		  }

	  function pushDetail(entry: DetailEntry) {
	    setDetailStack((prev) => [...prev, entry]);
	    loadDetail(entry);
	  }

	  function popDetail() {
	    if (detailStack.length <= 1) return;
	    const next = detailStack.slice(0, -1);
	    setDetailStack(next);
	    const top = next[next.length - 1];
	    if (top) loadDetail(top);
	  }

      const exportCsv = () => {
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `operations-${tab}-${stamp}.csv`;
        const list: any[] = sortedRows as any[];
        if (!list.length) return downloadTextFile(filename, 'id\n', 'text/csv; charset=utf-8');
        const header = Object.keys(list[0] ?? {});
        downloadTextFile(filename, toCsv(header, list), 'text/csv; charset=utf-8');
      };

	  const toggleSort = (key: string) => {
	    setSort((prev) => {
	      const k = String(key ?? '');
	      if (!k) return prev;
	      if (prev.key === k) return { key: k, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
	      return { key: k, dir: 'asc' };
	    });
	  };

		  const SortTh = ({ label, colKey }: { label: string; colKey: string }) => {
	    const active = sort.key === colKey;
    const arrow = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
	    return (
	      <th className="px-3 py-2 border border-outline-variant bg-primary text-on-primary">
	        <button
	          type="button"
	          className={cn('w-full text-left', active ? 'text-white font-semibold' : 'text-white/80')}
	          onClick={(e) => {
	            e.stopPropagation();
	            toggleSort(colKey);
	          }}
	        >
	          {label}
	          {arrow}
	        </button>
	      </th>
	    );
		  };

  const openAdvanceModal = async (row: OperationsPoListRow) => {
    const poId = String(row.poId ?? '').trim();
    if (!poId) return;
    setAdvanceModalPoId(poId);
    setAdvanceModalPoNumber(String(row.poNumber ?? poId));
    setAdvanceModalOpen(true);
    setAdvanceModalError(null);
    setAdvanceModalBusy(false);
    setAdvanceUploadBusyByIdx({});
    setAdvanceLines([{ advanceDate: new Date().toISOString().slice(0, 10), advanceAmount: '', paymentMode: '', paymentCopy: '' }]);
  };

  const openAdjustModal = async (row: OperationsAdvanceListRow) => {
    const poId = String(row.poId ?? '').trim();
    if (!poId) return;
    setAdjustModalPoId(poId);
    setAdjustModalPoNumber(String(row.poNumber ?? poId));
    setAdjustModalAdvanceAmount(Number(row.advanceAmount ?? 0));
    setAdjustModalUsesCreditVoucher(Boolean((row as any).creditVoucherApplicable));
    setAdjustModalOpen(true);
    setAdjustModalBusy(true);
    setAdjustModalError(null);
    setAdjustInvoices([]);
    setAdjustInvoiceAmounts({});
    setAdjustInvoicePaymentModes({});
    try {
      const inv = await fetchPoReceipts(poId);
      const list = Array.isArray(inv) ? inv : [];
      if (list.some((x) => String((x as any).referenceType ?? '').toUpperCase() === 'CREDIT_VOUCHER')) {
        setAdjustModalUsesCreditVoucher(true);
      }
      setAdjustInvoices(list);
      setAdjustInvoiceAmounts(Object.fromEntries(list.map((x) => [x.invoiceId, String(Number(x.adjustedAmount ?? 0) || '')])));
      setAdjustInvoicePaymentModes(Object.fromEntries(list.map((x) => [x.invoiceId, String((x as any).paymentMode ?? 'Credit') || 'Credit'])));
    } catch (e) {
      setAdjustModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdjustModalBusy(false);
    }
  };

  const closeAdjustModal = () => {
    setAdjustModalOpen(false);
    setAdjustModalBusy(false);
    setAdjustModalError(null);
    setAdjustModalPoId('');
    setAdjustModalPoNumber('');
    setAdjustModalAdvanceAmount(0);
    setAdjustModalUsesCreditVoucher(false);
    setAdjustInvoices([]);
    setAdjustInvoiceAmounts({});
    setAdjustInvoicePaymentModes({});
  };

  const saveAdjustments = async () => {
    if (!adjustModalPoId) return;
    setAdjustModalBusy(true);
    setAdjustModalError(null);
    try {
      const invoiceAmountById = new Map(
        adjustInvoices.map((inv) => [String(inv.invoiceId ?? ''), Number(inv.invoiceAmount ?? 0)])
      );
      for (const [invoiceId, raw] of Object.entries(adjustInvoiceAmounts)) {
        const entered = String(raw ?? '').trim() ? Number(raw) : 0;
        const invoiceAmount = Number(invoiceAmountById.get(String(invoiceId)) ?? 0);
        if (!Number.isFinite(entered) || entered < 0) {
          setAdjustModalError('Amount Adjustment must be a valid non-negative number.');
          setAdjustModalBusy(false);
          return;
        }
        if (entered > invoiceAmount + 1e-9) {
          const inv = adjustInvoices.find((x) => String(x.invoiceId) === String(invoiceId));
          setAdjustModalError(
            `Amount Adjustment cannot be more than Invoice Amount for ${inv?.invoiceNo || invoiceId}.`
          );
          setAdjustModalBusy(false);
          return;
        }
      }
      const rows = Object.entries(adjustInvoiceAmounts).map(([invoiceId, v]) => ({
        invoiceId,
        adjustedAmount: String(v ?? '').trim() ? Number(v) : 0,
        paymentMode: String(adjustInvoicePaymentModes[invoiceId] ?? '').trim() || 'Credit',
      }));
      await updatePoReceipts(adjustModalPoId, rows, 'Accounts Team');
      const refreshed = await fetchOperationsAdvances(filters);
      setAdvancePos(refreshed ?? []);
      closeAdjustModal();
    } catch (e) {
      setAdjustModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdjustModalBusy(false);
    }
  };

  const closeAdvanceModal = () => {
    setAdvanceModalOpen(false);
    setAdvanceModalBusy(false);
    setAdvanceModalError(null);
    setAdvanceModalPoId('');
    setAdvanceModalPoNumber('');
    setAdvanceLines([]);
    setAdvanceUploadBusyByIdx({});
  };

  const openEditPoModal = async (row: OperationsPoListRow) => {
    const poId = String(row.poId ?? '').trim();
    if (!poId) return;
    setEditPoId(poId);
    setEditPoNumber(String(row.poNumber ?? poId));
    setEditPoOpen(true);
    setEditPoBusy(true);
    setEditPoError(null);
    try {
      const detail = await fetchOperationsPoDetail(poId);
      const po = detail?.po?.po;
      const items = detail?.po?.items ?? [];
      const supplierId = String(po?.supplierId ?? row.supplierId ?? '').trim();
      setEditPoSupplierId(supplierId);
      setEditPoPaymentTerms(String(po?.paymentTerms ?? '').trim());
      setEditPoLines(
        (items ?? []).map((it: any) => ({
          itemId: String(it.itemId ?? '').trim(),
          itemLabel: String(it.itemLabel ?? it.item ?? '-'),
          poQty: Number(it.quantity ?? 0),
          grnQty: Number(it.grnQty ?? 0),
          acceptedQty: Number(it.acceptedQty ?? 0),
          quantity: String(Number(it.quantity ?? 0) || ''),
          rate: String(Number(it.rate ?? 0) || ''),
          discountPercent: String(Number(it.discountPercent ?? 0) || 0),
          taxPercent: String(Number(it.taxPercent ?? 0) || 0),
        }))
      );
    } catch (e) {
      setEditPoError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditPoBusy(false);
    }
  };

  const closeEditPoModal = () => {
    setEditPoOpen(false);
    setEditPoBusy(false);
    setEditPoError(null);
    setEditPoId('');
    setEditPoNumber('');
    setEditPoSupplierId('');
    setEditPoPaymentTerms('');
    setEditPoLines([]);
  };

  const saveEditPo = async () => {
    if (!editPoId) return;
    const supplierId = String(editPoSupplierId ?? '').trim();
    if (!supplierId) {
      setEditPoError('Supplier is required.');
      return;
    }
    const paymentTerms = String(editPoPaymentTerms ?? '').trim();
    if (!paymentTerms) {
      setEditPoError('Payment terms are required.');
      return;
    }

    for (const l of editPoLines) {
      const qty = Number(l.quantity ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (qty + 1e-9 < Number(l.acceptedQty ?? 0)) {
        setEditPoError(`Qty cannot be less than Accepted Qty for: ${l.itemLabel}`);
        return;
      }
    }

    const items = editPoLines
      .map((l) => ({
        itemId: String(l.itemId ?? '').trim(),
        quantity: Number(l.quantity ?? 0),
        rate: Number(l.rate ?? 0),
        discountPercent: Number(l.discountPercent ?? 0),
        taxPercent: getSupplierHasGst(supplierId) ? Number(l.taxPercent ?? 0) : 0,
      }))
      .filter((x) => x.itemId && Number.isFinite(x.quantity) && x.quantity > 0 && Number.isFinite(x.rate) && x.rate >= 0);
    if (!items.length) {
      setEditPoError('Enter Qty and Rate for at least one line.');
      return;
    }

    setEditPoBusy(true);
    setEditPoError(null);
    try {
      await updatePo(editPoId, {
        supplierId,
        paymentTerms,
        items,
        updatedBy: 'Operations',
      });
      const refreshed = await fetchOperationsPoDetail(editPoId);
      setInlinePoDetailById((prev) => ({ ...prev, [editPoId]: refreshed }));
      setPos((prev) =>
        prev.map((p) =>
          p.poId === editPoId
            ? {
                ...p,
                supplierId,
                supplierName: String(masters.suppliers.find((s) => s.id === supplierId)?.name ?? p.supplierName),
              }
            : p
        )
      );
      closeEditPoModal();
    } catch (e) {
      setEditPoError(e instanceof Error ? e.message : String(e));
      setEditPoBusy(false);
    }
  };

  const saveAdvances = async () => {
    if (!advanceModalPoId) return;
    const normalized = advanceLines
      .map((line) => ({
        id: String(line.id ?? '').trim() || undefined,
        advanceDate: String(line.advanceDate ?? '').trim(),
        advanceAmount: Number(line.advanceAmount ?? 0),
        paymentMode: String((line as any).paymentMode ?? '').trim() || undefined,
        paymentCopy: String((line as any).paymentCopy ?? '').trim() || undefined,
      }))
      .filter((line) => line.advanceDate && Number.isFinite(line.advanceAmount) && line.advanceAmount > 0);
    const missingMode = normalized.find((line) => !String(line.paymentMode ?? '').trim());
    if (missingMode) {
      setAdvanceModalError('Payment Mode is required for each advance row.');
      return;
    }
    setAdvanceModalBusy(true);
    setAdvanceModalError(null);
    try {
      const existing = await fetchPoAdvances(advanceModalPoId);
      const merged = [
        ...(existing ?? []).map((x: PoAdvanceRow) => ({
          id: x.id,
          advanceDate: String(x.advanceDate ?? '').slice(0, 10),
          advanceAmount: Number(x.advanceAmount ?? 0),
          paymentMode: String((x as any).paymentMode ?? '').trim() || undefined,
          paymentCopy: String((x as any).paymentCopy ?? '').trim() || undefined,
        })),
        ...normalized,
      ];
      const updated = await updatePoAdvances(advanceModalPoId, merged);
      setPos((prev) =>
        prev.map((po) =>
          po.poId === advanceModalPoId
            ? {
                ...po,
                advanceAmount: Number(updated.summary?.advanceAmount ?? 0),
                advanceDate: updated.summary?.advanceDate ?? null,
              }
            : po
        )
      );
      setInlinePoAdvancesById((prev) => ({ ...prev, [advanceModalPoId]: updated.advances ?? [] }));
      closeAdvanceModal();
    } catch (e) {
      setAdvanceModalError(e instanceof Error ? e.message : String(e));
      setAdvanceModalBusy(false);
    }
  };

  const toggleInlineAdvance = async (row: OperationsPoListRow) => {
    const poId = String(row.poId ?? '').trim();
    if (!poId) return;
    const isOpen = expandedPoAdvanceIds.includes(poId);
    if (isOpen) {
      setExpandedPoAdvanceIds((prev) => prev.filter((x) => x !== poId));
      return;
    }
    if (inlinePoAdvancesById[poId]) {
      const cached = inlinePoAdvancesById[poId] ?? [];
      if (cached.length > 0) setExpandedPoAdvanceIds((prev) => (prev.includes(poId) ? prev : [...prev, poId]));
      return;
    }
    if (inlinePoAdvancesLoadingById[poId]) return;
    setInlinePoAdvancesLoadingById((prev) => ({ ...prev, [poId]: true }));
    setInlinePoAdvancesErrorById((prev) => {
      const next = { ...prev };
      delete next[poId];
      return next;
    });
    try {
      const rows = await fetchPoAdvances(poId);
      const list = rows ?? [];
      setInlinePoAdvancesById((prev) => ({ ...prev, [poId]: list }));
      if (list.length > 0) setExpandedPoAdvanceIds((prev) => (prev.includes(poId) ? prev : [...prev, poId]));
    } catch (e) {
      setInlinePoAdvancesErrorById((prev) => ({ ...prev, [poId]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setInlinePoAdvancesLoadingById((prev) => ({ ...prev, [poId]: false }));
    }
  };

  const toggleInlineInvoiceReceipts = async (row: OperationsInvoiceListRow) => {
    const invoiceId = String(row?.invoiceId ?? '').trim();
    if (!invoiceId) return;
    const isOpen = expandedInvoiceReceiptIds.includes(invoiceId);
    if (isOpen) {
      setExpandedInvoiceReceiptIds((prev) => prev.filter((x) => x !== invoiceId));
      return;
    }
    if (inlineInvoiceReceiptsById[invoiceId]) {
      setExpandedInvoiceReceiptIds((prev) => (prev.includes(invoiceId) ? prev : [...prev, invoiceId]));
      return;
    }
    if (inlineInvoiceReceiptsLoadingById[invoiceId]) return;
    setInlineInvoiceReceiptsLoadingById((prev) => ({ ...prev, [invoiceId]: true }));
    setInlineInvoiceReceiptsErrorById((prev) => {
      const next = { ...prev };
      delete next[invoiceId];
      return next;
    });
    try {
      const payload = await fetchInvoiceReceipts(invoiceId);
      setInlineInvoiceReceiptsById((prev) => ({ ...prev, [invoiceId]: payload.receipts ?? [] }));
      setInlineInvoiceReceiptTotalsById((prev) => ({ ...prev, [invoiceId]: payload.totals ?? { adjustedAmount: 0, actualReceiptAmount: 0 } }));
      setExpandedInvoiceReceiptIds((prev) => (prev.includes(invoiceId) ? prev : [...prev, invoiceId]));
    } catch (e) {
      setInlineInvoiceReceiptsErrorById((prev) => ({ ...prev, [invoiceId]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setInlineInvoiceReceiptsLoadingById((prev) => ({ ...prev, [invoiceId]: false }));
    }
  };

  const toggleInlineCreditVoucherReceipts = async (row: OperationsCreditVoucherListRow) => {
    const cvId = String(row?.creditVoucherId ?? '').trim();
    if (!cvId) return;
    const isOpen = expandedCreditVoucherReceiptIds.includes(cvId);
    if (isOpen) {
      setExpandedCreditVoucherReceiptIds((prev) => prev.filter((x) => x !== cvId));
      return;
    }
    if (inlineCreditVoucherReceiptsById[cvId] && inlineCreditVoucherItemsById[cvId]) {
      setExpandedCreditVoucherReceiptIds((prev) => (prev.includes(cvId) ? prev : [...prev, cvId]));
      return;
    }
    if (inlineCreditVoucherReceiptsLoadingById[cvId]) return;
    setInlineCreditVoucherReceiptsLoadingById((prev) => ({ ...prev, [cvId]: true }));
    setInlineCreditVoucherItemsLoadingById((prev) => ({ ...prev, [cvId]: true }));
    setInlineCreditVoucherReceiptsErrorById((prev) => {
      const next = { ...prev };
      delete next[cvId];
      return next;
    });
    setInlineCreditVoucherItemsErrorById((prev) => {
      const next = { ...prev };
      delete next[cvId];
      return next;
    });
    try {
      const [payload, items] = await Promise.all([
        fetchCreditVoucherReceipts(cvId),
        fetchCreditVoucherItems(cvId),
      ]);
      setInlineCreditVoucherReceiptsById((prev) => ({ ...prev, [cvId]: payload.receipts ?? [] }));
      setInlineCreditVoucherReceiptTotalsById((prev) => ({
        ...prev,
        [cvId]: payload.totals ?? { adjustedAmount: 0, actualReceiptAmount: 0 },
      }));
      setInlineCreditVoucherItemsById((prev) => ({ ...prev, [cvId]: items }));
      setExpandedCreditVoucherReceiptIds((prev) => (prev.includes(cvId) ? prev : [...prev, cvId]));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setInlineCreditVoucherReceiptsErrorById((prev) => ({ ...prev, [cvId]: msg }));
      setInlineCreditVoucherItemsErrorById((prev) => ({ ...prev, [cvId]: msg }));
    } finally {
      setInlineCreditVoucherReceiptsLoadingById((prev) => ({ ...prev, [cvId]: false }));
      setInlineCreditVoucherItemsLoadingById((prev) => ({ ...prev, [cvId]: false }));
    }
  };

	  const getSupplierHasGst = (id: string) => {
	    const s = suppliers.find((x) => x.id === id);
	    return Boolean(String(s?.gstNumber ?? '').trim());
	  };

	  return (
	    <div className="space-y-6">

	      <div className="flex items-center justify-end">
	        <button
	          type="button"
	          className="btn btn-sm"
	          onClick={exportCsv}
	          disabled={loading}
	          title={tab === 'pos' ? 'Download Excel' : 'Export'}
	        >
	          {tab === 'pos' ? 'Download Excel' : 'Export'}
	        </button>
	      </div>

	      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-4">
	        <div className="grid grid-cols-1 md:grid-cols-7 gap-3 items-end">
	          <label className="space-y-1 md:col-span-2">
	            <div className={labelClass}>Search</div>
	            <input className={inputClass} value={filters.q ?? ''} onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))} placeholder="id / no / supplier / firm / project..." />
	          </label>
	
	          <label className="space-y-1">
	            <div className={labelClass}>Firm</div>
	            <SearchableSelect value={filters.firmId ?? ''} options={firmOptions} onChange={(v) => setFilters((p) => ({ ...p, firmId: v }))} />
	          </label>

	          <label className="space-y-1">
	            <div className={labelClass}>Store</div>
	            <SearchableSelect value={filters.storeId ?? ''} options={storeOptions} onChange={(v) => setFilters((p) => ({ ...p, storeId: v }))} />
	          </label>
	
	          <label className="space-y-1">
	            <div className={labelClass}>Project</div>
	            <SearchableSelect value={filters.projectId ?? ''} options={projectOptions} onChange={(v) => setFilters((p) => ({ ...p, projectId: v }))} />
	          </label>

          <label className="space-y-1">
            <div className={labelClass}>Supplier</div>
            <SearchableSelect value={filters.supplierId ?? ''} options={supplierOptions} onChange={(v) => setFilters((p) => ({ ...p, supplierId: v }))} />
          </label>

          <label className="space-y-1">
            <div className={labelClass}>Status</div>
            <select className={inputClass} value={filters.status ?? ''} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
              {statusOptions.map((s) => (
                <option key={s || '__all'} value={s}>
                  {s ? s : 'All'}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <div className={labelClass}>From</div>
            <input className={inputClass} type="date" value={filters.from ?? ''} onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))} />
          </label>

          <label className="space-y-1">
            <div className={labelClass}>To</div>
            <input className={inputClass} type="date" value={filters.to ?? ''} onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))} />
          </label>

	          <button
	            type="button"
	            className="btn btn-sm"
	            onClick={() =>
	              setFilters({
	                q: '',
	                firmId: '',
	                storeId: '',
	                projectId: '',
	                supplierId: '',
	                status: '',
	                from: '',
	                to: '',
	              })
            }
          >
            Clear
          </button>
        </div>
      </div>

      {error ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load: {error}</div> : null}

	      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden">
	        <div className="overflow-x-auto">
		          <table className="w-full min-w-[1140px] table-fixed text-left border-collapse border border-outline-variant text-sm">
	              {tab === 'pos' ? (
	                <colgroup>
	                  <col className="w-[95px]" />
	                  <col className="w-[95px]" />
	                  <col className="w-[220px]" />
	                  <col className="w-[160px]" />
	                  <col className="w-[180px]" />
	                  <col className="w-[120px]" />
	                  <col className="w-[80px]" />
		                  <col className="w-[120px]" />
		                  <col className="w-[120px]" />
		                  <col className="w-[70px]" />
		                  <col className="w-[90px]" />
	                </colgroup>
	              ) : null}
		            <thead>
	              <tr className="bg-primary text-on-primary">
		            {tab === 'prs' ? (
	                  <>
                    <SortTh label="PR" colKey="prNumber" />
                    <SortTh label="Firm" colKey="firmName" />
                    <SortTh label="Store" colKey="store" />
                    <SortTh label="Project" colKey="projectName" />
                    <SortTh label="Req By" colKey="requestedBy" />
                    <SortTh label="Req Date" colKey="requisitionDate" />
	                    <SortTh label="Status" colKey="status" />
	                  </>
		                ) : tab === 'pos' ? (
				                  <>
				                    <SortTh label="PO" colKey="poNumber" />
				                    <SortTh label="PR" colKey="prNumber" />
				                    <SortTh label="Firm" colKey="firmName" />
				                    <SortTh label="Store" colKey="storeName" />
				                    <SortTh label="Supplier" colKey="supplierName" />
				                    <SortTh label="Order Date" colKey="orderDate" />
				                    <SortTh label="Status" colKey="status" />
						                    <SortTh label="Amount" colKey="totalAmount" />
						                    <SortTh label="Advance" colKey="advanceAmount" />
						                    <th className="px-3 py-2 border border-outline-variant bg-primary text-on-primary">PO PDF</th>
						                    <th className="px-3 py-2 border border-outline-variant bg-primary text-on-primary">Action</th>
				                  </>
		                ) : tab === 'grns' ? (
	                  <>
	                    <SortTh label="GRN" colKey="grnNumber" />
	                    <SortTh label="PO" colKey="poNumber" />
	                    <SortTh label="PR" colKey="prNumber" />
	                    <SortTh label="Firm" colKey="firmName" />
	                    <SortTh label="Supplier" colKey="supplierName" />
	                    <SortTh label="Received" colKey="receivedDate" />
	                    <SortTh label="Qty" colKey="totalQty" />
	                  </>
		                ) : tab === 'pendingAdjustments' ? (
	                        <>
	                          <SortTh label="PO" colKey="poNumber" />
                          <SortTh label="Firm" colKey="firmName" />
                          <SortTh label="Supplier" colKey="supplierName" />
                          <SortTh label="Order Date" colKey="orderDate" />
                          <SortTh label="Advance" colKey="advanceAmount" />
                          <SortTh label="Amount Adjusted" colKey="amountAdjusted" />
                          <th className="px-3 py-2 border border-outline-variant bg-primary text-on-primary">Action</th>
	                        </>
	                      ) : tab === 'invoices' ? (
			                    <>
		                      <SortTh label="Invoice" colKey="invoiceNo" />
		                      <SortTh label="PO" colKey="poNumber" />
		                      <SortTh label="Firm" colKey="firmName" />
		                      <SortTh label="Supplier" colKey="supplierName" />
		                      <SortTh label="Date" colKey="invoiceDate" />
                          <SortTh label="GRN Qty" colKey="grnQty" />
                          <SortTh label="Approved Qty" colKey="approvedQty" />
                          <SortTh label="Advance" colKey="adjustedAmount" />
                          <SortTh label="Payment" colKey="actualReceiptAmount" />
                          <th className="px-3 py-2 border border-outline-variant bg-primary text-on-primary">Balance</th>
                          <SortTh label="Status" colKey="status" />
                          <SortTh label="Amount" colKey="invoiceAmount" />
			                    </>
				                ) : tab === 'creditVouchers' ? (
	                    <>
	                      <SortTh label="Voucher" colKey="voucherNo" />
	                      <SortTh label="Date" colKey="voucherDate" />
	                      <SortTh label="PO" colKey="poNumber" />
	                      <SortTh label="Firm" colKey="firmShortName" />
	                      <SortTh label="Supplier" colKey="supplierName" />	                      <SortTh label="Status" colKey="status" />
	                      <SortTh label="Payment" colKey="paymentStatus" />
	                      <SortTh label="Amount" colKey="totalAmount" />
	                      <SortTh label="Paid" colKey="paidAmount" />
	                      <SortTh label="Balance" colKey="balanceAmount" />
	                      <th className="px-3 py-2 border border-outline-variant bg-primary text-on-primary">CV PDF</th>
	                    </>
			                    ) : (
	                      <>
                        <SortTh label="Invoice" colKey="invoiceNo" />
                        <SortTh label="PO" colKey="poNumber" />
                        <SortTh label="Firm" colKey="firmName" />
                        <SortTh label="Supplier" colKey="supplierName" />
                        <SortTh label="Date" colKey="paymentDate" />
                        <SortTh label="Amount" colKey="amount" />
                        <SortTh label="Type" colKey="status" />
                        <SortTh label="Payment Mode" colKey="mode" />
                        <th className="px-3 py-2 border border-outline-variant bg-primary text-on-primary">Payment Copy</th>
                      </>
		                )}
	              </tr>
	            </thead>
            <tbody>
			              {loading ? (
			                <tr>
							                  <td colSpan={tab === 'pos' ? 11 : tab === 'prs' ? 7 : tab === 'pendingAdjustments' ? 7 : tab === 'invoices' ? 12 : tab === 'creditVouchers' ? 11 : 9} className="px-3 py-8 text-sm text-on-surface-variant border border-outline-variant">
				                    Loading...
				                  </td>
				                </tr>
				              ) : !paged.length ? (
				                <tr>
							                  <td colSpan={tab === 'pos' ? 11 : tab === 'prs' ? 7 : tab === 'pendingAdjustments' ? 7 : tab === 'invoices' ? 12 : tab === 'creditVouchers' ? 11 : 9} className="px-3 py-8 text-sm text-on-surface-variant border border-outline-variant">
				                    No records.
				                  </td>
				                </tr>
		              ) : (
                (paged as any[]).map((r) => {
	                  const rowId = getRowId(r, tab);
			                  const isExpanded = tab === 'pos' ? expandedPoIds.includes(String(r.poId ?? '')) : false;
                      const isGrnExpanded = tab === 'grns' ? expandedGrnIds.includes(String(r.grnId ?? '')) : false;
                      const isInvoiceExpanded = tab === 'invoices' ? expandedInvoiceIds.includes(String(r.invoiceId ?? '')) : false;
                      const isInvoiceReceiptExpanded =
                        tab === 'invoices' && invoiceSubTab === 'receipts'
                          ? expandedInvoiceReceiptIds.includes(String(r.invoiceId ?? ''))
                          : false;
                      const isCreditVoucherReceiptExpanded = tab === 'creditVouchers' ? expandedCreditVoucherReceiptIds.includes(String(r.creditVoucherId ?? '')) : false;
	                  const isAdvanceExpanded = tab === 'pos' ? expandedPoAdvanceIds.includes(String(r.poId ?? '')) : false;
		                  const detail = tab === 'pos' ? inlinePoDetailById[String(r.poId ?? '')] : null;
		                  const detailLoading = tab === 'pos' ? Boolean(inlinePoLoadingById[String(r.poId ?? '')]) : false;
		                  const detailError = tab === 'pos' ? inlinePoErrorById[String(r.poId ?? '')] : '';
		                  const grnDetail = tab === 'grns' ? inlineGrnDetailById[String(r.grnId ?? '')] : null;
		                  const grnDetailLoading = tab === 'grns' ? Boolean(inlineGrnLoadingById[String(r.grnId ?? '')]) : false;
		                  const grnDetailError = tab === 'grns' ? inlineGrnErrorById[String(r.grnId ?? '')] : '';
                      const invoiceDetail = tab === 'invoices' ? inlineInvoiceDetailById[String(r.invoiceId ?? '')] : null;
                      const invoiceDetailLoading = tab === 'invoices' ? Boolean(inlineInvoiceLoadingById[String(r.invoiceId ?? '')]) : false;
                      const invoiceDetailError = tab === 'invoices' ? inlineInvoiceErrorById[String(r.invoiceId ?? '')] : '';
		                  const advanceRows = tab === 'pos' ? inlinePoAdvancesById[String(r.poId ?? '')] ?? [] : [];
	                  const advanceLoading = tab === 'pos' ? Boolean(inlinePoAdvancesLoadingById[String(r.poId ?? '')]) : false;
	                  const advanceError = tab === 'pos' ? inlinePoAdvancesErrorById[String(r.poId ?? '')] : '';
                  return (
                    <React.Fragment key={rowId}>
		                      <tr
		                        className={cn("cursor-pointer", selectedRowId === rowId && "bg-primary/10")}
		                        onClick={() => {
		                          setSelectedRowId((prev) => (prev === rowId ? null : rowId));
                              setSelectedNestedRowId(null);
		                          if (tab === 'pendingAdjustments') return openAdjustModal(r as any);
	                            if (tab === 'payments') return;
	                            if (tab === 'creditVouchers') return toggleInlineCreditVoucherReceipts(r as OperationsCreditVoucherListRow);
	                            if (tab === 'invoices' && invoiceSubTab === 'receipts') {
                                toggleInlineInvoiceReceipts(r as OperationsInvoiceListRow);
                              }
	                          openDetailForRow(r);
	                        }}
                      >
                    {tab === 'prs' ? (
                      <>
	            <td className="px-3 py-2 border border-outline-variant font-semibold text-primary">{formatPrNumber(r.prNumber ?? r.prId)}</td>
                        <td className="px-3 py-2 border border-outline-variant">{r.firmName}</td>
                        <td className="px-3 py-2 border border-outline-variant">{r.store ?? '-'}</td>
                        <td className="px-3 py-2 border border-outline-variant">{r.projectName ?? '-'}</td>
                        <td className="px-3 py-2 border border-outline-variant">{r.requestedBy ?? '-'}</td>
                        <td className="px-3 py-2 border border-outline-variant">{formatDateShort(r.requisitionDate)}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.status}</td>
	                      </>
		                    ) : tab === 'pos' ? (
		                      <>
		                        <td className="px-3 py-2 border border-outline-variant font-semibold text-primary">{r.poNumber}</td>
		            <td className="px-3 py-2 border border-outline-variant">{formatPrNumber(r.prNumber ?? r.prId)}</td>
		                        <td className="px-3 py-2 border border-outline-variant">{r.firmName}</td>
		                        <td className="px-3 py-2 border border-outline-variant">{r.storeName ?? '-'}</td>
		                        <td className="px-3 py-2 border border-outline-variant">{r.supplierName || '-'}</td>
					                        <td className="px-3 py-2 border border-outline-variant">{r.orderDate ? formatDateShort(r.orderDate) : '-'}</td>
					                        <td className="px-3 py-2 border border-outline-variant">{r.status}</td>
					                        <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.totalAmount ?? 0).toFixed(2)}</td>
					                        <td className="px-3 py-2 border border-outline-variant tabular-nums">
					                          {Number(r.advanceAmount ?? 0).toFixed(2)}
					                        </td>
					                        <td className="px-3 py-2 border border-outline-variant">
				                          <button
				                            type="button"
				                            className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
				                            title="PO PDF"
				                            aria-label="PO PDF"
			                            onClick={(e) => {
			                              e.stopPropagation();
	                              window.location.href = `/api/pos/${encodeURIComponent(String(r.poId ?? ''))}.pdf?t=${Date.now()}`;
			                            }}
			                          >
				                            <FileText size={16} />
				                          </button>
			                        </td>
			                        <td className="px-3 py-2 border border-outline-variant">
			                          <div className="flex items-center gap-3">
				                          <button
				                            type="button"
				                            className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
				                            title="Advance Entry"
				                            aria-label="Advance Entry"
			                            onClick={(e) => {
			                              e.stopPropagation();
			                              openAdvanceModal(r as OperationsPoListRow);
			                            }}
				                          >
				                            <IndianRupee size={16} />
				                          </button>
				                          <button
				                            type="button"
				                            className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
				                            title="Edit PO"
				                            aria-label="Edit PO"
				                            onClick={(e) => {
				                              e.stopPropagation();
				                              openEditPoModal(r as OperationsPoListRow);
				                            }}
				                          >
				                            <Pencil size={16} />
				                          </button>
			                          </div>
			                        </td>
			                      </>
	                    ) : tab === 'grns' ? (
                      <>
                        <td className="px-3 py-2 border border-outline-variant font-semibold text-primary">{r.grnNumber}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.poNumber}</td>
	            <td className="px-3 py-2 border border-outline-variant">{formatPrNumber(r.prNumber ?? r.prId)}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.firmName}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.supplierName || '-'}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{formatDateShort(r.receivedDate)}</td>
	                        <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.totalQty ?? 0)}</td>
	                      </>
				                    ) : tab === 'pendingAdjustments' ? (
	                              <>
                                <td className="px-3 py-2 border border-outline-variant font-semibold text-primary">{r.poNumber}</td>
                                <td className="px-3 py-2 border border-outline-variant">{r.firmName}</td>
                                <td className="px-3 py-2 border border-outline-variant">{r.supplierName || '-'}</td>
                                <td className="px-3 py-2 border border-outline-variant">{r.orderDate ? formatDateShort(r.orderDate) : '-'}</td>
                                <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.advanceAmount ?? 0).toFixed(2)}</td>
                                <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.amountAdjusted ?? 0).toFixed(2)}</td>
                                <td className="px-3 py-2 border border-outline-variant">
	                                  <button type="button" className="btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); openAdjustModal(r as any); }}>
	                                Payment Adjustment
	                                  </button>
	                                </td>
	                              </>
		                            ) : tab === 'invoices' ? (
					                      <>
			                          <td className="px-3 py-2 border border-outline-variant font-semibold text-primary">{r.invoiceNo}</td>
				                          <td className="px-3 py-2 border border-outline-variant">{r.poNumber}</td>
				                          <td className="px-3 py-2 border border-outline-variant">{r.firmName}</td>
				                          <td className="px-3 py-2 border border-outline-variant">{r.supplierName || '-'}</td>
				                          <td className="px-3 py-2 border border-outline-variant">{formatDateShort(r.invoiceDate)}</td>
	                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.grnQty ?? 0).toFixed(2)}</td>
	                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.approvedQty ?? 0).toFixed(2)}</td>
	                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.adjustedAmount ?? 0).toFixed(2)}</td>
	                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.actualReceiptAmount ?? 0).toFixed(2)}</td>
	                              <td className="px-3 py-2 border border-outline-variant tabular-nums">
	                                {(Number(r.invoiceAmount ?? 0) - Number(r.adjustedAmount ?? 0) - Number(r.actualReceiptAmount ?? 0)).toFixed(2)}
	                              </td>
					                          <td className="px-3 py-2 border border-outline-variant">{r.status}</td>
					                          <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.invoiceAmount ?? 0).toFixed(2)}</td>
					                      </>
		                    ) : tab === 'creditVouchers' ? (
		                      <>
		                        <td className="px-3 py-2 border border-outline-variant font-semibold text-primary">{r.voucherNo}</td>
		                        <td className="px-3 py-2 border border-outline-variant">{formatDateShort(r.voucherDate)}</td>
		                        <td className="px-3 py-2 border border-outline-variant">{r.poNumber}</td>
		                        <td className="px-3 py-2 border border-outline-variant">{r.firmShortName || r.firmName}</td>
		                        <td className="px-3 py-2 border border-outline-variant">{r.supplierName || '-'}</td>
		                        <td className="px-3 py-2 border border-outline-variant">{r.status || '-'}</td>
		                        <td className="px-3 py-2 border border-outline-variant">{r.paymentStatus || '-'}</td>
		                        <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.totalAmount ?? 0).toFixed(2)}</td>
		                        <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.paidAmount ?? 0).toFixed(2)}</td>
		                        <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.balanceAmount ?? 0).toFixed(2)}</td>
		                        <td className="px-3 py-2 border border-outline-variant">
		                          <button
		                            type="button"
		                            className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
		                            title="Credit Voucher PDF"
		                            aria-label="Credit Voucher PDF"
		                            onClick={(e) => {
		                              e.stopPropagation();
		                              window.location.href = `/api/credit-vouchers/${encodeURIComponent(String(r.creditVoucherId ?? ''))}.pdf?t=${Date.now()}`;
		                            }}
		                          >
		                            <FileText size={16} />
		                          </button>
		                        </td>
		                      </>
		                    ) : (
	                        <>
	                          <td className="px-3 py-2 border border-outline-variant">{r.invoiceNo}</td>
				                      <td className="px-3 py-2 border border-outline-variant">{r.poNumber}</td>
				                      <td className="px-3 py-2 border border-outline-variant">{r.firmName}</td>
				                      <td className="px-3 py-2 border border-outline-variant">{r.supplierName || '-'}</td>
				                      <td className="px-3 py-2 border border-outline-variant">{formatDateShort(r.paymentDate)}</td>
				                      <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.amount ?? 0).toFixed(2)}</td>
                          <td className="px-3 py-2 border border-outline-variant">{r.status ?? '-'}</td>
                          <td className="px-3 py-2 border border-outline-variant">{String((r as any).mode ?? '') || '-'}</td>
                          <td className="px-3 py-2 border border-outline-variant">
                            {String((r as any).paymentCopy ?? '').trim() ? (
	                              <a href={uploadDocumentHref((r as any).paymentCopy)} target="_blank" rel="noreferrer" className="underline text-primary">
                                View
                              </a>
                            ) : (
                              '-'
                            )}
                          </td>
                        </>
		                    )}
	                      </tr>
	                      {tab === 'grns' && isGrnExpanded ? (
	                        <tr>
	                          <td colSpan={7} className="px-3 py-3 border border-outline-variant bg-surface-container-low">
	                            {grnDetailLoading ? <div className="text-sm text-on-surface-variant">Loading GRN items...</div> : null}
	                            {!grnDetailLoading && grnDetailError ? <div className="text-sm text-error">{grnDetailError}</div> : null}
	                            {!grnDetailLoading && !grnDetailError ? (
	                              <div className="overflow-x-auto">
	                                <table className="w-full min-w-[1050px] table-fixed text-left border-collapse border border-outline-variant text-sm">
		                                  <thead>
		                                    <tr className="bg-primary text-on-primary">
		                                      <th className="px-3 py-2 border border-outline-variant">Item</th>
		                                      <th className="px-3 py-2 border border-outline-variant w-[80px]">Unit</th>
	                                        <th className="px-3 py-2 border border-outline-variant w-[90px]">Length</th>
	                                        <th className="px-3 py-2 border border-outline-variant w-[90px]">Breadth</th>
		                                      <th className="px-3 py-2 border border-outline-variant w-[100px]">GRN Qty</th>
		                                      <th className="px-3 py-2 border border-outline-variant w-[120px]">Approved Qty</th>
		                                      <th className="px-3 py-2 border border-outline-variant w-[120px]">Inv. Link Qty</th>
		                                      <th className="px-3 py-2 border border-outline-variant w-[100px]">Rejected</th>
		                                    </tr>
		                                  </thead>
	                                  <tbody>
	                                    {(grnDetail?.grn?.items ?? []).length ? (
	                                      (grnDetail?.grn?.items ?? [])
	                                .filter((it: any) => !selectedNestedRowId || it.itemId === selectedNestedRowId)
	                                .map((it: any, idx: number) => (
	                                        <tr
	                                key={`${String(r.grnId ?? '')}-grn-it-${idx}`}
	                                className={cn("cursor-pointer", selectedNestedRowId === it.itemId && "bg-primary/10")}
	                                onClick={(e) => {
	                                e.stopPropagation();
	                                setSelectedNestedRowId(prev => prev === it.itemId ? null : it.itemId);
	                                }}
		                                >
		                                          <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{it?.item || '-'}</td>
		                                          <td className="px-3 py-2 border border-outline-variant">{it?.unit ?? '-'}</td>
	                                            <td className="px-3 py-2 border border-outline-variant whitespace-nowrap">
	                                              {it.dimLength ? `${it.dimLength}${it.dimUnit ? ` ${it.dimUnit}` : ''}` : '-'}
	                                            </td>
	                                            <td className="px-3 py-2 border border-outline-variant whitespace-nowrap">
	                                              {it.dimBreadth ? `${it.dimBreadth}${it.dimUnit ? ` ${it.dimUnit}` : ''}` : '-'}
	                                            </td>
		                                          <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it?.quantityReceived ?? 0)}</td>
		                                          <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it?.approvedQty ?? 0)}</td>
		                                          <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it?.invoiceLinkQty ?? 0)}</td>
		                                          <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it?.rejectedQty ?? 0)}</td>
		                                        </tr>
	                                ))
	                                    ) : (
	                                      <tr>
	                                        <td colSpan={8} className="px-3 py-3 border border-outline-variant text-on-surface-variant">
	                                          No GRN items found.
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
                        {tab === 'invoices' && isInvoiceExpanded ? (
                          <tr>
                            <td colSpan={12} className="px-3 py-3 border border-outline-variant bg-surface-container-low">
                              {invoiceDetailLoading ? <div className="text-sm text-on-surface-variant">Loading items...</div> : null}
                              {!invoiceDetailLoading && invoiceDetailError ? <div className="text-sm text-error">{invoiceDetailError}</div> : null}
                              {!invoiceDetailLoading && !invoiceDetailError && invoiceDetail ? (
                                <div className="space-y-2">
                                  <div className="overflow-x-auto">
                                    <table className="w-full min-w-[1050px] table-fixed text-left border-collapse border border-outline-variant text-sm">
	                                      <thead>
	                                        <tr className="bg-primary text-on-primary">
	                                          <th className="px-3 py-2 border border-outline-variant">Item</th>
	                                          <th className="px-3 py-2 border border-outline-variant w-[80px]">Unit</th>
	                                          <th className="px-3 py-2 border border-outline-variant w-[90px]">Length</th>
	                                          <th className="px-3 py-2 border border-outline-variant w-[90px]">Breadth</th>
	                                          <th className="px-3 py-2 border border-outline-variant w-[100px]">Qty</th>
	                                          <th className="px-3 py-2 border border-outline-variant w-[100px]">Rate</th>
	                                          <th className="px-3 py-2 border border-outline-variant w-[100px]">Tax %</th>
	                                          <th className="px-3 py-2 border border-outline-variant w-[120px]">Total</th>
	                                        </tr>
	                                      </thead>
                                      <tbody>
                                        {(invoiceDetail?.invoice?.items ?? []).length ? (
                                          (invoiceDetail?.invoice?.items ?? []).map((it: any, idx: number) => (
	                                            <tr key={`${String(r.invoiceId ?? '')}-it-${idx}`}>
	                                              <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{it?.item ?? '-'}</td>
	                                              <td className="px-3 py-2 border border-outline-variant">{it?.unit ?? '-'}</td>
	                                              <td className="px-3 py-2 border border-outline-variant whitespace-nowrap">
	                                                {it.dimLength ? `${it.dimLength}${it.dimUnit ? ` ${it.dimUnit}` : ''}` : '-'}
	                                              </td>
	                                              <td className="px-3 py-2 border border-outline-variant whitespace-nowrap">
	                                                {it.dimBreadth ? `${it.dimBreadth}${it.dimUnit ? ` ${it.dimUnit}` : ''}` : '-'}
	                                              </td>
	                                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it?.quantity ?? 0)}</td>
	                                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it?.rate ?? 0).toFixed(2)}</td>
	                                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it?.taxPercent ?? 0)}</td>
	                                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it?.totalAmount ?? 0).toFixed(2)}</td>
	                                            </tr>
                                          ))
                                        ) : (
                                          <tr>
                                            <td colSpan={8} className="px-3 py-3 border border-outline-variant text-on-surface-variant">
                                              No invoice items found.
                                            </td>
                                          </tr>
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ) : null}
		                      {tab === 'pos' && isExpanded ? (
		                        <tr>
		                      <td colSpan={10} className="px-3 py-3 border border-outline-variant bg-surface-container-low">
		                            {detailLoading ? <div className="text-sm text-on-surface-variant">Loading PO items...</div> : null}
		                            {!detailLoading && detailError ? <div className="text-sm text-error">{detailError}</div> : null}
		                            {!detailLoading && !detailError ? (
		                      <div className="space-y-2">
		                      <div className="text-xs text-on-surface-variant">
		                      Supplier: {detail?.po?.po?.supplier ?? r.supplierName ?? '-'} | Payment Terms: {detail?.po?.po?.paymentTerms ?? '-'}
		                      </div>
		                      <div className="overflow-x-auto">
		                      <table className="w-full min-w-[1250px] table-fixed text-left border-collapse border border-outline-variant text-sm">
			                      <thead>
			                                      <tr className="bg-primary text-on-primary">
			                                        <th className="px-3 py-2 border border-outline-variant">Item</th>
			                      <th className="px-3 py-2 border border-outline-variant w-[80px]">Unit</th>
			                      <th className="px-3 py-2 border border-outline-variant w-[90px]">Length</th>
			                      <th className="px-3 py-2 border border-outline-variant w-[90px]">Breadth</th>
			                                        <th className="px-3 py-2 border border-outline-variant w-[80px]">PO Qty</th>
			                                        <th className="px-3 py-2 border border-outline-variant w-[80px]">GRN Qty</th>
			                                        <th className="px-3 py-2 border border-outline-variant w-[100px]">Accepted Qty</th>
			                                        <th className="px-3 py-2 border border-outline-variant w-[100px]">Rejected Qty</th>
		                                        <th className="px-3 py-2 border border-outline-variant w-[90px]">PO Rate</th>
		                                        <th className="px-3 py-2 border border-outline-variant w-[70px]">Disc %</th>
		                                        <th className="px-3 py-2 border border-outline-variant w-[70px]">GST %</th>
		                                        <th className="px-3 py-2 border border-outline-variant w-[120px]">Total</th>
		                                      </tr>
		                      </thead>
		                      <tbody>
		                      {(detail?.po?.items ?? []).length ? (
		                      (detail?.po?.items ?? [])
		                      .filter((it: any) => !selectedNestedRowId || it.itemId === selectedNestedRowId)
		                      .map((it: any, idx: number) => {
		                      const qty = Number(it?.quantity ?? 0);
		                      const rate = Number(it?.rate ?? 0);
		                      const disc = Number(it?.discountPercent ?? 0);
		                      const total = Number(it?.totalAmount ?? 0);
		                      return (
		                                            <tr
		                      key={`${String(r.poId ?? '')}-it-${idx}`}
		                      className={cn("cursor-pointer", selectedNestedRowId === it.itemId && "bg-primary/10")}
		                      onClick={(e) => {
		                      e.stopPropagation();
		                      setSelectedNestedRowId(prev => prev === it.itemId ? null : it.itemId);
		                      }}
			                      >
			                                              <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{it?.itemLabel ?? it?.item ?? '-'}</td>
			                                              <td className="px-3 py-2 border border-outline-variant">{it?.unit ?? '-'}</td>
			                      <td className="px-3 py-2 border border-outline-variant whitespace-nowrap">
			                      {it.dimLength ? `${it.dimLength}${it.dimUnit ? ` ${it.dimUnit}` : ''}` : '-'}
			                      </td>
			                      <td className="px-3 py-2 border border-outline-variant whitespace-nowrap">
			                      {it.dimBreadth ? `${it.dimBreadth}${it.dimUnit ? ` ${it.dimUnit}` : ''}` : '-'}
			                      </td>
			                                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{qty}</td>
			                                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it?.grnQty ?? 0)}</td>
			                                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it?.acceptedQty ?? 0)}</td>
			                                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it?.rejectedQty ?? 0)}</td>
		                                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{rate.toFixed(2)}</td>
		                                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it?.discountPercent ?? 0)}</td>
		                                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it?.taxPercent ?? 0)}</td>
		                                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{total.toFixed(2)}</td>
		                                            </tr>
		                      );
		                      })
		                      ) : (
		                      <tr>
		                                          <td colSpan={12} className="px-3 py-3 border border-outline-variant text-on-surface-variant">
		                                            No PO items found.
		                                          </td>
		                                        </tr>
		                      )}
		                      </tbody>
		                      </table>
		                      </div>
		                      </div>
		                            ) : null}
		                          </td>
		                        </tr>
		                      ) : null}
			                      {tab === 'pos' && isAdvanceExpanded && (advanceLoading || Boolean(advanceError) || advanceRows.length > 0) ? (
			                        <tr>
		                          <td colSpan={10} className="px-3 py-3 border border-outline-variant bg-surface-container-low">
		                            {advanceLoading ? <div className="text-sm text-on-surface-variant">Loading advances...</div> : null}
		                            {!advanceLoading && advanceError ? <div className="text-sm text-error">{advanceError}</div> : null}
		                            {!advanceLoading && !advanceError && advanceRows.length ? (
	                              <div className="overflow-x-auto">
	                                <table className="w-full min-w-[720px] table-fixed text-left border-collapse border border-outline-variant text-sm">
	                                  <thead>
	                                    <tr className="bg-primary text-on-primary">
	                                      <th className="px-3 py-2 border border-outline-variant">Adv Date</th>
	                                      <th className="px-3 py-2 border border-outline-variant">Advance</th>
	                                      <th className="px-3 py-2 border border-outline-variant">Payment Mode</th>
	                                      <th className="px-3 py-2 border border-outline-variant">Payment Copy</th>
	                                    </tr>
	                                  </thead>
	                                  <tbody>
	                                    {advanceRows
                                        .filter((a) => !selectedNestedRowId || String(a.id) === selectedNestedRowId)
                                        .map((a) => (
	                                      <tr
                                          key={String(a.id)}
                                          className={cn("cursor-pointer", selectedNestedRowId === String(a.id) && "bg-primary/10")}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedNestedRowId(prev => prev === String(a.id) ? null : String(a.id));
                                          }}
                                        >
	                                        <td className="px-3 py-2 border border-outline-variant">{formatDateShort(String(a.advanceDate ?? ''))}</td>
	                                        <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(a.advanceAmount ?? 0).toFixed(2)}</td>
	                                        <td className="px-3 py-2 border border-outline-variant">{String((a as any).paymentMode ?? '').trim() || '-'}</td>
	                                        <td className="px-3 py-2 border border-outline-variant">
	                                          {String((a as any).paymentCopy ?? '').trim() ? (
		                                            <a className="text-primary underline" href={uploadDocumentHref((a as any).paymentCopy)} target="_blank" rel="noreferrer">
	                                              View
	                                            </a>
	                                          ) : (
	                                            '-'
	                                          )}
	                                        </td>
	                                      </tr>
	                                    ))}
	                                  </tbody>
	                                </table>
	                              </div>
		                            ) : null}
		                          </td>
		                        </tr>
			                      ) : null}
                          {tab === 'invoices' && invoiceSubTab === 'receipts' && isInvoiceReceiptExpanded ? (
                            <tr>
                              <td colSpan={12} className="px-3 py-3 border border-outline-variant bg-surface-container-low">
                                {inlineInvoiceReceiptsLoadingById[String(r.invoiceId ?? '')] ? (
                                  <div className="text-sm text-on-surface-variant">Loading receipts...</div>
                                ) : null}
                                {!inlineInvoiceReceiptsLoadingById[String(r.invoiceId ?? '')] && inlineInvoiceReceiptsErrorById[String(r.invoiceId ?? '')] ? (
                                  <div className="text-sm text-error">{inlineInvoiceReceiptsErrorById[String(r.invoiceId ?? '')]}</div>
                                ) : null}
                                {!inlineInvoiceReceiptsLoadingById[String(r.invoiceId ?? '')] && !inlineInvoiceReceiptsErrorById[String(r.invoiceId ?? '')] ? (
                                  <div className="space-y-2">
                                    <div className="text-xs text-on-surface-variant">
                                      Advance: {Number(inlineInvoiceReceiptTotalsById[String(r.invoiceId ?? '')]?.adjustedAmount ?? 0).toFixed(2)} | Payment:{' '}
                                      {Number(inlineInvoiceReceiptTotalsById[String(r.invoiceId ?? '')]?.actualReceiptAmount ?? 0).toFixed(2)}
                                    </div>
                                    <div className="overflow-x-auto">
                                      <table className="w-full min-w-[760px] table-fixed text-left border-collapse border border-outline-variant text-sm">
                                        <thead>
                                          <tr className="bg-primary text-on-primary">
                                            <th className="px-3 py-2 border border-outline-variant">Type</th>
                                            <th className="px-3 py-2 border border-outline-variant">Amount</th>
                                            <th className="px-3 py-2 border border-outline-variant">Payment Mode</th>
                                            <th className="px-3 py-2 border border-outline-variant">Created At</th>
                                            <th className="px-3 py-2 border border-outline-variant w-[70px]">Del</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {(inlineInvoiceReceiptsById[String(r.invoiceId ?? '')] ?? []).length ? (
                                            (inlineInvoiceReceiptsById[String(r.invoiceId ?? '')] ?? [])
                                              .filter((x) => !selectedNestedRowId || String(x.id) === selectedNestedRowId)
                                              .map((x) => (
                                              <tr
                                                key={x.id}
                                                className={cn("cursor-pointer", selectedNestedRowId === String(x.id) && "bg-primary/10")}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setSelectedNestedRowId(prev => prev === String(x.id) ? null : String(x.id));
                                                }}
                                              >
                                                <td className="px-3 py-2 border border-outline-variant">
                                                  {x.receiptType === 'DIRECT_PAYMENT' ? 'Payment' : 'Advance'}
                                                </td>
                                                <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(x.amount ?? 0).toFixed(2)}</td>
                                                <td className="px-3 py-2 border border-outline-variant">{x.paymentMode || '-'}</td>
                                                <td className="px-3 py-2 border border-outline-variant">{x.createdAt ? formatDateShort(x.createdAt) : '-'}</td>
                                                <td className="px-3 py-2 border border-outline-variant">
                                                  <button
                                                    type="button"
                                                    className="text-error hover:text-error/80 transition-colors"
                                                    title="Delete"
                                                    aria-label="Delete"
                                                    onClick={async (e) => {
                                                      e.stopPropagation();
                                                      const id = String(x.id ?? '').trim();
                                                      if (!id) return;
                                                      await deleteReceiptRow(id);
                                                      // Refresh this invoice's receipt list.
                                                      const payload = await fetchInvoiceReceipts(String(r.invoiceId ?? '').trim());
                                                      setInlineInvoiceReceiptsById((prev) => ({ ...prev, [String(r.invoiceId ?? '')]: payload.receipts ?? [] }));
                                                      setInlineInvoiceReceiptTotalsById((prev) => ({ ...prev, [String(r.invoiceId ?? '')]: payload.totals ?? { adjustedAmount: 0, actualReceiptAmount: 0 } }));
                                                    }}
                                                  >
                                                    <Trash2 size={16} />
                                                  </button>
                                                </td>
                                              </tr>
                                            ))
                                          ) : (
                                            <tr>
                                              <td colSpan={5} className="px-3 py-3 border border-outline-variant text-on-surface-variant">
                                                No receipt rows found.
                                              </td>
                                            </tr>
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                ) : null}
                              </td>
                            </tr>
                          ) : null}
                          {tab === 'creditVouchers' && isCreditVoucherReceiptExpanded ? (
                            <tr>
                              <td colSpan={11} className="px-3 py-3 border border-outline-variant bg-surface-container-low">
                                <div className="space-y-6">
                                  {/* Voucher Items Section */}
                                  <div>
                                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Voucher Items</div>
                                    {inlineCreditVoucherItemsLoadingById[String(r.creditVoucherId ?? '')] ? (
                                      <div className="text-sm text-on-surface-variant">Loading items...</div>
                                    ) : inlineCreditVoucherItemsErrorById[String(r.creditVoucherId ?? '')] ? (
                                      <div className="text-sm text-error">{inlineCreditVoucherItemsErrorById[String(r.creditVoucherId ?? '')]}</div>
                                    ) : (
                                      <div className="overflow-x-auto rounded border border-outline-variant/30">
                                        <table className="w-full min-w-[600px] table-fixed text-left border-collapse text-sm bg-surface">
                                          <thead>
                                            <tr className="bg-surface-container-high text-on-surface-variant">
                                              <th className="px-3 py-2 border border-outline-variant">Service/Item Name</th>
                                              <th className="px-3 py-2 border border-outline-variant text-right w-[100px]">Qty</th>
                                              <th className="px-3 py-2 border border-outline-variant text-right w-[120px]">Rate</th>
                                              <th className="px-3 py-2 border border-outline-variant text-right w-[120px]">Total</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {(inlineCreditVoucherItemsById[String(r.creditVoucherId ?? '')] ?? []).length ? (
                                              (inlineCreditVoucherItemsById[String(r.creditVoucherId ?? '')] ?? [])
                                                .filter((it) => !selectedNestedRowId || `${it.itemName}-${it.quantity}` === selectedNestedRowId)
                                                .map((it, idx) => (
                                                <tr
                                                  key={idx}
                                                  className={cn("cursor-pointer", selectedNestedRowId === `${it.itemName}-${it.quantity}` && "bg-primary/10")}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    const nid = `${it.itemName}-${it.quantity}`;
                                                    setSelectedNestedRowId(prev => prev === nid ? null : nid);
                                                  }}
                                                >
                                                  <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{it.itemName || '-'}</td>
                                                  <td className="px-3 py-2 border border-outline-variant text-right tabular-nums">{Number(it.quantity ?? 0).toFixed(2)}</td>
                                                  <td className="px-3 py-2 border border-outline-variant text-right tabular-nums">{Number(it.rate ?? 0).toFixed(2)}</td>
                                                  <td className="px-3 py-2 border border-outline-variant text-right tabular-nums font-medium">{Number(it.amount ?? 0).toFixed(2)}</td>
                                                </tr>
                                              ))
                                            ) : (
                                              <tr>
                                                <td colSpan={4} className="px-3 py-3 text-center text-on-surface-variant italic">No items found.</td>
                                              </tr>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>

                                  {/* Receipts Section */}
                                  <div>
                                    <div className="flex items-center justify-between mb-2">
                                      <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Adjustment & Payment Details</div>
                                      <div className="flex items-center gap-4 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">
                                        <div className="flex items-center gap-1.5">
                                          <div className="w-2 h-2 rounded-full bg-primary" />
                                          Adjusted: <span className="text-primary tabular-nums text-xs">{Number(inlineCreditVoucherReceiptTotalsById[String(r.creditVoucherId ?? '')]?.adjustedAmount ?? 0).toFixed(2)}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                          Paid: <span className="text-emerald-600 tabular-nums text-xs">{Number(inlineCreditVoucherReceiptTotalsById[String(r.creditVoucherId ?? '')]?.actualReceiptAmount ?? 0).toFixed(2)}</span>
                                        </div>
                                      </div>
                                    </div>

                                    {inlineCreditVoucherReceiptsLoadingById[String(r.creditVoucherId ?? '')] ? (
                                      <div className="text-sm text-on-surface-variant">Loading receipts...</div>
                                    ) : inlineCreditVoucherReceiptsErrorById[String(r.creditVoucherId ?? '')] ? (
                                      <div className="text-sm text-error">{inlineCreditVoucherReceiptsErrorById[String(r.creditVoucherId ?? '')]}</div>
                                    ) : (
                                      <div className="overflow-x-auto rounded border border-outline-variant/30">
                                        <table className="w-full min-w-[720px] table-fixed text-left border-collapse text-sm bg-surface">
                                          <thead>
                                            <tr className="bg-surface-container-high text-on-surface-variant">
                                              <th className="px-3 py-2 border border-outline-variant w-[120px]">Date</th>
                                              <th className="px-3 py-2 border border-outline-variant">Type</th>
                                              <th className="px-3 py-2 border border-outline-variant">Payment Mode</th>
                                              <th className="px-3 py-2 border border-outline-variant text-right w-[150px]">Amount</th>
                                              <th className="px-3 py-2 border border-outline-variant w-[80px] text-center">Action</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {(inlineCreditVoucherReceiptsById[String(r.creditVoucherId ?? '')] ?? []).length ? (
                                              (inlineCreditVoucherReceiptsById[String(r.creditVoucherId ?? '')] ?? [])
                                                .filter((x) => !selectedNestedRowId || String(x.id ?? '') === selectedNestedRowId)
                                                .map((x) => (
                                                <tr
                                                  key={String(x.id ?? '')}
                                                  className={cn("cursor-pointer", selectedNestedRowId === String(x.id ?? '') && "bg-primary/10")}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    const nid = String(x.id ?? '');
                                                    setSelectedNestedRowId(prev => prev === nid ? null : nid);
                                                  }}
                                                >
                                                  <td className="px-3 py-2 border border-outline-variant">{formatDateShort(x.createdAt || '')}</td>
                                                  <td className="px-3 py-2 border border-outline-variant">
                                                    <span className={cn(
                                                      "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                                      x.receiptType === 'DIRECT_PAYMENT' ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                                                    )}>
                                                      {x.receiptType === 'DIRECT_PAYMENT' ? 'Payment' : 'Adjustment'}
                                                    </span>
                                                  </td>
                                                  <td className="px-3 py-2 border border-outline-variant">{x.paymentMode || '-'}</td>
                                                  <td className="px-3 py-2 border border-outline-variant text-right tabular-nums font-medium">
                                                    {Number(x.amount ?? 0).toFixed(2)}
                                                  </td>
                                                  <td className="px-3 py-2 border border-outline-variant text-center">
                                                    <button
                                                      type="button"
                                                      className="p-1 text-error hover:bg-error/10 rounded-md transition-colors"
                                                      title="Delete Receipt"
                                                      onClick={async (e) => {
                                                        e.stopPropagation();
                                                        const id = String(x.id ?? '').trim();
                                                        if (!id || !confirm('Are you sure you want to delete this receipt row?')) return;
                                                        await deleteReceiptRow(id);
                                                        const payload = await fetchCreditVoucherReceipts(String(r.creditVoucherId ?? '').trim());
                                                        setInlineCreditVoucherReceiptsById((prev) => ({
                                                          ...prev,
                                                          [String(r.creditVoucherId ?? '')]: payload.receipts ?? [],
                                                        }));
                                                        setInlineCreditVoucherReceiptTotalsById((prev) => ({
                                                          ...prev,
                                                          [String(r.creditVoucherId ?? '')]: payload.totals ?? { adjustedAmount: 0, actualReceiptAmount: 0 },
                                                        }));
                                                      }}
                                                    >
                                                      <Trash2 size={14} />
                                                    </button>
                                                  </td>
                                                </tr>
                                              ))
                                            ) : (
                                              <tr>
                                                <td colSpan={5} className="px-3 py-3 text-center text-on-surface-variant italic">No receipt rows found.</td>
                                              </tr>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
	                    </React.Fragment>
	                  );
	                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-outline-variant flex items-center justify-between gap-3">
          <div className="text-xs text-on-surface-variant">
            {rowsCount ? `Total: ${rowsCount}` : 'Total: 0'}
          </div>
          <Pagination totalItems={rowsCount} page={page} pageSize={pageSize} onPageChange={setPage} />
        </div>
      </div>

      <Modal open={advanceModalOpen} title={`PO Advance: ${advanceModalPoNumber || '-'}`} onClose={closeAdvanceModal} fullScreen>
        <div className="space-y-3">
          {advanceModalError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{advanceModalError}</div> : null}
          <div className="overflow-x-auto">
	            <table className="w-full min-w-[820px] table-fixed text-left border-collapse border border-outline-variant text-sm">
	              <thead>
	                <tr className="bg-surface-container-high">
	                  <th className="px-3 py-2 border border-outline-variant">Advance Date</th>
	                  <th className="px-3 py-2 border border-outline-variant">Advance Amount</th>
	                  <th className="px-3 py-2 border border-outline-variant">Payment Mode</th>
	                  <th className="px-3 py-2 border border-outline-variant">Payment Copy</th>
	                  <th className="px-3 py-2 border border-outline-variant w-[70px]">Del</th>
	                </tr>
	              </thead>
	              <tbody>
	                {advanceLines.map((line, idx) => (
	                  <tr key={`${line.id ?? 'new'}-${idx}`}>
                    <td className="px-3 py-2 border border-outline-variant">
                      <input
                        type="date"
                        className={cn(inputClass, 'py-1.5')}
                        value={line.advanceDate}
                        onChange={(e) =>
                          setAdvanceLines((prev) => prev.map((x, i) => (i === idx ? { ...x, advanceDate: String(e.target.value ?? '').slice(0, 10) } : x)))
                        }
                        disabled={advanceModalBusy}
                      />
                    </td>
	                    <td className="px-3 py-2 border border-outline-variant">
	                      <input
	                        className={cn(inputClass, 'py-1.5')}
	                        value={line.advanceAmount}
                        onChange={(e) =>
                          setAdvanceLines((prev) => prev.map((x, i) => (i === idx ? { ...x, advanceAmount: sanitizeDecimalInput(e.target.value) } : x)))
                        }
                        inputMode="decimal"
                        placeholder="0"
	                        disabled={advanceModalBusy}
	                      />
	                    </td>
	                    <td className="px-3 py-2 border border-outline-variant">
	                      <select
	                        className={cn(inputClass, 'py-1.5')}
	                        value={String((line as any).paymentMode ?? '')}
	                        onChange={(e) =>
	                          setAdvanceLines((prev) => prev.map((x, i) => (i === idx ? { ...x, paymentMode: e.target.value } : x)))
	                        }
	                        disabled={advanceModalBusy}
	                      >
	                        <option value="">Select</option>
	                        <option value="Cash">Cash</option>
	                        <option value="UPI">UPI</option>
	                        <option value="Cheque">Cheque</option>
	                        <option value="NEFT">NEFT</option>
	                        <option value="RTGS">RTGS</option>
	                        <option value="IMPS">IMPS</option>
	                        <option value="Card">Card</option>
	                      </select>
	                    </td>
	                    <td className="px-3 py-2 border border-outline-variant">
	                    <div className="flex flex-col gap-1.5 pt-1">
	                    <div className="flex items-center gap-2">
	                    <label className={`btn btn-sm cursor-pointer ${(advanceModalBusy || Boolean(advanceUploadBusyByIdx[idx])) ? 'opacity-60 pointer-events-none' : ''}`}>
	                    {Boolean(advanceUploadBusyByIdx[idx]) ? 'Uploading...' : String((line as any).paymentCopy ?? '').trim() ? 'Change Document' : 'Upload Document'}
	                    <input
	                    type="file"
	                    className="hidden"
	                    disabled={advanceModalBusy || Boolean(advanceUploadBusyByIdx[idx])}
	                    onChange={async (e) => {
	                    const inputEl = e.currentTarget;
	                    const f = inputEl.files?.[0];
	                    if (!f) return;
	                    try {
	                    setAdvanceUploadBusyByIdx((m) => ({ ...m, [idx]: true }));
	                    const { url } = await uploadFileToServer(f);
	                    setAdvanceLines((prev) => prev.map((x, i) => (i === idx ? { ...x, paymentCopy: url } : x)));
	                    } catch (err) {
	                    setAdvanceModalError(err instanceof Error ? err.message : String(err));
	                    } finally {
	                    setAdvanceUploadBusyByIdx((m) => ({ ...m, [idx]: false }));
	                    if (inputEl) inputEl.value = '';
	                    }
	                    }}
	                    />
	                    </label>
	                    {String((line as any).paymentCopy ?? '').trim() ? (
	                    <div className="flex items-center gap-2">
	                    <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Uploaded</div>
	                    <a
		                    href={uploadDocumentHref((line as any).paymentCopy)}
	                    target="_blank"
	                    rel="noreferrer"
	                    className="text-xs text-primary underline font-medium"
	                    >
	                    View
	                    </a>
	                    </div>
	                    ) : (
	                    <div className="text-[10px] text-on-surface-variant uppercase tracking-wider font-medium italic">No document</div>
	                    )}
	                    </div>
	                    </div>
	                    </td>	                    <td className="px-3 py-2 border border-outline-variant">
	                      <button
	                        type="button"
                        className="text-error hover:text-error/80 transition-colors"
                        title="Delete"
                        aria-label="Delete"
                        onClick={() => setAdvanceLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)))}
                        disabled={advanceModalBusy || advanceLines.length <= 1}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setAdvanceLines((prev) => [...prev, { advanceDate: new Date().toISOString().slice(0, 10), advanceAmount: '' }])}
	                        disabled={advanceModalBusy}
	                      >
              <Plus size={14} /> Add Row
            </button>
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-sm" onClick={closeAdvanceModal} disabled={advanceModalBusy}>
                Close
              </button>
              <button type="button" className="btn-primary btn-sm" onClick={saveAdvances} disabled={advanceModalBusy}>
                {advanceModalBusy ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={adjustModalOpen}
        title={`Payment Entry: ${adjustModalPoNumber || '-'}`}
        onClose={() => (adjustModalBusy ? null : closeAdjustModal())}
        maxWidthClass="max-w-5xl"
        closeButtonLabel="Close"
      >
        <div className="space-y-4">
          {adjustModalError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{adjustModalError}</div> : null}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3">
              <div className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">Total Advance</div>
              <div className="text-sm font-bold tabular-nums text-on-surface">{Number(adjustModalAdvanceAmount ?? 0).toFixed(2)}</div>
            </div>
            <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3">
              <div className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">Total Adjusted</div>
              <div className="text-sm font-bold tabular-nums text-on-surface">{Number(adjustTotals.totalAdjusted ?? 0).toFixed(2)}</div>
            </div>
            <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3">
              <div className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">Advance Remaining</div>
              <div className="text-sm font-bold tabular-nums text-on-surface">{Number(adjustTotals.remaining ?? 0).toFixed(2)}</div>
            </div>
          </div>

          <div className="overflow-x-auto">
              <table className="w-full min-w-[1160px] table-fixed text-left border-collapse border border-outline-variant text-sm">
                <colgroup>
                  <col className="w-[180px]" />
                  <col className="w-[140px]" />
                  <col className="w-[160px]" />
                  <col className="w-[180px]" />
                  <col className="w-[160px]" />
                  <col className="w-[180px]" />
                </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
	                  <th className="px-3 py-2 border border-outline-variant">{adjustModalUsesCreditVoucher ? 'Credit Voucher No.' : 'Invoice No.'}</th>
	                  <th className="px-3 py-2 border border-outline-variant">{adjustModalUsesCreditVoucher ? 'Voucher Date' : 'Invoice Date'}</th>
	                  <th className="px-3 py-2 border border-outline-variant">{adjustModalUsesCreditVoucher ? 'Voucher Amount' : 'Invoice Amount'}</th>
                  <th className="px-3 py-2 border border-outline-variant">Amount Adjustment</th>
                  <th className="px-3 py-2 border border-outline-variant">Balance</th>
                  <th className="px-3 py-2 border border-outline-variant">Payment Mode</th>
                </tr>
              </thead>
              <tbody>
                {adjustModalBusy ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-sm text-on-surface-variant border border-outline-variant">
                      Loading...
                    </td>
                  </tr>
                ) : !adjustInvoices.length ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-sm text-on-surface-variant border border-outline-variant">
	                      {adjustModalUsesCreditVoucher ? 'No credit vouchers found for this PO.' : 'No invoices found for this PO.'}
                    </td>
                  </tr>
                ) : (
                  adjustInvoices.map((inv) => (
                    <tr key={inv.invoiceId}>
                      <td className="px-3 py-2 border border-outline-variant text-primary font-semibold">{inv.invoiceNo || inv.invoiceId}</td>
                      <td className="px-3 py-2 border border-outline-variant">{formatDateShort(inv.invoiceDate)}</td>
                      <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(inv.invoiceAmount ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-2 border border-outline-variant">
                        <input
                          className={cn(inputClass, 'py-1.5')}
                          value={adjustInvoiceAmounts[inv.invoiceId] ?? ''}
                          onChange={(e) =>
                            setAdjustInvoiceAmounts((prev) => ({
                              ...prev,
                              [inv.invoiceId]: sanitizeDecimalInput(e.target.value),
                            }))
                          }
                          inputMode="decimal"
                          placeholder="0"
                          disabled={adjustModalBusy}
                        />
                      </td>
                      <td className="px-3 py-2 border border-outline-variant tabular-nums">
                        {Math.max(0, Number(inv.invoiceAmount ?? 0) - (String(adjustInvoiceAmounts[inv.invoiceId] ?? '').trim() ? Number(adjustInvoiceAmounts[inv.invoiceId]) : 0)).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 border border-outline-variant">
                        <input
                          className={cn(inputClass, 'py-1.5')}
                          value={adjustInvoicePaymentModes[inv.invoiceId] ?? 'Credit'}
                          readOnly
                          disabled
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn btn-sm" onClick={closeAdjustModal} disabled={adjustModalBusy}>
              Close
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={saveAdjustments} disabled={adjustModalBusy}>
              {adjustModalBusy ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={editPoOpen} title={`Edit PO: ${editPoNumber || '-'}`} onClose={closeEditPoModal} fullScreen maxWidthClass="max-w-6xl">
        <div className="space-y-4">
          {editPoError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{editPoError}</div> : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1">
              <div className={labelClass}>Supplier</div>
              <SearchableSelect
                value={editPoSupplierId}
                options={masters.suppliers.map((s) => ({ value: s.id, label: s.name }))}
                onChange={(v) => setEditPoSupplierId(String(v ?? ''))}
                disabled={editPoBusy || masters.loading}
                placeholder="Select supplier..."
              />
            </label>
            <label className="space-y-1">
              <div className={labelClass}>Payment Terms</div>
              <input className={inputClass} value={editPoPaymentTerms} onChange={(e) => setEditPoPaymentTerms(e.target.value)} disabled={editPoBusy} />
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] table-fixed text-left border-collapse border border-outline-variant text-sm">
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 border border-outline-variant">Item</th>
                  <th className="px-3 py-2 border border-outline-variant">Qty</th>
                  <th className="px-3 py-2 border border-outline-variant">GRN Qty</th>
                  <th className="px-3 py-2 border border-outline-variant">Accepted Qty</th>
                  <th className="px-3 py-2 border border-outline-variant">Rate</th>
                  <th className="px-3 py-2 border border-outline-variant">Disc %</th>
                  <th className="px-3 py-2 border border-outline-variant">GST %</th>
                  <th className="px-3 py-2 border border-outline-variant text-right">GST Amount</th>
                  <th className="px-3 py-2 border border-outline-variant text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {editPoLines.length ? (
                  editPoLines.map((l, idx) => (
                    <tr key={`${l.itemId}-${idx}`}>
                      <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{l.itemLabel}</td>
                      <td className="px-3 py-2 border border-outline-variant">
                        <input
                          className={cn(inputClass, 'py-1.5')}
                          value={l.quantity}
                          onChange={(e) =>
                            setEditPoLines((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: sanitizeDecimalInput(e.target.value) } : x)))
                          }
                          inputMode="decimal"
                          disabled={editPoBusy || Number(l.acceptedQty ?? 0) >= Number(l.poQty ?? 0)}
                        />
                      </td>
                      <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(l.grnQty ?? 0)}</td>
                      <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(l.acceptedQty ?? 0)}</td>
                      <td className="px-3 py-2 border border-outline-variant">
                        <input
                          className={cn(inputClass, 'py-1.5')}
                          value={l.rate}
                          onChange={(e) =>
                            setEditPoLines((prev) => prev.map((x, i) => (i === idx ? { ...x, rate: sanitizeDecimalInput(e.target.value) } : x)))
                          }
                          inputMode="decimal"
                          disabled={editPoBusy}
                        />
                      </td>
                      <td className="px-3 py-2 border border-outline-variant">
                        <input
                          className={cn(inputClass, 'py-1.5')}
                          value={l.discountPercent}
                          onChange={(e) =>
                            setEditPoLines((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, discountPercent: sanitizeDecimalInput(e.target.value) } : x))
                            )
                          }
                          inputMode="decimal"
                          disabled={editPoBusy}
                        />
                      </td>
                      <td className="px-3 py-2 border border-outline-variant">
                      {getSupplierHasGst(editPoSupplierId) ? (
                      <input
                      className={cn(inputClass, 'py-1.5')}
                      value={l.taxPercent}
                      onChange={(e) =>
                      setEditPoLines((prev) => prev.map((x, i) => (i === idx ? { ...x, taxPercent: sanitizeDecimalInput(e.target.value) } : x)))
                      }
                      inputMode="decimal"
                      disabled={editPoBusy}
                      />
                      ) : (
                      <div className="text-center text-xs opacity-50">-</div>
                      )}
                      </td>
                      {(() => {
                        const goodsAmt = Number(l.quantity || 0) * Number(l.rate || 0) * (1 - (Number(l.discountPercent || 0) / 100));
                        const gstAmt = goodsAmt * (Number(l.taxPercent || 0) / 100);
                        const totalAmt = goodsAmt + gstAmt;
                        return (
                          <>
                            <td className="px-3 py-2 border border-outline-variant text-right tabular-nums text-xs font-medium text-on-surface flex items-center justify-end">{gstAmt.toFixed(2)}</td>
                            <td className="px-3 py-2 border border-outline-variant text-right tabular-nums text-xs font-bold text-on-surface flex items-center justify-end">{totalAmt.toFixed(2)}</td>
                          </>
                        );
                      })()}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="px-3 py-3 border border-outline-variant text-on-surface-variant">
                      No items.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn btn-sm" onClick={closeEditPoModal} disabled={editPoBusy}>
              Close
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={saveEditPo} disabled={editPoBusy}>
              {editPoBusy ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>

			      <Modal
			        open={detailOpen}
			        title={`${TAB_LABEL[detailTab]}: ${detailTitle}`}
			        onClose={closeDetail}
		        fullScreen
		        maxWidthClass="max-w-6xl"
		      >
	        {detailStack.length > 1 ? (
	          <div className="mb-3">
	            <button type="button" className="btn btn-sm" onClick={popDetail} disabled={detailLoading}>
	              Back
	            </button>
	          </div>
	        ) : null}
	        {detailLoading ? <div className="text-sm text-on-surface-variant">Loading detail...</div> : null}
	        {detailError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{detailError}</div> : null}
	        {!detailLoading && !detailError && detail ? (
	          <div className="space-y-4">
            {detailTab === 'prs' ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">PR</div>
                    <div className="mt-1 font-semibold text-on-surface">{detail.pr?.pr?.prNumber ?? detail.pr?.pr?.id ?? '-'}</div>
                    <div className="mt-1 text-on-surface-variant">Firm: {detail.pr?.pr?.firmName ?? detail.pr?.pr?.firmId ?? '-'}</div>
                    <div className="mt-1 text-on-surface-variant">Dept: {detail.pr?.pr?.department ?? '-'}</div>
                    <div className="mt-1 text-on-surface-variant">Status: {detail.pr?.pr?.status ?? '-'}</div>
                  </div>
                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Linked Docs</div>
                    <div className="mt-1 text-on-surface-variant">POs: {detail.pos?.length ?? 0}</div>
                    <div className="mt-1 text-on-surface-variant">GRNs: {detail.grns?.length ?? 0}</div>
                    <div className="mt-1 text-on-surface-variant">Invoices: {detail.invoices?.length ?? 0}</div>
                  </div>
	                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
	                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Actions</div>
	                    <div className="mt-2 flex flex-wrap gap-2">
	                      <button type="button" className="btn btn-sm" onClick={() => { setTab('pos'); closeDetail(); setFilters((p) => ({ ...p, q: detail.pr?.pr?.id ?? '' })); }}>
	                        Open POs
	                      </button>
	                      <button type="button" className="btn btn-sm" onClick={() => { setTab('invoices'); closeDetail(); setFilters((p) => ({ ...p, q: detail.pr?.pr?.id ?? '' })); }}>
	                        Open Invoices
	                      </button>
	                    </div>
	                  </div>
	                </div>

	                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
	                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 overflow-hidden">
	                    <div className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Linked POs</div>
	                    <div className="overflow-x-auto">
	                      <table className="w-full min-w-[520px] table-fixed text-left border-collapse border border-outline-variant text-sm">
	                        <thead>
	                          <tr className="bg-primary text-on-primary">
	                            <th className="px-3 py-2 border border-outline-variant">PO</th>
	                            <th className="px-3 py-2 border border-outline-variant">Supplier</th>
	                            <th className="px-3 py-2 border border-outline-variant">Status</th>
	                          </tr>
	                        </thead>
	                        <tbody>
	                          {(detail.pos ?? []).length ? (
	                            (detail.pos ?? []).map((po: any) => (
	                              <tr
	                                key={String(po?.po?.id ?? '')}
	                                className="hover:bg-surface-container-high/40 cursor-pointer"
	                                onClick={() => pushDetail({ tab: 'pos', id: String(po?.po?.id ?? ''), title: String(po?.po?.id ?? 'PO') })}
	                              >
	                                <td className="px-3 py-2 border border-outline-variant text-primary font-semibold">{po?.po?.id ?? '-'}</td>
	                                <td className="px-3 py-2 border border-outline-variant">{po?.po?.supplier ?? '-'}</td>
	                                <td className="px-3 py-2 border border-outline-variant">{po?.po?.status ?? '-'}</td>
	                              </tr>
	                            ))
	                          ) : (
	                            <tr>
	                              <td colSpan={3} className="px-3 py-3 border border-outline-variant text-on-surface-variant">
	                                None
	                              </td>
	                            </tr>
	                          )}
	                        </tbody>
	                      </table>
	                    </div>
	                  </div>

	                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 overflow-hidden">
	                    <div className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Linked GRNs</div>
	                    <div className="overflow-x-auto">
	                      <table className="w-full min-w-[520px] table-fixed text-left border-collapse border border-outline-variant text-sm">
	                        <thead>
	                          <tr className="bg-primary text-on-primary">
	                            <th className="px-3 py-2 border border-outline-variant">GRN</th>
	                            <th className="px-3 py-2 border border-outline-variant">Received</th>
	                          </tr>
	                        </thead>
	                        <tbody>
	                          {(detail.grns ?? []).length ? (
	                            (detail.grns ?? []).map((g: any) => (
	                              <tr
	                                key={String(g?.grn?.id ?? '')}
	                                className="hover:bg-surface-container-high/40 cursor-pointer"
	                                onClick={() => pushDetail({ tab: 'grns', id: String(g?.grn?.id ?? ''), title: String(g?.grn?.id ?? 'GRN') })}
	                              >
	                                <td className="px-3 py-2 border border-outline-variant text-primary font-semibold">{g?.grn?.id ?? '-'}</td>
	                                <td className="px-3 py-2 border border-outline-variant">{formatDateShort(g?.grn?.receivedDate ?? '')}</td>
	                              </tr>
	                            ))
	                          ) : (
	                            <tr>
	                              <td colSpan={2} className="px-3 py-3 border border-outline-variant text-on-surface-variant">
	                                None
	                              </td>
	                            </tr>
	                          )}
	                        </tbody>
	                      </table>
	                    </div>
	                  </div>

	                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 overflow-hidden">
	                    <div className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Linked Invoices</div>
	                    <div className="overflow-x-auto">
	                      <table className="w-full min-w-[520px] table-fixed text-left border-collapse border border-outline-variant text-sm">
	                        <thead>
	                          <tr className="bg-primary text-on-primary">
	                            <th className="px-3 py-2 border border-outline-variant">Invoice</th>
	                            <th className="px-3 py-2 border border-outline-variant">Date</th>
	                            <th className="px-3 py-2 border border-outline-variant">Status</th>
	                          </tr>
	                        </thead>
	                        <tbody>
	                          {(detail.invoices ?? []).length ? (
	                            (detail.invoices ?? []).map((inv: any) => (
	                              <tr
	                                key={String(inv?.invoice?.id ?? '')}
	                                className="hover:bg-surface-container-high/40 cursor-pointer"
	                                onClick={() => pushDetail({ tab: 'invoices', id: String(inv?.invoice?.id ?? ''), title: String(inv?.invoice?.supplierInvoiceNo ?? inv?.invoice?.id ?? 'Invoice') })}
	                              >
	                                <td className="px-3 py-2 border border-outline-variant text-primary font-semibold">{inv?.invoice?.supplierInvoiceNo ?? inv?.invoice?.id ?? '-'}</td>
	                                <td className="px-3 py-2 border border-outline-variant">{formatDateShort(inv?.invoice?.invoiceDate ?? '')}</td>
	                                <td className="px-3 py-2 border border-outline-variant">{inv?.invoice?.status ?? '-'}</td>
	                              </tr>
	                            ))
	                          ) : (
	                            <tr>
	                              <td colSpan={3} className="px-3 py-3 border border-outline-variant text-on-surface-variant">
	                                None
	                              </td>
	                            </tr>
	                          )}
	                        </tbody>
	                      </table>
	                    </div>
	                  </div>
	                </div>

	                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
	                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 overflow-hidden">
	                    <div className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">GRNs</div>
	                    <div className="overflow-x-auto">
	                      <table className="w-full min-w-[640px] table-fixed text-left border-collapse border border-outline-variant text-sm">
	                        <thead>
	                          <tr className="bg-primary text-on-primary">
	                            <th className="px-3 py-2 border border-outline-variant">GRN</th>
	                            <th className="px-3 py-2 border border-outline-variant">Received</th>
	                          </tr>
	                        </thead>
	                        <tbody>
	                          {(detail.grns ?? []).length ? (
	                            (detail.grns ?? []).map((g: any) => (
	                              <tr
	                                key={String(g?.grn?.id ?? '')}
	                                className="hover:bg-surface-container-high/40 cursor-pointer"
	                                onClick={() => pushDetail({ tab: 'grns', id: String(g?.grn?.id ?? ''), title: String(g?.grn?.id ?? 'GRN') })}
	                              >
		                                <td className="px-3 py-2 border border-outline-variant text-primary font-semibold">{g?.grn?.id ?? '-'}</td>
		                                <td className="px-3 py-2 border border-outline-variant">{formatDateShort(g?.grn?.receivedDate ?? '')}</td>
		                              </tr>
		                            ))
		                          ) : (
	                            <tr>
	                              <td colSpan={2} className="px-3 py-3 border border-outline-variant text-on-surface-variant">
	                                None
	                              </td>
	                            </tr>
	                          )}
	                        </tbody>
	                      </table>
	                    </div>
	                  </div>

	                  <div className="space-y-3">
	                    <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
	                      <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Invoice</div>
	                      <div className="mt-1 text-on-surface-variant">
	                        {detail.invoice?.invoice?.supplierInvoiceNo ?? detail.invoice?.invoice?.id ?? 'None'}
	                      </div>
	                      {detail.invoice?.invoice?.id ? (
	                        <div className="mt-2">
	                          <button
	                            type="button"
	                            className="btn btn-sm"
	                            onClick={() =>
	                              pushDetail({
	                                tab: 'invoices',
	                                id: String(detail.invoice?.invoice?.id ?? ''),
	                                title: String(detail.invoice?.invoice?.supplierInvoiceNo ?? detail.invoice?.invoice?.id ?? 'Invoice'),
	                              })
	                            }
	                          >
	                            Open Invoice
	                          </button>
	                        </div>
	                      ) : null}
	                    </div>

	                    <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 overflow-hidden">
	                      <div className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Payments</div>
	                      <div className="overflow-x-auto">
	                        <table className="w-full min-w-[640px] table-fixed text-left border-collapse border border-outline-variant text-sm">
	                          <thead>
	                            <tr className="bg-primary text-on-primary">
	                              <th className="px-3 py-2 border border-outline-variant">Payment</th>
	                              <th className="px-3 py-2 border border-outline-variant">Date</th>
	                              <th className="px-3 py-2 border border-outline-variant">Amount</th>
	                            </tr>
	                          </thead>
	                          <tbody>
	                            {(detail.payments ?? []).length ? (
	                              (detail.payments ?? []).map((p: any) => (
	                                <tr
	                                  key={String(p?.id ?? '')}
	                                  className="hover:bg-surface-container-high/40 cursor-pointer"
	                                  onClick={() => pushDetail({ tab: 'payments', id: String(p?.id ?? ''), title: String(p?.id ?? 'Payment') })}
	                                >
		                                  <td className="px-3 py-2 border border-outline-variant text-primary font-semibold">{p?.id ?? '-'}</td>
		                                  <td className="px-3 py-2 border border-outline-variant">{formatDateShort(p?.paymentDate ?? '')}</td>
		                                  <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(p?.amount ?? 0).toFixed(2)}</td>
		                                </tr>
		                              ))
	                            ) : (
	                              <tr>
	                                <td colSpan={3} className="px-3 py-3 border border-outline-variant text-on-surface-variant">
	                                  None
	                                </td>
	                              </tr>
	                            )}
	                          </tbody>
	                        </table>
	                      </div>
	                    </div>
	                  </div>
	                </div>

	                <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 overflow-hidden">
	                  <div className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Items</div>
	                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] table-fixed text-left border-collapse border border-outline-variant text-sm">
                      <thead>
                        <tr className="bg-primary text-on-primary">
                          <th className="px-3 py-2 border border-outline-variant">Item</th>
                          <th className="px-3 py-2 border border-outline-variant w-[100px]">Qty</th>
                          <th className="px-3 py-2 border border-outline-variant w-[100px]">Unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.pr?.items ?? []).map((it: any) => (
                          <tr key={it.id}>
                            <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">
                              {String(it.item ?? '').trim() || '-'}
                              {String(it.specification ?? '').trim() ? ` - ${String(it.specification).split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean).join(' - ')}` : ''}
                            </td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.quantity ?? 0)}</td>
                            <td className="px-3 py-2 border border-outline-variant">{it.unit ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
	            {detailTab === 'pos' ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">PO</div>
                    <div className="mt-1 font-semibold text-on-surface">{detail.po?.po?.id ?? '-'}</div>
                    <div className="mt-1 text-on-surface-variant">Supplier: {detail.po?.po?.supplier ?? '-'}</div>
                    <div className="mt-1 text-on-surface-variant">Status: {detail.po?.po?.status ?? '-'}</div>
                  </div>
                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Linked</div>
                    <div className="mt-1 text-on-surface-variant">GRNs: {detail.grns?.length ?? 0}</div>
                    <div className="mt-1 text-on-surface-variant">Invoice: {detail.invoice?.invoice?.id ? 'Yes' : 'No'}</div>
                    <div className="mt-1 text-on-surface-variant">Payments: {detail.payments?.length ?? 0}</div>
                  </div>
                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Open In Operations</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn btn-sm" onClick={() => { setTab('grns'); closeDetail(); setFilters((p) => ({ ...p, q: detail.po?.po?.id ?? '' })); }}>
                        GRNs
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => { setTab('invoices'); closeDetail(); setFilters((p) => ({ ...p, q: detail.po?.po?.id ?? '' })); }}>
                        Invoices
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => { setTab('payments'); closeDetail(); setFilters((p) => ({ ...p, q: detail.po?.po?.id ?? '' })); }}>
                        Payments
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 overflow-hidden">
                  <div className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Items</div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1000px] table-fixed text-left border-collapse border border-outline-variant text-sm">
                      <thead>
                        <tr className="bg-surface-container-high">
                          <th className="px-3 py-2 border border-outline-variant">Item</th>
                          <th className="px-3 py-2 border border-outline-variant w-[100px]">Qty</th>
                          <th className="px-3 py-2 border border-outline-variant w-[80px]">Unit</th>
                          <th className="px-3 py-2 border border-outline-variant w-[100px]">Rate</th>
                          <th className="px-3 py-2 border border-outline-variant w-[80px]">Disc %</th>
                          <th className="px-3 py-2 border border-outline-variant w-[80px]">GST %</th>
                          <th className="px-3 py-2 border border-outline-variant w-[120px]">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.po?.items ?? []).map((it: any, idx: number) => (
                          <tr key={`${idx}-${it.itemId}`}>
                            <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{it.item ?? '-'}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.quantity ?? 0)}</td>
                            <td className="px-3 py-2 border border-outline-variant">{it.unit ?? '-'}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.rate ?? 0)}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.discountPercent ?? 0)}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.taxPercent ?? 0)}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.totalAmount ?? 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
            {detailTab === 'grns' ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
	                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
	                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">GRN</div>
	                    <div className="mt-1 font-semibold text-on-surface">{detail.grn?.grn?.id ?? '-'}</div>
	                    <div className="mt-1 text-on-surface-variant">Received: {formatDateShort(detail.grn?.grn?.receivedDate ?? '')}</div>
	                  </div>
                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">PO</div>
                    <div className="mt-1 text-on-surface-variant">{detail.po?.po?.id ?? '-'}</div>
                    <div className="mt-1 text-on-surface-variant">Supplier: {detail.po?.po?.supplier ?? '-'}</div>
                  </div>
                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Open In Operations</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn btn-sm" onClick={() => { setTab('pos'); closeDetail(); setFilters((p) => ({ ...p, q: detail.po?.po?.id ?? '' })); }}>
                        PO
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => { setTab('invoices'); closeDetail(); setFilters((p) => ({ ...p, q: detail.po?.po?.id ?? '' })); }}>
                        Invoice
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 overflow-hidden">
                  <div className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Items</div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] table-fixed text-left border-collapse border border-outline-variant text-sm">
                      <thead>
                        <tr className="bg-surface-container-high">
                          <th className="px-3 py-2 border border-outline-variant">Item</th>
                          <th className="px-3 py-2 border border-outline-variant w-[80px]">Unit</th>
                          <th className="px-3 py-2 border border-outline-variant w-[120px]">Received Qty</th>
                          <th className="px-3 py-2 border border-outline-variant w-[120px]">Approved Qty</th>
                          <th className="px-3 py-2 border border-outline-variant w-[120px]">Rejected Qty</th>
                          <th className="px-3 py-2 border border-outline-variant w-[130px]">Inv. Link Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.grn?.items ?? []).map((it: any) => (
                          <tr key={it.id}>
                            <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{it.item ?? '-'}</td>
                            <td className="px-3 py-2 border border-outline-variant">{it.unit ?? '-'}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.quantityReceived ?? 0)}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.approvedQty ?? 0)}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.rejectedQty ?? 0)}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.invoiceLinkQty ?? 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
            {detailTab === 'invoices' ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
	                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
	                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Invoice</div>
	                    <div className="mt-1 font-semibold text-on-surface">{detail.invoice?.invoice?.supplierInvoiceNo ?? detail.invoice?.invoice?.id ?? '-'}</div>
	                    <div className="mt-1 text-on-surface-variant">Date: {formatDateShort(detail.invoice?.invoice?.invoiceDate ?? '')}</div>
	                    <div className="mt-1 text-on-surface-variant">Status: {detail.invoice?.invoice?.status ?? '-'}</div>
	                  </div>
                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Amount</div>
                    <div className="mt-1 text-on-surface-variant tabular-nums">{Number(detail.invoice?.invoice?.invoiceAmount ?? 0).toFixed(2)}</div>
                    <div className="mt-1 text-on-surface-variant">Payments: {detail.payments?.length ?? 0}</div>
                  </div>
                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Open In Operations</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn btn-sm" onClick={() => { setTab('payments'); closeDetail(); setFilters((p) => ({ ...p, q: detail.invoice?.invoice?.id ?? '' })); }}>
                        Payments
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 overflow-hidden">
                  <div className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Items</div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] table-fixed text-left border-collapse border border-outline-variant text-sm">
                      <thead>
                        <tr className="bg-surface-container-high">
                          <th className="px-3 py-2 border border-outline-variant">Item</th>
                          <th className="px-3 py-2 border border-outline-variant w-[100px]">Qty</th>
                          <th className="px-3 py-2 border border-outline-variant w-[80px]">Unit</th>
                          <th className="px-3 py-2 border border-outline-variant w-[100px]">Rate</th>
                          <th className="px-3 py-2 border border-outline-variant w-[100px]">GST %</th>
                          <th className="px-3 py-2 border border-outline-variant w-[120px]">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.invoice?.items ?? []).map((it: any) => (
                          <tr key={it.id}>
                            <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{it.item ?? '-'}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.quantity ?? 0)}</td>
                            <td className="px-3 py-2 border border-outline-variant">{it.unit ?? '-'}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.rate ?? 0)}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.taxPercent ?? 0)}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.totalAmount ?? 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 overflow-hidden">
                  <div className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Payments</div>
                  <div className="overflow-x-auto">
	                    <table className="w-full min-w-[720px] table-fixed text-left border-collapse border border-outline-variant text-sm">
	                      <thead>
	                        <tr className="bg-surface-container-high">
	                          <th className="px-3 py-2 border border-outline-variant">Payment</th>
	                          <th className="px-3 py-2 border border-outline-variant">Date</th>
	                          <th className="px-3 py-2 border border-outline-variant">Amount</th>
	                          <th className="px-3 py-2 border border-outline-variant">Mode</th>
	                          <th className="px-3 py-2 border border-outline-variant">Ref</th>
	                        </tr>
	                      </thead>
	                      <tbody>
	                        {(detail.payments ?? []).map((p: any) => (
	                          <tr
	                            key={p.id}
	                            className="hover:bg-surface-container-high/40 cursor-pointer"
	                            onClick={() => pushDetail({ tab: 'payments', id: String(p.id ?? ''), title: String(p.id ?? 'Payment') })}
	                          >
	                            <td className="px-3 py-2 border border-outline-variant text-primary font-semibold">{p.id ?? '-'}</td>
	                            <td className="px-3 py-2 border border-outline-variant">{formatDateShort(p.paymentDate)}</td>
	                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(p.amount ?? 0).toFixed(2)}</td>
	                            <td className="px-3 py-2 border border-outline-variant">{p.mode ?? '-'}</td>
	                            <td className="px-3 py-2 border border-outline-variant">{p.referenceNo ?? '-'}</td>
	                          </tr>
	                        ))}
	                      </tbody>
	                    </table>
                  </div>
                </div>
              </>
            ) : null}
	            {detailTab === 'payments' ? (
	              <div className="space-y-3">
	                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
		                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
		                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Payment</div>
		                    <div className="mt-1 font-semibold text-on-surface">{detail.payment?.paymentId ?? '-'}</div>
		                    <div className="mt-1 text-on-surface-variant">Date: {formatDateShort(detail.payment?.paymentDate ?? '')}</div>
		                    <div className="mt-1 text-on-surface-variant">Amount: {Number(detail.payment?.amount ?? 0).toFixed(2)}</div>
		                    <div className="mt-1 text-on-surface-variant">Status: {detail.payment?.status ?? '-'}</div>
		                    <div className="mt-1 text-on-surface-variant">Mode: {detail.payment?.mode ?? '-'}</div>
	                    <div className="mt-1 text-on-surface-variant">Ref: {detail.payment?.referenceNo ?? '-'}</div>
	                  </div>
	                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
	                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Linked</div>
	                    <div className="mt-1 text-on-surface-variant">Invoice: {detail.invoice?.invoice?.supplierInvoiceNo ?? detail.payment?.invoiceNo ?? '-'}</div>
	                    <div className="mt-1 text-on-surface-variant">PO: {detail.po?.po?.id ?? detail.payment?.poNumber ?? '-'}</div>
	                    <div className="mt-1 text-on-surface-variant">PR: {detail.pr?.pr?.id ?? detail.payment?.prNumber ?? '-'}</div>
	                  </div>
	                  <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 text-sm">
	                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Open In Operations</div>
	                    <div className="mt-2 flex flex-wrap gap-2">
	                      {detail.pr?.pr?.id ? (
	                        <button type="button" className="btn btn-sm" onClick={() => pushDetail({ tab: 'prs', id: String(detail.pr.pr.id), title: String(detail.pr.pr.id) })}>
	                          PR
	                        </button>
	                      ) : null}
	                      {detail.po?.po?.id ? (
	                        <button type="button" className="btn btn-sm" onClick={() => pushDetail({ tab: 'pos', id: String(detail.po.po.id), title: String(detail.po.po.id) })}>
	                          PO
	                        </button>
	                      ) : null}
	                      {detail.invoice?.invoice?.id ? (
	                        <button
	                          type="button"
	                          className="btn btn-sm"
	                          onClick={() =>
	                            pushDetail({
	                              tab: 'invoices',
	                              id: String(detail.invoice.invoice.id),
	                              title: String(detail.invoice.invoice.supplierInvoiceNo ?? detail.invoice.invoice.id),
	                            })
	                          }
	                        >
	                          Invoice
	                        </button>
	                      ) : null}
	                    </div>
	                  </div>
	                </div>

	                <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 overflow-hidden">
	                  <div className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Invoice Items</div>
	                  <div className="overflow-x-auto">
	                    <table className="w-full min-w-[820px] table-fixed text-left border-collapse border border-outline-variant text-sm">
	                      <thead>
	                        <tr className="bg-surface-container-high">
	                          <th className="px-3 py-2 border border-outline-variant">Item</th>
	                          <th className="px-3 py-2 border border-outline-variant">Qty</th>
	                          <th className="px-3 py-2 border border-outline-variant">Rate</th>
	                        </tr>
	                      </thead>
	                      <tbody>
	                        {(detail.invoice?.items ?? []).length ? (
	                          (detail.invoice?.items ?? []).map((it: any) => (
	                            <tr key={String(it.id)}>
	                              <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{it.item ?? '-'}</td>
	                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.quantity ?? 0)}</td>
	                              <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.rate ?? 0)}</td>
	                            </tr>
	                          ))
	                        ) : (
	                          <tr>
	                            <td colSpan={3} className="px-3 py-3 border border-outline-variant text-on-surface-variant">
	                              None
	                            </td>
	                          </tr>
	                        )}
	                      </tbody>
	                    </table>
	                  </div>
	                </div>
	              </div>
	            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
