import React, { useEffect, useMemo, useState } from 'react';
import Pagination from '@/src/components/common/Pagination';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import { cn } from '@/src/lib/utils';
import { formatPrNumber } from '@/src/lib/docNumbers';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { downloadTextFile, toCsv } from '@/src/lib/csvFile';
import {
			  fetchOperationsGrnDetail,
			  fetchOperationsGrns,
			  fetchOperationsInvoiceDetail,
	  fetchOperationsInvoices,
	  fetchOperationsPaymentDetail,
	  fetchOperationsPayments,
	  fetchOperationsPoDetail,
	  fetchOperationsPos,
	  fetchOperationsPrDetail,
	  fetchOperationsPrs,
	  type OperationsFilters,
	  type OperationsGrnListRow,
	  type OperationsInvoiceListRow,
	  type OperationsPaymentListRow,
	  type OperationsPoListRow,
  type OperationsPrListRow,
} from '@/src/lib/operations';
import { inputClass, labelClass, Modal, useQueueMasters } from './queues/shared';

type OpsTab = 'prs' | 'pos' | 'grns' | 'invoices' | 'payments';

const TAB_LABEL: Record<OpsTab, string> = {
  prs: 'Purchase Requisitions',
  pos: 'Purchase Orders',
  grns: 'GRN',
  invoices: 'Invoices',
  payments: 'Payments',
};

function formatDateShort(s: string) {
  const t = String(s ?? '').trim();
  if (!t) return '-';
  return formatDateDDMMYYYYOnly(t) || '-';
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
  const masters = useQueueMasters({ includeSuppliers: true });
  const [tab, setTab] = useState<OpsTab>(initialTab);

  useEffect(() => {
    setTab(initialTab);
    setDetailOpen(false);
  }, [initialTab]);

  const [filters, setFilters] = useState<OperationsFilters>({
    q: '',
    firmId: '',
    projectId: '',
    supplierId: '',
    status: '',
    from: '',
    to: '',
  });

	  const statusOptions = useMemo(() => {
	    if (tab === 'prs') return ['', 'Pending Approval', 'Approved', 'Rejected'];
	    if (tab === 'pos') return ['', 'Open', 'Partial', 'Closed'];
	    if (tab === 'invoices') return ['', 'Recorded', 'On Hold', 'Approved', 'Paid'];
	    if (tab === 'payments') return ['', 'Full Paid', 'Partly Paid'];
	    return [''];
	  }, [tab]);

	  useEffect(() => {
	    if (tab !== 'payments') return;
	    setFilters((p) => {
	      const cur = String(p.status ?? '').trim();
	      return cur ? p : { ...p, status: 'Full Paid' };
	    });
	  }, [tab]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

	  const [prs, setPrs] = useState<OperationsPrListRow[]>([]);
	  const [pos, setPos] = useState<OperationsPoListRow[]>([]);
	  const [grns, setGrns] = useState<OperationsGrnListRow[]>([]);
	  const [invoices, setInvoices] = useState<OperationsInvoiceListRow[]>([]);
	  const [payments, setPayments] = useState<OperationsPaymentListRow[]>([]);

	  type SortDir = 'asc' | 'desc';
	  const defaultSortKey = useMemo(() => {
	    if (tab === 'prs') return 'requisitionDate';
	    if (tab === 'pos') return 'createdAt';
	    if (tab === 'grns') return 'createdAt';
	    if (tab === 'invoices') return 'createdAt';
	    return 'createdAt';
	  }, [tab]);
	  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: defaultSortKey, dir: 'desc' });
	  useEffect(() => {
	    setSort({ key: defaultSortKey, dir: 'desc' });
	  }, [defaultSortKey]);

	  const sortedRows = useMemo(() => {
	    const list: any[] = tab === 'prs' ? prs : tab === 'pos' ? pos : tab === 'grns' ? grns : tab === 'invoices' ? invoices : payments;
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
	  }, [grns, invoices, payments, pos, prs, sort.dir, sort.key, tab]);

	  const rowsCount = sortedRows.length;

	  const pageSize = 20;
	  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [tab, filters.q, filters.firmId, filters.projectId, filters.supplierId, filters.status, filters.from, filters.to, sort.key, sort.dir]);

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
          : tab === 'grns'
            ? fetchOperationsGrns(filters, ac.signal).then(setGrns)
            : tab === 'invoices'
              ? fetchOperationsInvoices(filters, ac.signal).then(setInvoices)
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
  const projectOptions = useMemo(
    () => [{ value: '', label: 'All Projects' }, ...masters.projects.map((p) => ({ value: p.id, label: p.name }))],
    [masters.projects]
  );
  const supplierOptions = useMemo(
    () => [{ value: '', label: 'All Suppliers' }, ...masters.suppliers.map((s) => ({ value: s.id, label: s.name }))],
    [masters.suppliers]
  );

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
		    // PO rows can optionally open the Purchase Request detail screen (so user sees Existing POs grid).
		    if (tab === 'pos' && typeof onViewPr === 'function') {
		      const prId = String(row?.prId ?? '').trim();
		      if (prId) {
		        onViewPr(prId, { scrollTo: 'existingPos', view: 'existingPosOnly' });
		        return;
		      }
		    }
		    // GRN rows can optionally open PR view focused on Recorded GRNs.
		    if (tab === 'grns' && typeof onViewPr === 'function') {
		      const prId = String(row?.prId ?? '').trim();
		      if (prId) {
		        onViewPr(prId, { view: 'recordedGrnsOnly' });
		        return;
		      }
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
	    const arrow = active ? (sort.dir === 'asc' ? ' ^' : ' v') : '';
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
	        {(Object.keys(TAB_LABEL) as OpsTab[]).map((k) => (
	          <button
	            key={k}
	            type="button"
	            className={tab === k ? 'btn-danger btn-sm' : 'btn btn-sm'}
	            onClick={() => {
	              setTab(k);
	              setDetailOpen(false);
	            }}
	          >
            {TAB_LABEL[k]}
          </button>
        ))}
        <div className="flex-1" />
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
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <label className="space-y-1 md:col-span-2">
            <div className={labelClass}>Search</div>
            <input className={inputClass} value={filters.q ?? ''} onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))} placeholder="id / no / supplier / firm / project..." />
          </label>

          <label className="space-y-1">
            <div className={labelClass}>Firm</div>
            <SearchableSelect value={filters.firmId ?? ''} options={firmOptions} onChange={(v) => setFilters((p) => ({ ...p, firmId: v }))} />
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
          <table className="w-full min-w-[980px] table-fixed text-left border-collapse border border-outline-variant text-sm">
	            <thead>
	              <tr className="bg-primary text-on-primary">
		            {tab === 'prs' ? (
	                  <>
	                    <SortTh label="PR" colKey="prNumber" />
	                    <SortTh label="Firm" colKey="firmName" />
	                    <SortTh label="Dept" colKey="department" />
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
	                    <SortTh label="Supplier" colKey="supplierName" />
	                    <SortTh label="Order Date" colKey="orderDate" />
	                    <SortTh label="Status" colKey="status" />
		                    <SortTh label="Amount" colKey="totalAmount" />
		                    <th className="px-3 py-2 border border-outline-variant bg-primary text-on-primary">PO PDF</th>
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
	                ) : tab === 'invoices' ? (
	                  <>
	                    <SortTh label="Invoice" colKey="invoiceNo" />
	                    <SortTh label="PO" colKey="poNumber" />
	                    <SortTh label="Firm" colKey="firmName" />
	                    <SortTh label="Supplier" colKey="supplierName" />
	                    <SortTh label="Date" colKey="invoiceDate" />
	                    <SortTh label="Status" colKey="status" />
	                    <SortTh label="Amount" colKey="invoiceAmount" />
	                  </>
		                ) : (
		                  <>
		                    <SortTh label="Invoice" colKey="invoiceNo" />
		                    <SortTh label="PO" colKey="poNumber" />
		                    <SortTh label="Firm" colKey="firmName" />
		                    <SortTh label="Supplier" colKey="supplierName" />
		                    <SortTh label="Date" colKey="paymentDate" />
		                    <SortTh label="Amount" colKey="amount" />
		                    <SortTh label="Payment Status" colKey="status" />
		                  </>
		                )}
	              </tr>
	            </thead>
            <tbody>
	              {loading ? (
	                <tr>
	                  <td colSpan={tab === 'pos' ? 8 : 7} className="px-3 py-8 text-sm text-on-surface-variant border border-outline-variant">
	                    Loading...
	                  </td>
	                </tr>
	              ) : !paged.length ? (
	                <tr>
	                  <td colSpan={tab === 'pos' ? 8 : 7} className="px-3 py-8 text-sm text-on-surface-variant border border-outline-variant">
	                    No records.
	                  </td>
	                </tr>
	              ) : (
	                (paged as any[]).map((r) => (
	                  <tr
	                    key={
	                      tab === 'prs'
	                        ? String(r.prId)
	                        : tab === 'pos'
	                          ? String(r.poId)
	                          : tab === 'grns'
	                            ? String(r.grnId)
	                            : tab === 'invoices'
	                              ? String(r.invoiceId)
	                              : String(r.paymentId)
	                    }
	                    className="hover:bg-surface-container-high/40 cursor-pointer"
	                    onClick={() => openDetailForRow(r)}
	                  >
	                    {tab === 'prs' ? (
	                      <>
            <td className="px-3 py-2 border border-outline-variant text-primary font-semibold">{formatPrNumber(r.prNumber ?? r.prId)}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.firmName}</td>
                        <td className="px-3 py-2 border border-outline-variant">{r.department}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.projectName ?? '-'}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.requestedBy ?? '-'}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{formatDateShort(r.requisitionDate)}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.status}</td>
	                      </>
	                    ) : tab === 'pos' ? (
	                      <>
	                        <td className="px-3 py-2 border border-outline-variant text-primary font-semibold">{r.poNumber}</td>
	            <td className="px-3 py-2 border border-outline-variant">{formatPrNumber(r.prNumber ?? r.prId)}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.firmName}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.supplierName || '-'}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.orderDate ? formatDateShort(r.orderDate) : '-'}</td>
		                        <td className="px-3 py-2 border border-outline-variant">{r.status}</td>
		                        <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.totalAmount ?? 0).toFixed(2)}</td>
		                        <td className="px-3 py-2 border border-outline-variant">
		                          <button
		                            type="button"
		                            className="btn btn-sm"
		                            onClick={(e) => {
		                              e.stopPropagation();
		                              window.location.href = `/api/pos/${encodeURIComponent(String(r.poId ?? ''))}.pdf`;
		                            }}
		                          >
		                            PO PDF
		                          </button>
		                        </td>
		                      </>
	                    ) : tab === 'grns' ? (
                      <>
                        <td className="px-3 py-2 border border-outline-variant text-primary font-semibold">{r.grnNumber}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.poNumber}</td>
	            <td className="px-3 py-2 border border-outline-variant">{formatPrNumber(r.prNumber ?? r.prId)}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.firmName}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.supplierName || '-'}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{formatDateShort(r.receivedDate)}</td>
	                        <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.totalQty ?? 0)}</td>
	                      </>
	                    ) : tab === 'invoices' ? (
	                      <>
                        <td className="px-3 py-2 border border-outline-variant text-primary font-semibold">{r.invoiceNo}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.poNumber}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.firmName}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.supplierName || '-'}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{formatDateShort(r.invoiceDate)}</td>
	                        <td className="px-3 py-2 border border-outline-variant">{r.status}</td>
	                        <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(r.invoiceAmount ?? 0).toFixed(2)}</td>
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
		                      </>
		                    )}
                  </tr>
                ))
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
                    <table className="w-full min-w-[820px] table-fixed text-left border-collapse border border-outline-variant text-sm">
                      <thead>
                        <tr className="bg-primary text-on-primary">
                          <th className="px-3 py-2 border border-outline-variant">Item</th>
                          <th className="px-3 py-2 border border-outline-variant">Qty</th>
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
                    <table className="w-full min-w-[820px] table-fixed text-left border-collapse border border-outline-variant text-sm">
                      <thead>
                        <tr className="bg-surface-container-high">
                          <th className="px-3 py-2 border border-outline-variant">Item</th>
                          <th className="px-3 py-2 border border-outline-variant">Qty</th>
                          <th className="px-3 py-2 border border-outline-variant">Rate</th>
                          <th className="px-3 py-2 border border-outline-variant">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.po?.items ?? []).map((it: any, idx: number) => (
                          <tr key={`${idx}-${it.itemId}`}>
                            <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{it.item ?? '-'}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.quantity ?? 0)}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.rate ?? 0)}</td>
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
                    <table className="w-full min-w-[720px] table-fixed text-left border-collapse border border-outline-variant text-sm">
                      <thead>
                        <tr className="bg-surface-container-high">
                          <th className="px-3 py-2 border border-outline-variant">Item</th>
                          <th className="px-3 py-2 border border-outline-variant">Received Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.grn?.items ?? []).map((it: any) => (
                          <tr key={it.id}>
                            <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{it.item ?? '-'}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.quantityReceived ?? 0)}</td>
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
                    <table className="w-full min-w-[820px] table-fixed text-left border-collapse border border-outline-variant text-sm">
                      <thead>
                        <tr className="bg-surface-container-high">
                          <th className="px-3 py-2 border border-outline-variant">Item</th>
                          <th className="px-3 py-2 border border-outline-variant">Qty</th>
                          <th className="px-3 py-2 border border-outline-variant">Rate</th>
                          <th className="px-3 py-2 border border-outline-variant">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.invoice?.items ?? []).map((it: any) => (
                          <tr key={it.id}>
                            <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{it.item ?? '-'}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.quantity ?? 0)}</td>
                            <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.rate ?? 0)}</td>
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
	                            <td className="px-3 py-2 border border-outline-variant">{formatIsoDateShort(p.paymentDate)}</td>
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
