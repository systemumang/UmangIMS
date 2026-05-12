import React, { useEffect, useMemo, useState } from 'react';
import { Eye, FileText, Pencil, Trash2 } from 'lucide-react';
	import { clampPercentString, sanitizeDecimalInput, sanitizePercentInput } from '@/src/lib/numberInput';
		import SearchableSelect from '@/src/components/common/SearchableSelect';
			import Spinner from '@/src/components/common/Spinner';
import { inputClass, labelClass } from '@/src/components/views/queues/shared';
			import {
							  approvePr,
							  createGrnForPo,
							  createInvoice,
						  saveLogistics,
					  createPo,
					  updatePo,
					  updatePoCheckAndSent,
					  deletePo,
						  deleteGrn,
						  deleteInvoice,
						  fetchGrnInvoiceLinkSummary,
						  fetchGrnItemInvoiceLinkSummaryByPrId,
						  fetchGrnItemInvoiceLinks,
						  fetchInvoicesByPrId,
						  fetchFirms,
						  fetchLastSupplierByItemIds,
							  fetchPendingInvoiceItems,
							  fetchPendingGrnItems,
							  fetchGrnsByPrId,
							  fetchPendingGrnPosByPrId,
						  fetchQcRecordsByPrId,
						  fetchPos,
						  fetchWorkflow,
				  setGrnInvoiceLinks,
				  setGrnItemInvoiceLinks,
				  updateGrn,
				  recordQc,
				  updateQcForGrn,
				  deleteQcForGrn,
				  rejectPr,
				  statusPillClass,
				  updateInvoice,
				  updateInvoicePayment,
				  type Firm,
					  type GrnInvoiceLinkSummaryRow,
					  type GrnItemInvoiceLinkSummaryRow,
					  type GrnItemInvoiceLinkRow,
					  type PurchaseRequestItem,
					  type GrnWithItems,
					  type QcRecord,
				  type Po,
				  type PoItem,
						  type InvoiceWithItems,
						  type WorkflowSummary,
						  type LastSupplierInfoWithId,
				} from '@/src/lib/purchaseRequests';
	import { cn } from '@/src/lib/utils';
import { uploadFileToServer } from '@/src/lib/uploads';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { formatGrnNumber, formatPoNumber, formatPrNumber } from '@/src/lib/docNumbers';
import {
  fetchItems,
  fetchSpecificationValues,
  fetchSpecifications,
  fetchSuppliers,
  fetchTransporters,
  fetchUsers,
  type Item,
  type Specification,
  type SpecificationValue,
  type Supplier,
  type Transporter,
  type User,
} from '@/src/lib/masters';

type NumMap = Record<string, string>;
type TextMap = Record<string, string>;
type LinkedItemRow = {
  grnItemId: string;
  grnId: string;
  poId: string;
  itemId: string;
  itemLabel: string;
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  invoiceQty: number;
  linkedQty: number;
  acceptedQty: number;
};

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

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? '').trim());
}

function isShortHexLike(value: string) {
  return /^[0-9a-f]{6}$/i.test(String(value ?? '').trim());
}

function formatSpecsLines(
  specificationsJson: string,
  specNameById?: Record<string, string>,
  specValueTextById?: Record<string, string>
) {
  try {
    const obj = JSON.parse(specificationsJson) as Record<string, unknown>;
    const entries = Object.entries(obj);
    return entries
      .map(([k, v]) => {
        const rawKey = String(k ?? '').trim();
        const rawVal = typeof v === 'string' ? String(v ?? '').trim() : String(v ?? '').trim();
        const keyName = specNameById?.[rawKey] ?? (isUuidLike(rawKey) ? '' : rawKey);
        const valueText = specValueTextById?.[rawVal] ?? rawVal;

        // Hide raw ids entirely if we can't resolve them to human text.
        const safeValue = isUuidLike(valueText) ? '' : valueText;
        const safeKey = isUuidLike(keyName) ? '' : keyName;

        if (!safeKey && !safeValue) return '';
        if (!safeKey) return safeValue;
        if (!safeValue) return safeKey;
        return `${safeKey}: ${safeValue}`;
      })
      .map((s) => String(s ?? '').trim())
      .filter(Boolean);
  } catch {
    return String(specificationsJson ?? '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

function openDocument(url: string) {
  if (!url) return;
  const s = String(url).trim();
  if (s.startsWith('data:')) {
    try {
      const parts = s.split(';base64,');
      if (parts.length === 2) {
        const contentType = parts[0].split(':')[1] || 'application/octet-stream';
        const byteCharacters = atob(parts[1]);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: contentType });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
        return;
      }
    } catch (e) {
      console.error('Failed to open base64 document', e);
    }
  }
  window.open(s, '_blank');
}

function formatItemInline(
  itemName: string,
  specificationsJson: string,
  specNameById?: Record<string, string>,
  specValueTextById?: Record<string, string>
) {
  const specs = formatSpecsLines(specificationsJson, specNameById, specValueTextById);
  const base = String(itemName ?? '').trim();
  const cleaned = [base, ...specs]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    // if something still looks like an id, drop it
    .filter((s) => !(isUuidLike(s) || isShortHexLike(s)));
  return cleaned.join(' - ');
}

function formatItemWithSpecText(itemName: string, specification: string) {
  const base = String(itemName ?? '').trim();
  const specs = String(specification ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!specs.length) return base || '-';
  return [base, ...specs].filter(Boolean).join(' - ');
}

function renderSpecificationLines(specification: string) {
  const lines = String(specification ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) return <span className="text-on-surface">-</span>;
  return (
    <div className="space-y-1">
      {lines.map((l, i) => {
        const colon = l.indexOf(':');
        if (colon > 0) {
          const name = l.slice(0, colon).trim();
          const value = l.slice(colon + 1).trim();
          return (
            <div key={i} className="leading-snug">
              <span className="font-bold text-on-surface-variant">{name}:</span>{' '}
              <span className="text-on-surface">{value}</span>
            </div>
          );
        }
        return (
          <div key={i} className="leading-snug text-on-surface">
            {l}
          </div>
        );
      })}
    </div>
  );
}

function renderInlineWithBoldSpecNames(label: string) {
  const parts = String(label ?? '').split(' - ').filter(Boolean);
  return (
    <span className="whitespace-normal break-words leading-snug">
      {parts.map((p, i) => {
        const colon = p.indexOf(':');
        const piece =
          colon > 0 ? (
            <span>
              <span className="font-bold text-on-surface-variant">{p.slice(0, colon).trim()}:</span>{' '}
              <span className="text-on-surface">{p.slice(colon + 1).trim()}</span>
            </span>
          ) : (
            <span className="text-on-surface">{p}</span>
          );
        return (
          <React.Fragment key={`${i}-${p}`}>
            {i ? <span className="text-on-surface"> - </span> : null}
            {piece}
          </React.Fragment>
        );
      })}
    </span>
  );
}

function poRowDomId(poId: string) {
  const safe = String(poId ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_');
  return `po-row-${safe || 'unknown'}`;
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container-low rounded-xl p-4 border border-outline-variant space-y-3">
      {title ? <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">{title}</div> : null}
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
      <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">{label}</div>
      {children}
    </label>
  );
}

const tableInputClass =
		  'w-full h-10 bg-white border border-outline-variant rounded-lg px-3 py-2 text-base outline-none focus:ring-1 focus:ring-primary-container';

const compactTableInputClass =
  'w-full h-9 bg-white border border-outline-variant rounded-md px-2 py-1.5 text-base outline-none focus:ring-1 focus:ring-primary-container';

const compactSurfaceInputClass =
  'w-full h-9 bg-surface-container-lowest border border-outline-variant rounded-md px-2 py-1.5 text-base text-on-surface-variant placeholder:text-on-surface-variant outline-none focus:ring-1 focus:ring-outline-variant/15';
export default function PurchaseRequestDetailView({
  requestId,
  initialScrollTo = 'top',
  initialView = 'full',
  onBack,
}: {
  requestId: string | null;
  initialScrollTo?: 'top' | 'existingPos';
  initialView?: 'full' | 'existingPosOnly' | 'recordedGrnsOnly' | 'recordedInvoicesOnly';
  onBack: () => void;
}) {
		  const [workflow, setWorkflow] = useState<WorkflowSummary | null>(null);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [loading, setLoading] = useState(false);
		  const [busy, setBusy] = useState(false);
		  const [error, setError] = useState<string | null>(null);
		  const [lastSupplierByItemId, setLastSupplierByItemId] = useState<Record<string, LastSupplierInfoWithId>>({});

		  const existingPosOnly = initialView === 'existingPosOnly';
		  const recordedGrnsOnly = initialView === 'recordedGrnsOnly';
		  const recordedInvoicesOnly = initialView === 'recordedInvoicesOnly';

		  useEffect(() => {
		    try {
		      if (typeof window === 'undefined') return;
		      if (initialScrollTo === 'existingPos') {
		        const el = window.document.getElementById('existing-pos-section');
		        if (el) {
		          el.scrollIntoView({ behavior: 'auto', block: 'start' });
		          return;
		        }
		      }
		      if (!existingPosOnly) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
		    } catch {
		      // ignore
		    }
		  }, [requestId, initialScrollTo, existingPosOnly]);

		  const [approveByUserId, setApproveByUserId] = useState('');
	  const [rejectByUserId, setRejectByUserId] = useState('');
	  const [rejectReason, setRejectReason] = useState('');
	  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
	  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

					  const [users, setUsers] = useState<User[]>([]);
					  const [loadingUsers, setLoadingUsers] = useState(true);
					  const [masterItems, setMasterItems] = useState<Item[]>([]);
					  const [loadingMasterItems, setLoadingMasterItems] = useState(true);
					  const [specs, setSpecs] = useState<Specification[]>([]);
					  const [specValues, setSpecValues] = useState<SpecificationValue[]>([]);
					  const [loadingSpecs, setLoadingSpecs] = useState(true);
					  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
					  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
					  const [invoiceDetailsOpen, setInvoiceDetailsOpen] = useState(false);
				  const [invoiceDetailsMode, setInvoiceDetailsMode] = useState<'view' | 'edit'>('view');
				  const [activeInvoiceDetails, setActiveInvoiceDetails] = useState<InvoiceWithItems | null>(null);
				  const [invoiceDetailsError, setInvoiceDetailsError] = useState<string | null>(null);
				  const [editInvoiceNo, setEditInvoiceNo] = useState('');
				  const [editInvoiceDate, setEditInvoiceDate] = useState('');
					  const [editInvoiceAmount, setEditInvoiceAmount] = useState('');
						  const [editInvoiceCourierCharge, setEditInvoiceCourierCharge] = useState('');
						  const [editInvoicePackingCharge, setEditInvoicePackingCharge] = useState('');
						  const [editInvoiceLabourCharge, setEditInvoiceLabourCharge] = useState('');
						  const [editInvoiceOtherCharge, setEditInvoiceOtherCharge] = useState('');
						  const [editInvoiceChargesGstAmount, setEditInvoiceChargesGstAmount] = useState('');
						  const [editInvoiceLines, setEditInvoiceLines] = useState<Array<{ itemId: string; label: string; quantity: string; rate: string }>>([]);
					  const [grnDetailsOpen, setGrnDetailsOpen] = useState(false);
					  const [grnDetailsMode, setGrnDetailsMode] = useState<'view' | 'edit'>('view');
						  const [activeGrnDetails, setActiveGrnDetails] = useState<GrnWithItems | null>(null);
						  const [grnDetailsError, setGrnDetailsError] = useState<string | null>(null);
						  const [editGrnReceivedDate, setEditGrnReceivedDate] = useState('');
							  const [editGrnUpdatedBy, setEditGrnUpdatedBy] = useState('');
							  const [editGrnMaterialReceivedBy, setEditGrnMaterialReceivedBy] = useState('');
							  const [editGrnGoodsCollectedBy, setEditGrnGoodsCollectedBy] = useState('');

							  const [poDetailsOpen, setPoDetailsOpen] = useState(false);
							  const [activePoDetails, setActivePoDetails] = useState<{ po: Po; items: PoItem[] } | null>(null);
							  const [poDetailsError, setPoDetailsError] = useState<string | null>(null);
							  const [poDetailsSentDate, setPoDetailsSentDate] = useState('');
							  const [editPoSupplierId, setEditPoSupplierId] = useState('');
							  const [editPoPaymentTerms, setEditPoPaymentTerms] = useState('');
						  const [editPoLines, setEditPoLines] = useState<
						    Array<{ itemId: string; label: string; quantity: string; rate: string; discountPercent: string; taxPercent: string }>
						  >([]);
						  const [editPoShippingSameAsFirm, setEditPoShippingSameAsFirm] = useState(true);
						  const [editPoShippingAddress, setEditPoShippingAddress] = useState('');
						  const [editPoTermsConditions, setEditPoTermsConditions] = useState('');

					  const [qcDetailsOpen, setQcDetailsOpen] = useState(false);
					  const [qcDetailsMode, setQcDetailsMode] = useState<'view' | 'edit'>('view');
					  const [activeQcDetails, setActiveQcDetails] = useState<{ grnId: string; poId: string; qcBy: string; qcDate: string; updatedBy: string; items: QcRecord[] } | null>(
					    null
					  );
					  const [qcDetailsError, setQcDetailsError] = useState<string | null>(null);
					  const [editQcBy, setEditQcBy] = useState('');
					  const [editQcUpdatedBy, setEditQcUpdatedBy] = useState('');
					  const [editQcLocation, setEditQcLocation] = useState('Main Store');
					  const [editQcLines, setEditQcLines] = useState<
					    Array<{ itemId: string; label: string; accepted: string; rejected: string; remarks: string }>
					  >([]);
		  const [transporters, setTransporters] = useState<Transporter[]>([]);
		  const [loadingTransporters, setLoadingTransporters] = useState(true);

	const transporterOptions = useMemo(
	  () => transporters.map((t) => ({ value: t.id, label: t.name })),
	  [transporters]
	);

	const paymentStatusOptions = useMemo(
	  () => [
	    { value: 'Partly Paid', label: 'Partly Paid' },
	    { value: 'Full Paid', label: 'Full Paid' },
	  ],
		  []
	);
		  const [posList, setPosList] = useState<Array<{ po: Po; items: PoItem[] }>>([]);
		  const [loadingPos, setLoadingPos] = useState(true);
			  const [pendingCheckDateByPoId, setPendingCheckDateByPoId] = useState<Record<string, string>>({});
			  const [pendingCheckedByByPoId, setPendingCheckedByByPoId] = useState<Record<string, string>>({});
			  const [pendingSentDateByPoId, setPendingSentDateByPoId] = useState<Record<string, string>>({});
			  const [pendingSentByByPoId, setPendingSentByByPoId] = useState<Record<string, string>>({});

			  const poNumberById = useMemo(() => {
			    const map = new Map<string, string>();
			    for (const p of posList ?? []) {
			      const poId = String(p?.po?.id ?? '').trim();
			      if (!poId) continue;
			      const poNumber = String(p?.po?.poNumber ?? '').trim();
			      map.set(poId, poNumber);
			    }
			    return map;
			  }, [posList]);

			  function displayPoNumberById(poId: string) {
			    const n = poNumberById.get(String(poId ?? '').trim()) ?? '';
			    return formatPoNumber(n) || '-';
			  }

			  function displayGrnNumber(grn: any) {
			    const n = String(grn?.grnNumber ?? '').trim();
			    return formatGrnNumber(n) || '-';
			  }

		  const sentPoIdSet = useMemo(() => {
		    const set = new Set<string>();
		    for (const p of posList) {
		      const sentBy = String(p.po.sentBy ?? '').trim();
		      if (sentBy) set.add(p.po.id);
		    }
		    return set;
		  }, [posList]);

		  const [poSupplierByItemId, setPoSupplierByItemId] = useState<TextMap>({});
		  const [poPaymentTermsByItemId, setPoPaymentTermsByItemId] = useState<TextMap>({});
		  const [poQty, setPoQty] = useState<NumMap>({});
		  const [poQtyTouched, setPoQtyTouched] = useState<Record<string, boolean>>({});
		  const [poRatesTouched, setPoRatesTouched] = useState<Record<string, boolean>>({});
		  const [poSupplierTouched, setPoSupplierTouched] = useState<Record<string, boolean>>({});
		  const [poRates, setPoRates] = useState<NumMap>({});
		  const [poDiscounts, setPoDiscounts] = useState<NumMap>({});
		  const [poTaxes, setPoTaxes] = useState<NumMap>({});
		  const [poDiscountsTouched, setPoDiscountsTouched] = useState<Record<string, boolean>>({});
		  const [poTaxesTouched, setPoTaxesTouched] = useState<Record<string, boolean>>({});

			  const [poShippingSameAsFirmByGroup, setPoShippingSameAsFirmByGroup] = useState<Record<string, boolean>>({});
			  const [poShippingAddressByGroup, setPoShippingAddressByGroup] = useState<TextMap>({});
			  const [poTermsConditionsByGroup, setPoTermsConditionsByGroup] = useState<TextMap>({});

				  const masterItemById = useMemo(() => {
				    const m = new Map<string, Item>();
				    for (const it of masterItems) m.set(String(it.id ?? '').trim(), it);
				    return m;
				  }, [masterItems]);

				  const specNameById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);
				  const specValueTextById = useMemo(
				    () => Object.fromEntries(specValues.map((v) => [v.id, v.value])),
				    [specValues]
				  );

				  const masterItemOptions = useMemo(
				    () =>
				      masterItems.map((it) => ({
				        value: it.id,
				        label: formatItemInline(it.itemName, it.specificationsJson, specNameById, specValueTextById),
				      })),
				    [masterItems, specNameById, specValueTextById]
				  );

					const [invoiceNo, setInvoiceNo] = useState('');
					const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
						const [invoiceCourierCharge, setInvoiceCourierCharge] = useState('');
						const [invoicePackingCharge, setInvoicePackingCharge] = useState('');
						const [invoiceLabourCharge, setInvoiceLabourCharge] = useState('');
						const [invoiceOtherCharge, setInvoiceOtherCharge] = useState('');
						const [invoiceChargesGstAmount, setInvoiceChargesGstAmount] = useState('');
					const [invoicePdf, setInvoicePdf] = useState('');
					const [invoicePdfFileName, setInvoicePdfFileName] = useState('');
		const [ewayBillNumber, setEwayBillNumber] = useState('');
		const [cnNumber, setCnNumber] = useState('');
		const [courierNumber, setCourierNumber] = useState('');
			const [invoiceTransporterId, setInvoiceTransporterId] = useState('');
			const [invoiceUpdatedBy, setInvoiceUpdatedBy] = useState('');
			const [invoiceCourierCopy, setInvoiceCourierCopy] = useState('');
			const [invoiceCourierCopyFileName, setInvoiceCourierCopyFileName] = useState('');
		const [invoiceFormError, setInvoiceFormError] = useState<string | null>(null);
			const [pendingInvoiceItems, setPendingInvoiceItems] = useState<Array<{ itemId: string; item: string; pendingQty: number; rate: number }>>([]);
			const [loadingPendingItems, setLoadingPendingItems] = useState(false);
			const [invoiceQty, setInvoiceQty] = useState<NumMap>({});
					const [invoiceRates, setInvoiceRates] = useState<NumMap>({});
					const [invoiceGstPct, setInvoiceGstPct] = useState<NumMap>({});
					const [selectedPoId, setSelectedPoId] = useState('');
					const [invoiceCreateOpen, setInvoiceCreateOpen] = useState(false);
					const [grnCreateOpen, setGrnCreateOpen] = useState(false);

						const computedInvoiceLinesTotalNumber = useMemo(() => {
						  let sum = 0;
						  const selectedPoItems =
						    posList.find((p) => p.po.id === selectedPoId)?.items ??
						    (workflow?.po?.po?.id === selectedPoId ? (workflow?.po?.items ?? []) : []);
						  for (const it of pendingInvoiceItems) {
						    const qty = Number(invoiceQty[it.itemId] ?? it.pendingQty);
						    const rate = Number(invoiceRates[it.itemId] ?? it.rate);
						    const poTaxPct = Number((selectedPoItems.find((x) => x.itemId === it.itemId) as any)?.taxPercent ?? 0);
						    const gstPct = Number(invoiceGstPct[it.itemId] ?? poTaxPct ?? 0);
						    if (!Number.isFinite(qty) || qty < 0) continue;
						    if (!Number.isFinite(rate) || rate < 0) continue;
						    const safeGstPct = Number.isFinite(gstPct) && gstPct >= 0 ? gstPct : 0;
						    const base = qty * rate;
						    const tax = base * (safeGstPct / 100);
						    sum += base + tax;
						  }
						  return sum;
						}, [invoiceGstPct, invoiceQty, invoiceRates, pendingInvoiceItems, posList, selectedPoId, workflow?.po?.items, workflow?.po?.po?.id]);

						const computedInvoiceExtraChargesNumber = useMemo(() => {
						  const courier = invoiceCourierCharge.trim() ? Number(invoiceCourierCharge) : 0;
						  const packing = invoicePackingCharge.trim() ? Number(invoicePackingCharge) : 0;
						  const labour = invoiceLabourCharge.trim() ? Number(invoiceLabourCharge) : 0;
						  const other = invoiceOtherCharge.trim() ? Number(invoiceOtherCharge) : 0;
						  const chargesGst = invoiceChargesGstAmount.trim() ? Number(invoiceChargesGstAmount) : 0;
						  return (
						    (Number.isFinite(courier) ? courier : 0) +
						    (Number.isFinite(packing) ? packing : 0) +
						    (Number.isFinite(labour) ? labour : 0) +
						    (Number.isFinite(other) ? other : 0) +
						    (Number.isFinite(chargesGst) ? chargesGst : 0)
						  );
						}, [invoiceChargesGstAmount, invoiceCourierCharge, invoiceLabourCharge, invoiceOtherCharge, invoicePackingCharge]);

						const computedInvoiceAmountNumber = useMemo(
						  () => computedInvoiceLinesTotalNumber + computedInvoiceExtraChargesNumber,
						  [computedInvoiceExtraChargesNumber, computedInvoiceLinesTotalNumber]
						);

		const computedInvoiceAmountText = useMemo(() => {
		  if (!Number.isFinite(computedInvoiceAmountNumber)) return '';
		  return computedInvoiceAmountNumber.toFixed(2);
		}, [computedInvoiceAmountNumber]);
			const [invoicesForPr, setInvoicesForPr] = useState<InvoiceWithItems[]>([]);
			const [paymentStatusByInvoiceId, setPaymentStatusByInvoiceId] = useState<Record<string, string>>({});
			const [paymentDateByInvoiceId, setPaymentDateByInvoiceId] = useState<Record<string, string>>({});
			const [linkedItemOrder, setLinkedItemOrder] = useState<string[]>([]);

			const [linkInvoiceId, setLinkInvoiceId] = useState('');
				const [linkSummaryRows, setLinkSummaryRows] = useState<GrnInvoiceLinkSummaryRow[]>([]);
				const [linkQtyByInvoiceItemId, setLinkQtyByInvoiceItemId] = useState<NumMap>({});
				const [loadingLinkSummary, setLoadingLinkSummary] = useState(false);
				const [linkLocalError, setLinkLocalError] = useState<string | null>(null);

			const [grnItemInvoiceLinkSummary, setGrnItemInvoiceLinkSummary] = useState<GrnItemInvoiceLinkSummaryRow[]>([]);
			const [grnItemLinkModalOpen, setGrnItemLinkModalOpen] = useState(false);
			const [grnItemLinkInvoiceIdFilter, setGrnItemLinkInvoiceIdFilter] = useState('');
			const [activeGrnItemLink, setActiveGrnItemLink] = useState<null | {
			  grnItemId: string;
			  grnId: string;
			  poId: string;
			  itemId: string;
			  itemLabel: string;
			  grnQty: number;
			}>(null);
			const [activeGrnItemInvoiceLinks, setActiveGrnItemInvoiceLinks] = useState<GrnItemInvoiceLinkRow[]>([]);
			const [loadingActiveGrnItemInvoiceLinks, setLoadingActiveGrnItemInvoiceLinks] = useState(false);
				const [grnItemLinkQtyByInvoiceItemId, setGrnItemLinkQtyByInvoiceItemId] = useState<NumMap>({});
				const [grnItemLinkSelectedInvoiceItemId, setGrnItemLinkSelectedInvoiceItemId] = useState('');
				const [grnItemLinkSelectedQty, setGrnItemLinkSelectedQty] = useState('');
				const [grnItemLinkLocalError, setGrnItemLinkLocalError] = useState<string | null>(null);
				const [selectedInvoiceIdByGrnItemId, setSelectedInvoiceIdByGrnItemId] = useState<Record<string, string>>({});
				const [linkQtyInputByGrnItemId, setLinkQtyInputByGrnItemId] = useState<Record<string, string>>({});

					  useEffect(() => {
					    if (!selectedPoId || !sentPoIdSet.has(selectedPoId)) {
					      setPendingInvoiceItems([]);
					      setInvoiceQty({});
					      setInvoiceRates({});
					      setLoadingPendingItems(false);
					      return;
					    }
					    const ac = new AbortController();
						    setInvoiceFormError(null);
						    setInvoiceCourierCharge('');
						    setInvoicePackingCharge('');
						    setInvoiceLabourCharge('');
						    setInvoiceOtherCharge('');
						    setInvoiceChargesGstAmount('');
						    setInvoicePdf('');
						    setInvoiceCourierCopy('');
						    setInvoiceGstPct({});
				    setLoadingPendingItems(true);
		    (async () => {
		      try {
		        const pending = await fetchPendingInvoiceItems(selectedPoId, ac.signal);
		        setPendingInvoiceItems(pending);
		        const qtyMap: NumMap = {};
		        const rateMap: NumMap = {};
		        const gstMap: NumMap = {};
		        pending.forEach((it) => {
		          qtyMap[it.itemId] = String(it.pendingQty);
		          rateMap[it.itemId] = String(it.rate);
		          const poLine = selectedPo?.items?.find((x) => x.itemId === it.itemId);
		          const gstPct = Number((poLine as any)?.taxPercent ?? 0);
		          gstMap[it.itemId] = Number.isFinite(gstPct) && gstPct >= 0 ? String(gstPct) : '0';
		        });
		        setInvoiceQty(qtyMap);
		        setInvoiceRates(rateMap);
		        setInvoiceGstPct(gstMap);
		      } catch (e) {
		        if (!isAbortError(e)) console.error('Failed to load pending invoice items', e);
		      } finally {
		        setLoadingPendingItems(false);
		      }
		    })();
		    return () => ac.abort();
		  }, [selectedPoId, invoicesForPr.length, sentPoIdSet]);

			  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
			  const [grnQty, setGrnQty] = useState<NumMap>({});
			  const [grnUpdatedBy, setGrnUpdatedBy] = useState('');
			  const [grnMaterialReceivedBy, setGrnMaterialReceivedBy] = useState('');
			  const [grnGoodsCollectedBy, setGrnGoodsCollectedBy] = useState('');
			  const [pendingGrnItems, setPendingGrnItems] = useState<Array<{ itemId: string; item: string; pendingQty: number; rate: number }>>([]);
			  const [loadingPendingGrnItems, setLoadingPendingGrnItems] = useState(false);
			  const [grnFormError, setGrnFormError] = useState<string | null>(null);
			  const [pendingGrnPos, setPendingGrnPos] = useState<Array<{ poId: string; pendingQty: number }>>([]);
			  const [loadingPendingGrnPos, setLoadingPendingGrnPos] = useState(false);
					  const [recordedGrns, setRecordedGrns] = useState<GrnWithItems[]>([]);
					  const [loadingRecordedGrns, setLoadingRecordedGrns] = useState(false);
					  const [qcRecords, setQcRecords] = useState<QcRecord[]>([]);
					  const [loadingQcRecords, setLoadingQcRecords] = useState(false);
					  const grnNumberById = useMemo(() => {
					    const map = new Map<string, string>();
					    for (const g of recordedGrns ?? []) {
					      const grnId = String((g as any)?.grn?.id ?? '').trim();
					      if (!grnId) continue;
					      const grnNumber = String((g as any)?.grn?.grnNumber ?? '').trim();
					      map.set(grnId, grnNumber);
					    }
					    return map;
					  }, [recordedGrns]);

					  function displayGrnNumberById(grnId: string) {
					    const n = grnNumberById.get(String(grnId ?? '').trim()) ?? '';
					    return formatGrnNumber(n) || '-';
					  }
					  const [qcReloadKey, setQcReloadKey] = useState(0);
					  const [selectedQcGrnId, setSelectedQcGrnId] = useState('');

			  useEffect(() => {
			    if (!requestId) {
			      setPendingGrnPos([]);
			      return;
			    }
			    const ac = new AbortController();
			    setLoadingPendingGrnPos(true);
			    (async () => {
			      try {
			        const rows = await fetchPendingGrnPosByPrId(requestId, ac.signal);
			        setPendingGrnPos(rows);
			      } catch (e) {
			        if (!isAbortError(e)) console.error('Failed to load pending GRN POs', e);
			      } finally {
			        setLoadingPendingGrnPos(false);
			      }
				    })();
				    return () => ac.abort();
				  }, [requestId, workflow?.grn?.grn?.id, qcReloadKey]);

				  useEffect(() => {
				    const eligible = pendingGrnPos.filter((p) => sentPoIdSet.has(p.poId));
				    if (!eligible.length) return;
				    if (!selectedPoId || !eligible.some((p) => p.poId === selectedPoId)) {
				      setSelectedPoId(eligible[0]!.poId);
				    }
				  }, [pendingGrnPos, selectedPoId, sentPoIdSet]);

				  useEffect(() => {
				    if (!selectedPoId || !sentPoIdSet.has(selectedPoId)) {
				      setPendingGrnItems([]);
				      setLoadingPendingGrnItems(false);
				      return;
				    }
				    const ac = new AbortController();
				    setGrnFormError(null);
			    setLoadingPendingGrnItems(true);
		    (async () => {
	      try {
	        const pending = await fetchPendingGrnItems(selectedPoId, ac.signal);
	        setPendingGrnItems(pending);
	        setGrnQty((prev) => {
	          const next: NumMap = {};
	          pending.forEach((it) => {
	            const existing = prev[it.itemId];
	            next[it.itemId] = existing != null && String(existing).trim() !== '' ? existing : String(it.pendingQty);
	          });
	          return next;
	        });
	      } catch (e) {
	        if (!isAbortError(e)) console.error('Failed to load pending GRN items', e);
	      } finally {
	        setLoadingPendingGrnItems(false);
	      }
		    })();
		    return () => ac.abort();
		  }, [selectedPoId, workflow?.grn?.grn?.id]);

			  useEffect(() => {
			    if (!requestId) {
			      setRecordedGrns([]);
			      return;
			    }
		    const ac = new AbortController();
		    setLoadingRecordedGrns(true);
		    (async () => {
		      try {
		        const grns = await fetchGrnsByPrId(requestId, ac.signal);
		        setRecordedGrns(grns);
		      } catch (e) {
		        if (!isAbortError(e)) console.error('Failed to load GRNs', e);
		      } finally {
		        setLoadingRecordedGrns(false);
		      }
		    })();
		    return () => ac.abort();
			  }, [requestId, workflow?.grn?.grn?.id]);

			  useEffect(() => {
			    if (!requestId) {
			      setQcRecords([]);
			      return;
			    }
			    const ac = new AbortController();
			    setLoadingQcRecords(true);
			    (async () => {
			      try {
			        const rows = await fetchQcRecordsByPrId(requestId, ac.signal);
			        setQcRecords(rows);
			      } catch (e) {
			        if (!isAbortError(e)) console.error('Failed to load QC records', e);
			      } finally {
			        setLoadingQcRecords(false);
			      }
			    })();
			    return () => ac.abort();
			  }, [requestId, workflow?.grn?.grn?.id]);

		  const [qcInspectedBy, setQcInspectedBy] = useState('');
	  const [location, setLocation] = useState('Main Store');
	  const [qcUpdatedBy, setQcUpdatedBy] = useState('');
	  const [qcAccepted, setQcAccepted] = useState<NumMap>({});
	  const [qcRejected, setQcRejected] = useState<NumMap>({});
	  const [qcRemarks, setQcRemarks] = useState<TextMap>({});

		  useEffect(() => {
		    if (!users.length) return;
		    if (!qcInspectedBy) setQcInspectedBy(users[0]!.id);
		    if (!qcUpdatedBy) setQcUpdatedBy(users[0]!.id);
		  }, [qcInspectedBy, qcUpdatedBy, users]);

			  const pr = workflow?.pr.pr;
			  const prItems = workflow?.pr.items ?? [];
			  const isDirectPoRequest = String(pr?.department ?? '').trim().toLowerCase() === 'direct po';
			  const showApprovedPrItemSummaryCols = pr?.status === 'Approved';
		  const [draftPrItems, setDraftPrItems] = useState<PurchaseRequestItem[]>([]);

		  useEffect(() => {
		    if (!pr) {
		      setDraftPrItems([]);
	      return;
	    }
	    if (pr.status !== 'Pending Approval') {
	      setDraftPrItems(prItems);
	      return;
	    }
		    // Reset draft when switching PRs or when server items change.
		    setDraftPrItems(prItems);
		  }, [pr?.id, pr?.status, prItems]);

		  const po = workflow?.po?.po;
		  const poItems = workflow?.po?.items ?? [];

		  const totalPoQtyByItemId = useMemo(() => {
		    const map: Record<string, number> = {};
		    const all: Array<{ po: Po; items: PoItem[] }> = posList.slice();
		    if (po && poItems?.length && !all.some((p) => p.po.id === po.id)) all.push({ po, items: poItems });
		    for (const p of all) {
		      for (const it of p.items ?? []) {
		        const itemId = String((it as any)?.itemId ?? '').trim();
		        if (!itemId) continue;
		        map[itemId] = (map[itemId] ?? 0) + Number((it as any)?.quantity ?? 0);
		      }
		    }
		    return map;
		  }, [posList, po, poItems]);

		  const totalInvoiceQtyByItemId = useMemo(() => {
		    const map: Record<string, number> = {};
		    for (const inv of invoicesForPr) {
		      for (const it of inv.items ?? []) {
		        const itemId = String((it as any)?.itemId ?? '').trim();
		        if (!itemId) continue;
		        map[itemId] = (map[itemId] ?? 0) + Number((it as any)?.quantity ?? 0);
		      }
		    }
		    return map;
		  }, [invoicesForPr]);

		  const totalGrnQtyByItemId = useMemo(() => {
		    const map: Record<string, number> = {};
		    for (const g of recordedGrns) {
		      for (const it of g.items ?? []) {
		        const itemId = String((it as any)?.itemId ?? '').trim();
		        if (!itemId) continue;
		        map[itemId] = (map[itemId] ?? 0) + Number((it as any)?.quantityReceived ?? 0);
		      }
		    }
		    return map;
		  }, [recordedGrns]);

		  const totalApprovedQtyByItemId = useMemo(() => {
		    const map: Record<string, number> = {};
		    for (const r of qcRecords) {
		      const itemId = String((r as any)?.itemId ?? '').trim();
		      if (!itemId) continue;
		      map[itemId] = (map[itemId] ?? 0) + Number((r as any)?.acceptedQty ?? 0);
		    }
		    return map;
		  }, [qcRecords]);

		  const totalRejectedQtyByItemId = useMemo(() => {
		    const map: Record<string, number> = {};
		    for (const r of qcRecords) {
		      const itemId = String((r as any)?.itemId ?? '').trim();
		      if (!itemId) continue;
		      map[itemId] = (map[itemId] ?? 0) + Number((r as any)?.rejectedQty ?? 0);
		    }
		    return map;
		  }, [qcRecords]);
				  const selectedPo = useMemo(
				    () => posList.find((p) => p.po.id === selectedPoId) ?? (po ? { po, items: poItems } : undefined),
				    [posList, selectedPoId, po, poItems]
				  );

			  const pendingPoForChecking = useMemo(() => {
			    return posList.filter((p) => !String(p.po.checkPoUserId ?? '').trim() && !Boolean(p.po.checkPo));
			  }, [posList]);

			  const pendingPoForSending = useMemo(() => {
			    return posList.filter(
			      (p) => (String(p.po.checkPoUserId ?? '').trim() || Boolean(p.po.checkPo)) && !String(p.po.sentBy ?? '').trim()
			    );
			  }, [posList]);

				  const prItemByItemId = useMemo(() => {
				    const map = new Map<string, { item: string; specification: string }>();
				    for (const r of prItems) {
			      const id = String(r.itemId ?? '').trim();
			      if (!id) continue;
			      map.set(id, { item: String(r.item ?? ''), specification: String(r.specification ?? '') });
			    }
			    return map;
			  }, [prItems]);

				  const formatPoItemLabel = (itemId: string, fallbackItem: string) => {
				    const prRow = prItemByItemId.get(itemId);
				    const itemName = (prRow?.item || fallbackItem || '').trim();
				    const specInline = (prRow?.specification || '')
				      .split(/\r?\n/)
				      .map((s) => s.trim())
				      .filter(Boolean)
				      .join(' - ');
				    if (specInline) return [itemName, specInline].filter(Boolean).join(' - ') || '-';

				    // Fallback to PO line specs (covers Direct PO where PR items may be empty).
				    const poLine =
				      posList.flatMap((p) => (Array.isArray(p.items) ? p.items : [])).find((x) => String((x as any)?.itemId ?? '').trim() === itemId) ??
				      selectedPo?.items?.find((x) => String((x as any)?.itemId ?? '').trim() === itemId);
				    const poSpecs =
				      poLine && (poLine as any)?.specificationsJson
				        ? formatSpecsLines(String((poLine as any).specificationsJson), specNameById).join(' - ').trim()
				        : '';
				    return [itemName, poSpecs || null].filter(Boolean).join(' - ') || '-';
				  };

					  const scrollToPo = (poId: string) => {
					    const el = document.getElementById(poRowDomId(poId));
					    if (!el) return;
					    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
				  };

				  const userNameById = useMemo(() => {
				    const map = new Map<string, string>();
				    for (const u of users) map.set(String(u.id ?? '').trim(), String(u.name ?? '').trim());
				    return map;
				  }, [users]);

	  const poRateByPoIdItemId = useMemo(() => {
	    const map: Record<string, number> = {};
	    const all: Array<{ po: Po; items: PoItem[] }> = posList.slice();
	    if (po && poItems?.length && !all.some((p) => p.po.id === po.id)) all.push({ po, items: poItems });
	    for (const p of all) {
	      for (const it of p.items ?? []) {
	        const itemId = String((it as any)?.itemId ?? '').trim();
	        if (!itemId) continue;
	        map[`${p.po.id}||${itemId}`] = Number((it as any)?.rate ?? 0);
	      }
	    }
	    return map;
	  }, [posList, po, poItems]);
  const invoice = workflow?.invoice?.invoice;
	  const invoiceItems = workflow?.invoice?.items ?? [];
	  const grn = workflow?.grn?.grn;
		  const grnItems = workflow?.grn?.items ?? [];
		  const qc = workflow?.qc ?? [];

						  const pendingGrnPoOptions = useMemo(() => {
							    return pendingGrnPos
							      .filter((p) => sentPoIdSet.has(p.poId))
	    .map((p) => ({ value: p.poId, label: displayPoNumberById(p.poId) }));
							  }, [pendingGrnPos, sentPoIdSet]);

			  const showGrnCreateFields = pendingGrnPoOptions.length > 0;

		  const qcByGrnId = useMemo(() => {
		    const map = new Map<string, QcRecord[]>();
		    for (const r of qcRecords) {
		      const grnId = String(r.grnId ?? '').trim();
		      if (!grnId) continue;
		      const list = map.get(grnId) ?? [];
		      list.push(r);
		      map.set(grnId, list);
		    }
		    return map;
		  }, [qcRecords]);

		  const pendingQcGrns = useMemo(() => {
		    if (!recordedGrns.length) return [];
		    const qcGrnIds = new Set<string>(Array.from(qcByGrnId.keys()));
		    return recordedGrns.filter((g) => !qcGrnIds.has(g.grn.id));
		  }, [qcByGrnId, recordedGrns]);

		  const pendingQcGrnOptions = useMemo(() => {
    return pendingQcGrns.map((g) => ({ value: g.grn.id, label: displayGrnNumber(g.grn) }));
		  }, [pendingQcGrns]);

		  const activePendingQcGrn = useMemo(() => {
		    if (!selectedQcGrnId) return pendingQcGrns[0] ?? null;
		    return pendingQcGrns.find((g) => g.grn.id === selectedQcGrnId) ?? pendingQcGrns[0] ?? null;
		  }, [pendingQcGrns, selectedQcGrnId]);

		  useEffect(() => {
		    const next = pendingQcGrns[0]?.grn?.id ?? '';
		    if (!next) {
		      if (selectedQcGrnId) setSelectedQcGrnId('');
		      return;
		    }
		    if (!selectedQcGrnId || !pendingQcGrns.some((g) => g.grn.id === selectedQcGrnId)) setSelectedQcGrnId(next);
		  }, [pendingQcGrns, selectedQcGrnId]);

		  useEffect(() => {
		    const g = activePendingQcGrn;
		    if (!g) return;
		    const nextAcc: NumMap = {};
		    const nextRej: NumMap = {};
		    const nextRem: TextMap = {};
		    for (const it of g.items ?? []) {
		      nextAcc[it.itemId] = String(it.quantityReceived);
		      nextRej[it.itemId] = '0';
		      nextRem[it.itemId] = '';
		    }
		    setQcAccepted(nextAcc);
		    setQcRejected(nextRej);
		    setQcRemarks(nextRem);
		  }, [activePendingQcGrn?.grn?.id]);

	  const invoiceQtyByItem = useMemo(() => {
	    const map: Record<string, number> = {};
	    for (const it of workflow?.invoice?.items ?? []) {
	      map[it.itemId] = (map[it.itemId] ?? 0) + Number(it.quantity ?? 0);
	    }
	    return map;
	  }, [workflow?.invoice?.items]);

				  const grnQtyByPoAndItemId = useMemo(() => {
				    const map: Record<string, number> = {};
				    for (const g of recordedGrns) {
			      const poId = String(g.grn.poId ?? '').trim();
			      if (!poId) continue;
			      for (const it of g.items ?? []) {
			        const key = `${poId}||${it.itemId}`;
			        map[key] = (map[key] ?? 0) + Number(it.quantityReceived ?? 0);
			      }
			    }
				    return map;
				  }, [recordedGrns]);

				  const pendingGrnPoRows = useMemo(() => {
				    const eligiblePoIdSet = new Set(pendingGrnPos.filter((p) => sentPoIdSet.has(p.poId)).map((p) => p.poId));
				    return posList
				      .filter((p) => eligiblePoIdSet.has(p.po.id))
				      .map((p) => {
				        const poId = p.po.id;
				        const poNumber = String((p.po as any)?.poNumber ?? (p as any)?.po?.poNumber ?? '').trim();
				        const lines = (p.items ?? [])
				          .map((it) => {
				            const itemId = String((it as any)?.itemId ?? '').trim();
				            if (!itemId) return null;
				            const ordered = Number((it as any)?.quantity ?? 0);
				            const received = Number(grnQtyByPoAndItemId[`${poId}||${itemId}`] ?? 0);
				            const pendingQty = Math.max(0, ordered - received);
				            return {
				              itemId,
				              poQty: ordered,
				              poRate: Number((it as any)?.rate ?? 0),
				              discountPercent: Number((it as any)?.discountPercent ?? 0),
				              taxPercent: Number((it as any)?.taxPercent ?? 0),
				              pendingGrnQty: pendingQty,
				            };
				          })
				          .filter(Boolean)
				          .filter((l) => Number.isFinite((l as any).pendingGrnQty) && (l as any).pendingGrnQty > 0) as Array<{
				          itemId: string;
				          poQty: number;
				          poRate: number;
				          discountPercent: number;
				          taxPercent: number;
				          pendingGrnQty: number;
				        }>;

				        const checkedById = String((p.po as any)?.checkPoUserId ?? '').trim();
				        const sentById = String((p.po as any)?.sentBy ?? '').trim();
				        const checkedByName = checkedById ? userNameById.get(checkedById) ?? checkedById : '';
				        const sentByName = sentById ? userNameById.get(sentById) ?? sentById : '';

				        return {
				          poId,
				          poNumber,
				          supplier: String((p.po as any)?.supplier ?? (p.po as any)?.supplierName ?? '').trim(),
				          paymentTerms: String((p.po as any)?.paymentTerms ?? '').trim(),
				          checkedBy: checkedByName,
				          sentBy: sentByName,
				          lines,
				        };
				      })
				      .filter((r) => Array.isArray(r.lines) && r.lines.length > 0);
				  }, [grnQtyByPoAndItemId, pendingGrnPos, posList, sentPoIdSet, userNameById]);

			  const grnQtyByGrnIdItemId = useMemo(() => {
			    const map: Record<string, number> = {};
			    for (const g of recordedGrns) {
			      const grnId = String(g.grn.id ?? '').trim();
			      if (!grnId) continue;
			      for (const it of g.items ?? []) {
			        const key = `${grnId}||${it.itemId}`;
			        map[key] = (map[key] ?? 0) + Number(it.quantityReceived ?? 0);
			      }
			    }
			    return map;
			  }, [recordedGrns]);

		  const qcAcceptedByPoAndItemId = useMemo(() => {
		    const map: Record<string, number> = {};
		    for (const r of qcRecords) {
		      const poId = String(r.poId ?? '').trim();
		      const itemId = String(r.itemId ?? '').trim();
		      if (!poId || !itemId) continue;
		      const key = `${poId}||${itemId}`;
		      map[key] = (map[key] ?? 0) + Number(r.acceptedQty ?? 0);
		    }
		    return map;
		  }, [qcRecords]);

		  const qcRejectedByPoAndItemId = useMemo(() => {
		    const map: Record<string, number> = {};
		    for (const r of qcRecords) {
		      const poId = String(r.poId ?? '').trim();
		      const itemId = String(r.itemId ?? '').trim();
		      if (!poId || !itemId) continue;
		      const key = `${poId}||${itemId}`;
		      map[key] = (map[key] ?? 0) + Number(r.rejectedQty ?? 0);
		    }
		    return map;
		  }, [qcRecords]);

		  const qcAcceptedByGrnIdItemId = useMemo(() => {
		    const map: Record<string, number> = {};
		    for (const r of qcRecords) {
		      const grnId = String(r.grnId ?? '').trim();
		      const itemId = String(r.itemId ?? '').trim();
		      if (!grnId || !itemId) continue;
		      const key = `${grnId}||${itemId}`;
		      map[key] = (map[key] ?? 0) + Number(r.acceptedQty ?? 0);
		    }
		    return map;
		  }, [qcRecords]);

		  const qcRejectedByGrnIdItemId = useMemo(() => {
		    const map: Record<string, number> = {};
		    for (const r of qcRecords) {
		      const grnId = String(r.grnId ?? '').trim();
		      const itemId = String(r.itemId ?? '').trim();
		      if (!grnId || !itemId) continue;
		      const key = `${grnId}||${itemId}`;
		      map[key] = (map[key] ?? 0) + Number(r.rejectedQty ?? 0);
		    }
		    return map;
		  }, [qcRecords]);

		  const invoicedQtyByPoAndItemId = useMemo(() => {
		    const map: Record<string, number> = {};
		    for (const inv of invoicesForPr) {
		      const poId = inv.invoice.poId;
		      for (const it of inv.items ?? []) {
		        const key = `${poId}||${it.itemId}`;
		        map[key] = (map[key] ?? 0) + Number(it.quantity ?? 0);
		      }
		    }
		    return map;
		  }, [invoicesForPr]);

			  const qcDonePoIds = useMemo(() => {
			    const set = new Set<string>();
			    for (const r of qcRecords) {
			      const poId = String((r as any)?.poId ?? '').trim();
			      if (poId) set.add(poId);
			    }
			    return set;
			  }, [qcRecords]);

			  const qcDoneGrnIds = useMemo(() => {
			    const set = new Set<string>();
			    for (const r of qcRecords) {
			      const grnId = String((r as any)?.grnId ?? '').trim();
			      if (grnId) set.add(grnId);
			    }
			    return set;
			  }, [qcRecords]);

		  const linkInvoiceOptions = useMemo(() => {
		    return invoicesForPr
		      .map((inv) => {
		        const invoiceId = String(inv.invoice.id ?? '').trim();
		        if (!invoiceId) return null;
		        const invoiceNo = String(inv.invoice.supplierInvoiceNo ?? inv.invoice.id ?? '').trim() || invoiceId;
		        const invoiceDate = String(inv.invoice.invoiceDate ?? '').trim();
		        const label = invoiceDate ? `${invoiceNo} (${formatDateDDMMYYYYOnly(invoiceDate)})` : invoiceNo;
		        return { value: invoiceId, label };
		      })
		      .filter(Boolean) as Array<{ value: string; label: string }>;
		  }, [invoicesForPr]);

		  useEffect(() => {
		    if (linkInvoiceId) return;
		    const first = linkInvoiceOptions[0]?.value;
		    if (first) setLinkInvoiceId(first);
		  }, [linkInvoiceId, linkInvoiceOptions]);

		  const selectedLinkInvoice = useMemo(() => {
		    const id = String(linkInvoiceId ?? '').trim();
		    if (!id) return null;
		    return invoicesForPr.find((inv) => String(inv.invoice.id ?? '').trim() === id) ?? null;
		  }, [invoicesForPr, linkInvoiceId]);

				  const linkEnabled = useMemo(() => {
				    const poId = String(selectedLinkInvoice?.invoice?.poId ?? '').trim();
				    if (!poId) return false;
				    return qcDonePoIds.has(poId);
				  }, [qcDonePoIds, selectedLinkInvoice]);

				  const linkQtyByGrnItemIdForSelectedInvoice = useMemo(() => {
				    const invoiceId = String(linkInvoiceId ?? '').trim();
				    const map = new Map<string, number>();
				    if (!invoiceId) return map;
				    for (const r of grnItemInvoiceLinkSummary) {
				      const grnItemId = String((r as any)?.grnItemId ?? '').trim();
				      const invId = String((r as any)?.invoiceId ?? '').trim();
				      if (!grnItemId || !invId) continue;
				      if (invId !== invoiceId) continue;
				      map.set(grnItemId, Number((r as any)?.linkedQty ?? 0));
				    }
				    return map;
				  }, [grnItemInvoiceLinkSummary, linkInvoiceId]);

				  const invQtyByItemIdForSelectedInvoice = useMemo(() => {
				    const map = new Map<string, number>();
				    const inv = selectedLinkInvoice;
				    if (!inv) return map;
				    for (const it of inv.items ?? []) {
				      const itemId = String((it as any)?.itemId ?? '').trim();
				      if (!itemId) continue;
				      map.set(itemId, (map.get(itemId) ?? 0) + Number((it as any)?.quantity ?? 0));
				    }
				    return map;
				  }, [selectedLinkInvoice]);

				  const grnInvoiceLinkRowsForSelectedInvoice = useMemo(() => {
				    const invoiceId = String(linkInvoiceId ?? '').trim();
				    const inv = selectedLinkInvoice;
				    const poId = String(inv?.invoice?.poId ?? '').trim();
				    if (!invoiceId || !inv || !poId) return [];

				    const rows: Array<{
				      grnItemId: string;
				      grnId: string;
				      poId: string;
				      itemId: string;
				      itemLabel: string;
				      grnQty: number;
				      invQty: number;
				      qcQty: number;
				      linkQty: number;
				      invoiceItemId: string;
				    }> = [];

				    const invoiceItemIdByItemId = new Map<string, string>();
				    for (const it of inv.items ?? []) {
				      const itemId = String((it as any)?.itemId ?? '').trim();
				      const invoiceItemId = String((it as any)?.id ?? '').trim();
				      if (!itemId || !invoiceItemId) continue;
				      if (!invoiceItemIdByItemId.has(itemId)) invoiceItemIdByItemId.set(itemId, invoiceItemId);
				    }

				    for (const g of recordedGrns) {
				      if (String((g as any)?.grn?.poId ?? '').trim() !== poId) continue;
				      const grnId = String((g as any)?.grn?.id ?? '').trim();
				      if (!grnId) continue;
				      for (const it of g.items ?? []) {
				        const grnItemId = String((it as any)?.id ?? '').trim();
				        const itemId = String((it as any)?.itemId ?? '').trim();
				        if (!grnItemId || !itemId) continue;
				        const invoiceItemId = invoiceItemIdByItemId.get(itemId) ?? '';
				        if (!invoiceItemId) continue;

				        const prRow = prItems.find((r) => r.itemId === itemId);
				        const specInline = String(prRow?.specification ?? '')
				          .split(/\r?\n/)
				          .map((s) => s.trim())
				          .filter(Boolean)
				          .join(' - ');
				        const itemLabel = [prRow?.item || (it as any)?.item, specInline || null].filter(Boolean).join(' - ');

				        const invQty = invQtyByItemIdForSelectedInvoice.get(itemId) ?? 0;
				        const qcQty = Number(qcAcceptedByGrnIdItemId[`${grnId}||${itemId}`] ?? 0);
				        const linkQty = linkQtyByGrnItemIdForSelectedInvoice.get(grnItemId) ?? 0;
				        const grnQty = Number((it as any)?.quantityReceived ?? 0);

				        rows.push({
				          grnItemId,
				          grnId,
				          poId,
				          itemId,
				          itemLabel: itemLabel || (it as any)?.item || itemId,
				          grnQty,
				          invQty,
				          qcQty,
				          linkQty,
				          invoiceItemId,
				        });
				      }
				    }

				    rows.sort((a, b) => a.grnId.localeCompare(b.grnId));
				    return rows;
				  }, [
				    invQtyByItemIdForSelectedInvoice,
				    linkInvoiceId,
				    linkQtyByGrnItemIdForSelectedInvoice,
				    prItems,
				    qcAcceptedByGrnIdItemId,
				    recordedGrns,
				    selectedLinkInvoice,
				  ]);

				  useEffect(() => {
				    if (!linkInvoiceId) {
				      setLinkSummaryRows([]);
				      setLinkQtyByInvoiceItemId({});
				      setLinkLocalError(null);
				      return;
				    }
				    const ac = new AbortController();
				    setLoadingLinkSummary(true);
				    setLinkLocalError(null);
				    fetchGrnInvoiceLinkSummary(linkInvoiceId, ac.signal)
				      .then((rows) => {
				        setLinkSummaryRows(rows);
				        const next: NumMap = {};
				        for (const r of rows) next[r.invoiceItemId] = String(r.linkedQty ?? 0);
				        setLinkQtyByInvoiceItemId(next);
				      })
				      .catch((e) => {
				        if (!isAbortError(e)) console.error('Failed to load GRN \u2194 Invoice link summary', e);
				      })
				      .finally(() => setLoadingLinkSummary(false));
				    return () => ac.abort();
				  }, [linkInvoiceId]);

				  const activeGrnItemInvoiceItemMeta = useMemo(() => {
				    const map = new Map<
				      string,
				      { invoiceItemId: string; invoiceId: string; invoiceNo: string; invoiceDate: string; invoiceQty: number }
				    >();
				    if (!activeGrnItemLink) return map;
				    const poId = String(activeGrnItemLink.poId ?? '').trim();
				    const itemId = String(activeGrnItemLink.itemId ?? '').trim();
				    const invoiceFilter = String(grnItemLinkInvoiceIdFilter ?? '').trim();
				    if (!poId || !itemId) return map;

				    for (const inv of invoicesForPr) {
				      const invoiceId = String(inv.invoice.id ?? '').trim();
				      if (!invoiceId || String(inv.invoice.poId ?? '').trim() !== poId) continue;
				      if (invoiceFilter && invoiceId !== invoiceFilter) continue;
				      const invoiceNo = String(inv.invoice.supplierInvoiceNo ?? inv.invoice.id ?? '').trim() || invoiceId;
				      const invoiceDate = String(inv.invoice.invoiceDate ?? '').trim();
				      for (const it of inv.items ?? []) {
				        const invoiceItemId = String((it as any)?.id ?? (it as any)?.invoiceItemId ?? '').trim();
				        if (!invoiceItemId) continue;
				        if (String(it.itemId ?? '').trim() !== itemId) continue;
				        map.set(invoiceItemId, {
				          invoiceItemId,
				          invoiceId,
				          invoiceNo,
				          invoiceDate,
				          invoiceQty: Number((it as any)?.quantity ?? 0),
				        });
				      }
				    }
				    return map;
				  }, [activeGrnItemLink, grnItemLinkInvoiceIdFilter, invoicesForPr]);

				  const activeGrnItemInvoiceItemOptions = useMemo(() => {
				    const options: Array<{ value: string; label: string }> = [];
				    for (const m of activeGrnItemInvoiceItemMeta.values()) {
				      const label = m.invoiceDate ? `${m.invoiceNo} (${formatDateDDMMYYYYOnly(m.invoiceDate)})` : m.invoiceNo;
				      options.push({ value: m.invoiceItemId, label });
				    }
				    options.sort((a, b) => a.label.localeCompare(b.label));
				    return options;
				  }, [activeGrnItemInvoiceItemMeta]);

				  useEffect(() => {
				    if (!grnItemLinkModalOpen || !activeGrnItemLink) return;
				    const grnItemId = String(activeGrnItemLink.grnItemId ?? '').trim();
				    if (!grnItemId) return;
				    const ac = new AbortController();
				    setLoadingActiveGrnItemInvoiceLinks(true);
				    setGrnItemLinkLocalError(null);
				    fetchGrnItemInvoiceLinks(grnItemId, ac.signal)
				      .then((rows) => {
				        setActiveGrnItemInvoiceLinks(rows);
				        const next: NumMap = {};
				        for (const r of rows) next[r.invoiceItemId] = String(r.linkedQty ?? 0);
				        setGrnItemLinkQtyByInvoiceItemId(next);
				      })
				      .catch((e) => {
				        const message = e instanceof Error ? e.message : String(e);
				        setGrnItemLinkLocalError(message);
				      })
				      .finally(() => setLoadingActiveGrnItemInvoiceLinks(false));
				    return () => ac.abort();
				  }, [activeGrnItemLink, grnItemLinkModalOpen]);

				  useEffect(() => {
				    if (!grnItemLinkModalOpen) return;
				    if (grnItemLinkSelectedInvoiceItemId) return;
				    const first = activeGrnItemInvoiceItemOptions[0]?.value;
				    if (first) setGrnItemLinkSelectedInvoiceItemId(first);
				  }, [activeGrnItemInvoiceItemOptions, grnItemLinkModalOpen, grnItemLinkSelectedInvoiceItemId]);

				  useEffect(() => {
				    if (!grnItemLinkModalOpen) return;
				    const id = String(grnItemLinkSelectedInvoiceItemId ?? '').trim();
				    if (!id) return;
				    setGrnItemLinkSelectedQty(String(grnItemLinkQtyByInvoiceItemId[id] ?? ''));
				  }, [grnItemLinkModalOpen, grnItemLinkQtyByInvoiceItemId, grnItemLinkSelectedInvoiceItemId]);

				  const invoiceHeaderById = useMemo(() => {
				    const map = new Map<string, { invoiceNo: string; invoiceDate: string }>();
				    for (const inv of invoicesForPr) {
				      const invoiceId = String(inv.invoice.id ?? '').trim();
				      if (!invoiceId) continue;
				      const invoiceNo = String(inv.invoice.supplierInvoiceNo ?? inv.invoice.id ?? '').trim() || invoiceId;
				      const invoiceDate = String(inv.invoice.invoiceDate ?? '').trim();
				      map.set(invoiceId, { invoiceNo, invoiceDate });
				    }
				    return map;
				  }, [invoicesForPr]);

				  const linkedInvoicesByGrnItemId = useMemo(() => {
				    const map = new Map<string, Array<{ invoiceId: string; invoiceNo: string; linkedQty: number }>>();
				    for (const r of grnItemInvoiceLinkSummary) {
				      const grnItemId = String((r as any)?.grnItemId ?? '').trim();
				      const invoiceId = String((r as any)?.invoiceId ?? '').trim();
				      if (!grnItemId || !invoiceId) continue;
				      const header = invoiceHeaderById.get(invoiceId);
				      const invoiceNo = String((r as any)?.invoiceNo ?? '').trim() || header?.invoiceNo || invoiceId;
				      const linkedQty = Number((r as any)?.linkedQty ?? 0);
				      const arr = map.get(grnItemId) ?? [];
				      arr.push({ invoiceId, invoiceNo, linkedQty });
				      map.set(grnItemId, arr);
				    }

				    for (const [grnItemId, arr] of map.entries()) {
				      const seen = new Set<string>();
				      const uniq: Array<{ invoiceId: string; invoiceNo: string; linkedQty: number }> = [];
				      for (const x of arr) {
				        if (!x.invoiceId || seen.has(x.invoiceId)) continue;
				        seen.add(x.invoiceId);
				        uniq.push(x);
				      }
				      uniq.sort((a, b) => a.invoiceNo.localeCompare(b.invoiceNo));
				      map.set(grnItemId, uniq);
				    }

				    return map;
				  }, [grnItemInvoiceLinkSummary, invoiceHeaderById]);

				  const invoiceDropdownOptionsByPoItemKey = useMemo(() => {
				    const map = new Map<string, Array<{ value: string; label: string }>>();
				    for (const inv of invoicesForPr) {
				      const invoiceId = String(inv.invoice.id ?? '').trim();
				      const poId = String(inv.invoice.poId ?? '').trim();
				      if (!invoiceId || !poId) continue;
				      const header = invoiceHeaderById.get(invoiceId);
				      const label = header?.invoiceDate ? `${header.invoiceNo} (${formatDateDDMMYYYYOnly(header.invoiceDate)})` : header?.invoiceNo ?? invoiceId;
				      const itemIds = new Set((inv.items ?? []).map((x) => String((x as any)?.itemId ?? '').trim()).filter(Boolean));
				      for (const itemId of itemIds) {
				        const key = `${poId}||${itemId}`;
				        const arr = map.get(key) ?? [];
				        if (!arr.some((o) => o.value === invoiceId)) arr.push({ value: invoiceId, label });
				        map.set(key, arr);
				      }
				    }

				    for (const [k, arr] of map.entries()) {
				      arr.sort((a, b) => a.label.localeCompare(b.label));
				      map.set(k, arr);
				    }
				    return map;
				  }, [invoiceHeaderById, invoicesForPr]);

				  const invoiceItemIdByInvoiceIdItemId = useMemo(() => {
				    const map = new Map<string, string>();
				    for (const inv of invoicesForPr) {
				      const invoiceId = String(inv.invoice.id ?? '').trim();
				      if (!invoiceId) continue;
				      for (const it of inv.items ?? []) {
				        const itemId = String((it as any)?.itemId ?? '').trim();
				        const invoiceItemId = String((it as any)?.id ?? (it as any)?.invoiceItemId ?? '').trim();
				        if (!itemId || !invoiceItemId) continue;
				        const key = `${invoiceId}||${itemId}`;
				        if (!map.has(key)) map.set(key, invoiceItemId);
				      }
				    }
				    return map;
				  }, [invoicesForPr]);

				  const invQtyByInvoiceIdItemId = useMemo(() => {
				    const map = new Map<string, number>();
				    for (const inv of invoicesForPr) {
				      const invoiceId = String(inv.invoice.id ?? '').trim();
				      if (!invoiceId) continue;
				      for (const it of inv.items ?? []) {
				        const itemId = String((it as any)?.itemId ?? '').trim();
				        if (!itemId) continue;
				        const key = `${invoiceId}||${itemId}`;
				        map.set(key, (map.get(key) ?? 0) + Number((it as any)?.quantity ?? 0));
				      }
				    }
				    return map;
				  }, [invoicesForPr]);

					  const linkedQtyByGrnItemIdInvoiceId = useMemo(() => {
					    const map = new Map<string, number>();
					    for (const r of grnItemInvoiceLinkSummary) {
					      const grnItemId = String((r as any)?.grnItemId ?? '').trim();
					      const invoiceId = String((r as any)?.invoiceId ?? '').trim();
					      if (!grnItemId || !invoiceId) continue;
					      map.set(`${grnItemId}||${invoiceId}`, Number((r as any)?.linkedQty ?? 0));
					    }
					    return map;
					  }, [grnItemInvoiceLinkSummary]);

						  const linkedItemRows = useMemo(() => {
						    const grnItemMeta = new Map<
						      string,
						      { grnId: string; poId: string; itemId: string; itemLabel: string }
						    >();
					    for (const g of recordedGrns) {
					      const grnId = String((g as any)?.grn?.id ?? '').trim();
					      const poId = String((g as any)?.grn?.poId ?? '').trim();
					      if (!grnId || !poId) continue;
					      for (const it of (g as any)?.items ?? []) {
					        const grnItemId = String((it as any)?.id ?? '').trim();
					        const itemId = String((it as any)?.itemId ?? '').trim();
					        if (!grnItemId || !itemId) continue;
					        if (grnItemMeta.has(grnItemId)) continue;
					        const prRow = prItems.find((r) => r.itemId === itemId);
					        const specInline = String(prRow?.specification ?? '')
					          .split(/\r?\n/)
					          .map((s) => s.trim())
					          .filter(Boolean)
					          .join(' - ');
					        const itemLabel = [prRow?.item || (it as any)?.item, specInline || null].filter(Boolean).join(' - ');
					        grnItemMeta.set(grnItemId, { grnId, poId, itemId, itemLabel: itemLabel || itemId });
					      }
					    }

					    const rows: LinkedItemRow[] = [];

					    for (const r of grnItemInvoiceLinkSummary) {
					      const grnItemId = String((r as any)?.grnItemId ?? '').trim();
					      const invoiceId = String((r as any)?.invoiceId ?? '').trim();
					      const linkedQty = Number((r as any)?.linkedQty ?? 0);
					      if (!grnItemId || !invoiceId || !Number.isFinite(linkedQty) || linkedQty <= 0) continue;
					      const meta = grnItemMeta.get(grnItemId);
					      if (!meta) continue;
					      const header = invoiceHeaderById.get(invoiceId);
					      const invoiceNo = String((r as any)?.invoiceNo ?? '').trim() || header?.invoiceNo || invoiceId;
					      const invoiceDate = header?.invoiceDate ?? '';
					      const invoiceQty = invQtyByInvoiceIdItemId.get(`${invoiceId}||${meta.itemId}`) ?? 0;
					      const acceptedQty = Number(qcAcceptedByGrnIdItemId[`${meta.grnId}||${meta.itemId}`] ?? 0);

					      rows.push({
					        grnItemId,
					        grnId: meta.grnId,
					        poId: meta.poId,
					        itemId: meta.itemId,
					        itemLabel: meta.itemLabel,
					        invoiceId,
					        invoiceNo,
					        invoiceDate,
					        invoiceQty,
					        linkedQty,
					        acceptedQty,
					      });
					    }

						    rows.sort((a, b) => a.grnId.localeCompare(b.grnId) || a.itemLabel.localeCompare(b.itemLabel) || a.invoiceNo.localeCompare(b.invoiceNo));
						    return rows;
						  }, [grnItemInvoiceLinkSummary, invoiceHeaderById, invQtyByInvoiceIdItemId, prItems, qcAcceptedByGrnIdItemId, recordedGrns]);

						  useEffect(() => {
						    setLinkedItemOrder([]);
						  }, [requestId]);

						  useEffect(() => {
						    setLinkedItemOrder((prev) => {
						      const currentKeys = linkedItemRows.map((r) => `${r.grnItemId}||${r.invoiceId}`);
						      const currentSet = new Set(currentKeys);
						      const next: string[] = prev.filter((k) => currentSet.has(k));
						      const nextSet = new Set(next);
						      for (const k of currentKeys) {
						        if (!nextSet.has(k)) {
						          next.push(k);
						          nextSet.add(k);
						        }
						      }
						      return next;
						    });
						  }, [linkedItemRows]);

						  const linkedItemRowByKey = useMemo(() => {
						    const map = new Map<string, LinkedItemRow>();
						    for (const r of linkedItemRows) map.set(`${r.grnItemId}||${r.invoiceId}`, r);
						    return map;
						  }, [linkedItemRows]);

						  const linkedItemRowsOrdered = useMemo(() => {
						    const out: LinkedItemRow[] = [];
						    for (const k of linkedItemOrder) {
						      const r = linkedItemRowByKey.get(k);
						      if (r) out.push(r);
						    }
						    return out;
						  }, [linkedItemOrder, linkedItemRowByKey]);

						  const linkedGrnQtyByInvoiceIdItemId = useMemo(() => {
						    const map: Record<string, number> = {};
						    for (const r of linkedItemRows) {
						      const invoiceId = String((r as any)?.invoiceId ?? '').trim();
						      const itemId = String((r as any)?.itemId ?? '').trim();
						      if (!invoiceId || !itemId) continue;
						      const key = `${invoiceId}||${itemId}`;
						      map[key] = (map[key] ?? 0) + Number((r as any)?.linkedQty ?? 0);
						    }
						    return map;
						  }, [linkedItemRows]);

						  const invoicesDueForPayment = useMemo(() => {
						    const due = (Array.isArray(invoicesForPr) ? invoicesForPr : []).filter((inv) => {
						      const status = inv?.invoice?.status;
						      if (status === 'Paid' || status === 'On Hold') return false;
						      const payStatus = String(inv?.invoice?.paymentStatus ?? '').trim();
						      if (payStatus === 'Full Paid') return false;

						      const invoiceId = String(inv?.invoice?.id ?? '').trim();
						      const items = Array.isArray(inv?.items) ? inv.items : [];
						      if (!invoiceId || !items.length) return false;

						      return items.every((it) => {
						        const itemId = String((it as any)?.itemId ?? '').trim();
						        if (!itemId) return false;
						        const invQty = Number((it as any)?.quantity ?? 0);
						        const grnQty = Number(linkedGrnQtyByInvoiceIdItemId[`${invoiceId}||${itemId}`] ?? 0);
						        if (!Number.isFinite(invQty) || !Number.isFinite(grnQty)) return false;
						        return Math.abs(invQty - grnQty) < 1e-9;
						      });
						    });

						    due.sort(
						      (a, b) =>
						        String(a.invoice.invoiceDate ?? '').localeCompare(String(b.invoice.invoiceDate ?? '')) ||
						        String(a.invoice.supplierInvoiceNo ?? '').localeCompare(String(b.invoice.supplierInvoiceNo ?? ''))
						    );
						    return due;
						  }, [invoicesForPr, linkedGrnQtyByInvoiceIdItemId]);

						  const activeInvoiceReadyForPayment = useMemo(() => {
						    const inv = activeInvoiceDetails?.invoice;
						    if (!inv) return false;
						    const invoiceId = String(inv.id ?? '').trim();
						    const items = Array.isArray(activeInvoiceDetails?.items) ? activeInvoiceDetails.items : [];
						    if (!invoiceId || !items.length) return false;
						    return items.every((it) => {
						      const itemId = String((it as any)?.itemId ?? '').trim();
						      if (!itemId) return false;
						      const invQty = Number((it as any)?.quantity ?? 0);
						      const grnQty = Number(linkedGrnQtyByInvoiceIdItemId[`${invoiceId}||${itemId}`] ?? 0);
						      if (!Number.isFinite(invQty) || !Number.isFinite(grnQty)) return false;
						      return Math.abs(invQty - grnQty) < 1e-9;
						    });
						  }, [activeInvoiceDetails, linkedGrnQtyByInvoiceIdItemId]);

					  const grnInvoiceLinkRows = useMemo(() => {
					    const rows: Array<{
					      grnItemId: string;
					      grnId: string;
					      poId: string;
				      receivedDate: string;
			      itemId: string;
			      itemLabel: string;
			      grnQty: number;
			      invoiceNos: string;
			      invoiceDate: string;
			      invoiceQty: number;
			      acceptedQty: number;
			      rejectedQty: number;
			    }> = [];

		    for (const g of recordedGrns) {
		      const grnId = String(g.grn.id ?? '').trim();
		      const poId = String(g.grn.poId ?? '').trim();
		      const receivedDate = String(g.grn.receivedDate ?? '').trim();
		      if (!grnId || !poId) continue;
			      for (const it of g.items ?? []) {
			        const grnItemId = String((it as any)?.id ?? '').trim() || `${grnId}||${String((it as any)?.itemId ?? '').trim()}`;
			        const itemId = String(it.itemId ?? '').trim();
			        if (!itemId) continue;

		        const prRow = prItems.find((r) => r.itemId === itemId);
		        const specInline = String(prRow?.specification ?? '')
		          .split(/\r?\n/)
		          .map((s) => s.trim())
		          .filter(Boolean)
		          .join(' - ');
			        const itemLabel = [prRow?.item || it.item, specInline || null].filter(Boolean).join(' - ');

			        const key = `${poId}||${itemId}`;
			        const linked = linkedInvoicesByGrnItemId.get(grnItemId) ?? [];
			        const invoiceNos = linked.map((x) => x.invoiceNo).join(', ');
			        let invoiceDate = '';
			        for (const l of linked) {
			          const dt = invoiceHeaderById.get(l.invoiceId)?.invoiceDate ?? '';
			          if (dt && (!invoiceDate || dt > invoiceDate)) invoiceDate = dt;
			        }
			        const invoiceQty = Number(invoicedQtyByPoAndItemId[key] ?? 0);
			        const acceptedQty = Number(qcAcceptedByGrnIdItemId[`${grnId}||${itemId}`] ?? 0);
			        const rejectedQty = Number(qcRejectedByGrnIdItemId[`${grnId}||${itemId}`] ?? 0);

			        rows.push({
			          grnItemId,
			          grnId,
			          poId,
			          receivedDate,
			          itemId,
			          itemLabel: itemLabel || it.item || itemId,
			          grnQty: Number(it.quantityReceived ?? 0),
			          invoiceNos,
			          invoiceDate,
			          invoiceQty,
			          acceptedQty,
			          rejectedQty,
			        });
			      }
			    }

		    rows.sort((a, b) => String(b.receivedDate ?? '').localeCompare(String(a.receivedDate ?? '')));
				    return rows;
				  }, [invoicedQtyByPoAndItemId, invoiceHeaderById, linkedInvoicesByGrnItemId, prItems, qcAcceptedByGrnIdItemId, qcRejectedByGrnIdItemId, recordedGrns]);

				  const invoiceLinkQtyByGrnIdItemId = useMemo(() => {
				    const map: Record<string, number> = {};
				    for (const r of linkedItemRows) {
				      const key = `${r.grnId}||${r.itemId}`;
				      map[key] = (map[key] ?? 0) + Number(r.linkedQty ?? 0);
				    }
				    return map;
				  }, [linkedItemRows]);

				  const pendingGrnInvoiceLinkRows = useMemo(() => {
				    return grnInvoiceLinkRows.filter((r) => {
				      const accepted = Number(r.acceptedQty ?? 0);
				      if (!Number.isFinite(accepted) || accepted <= 0) return false;
				      const linked = linkedInvoicesByGrnItemId.get(r.grnItemId) ?? [];
				      const totalLinked = linked.reduce((sum, x) => sum + Number((x as any)?.linkedQty ?? 0), 0);
				      return totalLinked + 1e-9 < accepted;
				    });
				  }, [grnInvoiceLinkRows, linkedInvoicesByGrnItemId]);

				  const saveAllGrnInvoiceLinks = () => {
				    const rows = pendingGrnInvoiceLinkRows;
				    if (!rows.length) return;
				    run(async () => {
				      for (const r of rows) {
				        const linked = linkedInvoicesByGrnItemId.get(r.grnItemId) ?? [];
				        const selectedInvoiceId = String(selectedInvoiceIdByGrnItemId[r.grnItemId] ?? '').trim();
				        if (!selectedInvoiceId) continue;

					        const acceptedQty = Number(r.acceptedQty ?? 0);
					        const invQty = invQtyByInvoiceIdItemId.get(`${selectedInvoiceId}||${r.itemId}`) ?? 0;
					        const invoiceItemLinkedTotal = Number(linkedGrnQtyByInvoiceIdItemId[`${selectedInvoiceId}||${r.itemId}`] ?? 0);
					        const currentInvoiceLinkQty = Number(linkedQtyByGrnItemIdInvoiceId.get(`${r.grnItemId}||${selectedInvoiceId}`) ?? 0);
					        const remainingOnInvoice = Math.max(0, invQty - Math.max(0, invoiceItemLinkedTotal - currentInvoiceLinkQty));
					        const otherLinkedTotal = (linked ?? [])
					          .filter((x) => String((x as any)?.invoiceId ?? '').trim() !== selectedInvoiceId)
					          .reduce((sum, x) => sum + Number((x as any)?.linkedQty ?? 0), 0);
					        const maxAllowed = Math.max(0, acceptedQty - otherLinkedTotal);
					        const suggestedQty = Math.max(0, Math.min(remainingOnInvoice, maxAllowed));
					        const typed = linkQtyInputByGrnItemId[r.grnItemId];
					        const raw = typed != null && String(typed).trim() !== '' ? String(typed).trim() : String(suggestedQty);
					        const desiredQty = raw ? Number(raw) : 0;
					        if (!Number.isFinite(desiredQty) || desiredQty < 0) throw new Error(`Invalid Link Qty for GRN ${formatGrnNumber(r.grnId)}`);
					        if (desiredQty > remainingOnInvoice + 1e-9) throw new Error(`Link Qty cannot be more than remaining Invoice Qty (GRN ${formatGrnNumber(r.grnId)})`);
					        if (desiredQty > Number(r.acceptedQty ?? 0) + 1e-9) throw new Error(`Link Qty cannot be more than Accepted Qty (GRN ${formatGrnNumber(r.grnId)})`);

					        if (otherLinkedTotal + desiredQty > Number(r.acceptedQty ?? 0) + 1e-9) {
						          throw new Error(`Total linked qty across invoices cannot be more than Accepted Qty (GRN ${formatGrnNumber(r.grnId)})`);
					        }

				        const invoiceItemId = invoiceItemIdByInvoiceIdItemId.get(`${selectedInvoiceId}||${r.itemId}`) ?? '';
					        if (!invoiceItemId) throw new Error(`Invoice item not found (GRN ${formatGrnNumber(r.grnId)})`);

				        const links: Array<{ invoiceItemId: string; linkedQty: number }> = [];
				        for (const x of linked ?? []) {
				          const id = String((x as any)?.invoiceId ?? '').trim();
				          if (!id || id === selectedInvoiceId) continue;
				          const invIt = invoiceItemIdByInvoiceIdItemId.get(`${id}||${r.itemId}`) ?? '';
				          const qty = Number((x as any)?.linkedQty ?? 0);
				          if (!invIt || !Number.isFinite(qty) || qty <= 0) continue;
				          links.push({ invoiceItemId: invIt, linkedQty: qty });
				        }
				        if (desiredQty > 0) links.push({ invoiceItemId, linkedQty: desiredQty });

				        await setGrnItemInvoiceLinks(r.grnItemId, { updatedBy: 'system', links });
				      }
				      if (requestId) {
				        const next = await fetchGrnItemInvoiceLinkSummaryByPrId(requestId);
				        setGrnItemInvoiceLinkSummary(next);
				      }
				      setSelectedInvoiceIdByGrnItemId({});
				      setLinkQtyInputByGrnItemId({});
				      setLinkLocalError(null);
				    }).catch((e) => {
				      setLinkLocalError(e instanceof Error ? e.message : String(e));
				      throw e;
				    });
				  };

			  const saveGrnInvoiceLinking = () => {
			    const invoiceId = String(linkInvoiceId ?? '').trim();
			    if (!invoiceId) return;
			    if (!linkEnabled) {
			      setLinkLocalError('Record QC for this PO before linking GRN \u2194 Invoice.');
			      setError('Record QC for this PO before linking GRN \u2194 Invoice.');
			      return;
			    }
			    const links = linkSummaryRows.map((r) => {
			      const raw = String(linkQtyByInvoiceItemId[r.invoiceItemId] ?? '').trim();
			      const linkedQty = raw ? Number(raw) : 0;
			      return { invoiceItemId: r.invoiceItemId, linkedQty };
			    });
			    if (links.some((l) => !l.invoiceItemId || !Number.isFinite(l.linkedQty) || l.linkedQty < 0)) {
			      setLinkLocalError('Enter valid linked quantities (0 or more).');
			      setError('Enter valid linked quantities (0 or more).');
			      return;
			    }
				    run(() =>
				      setGrnInvoiceLinks(invoiceId, {
				        updatedBy: 'system',
				        links,
				      })
			        .then((res) => {
			          const rows = Array.isArray(res.links) ? res.links : [];
			          setLinkSummaryRows(rows);
			          const next: NumMap = {};
			          for (const r of rows) next[r.invoiceItemId] = String(r.linkedQty ?? 0);
			          setLinkQtyByInvoiceItemId(next);
			          setLinkLocalError(null);
			        })
			        .catch((e) => {
			          const message = e instanceof Error ? e.message : String(e);
			          setLinkLocalError(message);
			          throw e;
			        })
			    );
			  };

			  const resetGrnInvoiceLinkingInputs = () => {
			    const next: NumMap = {};
			    for (const r of linkSummaryRows) next[r.invoiceItemId] = String(r.linkedQty ?? 0);
			    setLinkQtyByInvoiceItemId(next);
			    setLinkLocalError(null);
			  };

			  const clearGrnInvoiceLinkingInputs = () => {
			    const next: NumMap = {};
			    for (const r of linkSummaryRows) next[r.invoiceItemId] = '0';
			    setLinkQtyByInvoiceItemId(next);
			    setLinkLocalError(null);
			  };

			  const deleteGrnInvoiceLinking = () => {
			    if (!linkEnabled) {
			      setLinkLocalError('Record QC for this PO before deleting GRN \u2194 Invoice linking.');
			      setError('Record QC for this PO before deleting GRN \u2194 Invoice linking.');
			      return;
			    }
			    if (!linkInvoiceId) return;
			    if (!confirm('Delete all GRN \u2194 Invoice linking for this invoice?')) return;
			    const links = linkSummaryRows.map((r) => ({ invoiceItemId: r.invoiceItemId, linkedQty: 0 }));
				    run(() =>
				      setGrnInvoiceLinks(linkInvoiceId, {
				        updatedBy: 'system',
				        links,
				      })
			        .then((res) => {
			          const rows = Array.isArray(res.links) ? res.links : [];
			          setLinkSummaryRows(rows);
			          const next: NumMap = {};
			          for (const r of rows) next[r.invoiceItemId] = String(r.linkedQty ?? 0);
			          setLinkQtyByInvoiceItemId(next);
			          setLinkLocalError(null);
			        })
			        .catch((e) => {
			          const message = e instanceof Error ? e.message : String(e);
			          setLinkLocalError(message);
			          throw e;
			        })
			    );
			  };

				  const pendingInvoiceTotalByPoId = useMemo(() => {
				    const map: Record<string, number> = {};
				    for (const p of posList) {
			      const poId = p.po.id;
		      let pending = 0;
		      for (const it of p.items ?? []) {
		        const ordered = Number(it.quantity ?? 0);
		        const invoiced = Number(invoicedQtyByPoAndItemId[`${poId}||${it.itemId}`] ?? 0);
		        pending += Math.max(0, ordered - invoiced);
		      }
		      map[poId] = pending;
		    }
		    return map;
		  }, [invoicedQtyByPoAndItemId, posList]);

						  const invoicePoOptions = useMemo(() => {
						    return posList
						      .filter((p) => sentPoIdSet.has(p.po.id))
						      .filter((p) => Number(pendingInvoiceTotalByPoId[p.po.id] ?? 0) > 0)
	                          .map((p) => ({ value: p.po.id, label: formatPoNumber((p as any)?.po?.poNumber ?? '') || '-' }));
						  }, [pendingInvoiceTotalByPoId, posList, sentPoIdSet]);

						  const pendingInvoicePoRows = useMemo(() => {
						    return posList
						      .filter((p) => sentPoIdSet.has(p.po.id))
						      .map((p) => {
						        const poId = p.po.id;
						        const poNumber = String((p.po as any)?.poNumber ?? (p as any)?.po?.poNumber ?? '').trim();
						        const lines = (p.items ?? [])
						          .map((it) => {
						            const ordered = Number((it as any)?.quantity ?? 0);
						            const invoiced = Number(invoicedQtyByPoAndItemId[`${poId}||${(it as any)?.itemId}`] ?? 0);
						            const pendingQty = Math.max(0, ordered - invoiced);
						            return {
						              itemId: String((it as any)?.itemId ?? '').trim(),
						              poQty: ordered,
						              poRate: Number((it as any)?.rate ?? 0),
						              discountPercent: Number((it as any)?.discountPercent ?? 0),
						              taxPercent: Number((it as any)?.taxPercent ?? 0),
						              pendingInvoiceQty: pendingQty,
						            };
						          })
						          .filter((l) => l.itemId && Number.isFinite(l.pendingInvoiceQty) && l.pendingInvoiceQty > 0);
						        const pendingQty = lines.reduce((sum, l) => sum + (Number.isFinite(l.pendingInvoiceQty) ? l.pendingInvoiceQty : 0), 0);
						        const checkedById = String((p.po as any)?.checkPoUserId ?? '').trim();
						        const sentById = String((p.po as any)?.sentBy ?? '').trim();
						        const checkedByName = checkedById ? userNameById.get(checkedById) ?? checkedById : '';
						        const sentByName = sentById ? userNameById.get(sentById) ?? sentById : '';
						        return {
						          poId,
						          poNumber,
						          supplier: String((p.po as any)?.supplier ?? (p.po as any)?.supplierName ?? '').trim(),
						          paymentTerms: String((p.po as any)?.paymentTerms ?? '').trim(),
						          checkedBy: checkedByName,
						          sentBy: sentByName,
						          pendingQty,
						          lines,
						        };
						      })
						      .filter((r) => Number.isFinite(r.pendingQty) && r.pendingQty > 0 && Array.isArray(r.lines) && r.lines.length > 0);
						  }, [invoicedQtyByPoAndItemId, posList, sentPoIdSet, userNameById]);

				  const allPoOptions = useMemo(() => {
				    const map = new Map<string, string>();
				    for (const p of posList) map.set(p.po.id, p.po.id);
				    if (po?.id) map.set(po.id, po.id);
				    return Array.from(map.entries()).map(([value, label]) => ({ value, label: formatPoNumber(label) }));
				  }, [posList, po?.id]);

	  useEffect(() => {
	    if (selectedPoId) return;
	    const fallbackPoId = invoicePoOptions[0]?.value || allPoOptions[0]?.value;
	    if (fallbackPoId) setSelectedPoId(fallbackPoId);
	  }, [allPoOptions, invoicePoOptions, selectedPoId]);

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

			  useEffect(() => {
			    if (!pr?.id) return;
			    // Auto-fill Qty PO with Pending Qty unless user has edited it.
			    setPoQty((prev) => {
			      const next: NumMap = { ...prev };
			      let changed = false;
			      for (const it of prItems) {
			        const lineId = String((it as any).id ?? '').trim() || String((it as any).itemId ?? '').trim();
			        if (!lineId) continue;
			        const itemId = String((it as any).itemId ?? '').trim();
			        const pending = Number(remainingQtyByItemId[itemId] ?? 0);
			        if (!(pending > 0)) continue;
			        if (poQtyTouched[lineId]) continue;
			        const current = String(next[lineId] ?? '').trim();
			        if (!current) {
			          next[lineId] = String(pending);
			          changed = true;
			        }
			      }
			      return changed ? next : prev;
			    });
			  }, [pr?.id, prItems, poQtyTouched, remainingQtyByItemId]);

			  useEffect(() => {
			    if (!pr?.id) return;
			    if (!suppliers.length) return;
			    // Auto-fill Rate from last supplier info unless user has edited it.

			    setPoRates((prev) => {
			      const next: NumMap = { ...prev };
			      let changed = false;
			      for (const it of prItems) {
			        const lineId = String((it as any).id ?? '').trim() || String((it as any).itemId ?? '').trim();
			        if (!lineId) continue;
			        const itemId = String((it as any).itemId ?? '').trim();
			        if (poRatesTouched[lineId]) continue;
			        const last = lastSupplierByItemId[itemId];
			        if (!last) continue;
			        const current = String(next[lineId] ?? '').trim();
			        if (!current) {
			          next[lineId] = String(last.rate ?? '');
			          changed = true;
			        }
			      }
			      return changed ? next : prev;
			    });
			  }, [lastSupplierByItemId, poRatesTouched, pr?.id, prItems, suppliers]);

			  useEffect(() => {
			    if (!pr?.id) return;
			    if (!suppliers.length) return;

			    // Pre-fill Supplier + Terms from "Last Supplier" per row (editable).
			    // This runs per PR and never writes to other rows except the ones that are blank + untouched.
			    const supplierById = new Map<string, Supplier>(suppliers.map((s) => [s.id, s]));

			    setPoSupplierByItemId((prev) => {
			      const next: TextMap = { ...prev };
			      let changed = false;
			      for (const it of prItems) {
			        const lineId = String((it as any)?.id ?? '').trim() || String((it as any)?.itemId ?? '').trim();
			        if (!lineId) continue;
			        if (poSupplierTouched[lineId]) continue;
			        const current = String(next[lineId] ?? '').trim();
			        if (current) continue;

			        const last = lastSupplierByItemId[String((it as any)?.itemId ?? '').trim()];
			        const desired = String(last?.supplierId ?? '').trim();
			        if (!desired) continue;
			        if (!supplierById.has(desired)) continue;

			        next[lineId] = desired;
			        changed = true;
			      }
			      return changed ? next : prev;
			    });

			    setPoPaymentTermsByItemId((prev) => {
			      const next: TextMap = { ...prev };
			      let changed = false;
			      for (const it of prItems) {
			        const lineId = String((it as any)?.id ?? '').trim() || String((it as any)?.itemId ?? '').trim();
			        if (!lineId) continue;
			        if (poSupplierTouched[lineId]) continue;

			        const supplierId = String(poSupplierByItemId[lineId] ?? '').trim();
			        if (!supplierId) continue;

			        const currentTerms = String(next[lineId] ?? '').trim();
			        if (currentTerms) continue;

			        const sup = supplierById.get(supplierId);
			        if (!sup) continue;
			        next[lineId] = String(sup.paymentTerms ?? '').trim();
			        changed = true;
			      }
			      return changed ? next : prev;
			    });
			  }, [lastSupplierByItemId, poSupplierByItemId, poSupplierTouched, pr?.id, prItems, suppliers]);

		  const makePoItems = useMemo(
		    () => prItems.filter((it) => Number(remainingQtyByItemId[it.itemId] ?? 0) > 0),
		    [prItems, remainingQtyByItemId]
		  );

		  const selectedFirm = useMemo(() => (pr ? firms.find((f) => f.id === pr.firmId) ?? null : null), [firms, pr?.firmId]);
		  const firmAddress = useMemo(() => String(selectedFirm?.address ?? '').trim(), [selectedFirm?.address]);
		  const firmTermsConditions = useMemo(() => String(selectedFirm?.termsConditions ?? '').trim(), [selectedFirm?.termsConditions]);

			  const poDraftLines = useMemo(() => {
			    const items = prItems.filter((it) => Number(remainingQtyByItemId[it.itemId] ?? 0) > 0);
			    return items
			      .map((it) => {
			        const lineId = String((it as any).id ?? '').trim() || String((it as any).itemId ?? '').trim();
			        const itemId = String(it.itemId ?? '').trim();
			        const supplierId = String(poSupplierByItemId[lineId] ?? '').trim();
			        const paymentTerms = String(poPaymentTermsByItemId[lineId] ?? '').trim();
			        return {
			          lineId,
			          itemId,
			          remaining: Number(remainingQtyByItemId[itemId] ?? 0),
			          supplierId,
			          paymentTerms,
			          quantity: Number(poQty[lineId] ?? 0),
			          rate: Number(poRates[lineId] ?? 0),
			          discountPercent: Number(poDiscounts[lineId] ?? 0),
			          taxPercent: Number(poTaxes[lineId] ?? 0),
			        };
			      })
			      .filter((x) => x.lineId && x.itemId && Number.isFinite(x.quantity) && x.quantity > 0 && x.supplierId && x.paymentTerms);
			  }, [
			    poDiscounts,
			    poPaymentTermsByItemId,
			    poQty,
			    poRates,
			    poSupplierByItemId,
			    poTaxes,
			    prItems,
			    remainingQtyByItemId,
			  ]);

			  const poGroupKeys = useMemo(() => {
			    const set = new Set<string>();
			    for (const l of poDraftLines) set.add(`${l.supplierId}||${l.paymentTerms}`);
			    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
			  }, [poDraftLines]);

				  useEffect(() => {
				    const ac = new AbortController();
				    setLoadingMasterItems(true);
				    fetchItems(ac.signal)
				      .then((rows) => setMasterItems(Array.isArray(rows) ? rows : []))
				      .catch((e) => {
				        if (isAbortError(e)) return;
				        setMasterItems([]);
				      })
				      .finally(() => setLoadingMasterItems(false));
				    return () => ac.abort();
				  }, []);

				  useEffect(() => {
				    const ac = new AbortController();
				    setLoadingSpecs(true);
				    fetchSpecifications(ac.signal)
				      .then(async (rows) => {
				        const nextSpecs = Array.isArray(rows) ? rows : [];
				        setSpecs(nextSpecs);
				        const all = await Promise.all(
				          nextSpecs.map((s) =>
				            fetchSpecificationValues(s.id, ac.signal).catch((e) => {
				              if (isAbortError(e)) return [];
				              return [];
				            })
				          )
				        );
				        const flat = all.flat().filter(Boolean) as SpecificationValue[];
				        setSpecValues(flat);
				      })
				      .catch((e) => {
				        if (isAbortError(e)) return;
				        setSpecs([]);
				        setSpecValues([]);
				      })
				      .finally(() => setLoadingSpecs(false));
				    return () => ac.abort();
				  }, []);

			  useEffect(() => {
			    if (!poGroupKeys.length) return;

		    setPoShippingSameAsFirmByGroup((prev) => {
		      const next = { ...prev };
		      let changed = false;
		      for (const k of poGroupKeys) {
		        if (typeof next[k] === 'boolean') continue;
		        next[k] = Boolean(firmAddress);
		        changed = true;
		      }
		      return changed ? next : prev;
		    });

		    setPoShippingAddressByGroup((prev) => {
		      const next = { ...prev };
		      let changed = false;
		      for (const k of poGroupKeys) {
		        if (String(next[k] ?? '').trim()) continue;
		        if (!firmAddress) continue;
		        next[k] = firmAddress;
		        changed = true;
		      }
		      return changed ? next : prev;
		    });

		    setPoTermsConditionsByGroup((prev) => {
		      const next = { ...prev };
		      let changed = false;
		      for (const k of poGroupKeys) {
		        if (String(next[k] ?? '').trim()) continue;
		        if (!firmTermsConditions) continue;
		        next[k] = firmTermsConditions;
		        changed = true;
		      }
		      return changed ? next : prev;
		    });
		  }, [firmAddress, firmTermsConditions, poGroupKeys]);

						  const refresh = async (signal?: AbortSignal) => {
						    if (!requestId) return;
						    const [firmRows, posRows, invoiceRows, grnItemLinkRows, supplierRows, userRows, transporterRows] = await Promise.all([
						      fetchFirms(signal),
						      fetchPos(requestId, signal),
						      fetchInvoicesByPrId(requestId, signal),
						      fetchGrnItemInvoiceLinkSummaryByPrId(requestId, signal),
						      fetchSuppliers(signal),
						      fetchUsers(signal),
						      fetchTransporters(signal),
						    ]);

						    const desiredPoId = selectedPoId || po?.id || posRows[0]?.po.id || '';
						    const wf = await fetchWorkflow(requestId, signal, desiredPoId || undefined);
					    setFirms(firmRows);
					    setWorkflow(wf);
						    setPosList(posRows);
						    setInvoicesForPr(invoiceRows);
						    setGrnItemInvoiceLinkSummary(grnItemLinkRows);
						    setSuppliers(supplierRows);
						    setUsers(userRows);
							    setTransporters(transporterRows);
						    try {
						      const itemIds = Array.from(new Set((wf.pr.items ?? []).map((it) => String((it as any)?.itemId ?? '').trim()).filter(Boolean)));
						      setLastSupplierByItemId(await fetchLastSupplierByItemIds(itemIds, signal));
						    } catch {
						      // ignore
						    }

		    if (!selectedPoId) {
		      const defaultPoId = posRows[0]?.po.id ?? wf.po?.po.id ?? '';
		      if (defaultPoId) setSelectedPoId(defaultPoId);
		    }

		    if (wf.pr.items.length) {
		      const supplierTermsById = new Map(supplierRows.map((s) => [s.id, String(s.paymentTerms ?? '').trim()] as const));
		      const supplierIdSet = new Set(supplierRows.map((s) => s.id));

		      const migrateNumMap = (prev: NumMap) => {
		        const next: NumMap = {};
		        for (const it of wf.pr.items) {
		          const lineId = String((it as any)?.id ?? '').trim() || String((it as any)?.itemId ?? '').trim();
		          const legacyKey = String((it as any)?.itemId ?? '').trim();
		          if (!lineId) continue;
		          const v = String(prev[lineId] ?? '').trim() ? prev[lineId] : legacyKey && legacyKey !== lineId ? prev[legacyKey] : '';
		          next[lineId] = v ?? '';
		        }
		        return next;
		      };

		      const migrateTouched = (prev: Record<string, boolean>) => {
		        const next: Record<string, boolean> = {};
		        for (const it of wf.pr.items) {
		          const lineId = String((it as any)?.id ?? '').trim() || String((it as any)?.itemId ?? '').trim();
		          const legacyKey = String((it as any)?.itemId ?? '').trim();
		          if (!lineId) continue;
		          next[lineId] = Boolean(prev[lineId] ?? (legacyKey && legacyKey !== lineId ? prev[legacyKey] : false));
		        }
		        return next;
		      };

		      const nextSupplier: TextMap = { ...poSupplierByItemId };
		      const nextTerms: TextMap = { ...poPaymentTermsByItemId };
		      const lineIdSet = new Set<string>();
		      for (const it of wf.pr.items) {
		        const lineId = String((it as any)?.id ?? '').trim() || String((it as any)?.itemId ?? '').trim();
		        if (!lineId) continue;
		        lineIdSet.add(lineId);
		        const currentSupplier = String(nextSupplier[lineId] ?? '').trim();
		        const safeSupplier = currentSupplier && supplierIdSet.has(currentSupplier) ? currentSupplier : '';
		        nextSupplier[lineId] = safeSupplier;

		        const currentTerms = String(nextTerms[lineId] ?? '').trim();
		        if (!safeSupplier) {
		          nextTerms[lineId] = '';
		        } else {
		          nextTerms[lineId] = currentTerms || (supplierTermsById.get(safeSupplier) ?? '');
		        }
		      }
		      for (const key of Object.keys(nextSupplier)) if (!lineIdSet.has(key)) delete nextSupplier[key];
		      for (const key of Object.keys(nextTerms)) if (!lineIdSet.has(key)) delete nextTerms[key];

		      setPoSupplierByItemId(nextSupplier);
		      setPoPaymentTermsByItemId(nextTerms);
		      // Migrate legacy per-itemId draft maps to per-lineId maps (fixes "changing one row updates another").
		      setPoQty((prev) => migrateNumMap(prev));
		      setPoRates((prev) => migrateNumMap(prev));
		      setPoDiscounts((prev) => migrateNumMap(prev));
		      setPoTaxes((prev) => migrateNumMap(prev));
		      setPoQtyTouched((prev) => migrateTouched(prev));
		      setPoRatesTouched((prev) => migrateTouched(prev));
		      setPoDiscountsTouched((prev) => migrateTouched(prev));
		      setPoTaxesTouched((prev) => migrateTouched(prev));
		      setPoSupplierTouched((prev) => migrateTouched(prev));
		    }

			    if (wf.pr.items.length && Object.keys(poRates).length === 0) {
			      const next: NumMap = {};
			      wf.pr.items.forEach((it) => {
			        const lineId = String((it as any)?.id ?? '').trim() || String((it as any)?.itemId ?? '').trim();
			        if (!lineId) return;
			        next[lineId] = '';
			      });
			      setPoRates(next);
			    }
				    if (wf.pr.items.length && Object.keys(poDiscounts).length === 0) {
				      const next: NumMap = {};
				      wf.pr.items.forEach((it) => {
				        const lineId = String((it as any)?.id ?? '').trim() || String((it as any)?.itemId ?? '').trim();
				        if (!lineId) return;
				        next[lineId] = '';
				      });
				      setPoDiscounts(next);
				      setPoDiscountsTouched({});
				    }
				    if (wf.pr.items.length && Object.keys(poTaxes).length === 0) {
				      const next: NumMap = {};
				      wf.pr.items.forEach((it) => {
				        const lineId = String((it as any)?.id ?? '').trim() || String((it as any)?.itemId ?? '').trim();
				        if (!lineId) return;
				        next[lineId] = '';
				      });
				      setPoTaxes(next);
				      setPoTaxesTouched({});
				    }
				    if (wf.pr.items.length && Object.keys(poQty).length === 0) {
				      const next: NumMap = {};
				      wf.pr.items.forEach((it) => {
				        const lineId = String((it as any)?.id ?? '').trim() || String((it as any)?.itemId ?? '').trim();
				        if (!lineId) return;
				        next[lineId] = '';
				      });
				      setPoQty(next);
			      setPoQtyTouched({});
		    }
	    if (wf.po && !wf.invoice) {
	      const nextQty: NumMap = {};
	      const nextRates: NumMap = {};
	      wf.po.items.forEach((it) => {
	        nextQty[it.itemId] = String(it.quantity);
	        nextRates[it.itemId] = String(it.rate);
	      });
	      setInvoiceQty((prev) => (Object.keys(prev).length ? prev : nextQty));
	      setInvoiceRates((prev) => (Object.keys(prev).length ? prev : nextRates));
	    }
	    if (wf.invoice && !wf.grn) {
	      const next: NumMap = {};
	      wf.invoice.items.forEach((it) => (next[it.itemId] = String(it.quantity)));
	      setGrnQty((prev) => (Object.keys(prev).length ? prev : next));
	    }
	    if (wf.grn && !wf.qc) {
	      const nextAcc: NumMap = {};
	      const nextRej: NumMap = {};
	      wf.grn.items.forEach((it) => {
	        nextAcc[it.itemId] = String(it.quantityReceived);
	        nextRej[it.itemId] = '0';
	      });
	      setQcAccepted((prev) => (Object.keys(prev).length ? prev : nextAcc));
	      setQcRejected((prev) => (Object.keys(prev).length ? prev : nextRej));
	    }
  };

			  useEffect(() => {
			    if (!requestId) return;
				    const ac = new AbortController();
				    setLoading(true);
				    setLoadingUsers(true);
				    setLoadingSuppliers(true);
				    setLoadingTransporters(true);
				    setLoadingPos(true);
				    setError(null);
				    refresh(ac.signal)
		      .catch((e) => {
		        if (isAbortError(e)) return;
		        setError(e instanceof Error ? e.message : String(e));
		      })
				      .finally(() => {
				        setLoading(false);
				        setLoadingUsers(false);
				        setLoadingSuppliers(false);
				        setLoadingTransporters(false);
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

			  const closeInvoiceDetails = () => {
			    setInvoiceDetailsOpen(false);
			    setActiveInvoiceDetails(null);
			    setInvoiceDetailsError(null);
			  };

				  const closePoDetails = () => {
				    setPoDetailsOpen(false);
				    setActivePoDetails(null);
				    setPoDetailsError(null);
				    setPoDetailsSentDate('');
				  };

					  const openPoDetails = (p: { po: Po; items: PoItem[] }) => {
					    setPoDetailsError(null);
					    setActivePoDetails(p);
					    const fallbackToday = new Date().toISOString().slice(0, 10);
					    setPoDetailsSentDate(String(p.po.sentDate ?? fallbackToday).slice(0, 10) || fallbackToday);

				    const initialSupplierId =
				      String(p.po.supplierId ?? '').trim() ||
				      (suppliers.find((s) => s.name.trim().toLowerCase() === String(p.po.supplier ?? '').trim().toLowerCase())?.id ?? '');
				    setEditPoSupplierId(initialSupplierId);
				    setEditPoPaymentTerms(String(p.po.paymentTerms ?? '').trim());

				    const firmRow = pr ? firms.find((f) => f.id === pr.firmId) : undefined;
				    const firmAddress = String(firmRow?.address ?? '').trim();
					    const defaultTerms = String(firmRow?.termsConditions ?? '').trim();
				    const existingShipping = String(p.po.shippingAddress ?? '').trim();
				    const shipping = existingShipping || firmAddress;
				    const sameAsFirm = Boolean(firmAddress) && (shipping === firmAddress);
				    setEditPoShippingSameAsFirm(sameAsFirm || (!existingShipping && Boolean(firmAddress)));
				    setEditPoShippingAddress(shipping);
					    setEditPoTermsConditions(defaultTerms);

					    setEditPoLines(
					      (p.items ?? []).map((it) => {
					                            const prRow = prItems.find((r) => r.itemId === it.itemId);
					                            const poLine = selectedPo?.items?.find((x) => x.itemId === it.itemId);
					                            const specInline = (prRow?.specification || '')
					                              .split(/\r?\n/)
					                              .map((s) => s.trim())
			                              .filter(Boolean)
			                              .join(' - ');
					                            const poSpecsInline = poLine?.specificationsJson
					                              ? formatSpecsLines(poLine.specificationsJson, specNameById).join(' - ').trim()
					                              : '';
					                            const label = [prRow?.item || it.item, specInline || poSpecsInline || null].filter(Boolean).join(' - ');
					        const discPct = Number((it as any)?.discountPercent ?? 0);
					        const taxPct = Number((it as any)?.taxPercent ?? 0);
					        return {
					          itemId: it.itemId,
					          label,
					          quantity: String(it.quantity ?? ''),
					          rate: String(it.rate ?? ''),
					          discountPercent: Number.isFinite(discPct) && discPct !== 0 ? String(discPct) : '',
					          taxPercent: Number.isFinite(taxPct) && taxPct !== 0 ? String(taxPct) : '',
					        };
					      })
					    );

				    setPoDetailsOpen(true);
				  };

		  const openInvoiceDetails = (inv: InvoiceWithItems, mode: 'view' | 'edit') => {
		    setInvoiceDetailsError(null);
		    setActiveInvoiceDetails(inv);
		    setInvoiceDetailsMode(mode);
		    if (mode === 'edit') {
		      setEditInvoiceNo(inv.invoice.supplierInvoiceNo || '');
		      setEditInvoiceDate(inv.invoice.invoiceDate || new Date().toISOString().slice(0, 10));
		      setEditInvoiceAmount(
		        typeof inv.invoice.invoiceAmount === 'number' && Number.isFinite(inv.invoice.invoiceAmount) ? String(inv.invoice.invoiceAmount) : ''
		      );
		      setEditInvoiceCourierCharge(
		        typeof inv.invoice.courierCharge === 'number' && Number.isFinite(inv.invoice.courierCharge) && inv.invoice.courierCharge !== 0
		          ? String(inv.invoice.courierCharge)
		          : ''
		      );
		      setEditInvoicePackingCharge(
		        typeof inv.invoice.packingCharge === 'number' && Number.isFinite(inv.invoice.packingCharge) && inv.invoice.packingCharge !== 0
		          ? String(inv.invoice.packingCharge)
		          : ''
		      );
		      setEditInvoiceLabourCharge(
		        typeof inv.invoice.labourCharge === 'number' && Number.isFinite(inv.invoice.labourCharge) && inv.invoice.labourCharge !== 0
		          ? String(inv.invoice.labourCharge)
		          : ''
		      );
		      setEditInvoiceOtherCharge(
		        typeof inv.invoice.otherCharge === 'number' && Number.isFinite(inv.invoice.otherCharge) && inv.invoice.otherCharge !== 0
		          ? String(inv.invoice.otherCharge)
		          : ''
		      );
		      setEditInvoiceLines(
		        (inv.items ?? []).map((it) => {
	          const prRow = prItems.find((r) => r.itemId === it.itemId);
	          const specInline = (prRow?.specification || '')
	            .split(/\r?\n/)
	            .map((s) => s.trim())
	            .filter(Boolean)
	            .join(' - ');
	          const label = [prRow?.item || it.item, specInline || null].filter(Boolean).join(' - ');
	          return { itemId: it.itemId, label, quantity: String(it.quantity ?? ''), rate: String(it.rate ?? '') };
	        })
	      );
	    }
		    setInvoiceDetailsOpen(true);
		  };

		  const closeGrnDetails = () => {
		    setGrnDetailsOpen(false);
		    setActiveGrnDetails(null);
		    setGrnDetailsError(null);
		  };

			  const openGrnDetails = (grn: GrnWithItems, mode: 'view' | 'edit') => {
			    setGrnDetailsError(null);
			    setActiveGrnDetails(grn);
			    setGrnDetailsMode(mode);
				    if (mode === 'edit') {
				      setEditGrnReceivedDate(String(grn.grn.receivedDate ?? '').slice(0, 10));
				      setEditGrnUpdatedBy(String(grn.grn.updatedBy ?? ''));
				      setEditGrnMaterialReceivedBy(String(grn.grn.materialReceivedBy ?? ''));
				      setEditGrnGoodsCollectedBy(String(grn.grn.goodsCollectedBy ?? ''));
				    }
			    setGrnDetailsOpen(true);
			  };

			  const closeQcDetails = () => {
			    setQcDetailsOpen(false);
			    setActiveQcDetails(null);
			    setQcDetailsError(null);
			  };

				  const openQcDetails = (grnId: string, mode: 'view' | 'edit') => {
				    setQcDetailsError(null);
				    const rows = qcByGrnId.get(grnId) ?? [];
				    if (!rows.length) return;
			    const head = rows[0];
			    const qcDate = String(head?.qcDate ?? head?.createdAt ?? '').slice(0, 10);
			    const qcBy = String(head?.qcBy ?? '');
			    const updatedBy = String(head?.updatedBy ?? '');
			    setActiveQcDetails({
			      grnId,
			      poId: String(head?.poId ?? ''),
			      qcBy,
			      qcDate,
			      updatedBy,
			      items: rows,
			    });
			    setQcDetailsMode(mode);
			    if (mode === 'edit') {
			      setEditQcBy(qcBy);
			      setEditQcUpdatedBy(updatedBy || qcBy);
			      setEditQcLocation(location);
			      setEditQcLines(
			        rows.map((r) => {
			          const prRow = prItems.find((it) => it.itemId === r.itemId);
			          const specInline = (prRow?.specification || '')
			            .split(/\r?\n/)
			            .map((s) => s.trim())
			            .filter(Boolean)
			            .join(' - ');
				          const label = [prRow?.item || r.item, specInline || null].filter(Boolean).join(' - ');
				          const acceptedQty = Number(r.acceptedQty ?? 0);
				          const rejectedQty = Number(r.rejectedQty ?? 0);
				          return {
				            itemId: r.itemId,
				            label,
				            accepted: Number.isFinite(acceptedQty) && acceptedQty !== 0 ? String(acceptedQty) : '',
				            rejected: Number.isFinite(rejectedQty) && rejectedQty !== 0 ? String(rejectedQty) : '',
				            remarks: String(r.remarks ?? ''),
				          };
				        })
			      );
			    }
				    setQcDetailsOpen(true);
				  };

				  const closeGrnItemLinkModal = () => {
				    setGrnItemLinkModalOpen(false);
				    setGrnItemLinkInvoiceIdFilter('');
				    setActiveGrnItemLink(null);
				    setActiveGrnItemInvoiceLinks([]);
				    setGrnItemLinkQtyByInvoiceItemId({});
				    setGrnItemLinkSelectedInvoiceItemId('');
				    setGrnItemLinkSelectedQty('');
				    setGrnItemLinkLocalError(null);
				  };

		  const closeApproveDialog = () => {
		    setApproveDialogOpen(false);
		    setApproveByUserId('');
		  };
	  const closeRejectDialog = () => {
	    setRejectDialogOpen(false);
	    setRejectByUserId('');
	    setRejectReason('');
	  };

		  const headerRight = (
		    <div className="flex items-center gap-2">
		      <button
		        type="button"
		        onClick={() => (window.location.href = `/api/requests/${encodeURIComponent(requestId)}.pdf`)}
		        title="Download PR PDF"
		        aria-label="Download PR PDF"
		        className="btn btn-sm"
		      >
		        <FileText size={14} className="text-error" />
		        PR PDF
		      </button>
		      <button
		        type="button"
		        onClick={() => (window.location.href = '/api/requests.xlsx')}
		        className="btn btn-sm"
      >
        Download Excel
      </button>
      <button
        type="button"
        onClick={onBack}
        className="btn btn-sm"
      >
        Back
      </button>
    </div>
	  );

	  if (!requestId) return null;

	  if (workflow && pr && existingPosOnly) {
	    return (
	      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 shadow-sm space-y-4">
	        <div className="flex items-center justify-between gap-3">
	          <div>
	            <div className="font-headline font-bold text-sm text-on-surface">{formatPrNumber(pr?.prNumber ?? requestId)}</div>
	          </div>
	          {headerRight}
	        </div>

	        {error ? (
	          <div className="bg-error-container/40 rounded-xl border border-outline-variant p-3 text-sm text-on-surface">{error}</div>
	        ) : null}
	        {loading ? (
	          <div className="flex items-center gap-2 text-sm text-on-surface">
	            <Spinner />
	            <span>Loading...</span>
	          </div>
	        ) : null}

	        <Section>
	          <div className="text-center text-2xl font-bold text-blue-600">Purchase Orders (PO)</div>
	          {loadingPos ? <div className="text-sm text-on-surface-variant">Loading POs...</div> : null}
	          {!loadingPos && posList.length ? (
	            <div className="space-y-2">
	              <div className="text-center text-lg font-semibold text-blue-600">Existing POs</div>
	              <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
	                <div className="overflow-x-auto">
	                  <table className="w-full min-w-[1900px] table-fixed text-left border-collapse border border-outline-variant">
	                    <colgroup>
	                      <col className="w-[130px]" />
	                      <col className="w-[170px]" />
	                      <col className="w-[90px]" />
	                      <col className="w-[420px]" />
	                      <col className="w-[90px]" />
	                      <col className="w-[90px]" />
	                      <col className="w-[80px]" />
	                      <col className="w-[80px]" />
	                      <col className="w-[100px]" />
	                      <col className="w-[100px]" />
	                      <col className="w-[110px]" />
	                      <col className="w-[110px]" />
	                      <col className="w-[190px]" />
	                      <col className="w-[130px]" />
	                      <col className="w-[200px]" />
	                      <col className="w-[200px]" />
	                      <col className="w-[130px]" />
	                      <col className="w-[130px]" />
	                    </colgroup>
	                    <thead>
	                      <tr className="bg-blue-700">
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          PO No
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          Supplier
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          Terms
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          Items
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          PO Qty
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          PO Rate
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          Disc %
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          GST %
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          Invoice Qty
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          GRN Qty
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          Accepted Qty
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          Rejected Qty
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          Checked By
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          Check Date
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          Sent By
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          Sent Proof
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          Sent Date
	                        </th>
	                        <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">
	                          Actions
	                        </th>
	                      </tr>
	                    </thead>
	                    <tbody>
	                      {(posList ?? []).flatMap((p) => {
	                        const items = Array.isArray(p.items) ? p.items : [];
	                        const safeItems = items.length ? items : [null];
	                        const rowSpan = safeItems.length;
	                        const keyPrefix = `existing-pos-only-${p.po.id}`;
	                        return safeItems.map((it, idx) => (
	                          <tr key={`${keyPrefix}-${String((it as any)?.itemId ?? 'empty')}-${idx}`}>
	                            {idx === 0 ? (
	                              <>
	                                <td rowSpan={rowSpan} className="px-2 py-2 text-sm font-semibold text-on-surface border border-outline-variant align-top">
	                                  {formatPoNumber((p as any)?.po?.poNumber ?? '') || '-'}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-outline-variant align-top">
	                                  {p.po.supplier || '-'}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-outline-variant align-top">
	                                  {p.po.paymentTerms || '-'}
	                                </td>
	                              </>
	                            ) : null}
	                            <td className="px-2 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words align-top">
	                              {it ? formatPoItemLabel(String((it as any)?.itemId ?? '').trim(), String((it as any)?.item ?? '')) : '-'}
	                            </td>
	                            <td className="px-2 py-2 text-sm text-on-surface border border-outline-variant tabular-nums align-top">
	                              {it ? Number((it as any)?.quantity ?? 0) : 0}
	                            </td>
	                            <td className="px-2 py-2 text-sm text-on-surface border border-outline-variant tabular-nums align-top">
	                              {it ? Number((it as any)?.rate ?? 0) : 0}
	                            </td>
	                            <td className="px-2 py-2 text-sm text-on-surface border border-outline-variant tabular-nums align-top">
	                              {it ? Number((it as any)?.discountPercent ?? 0) : 0}
	                            </td>
	                            <td className="px-2 py-2 text-sm text-on-surface border border-outline-variant tabular-nums align-top">
	                              {it ? Number((it as any)?.taxPercent ?? 0) : 0}
	                            </td>
	                            {idx === 0 ? (
	                              <>
	                                <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-outline-variant tabular-nums align-top">
	                                  {Number((p as any)?.po?.invoiceQty ?? 0)}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-outline-variant tabular-nums align-top">
	                                  {Number((p as any)?.po?.grnQty ?? 0)}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-outline-variant tabular-nums align-top">
	                                  {Number((p as any)?.po?.acceptedQty ?? 0)}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-outline-variant tabular-nums align-top">
	                                  {Number((p as any)?.po?.rejectedQty ?? 0)}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-outline-variant align-top">
	                                  {(() => {
	                                    const checkedById = String((p as any)?.po?.checkPoUserId ?? '').trim();
	                                    if (!checkedById) return '-';
	                                    return userNameById.get(checkedById) ?? checkedById;
	                                  })()}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-outline-variant align-top">
	                                  {String((p as any)?.po?.checkDate ?? '') || '-'}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-outline-variant align-top">
	                                  {(() => {
	                                    const sentById = String((p as any)?.po?.sentBy ?? '').trim();
	                                    if (!sentById) return '-';
	                                    return userNameById.get(sentById) ?? sentById;
	                                  })()}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-outline-variant align-top">
	                                  {String((p as any)?.po?.sentProof ?? '') ? (
	                                    <button type="button" className="btn btn-sm" onClick={() => openDocument(String((p as any)?.po?.sentProof ?? ''))}>
	                                      View
	                                    </button>
	                                  ) : (
	                                    '-'
	                                  )}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-outline-variant align-top">
	                                  {String((p as any)?.po?.sentDate ?? '') || '-'}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-outline-variant align-top">
	                                  -
	                                </td>
	                              </>
	                            ) : null}
	                          </tr>
	                        ));
	                      })}
	                    </tbody>
	                  </table>
	                </div>
	              </div>
	            </div>
	          ) : (
	            <div className="text-sm text-on-surface-variant">No POs found.</div>
	          )}
	        </Section>
	      </div>
	    );
	  }

	  if (workflow && pr && recordedGrnsOnly) {
	    return (
	      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 shadow-sm space-y-4">
	        <div className="flex items-center justify-between gap-3">
	          <div>
	            <div className="font-headline font-bold text-sm text-on-surface">{formatPrNumber(pr?.prNumber ?? requestId)}</div>
	          </div>
	          {headerRight}
	        </div>

	        {error ? (
	          <div className="bg-error-container/40 rounded-xl border border-outline-variant p-3 text-sm text-on-surface">{error}</div>
	        ) : null}

	        <Section>
	          <div className="text-center text-2xl font-bold text-blue-600">GRN</div>
	          {loadingRecordedGrns ? <div className="pt-2 text-sm text-on-surface-variant">Loading GRNs...</div> : null}
	          {!loadingRecordedGrns && recordedGrns.length ? (
	            <div className="pt-2 space-y-2">
	              <div className="text-center text-lg font-semibold text-blue-600">Recorded GRNs ({recordedGrns.length})</div>
	              <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
	                <div className="overflow-x-auto">
	                  <table className="w-full min-w-[1440px] table-fixed text-left border-collapse border border-outline-variant">
	                    <colgroup>
	                      <col className="w-[170px]" />
	                      <col className="w-[170px]" />
	                      <col className="w-[140px]" />
	                      <col className="w-[520px]" />
	                      <col className="w-[110px]" />
	                      <col className="w-[170px]" />
	                      <col className="w-[160px]" />
	                    </colgroup>
	                    <thead>
	                      <tr className="bg-blue-700">
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GRN</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO Number</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Received Date</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Item</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Qty</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Updated By</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Action</th>
	                      </tr>
	                    </thead>
	                    <tbody>
	                      {recordedGrns.flatMap((g) => {
	                        const lines = Array.isArray(g.items) && g.items.length ? g.items : [null];
	                        const rowSpan = lines.length;
	                        const updatedByCell =
	                          g.grn.updatedBy != null
	                            ? users.find((u) => u.id === g.grn.updatedBy)?.name ?? String(g.grn.updatedBy)
	                            : '-';

	                        return lines.map((it: any, idx: number) => {
	                          const prRow = it ? prItems.find((r) => r.itemId === it.itemId) : null;
	                          const specInline = (prRow?.specification || '')
	                            .split(/\r?\n/)
	                            .map((s) => s.trim())
	                            .filter(Boolean)
	                            .join(' - ');
	                          const label = it ? [prRow?.item || it.item, specInline || null].filter(Boolean).join(' - ') : '-';
	                          const qtyCell = it ? Number(it.quantityReceived ?? 0) : '-';

	                          return (
	                            <tr key={`${g.grn.id}||${it ? it.itemId : 'empty'}||${idx}`}>
	                              {idx === 0 ? (
	                                <>
	                                  <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
	                                    {displayGrnNumber(g.grn)}
	                                  </td>
	                                  <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
	                                    {displayPoNumberById(g.grn.poId)}
	                                  </td>
	                                  <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
	                                    {formatDateDDMMYYYYOnly(g.grn.receivedDate)}
	                                  </td>
	                                </>
	                              ) : null}
	                              <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
	                                <div className="whitespace-normal break-words">{renderInlineWithBoldSpecNames(label)}</div>
	                              </td>
	                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{qtyCell}</td>
	                              {idx === 0 ? (
	                                <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
	                                  {updatedByCell}
	                                </td>
	                              ) : null}
	                              {idx === 0 ? (
	                                <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
	                                  <div className="flex items-center gap-2">
	                                    <button
	                                      type="button"
	                                      title="View"
	                                      aria-label="View"
	                                      className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-on-primary shadow-sm hover:bg-primary-dim transition-colors"
	                                      onClick={() => openGrnDetails(g, 'view')}
	                                    >
	                                      <Eye size={16} />
	                                    </button>
	                                    <button
	                                      type="button"
	                                      title="Edit"
	                                      aria-label="Edit"
	                                      className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-on-primary shadow-sm hover:bg-primary-dim transition-colors"
	                                      onClick={() => openGrnDetails(g, 'edit')}
	                                    >
	                                      <Pencil size={16} />
	                                    </button>
	                                  </div>
	                                </td>
	                              ) : null}
	                            </tr>
	                          );
	                        });
	                      })}
	                    </tbody>
	                  </table>
	                </div>
	              </div>
	            </div>
	          ) : !loadingRecordedGrns ? (
	            <div className="text-sm text-on-surface-variant text-center">No recorded GRNs.</div>
	          ) : null}
	        </Section>
	      </div>
	    );
	  }

	  if (workflow && pr && recordedInvoicesOnly) {
	    return (
	      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 shadow-sm space-y-4">
	        <div className="flex items-center justify-between gap-3">
	          <div>
	            <div className="font-headline font-bold text-sm text-on-surface">{formatPrNumber(pr?.prNumber ?? requestId)}</div>
	          </div>
	          {headerRight}
	        </div>

	        {error ? (
	          <div className="bg-error-container/40 rounded-xl border border-outline-variant p-3 text-sm text-on-surface">{error}</div>
	        ) : null}

	        <Section>
	          <div className="text-center text-2xl font-bold text-blue-600">Invoices</div>
	          {invoicesForPr.length ? (
	            <div className="space-y-2">
	              <div className="text-center text-lg font-semibold text-blue-600">Recorded Invoices ({invoicesForPr.length})</div>
	              <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
	                <div className="overflow-x-auto">
	                  <table className="w-full min-w-[2650px] table-fixed text-left border-collapse border border-outline-variant border-black [&_th]:border-black [&_td]:border-black">
	                    <colgroup>
	                      <col className="w-[140px]" />
	                      <col className="w-[180px]" />
	                      <col className="w-[140px]" />
	                      <col className="w-[120px]" />
	                      <col className="w-[120px]" />
	                      <col className="w-[120px]" />
	                      <col className="w-[120px]" />
	                      <col className="w-[120px]" />
	                      <col className="w-[120px]" />
	                      <col className="w-[140px]" />
	                      <col className="w-[520px]" />
	                      <col className="w-[110px]" />
	                      <col className="w-[110px]" />
	                      <col className="w-[110px]" />
	                      <col className="w-[140px]" />
	                      <col className="w-[110px]" />
	                      <col className="w-[140px]" />
	                      <col className="w-[160px]" />
	                    </colgroup>
	                    <thead>
	                      <tr className="bg-blue-700">
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Invoice No</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Invoice Date</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Amount</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Courier Charge</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Packing Charge</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Labour Charge</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Other Charge</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Status</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Payment Status</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Item</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Inv Qty</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO Rate</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Inv Rate</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Effective Item Price</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GRN Qty</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Created At</th>
	                        <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Action</th>
	                      </tr>
	                    </thead>
	                    <tbody>
	                      {invoicesForPr.flatMap((inv) => {
	                        const lines = Array.isArray(inv.items) && inv.items.length ? inv.items : [null];
	                        const rowSpan = lines.length;
	                        const amountCell =
	                          typeof inv.invoice.invoiceAmount === 'number' && Number.isFinite(inv.invoice.invoiceAmount) ? inv.invoice.invoiceAmount.toFixed(2) : '-';
	                        const courierChargeCell =
	                          typeof inv.invoice.courierCharge === 'number' && Number.isFinite(inv.invoice.courierCharge) ? inv.invoice.courierCharge.toFixed(2) : '-';
	                        const packingChargeCell =
	                          typeof inv.invoice.packingCharge === 'number' && Number.isFinite(inv.invoice.packingCharge) ? inv.invoice.packingCharge.toFixed(2) : '-';
	                        const labourChargeCell =
	                          typeof inv.invoice.labourCharge === 'number' && Number.isFinite(inv.invoice.labourCharge) ? inv.invoice.labourCharge.toFixed(2) : '-';
	                        const otherChargeCell =
	                          typeof inv.invoice.otherCharge === 'number' && Number.isFinite(inv.invoice.otherCharge) ? inv.invoice.otherCharge.toFixed(2) : '-';

	                        return lines.map((it: any, idx: number) => (
	                          <tr key={`${inv.invoice.id}||${it ? it.itemId : 'empty'}||${idx}`}>
	                            {idx === 0 ? (
	                              <>
	                                <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
	                                  {displayPoNumberById(inv.invoice.poId)}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
	                                  {inv.invoice.supplierInvoiceNo || inv.invoice.id}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
	                                  {formatDateDDMMYYYYOnly(inv.invoice.invoiceDate)}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top tabular-nums">
	                                  {amountCell}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top tabular-nums">
	                                  {courierChargeCell}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top tabular-nums">
	                                  {packingChargeCell}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top tabular-nums">
	                                  {labourChargeCell}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top tabular-nums">
	                                  {otherChargeCell}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
	                                  {inv.invoice.status ?? '-'}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
	                                  {inv.invoice.paymentStatus ?? '-'}
	                                </td>
	                              </>
	                            ) : null}
	                            <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
	                              <div className="whitespace-normal break-words">{it ? renderInlineWithBoldSpecNames(it.item ?? '-') : '-'}</div>
	                            </td>
	                            <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{it ? Number(it.quantity ?? 0) : '-'}</td>
	                            <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{it ? Number(it.poRate ?? it.rate ?? 0) : '-'}</td>
	                            <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{it ? Number(it.rate ?? 0) : '-'}</td>
	                            <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{it ? Number(it.effectiveItemPrice ?? 0) : '-'}</td>
	                            <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{it ? Number(it.grnQty ?? 0) : '-'}</td>
	                            {idx === 0 ? (
	                              <>
	                                <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
	                                  {formatDateDDMMYYYYOnly(inv.invoice.createdAt)}
	                                </td>
	                                <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
	                                  <div className="flex items-center gap-2">
	                                    <button
	                                      type="button"
	                                      title="View"
	                                      aria-label="View"
	                                      className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-on-primary shadow-sm hover:bg-primary-dim transition-colors"
	                                      onClick={() => openInvoiceDetails(inv, 'view')}
	                                    >
	                                      <Eye size={16} />
	                                    </button>
	                                    <button
	                                      type="button"
	                                      title="Edit"
	                                      aria-label="Edit"
	                                      className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-on-primary shadow-sm hover:bg-primary-dim transition-colors"
	                                      onClick={() => openInvoiceDetails(inv, 'edit')}
	                                    >
	                                      <Pencil size={16} />
	                                    </button>
	                                  </div>
	                                </td>
	                              </>
	                            ) : null}
	                          </tr>
	                        ));
	                      })}
	                    </tbody>
	                  </table>
	                </div>
	              </div>
	            </div>
	          ) : (
	            <div className="text-sm text-on-surface-variant text-center">No recorded invoices.</div>
	          )}
	        </Section>
	      </div>
	    );
	  }

	  return (
		    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
	          <div className="font-headline font-bold text-sm text-on-surface">{formatPrNumber(pr?.prNumber ?? requestId)}</div>
        </div>
        {headerRight}
      </div>

      {error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant p-3 text-sm text-on-surface">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-on-surface">
          <Spinner />
          <span>Loading...</span>
        </div>
      ) : null}

      {workflow && pr ? (
        <div className="space-y-4">
	          <Section>
	            <div className="flex items-center justify-between">
	              <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider', statusPillClass(pr.status))}>
	                {pr.status}
	              </span>
	            </div>
	            <div className="text-base text-on-surface-variant flex flex-col gap-1 md:flex-row md:flex-nowrap md:items-center md:gap-6 overflow-x-auto">
	              <span className="whitespace-nowrap">
	                <span className="font-bold text-on-surface-variant">Firm:</span> <span className="text-on-surface">{firmName}</span>
	              </span>
	              <span className="whitespace-nowrap">
	                <span className="font-bold text-on-surface-variant">Department:</span> <span className="text-on-surface">{pr.department}</span>
	              </span>
	              <span className="whitespace-nowrap">
	                <span className="font-bold text-on-surface-variant">Required Date:</span>{' '}
	                <span className="text-on-surface">{formatDateDDMMYYYYOnly(pr.requiredDate)}</span>
	              </span>
	              <span className="whitespace-nowrap">
	                <span className="font-bold text-on-surface-variant">Requested By:</span> <span className="text-on-surface">{pr.requestedBy}</span>
	              </span>
	              <span className="whitespace-nowrap">
	                <span className="font-bold text-on-surface-variant">Request Type:</span>{' '}
	                <span className="text-on-surface">{pr.requestType ?? 'Stock'}</span>
	              </span>
	              {pr.requestType === 'Project' ? (
	                <span className="whitespace-nowrap">
	                  <span className="font-bold text-on-surface-variant">Project Name:</span>{' '}
	                  <span className="text-on-surface">{pr.projectName ?? pr.projectId ?? '-'}</span>
	                </span>
	              ) : null}
	            </div>
				            {!isDirectPoRequest ? (
				            <div className="space-y-2">
						              <div className="text-base font-semibold text-on-surface-variant">Items</div>
				              <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-black">
				                <div className="overflow-x-auto">
					                  <table className={cn('w-full table-fixed text-left border-collapse border border-black', showApprovedPrItemSummaryCols ? 'min-w-[1200px]' : '')}>
					                    <colgroup>
					                      <col className={showApprovedPrItemSummaryCols ? 'w-[220px]' : 'w-[240px]'} />
					                      <col className={showApprovedPrItemSummaryCols ? 'w-[90px]' : 'w-[140px]'} />
					                      {showApprovedPrItemSummaryCols ? (
					                        <>
					                          <col className="w-[140px]" />
				                          <col className="w-[160px]" />
				                          <col className="w-[140px]" />
				                          <col className="w-[140px]" />
				                          <col className="w-[140px]" />
				                        </>
				                      ) : null}
				                    </colgroup>
					                    <thead>
					                      <tr className="bg-surface-container-high">
						                        <th className="px-3 py-2 text-sm font-bold text-on-surface-variant uppercase tracking-widest border border-black">Item</th>
						                        <th className="px-3 py-2 text-sm font-bold text-on-surface-variant uppercase tracking-widest border border-black">Qty</th>
						                        {showApprovedPrItemSummaryCols ? (
						                          <>
						                            <th className="px-3 py-2 text-sm font-bold text-on-surface-variant uppercase tracking-widest border border-black">
					                              Total PO Quantity
					                            </th>
					                            <th className="px-3 py-2 text-sm font-bold text-on-surface-variant uppercase tracking-widest border border-black">
					                              Total Invoice Quantity
					                            </th>
					                            <th className="px-3 py-2 text-sm font-bold text-on-surface-variant uppercase tracking-widest border border-black">
					                              Total GRN Quantity
					                            </th>
					                            <th className="px-3 py-2 text-sm font-bold text-on-surface-variant uppercase tracking-widest border border-black">
					                              Approved Quantity
					                            </th>
					                            <th className="px-3 py-2 text-sm font-bold text-on-surface-variant uppercase tracking-widest border border-black">
					                              Rejected Quantity
					                            </th>
					                          </>
					                        ) : null}
				                      </tr>
				                    </thead>
				                    <tbody>
					                      {(pr?.status === 'Pending Approval' ? draftPrItems : prItems).length ? (
						                        (pr?.status === 'Pending Approval' ? draftPrItems : prItems).map((it, idx) => (
						                          <tr key={`${String((it as any).id ?? String((it as any).itemId ?? it.item))}-${idx}`}>
						                            <td className="px-3 py-2 text-base font-semibold text-on-surface break-words border border-black align-top">
						                              {pr?.status === 'Pending Approval' ? (
						                                <div className="space-y-1">
						                                  <SearchableSelect
						                                    value={String(it.itemId ?? '').trim()}
						                                    options={masterItemOptions}
					                                    disabled={busy || loadingMasterItems}
					                                    placeholder={loadingMasterItems ? 'Loading items...' : 'Select item...'}
					                                    onChange={(val) => {
					                                      const nextItemId = String(val ?? '').trim();
					                                      const master = nextItemId ? masterItemById.get(nextItemId) : undefined;
					                                      const nextItemName = master?.itemName ?? '';
					                                      const nextSpec = master ? formatSpecsLines(master.specificationsJson).join('\n') : '';
						                                      setDraftPrItems((prev) =>
						                                        prev.map((x) =>
						                                          x.id === it.id
						                                            ? {
						                                                ...x,
					                                                itemId: nextItemId,
					                                                item: nextItemName,
					                                                specification: nextSpec,
					                                              }
						                                            : x
						                                        )
						                                      );
						                                    }}
						                                  />
						                                  {String(it.item ?? '').trim() ? (
						                                    <div className="text-xs text-on-surface-variant whitespace-normal break-words">
						                                      {formatItemWithSpecText(String(it.item ?? ''), String(it.specification ?? ''))}
						                                    </div>
						                                  ) : null}
						                                </div>
						                              ) : (
						                                <span className="whitespace-normal break-words">{formatItemWithSpecText(String(it.item ?? ''), String(it.specification ?? ''))}</span>
						                              )}
						                            </td>
						                            <td className="px-3 py-2 text-base text-on-surface-variant border border-black align-top">
						                              {pr?.status === 'Pending Approval' ? (
					                                <div className="flex items-center gap-2">
				                                  <input
				                                    type="number"
			                                    min={1}
			                                    step={1}
			                                    className={cn(tableInputClass, 'h-9 border-black', it.quantity > 0 ? '' : 'border-error')}
			                                    value={String(it.quantity ?? 0)}
			                                    onChange={(e) => {
			                                      const v = e.target.value;
			                                      const n = v === '' ? 0 : Number(v);
			                                      setDraftPrItems((prev) =>
			                                        prev.map((x) => (x.id === it.id ? { ...x, quantity: Number.isFinite(n) ? n : x.quantity } : x))
			                                      );
			                                    }}
			                                  />
				                                  <button
				                                    type="button"
				                                    className="btn-icon-danger"
				                                    title="Delete item row"
				                                    aria-label="Delete item row"
				                                    onClick={() => {
				                                      if (!window.confirm('Delete this PR item row?')) return;
				                                      setDraftPrItems((prev) => prev.filter((x) => x.id !== it.id));
			                                    }}
			                                  >
			                                    <Trash2 size={16} />
			                                  </button>
			                                </div>
			                              ) : (
						                                it.quantity
						                              )}
					                            </td>
					                            {showApprovedPrItemSummaryCols ? (
					                              <>
					                                <td className="px-3 py-2 text-base text-on-surface-variant border border-black align-top tabular-nums text-right">
					                                  {totalPoQtyByItemId[String(it.itemId ?? '').trim()] ?? 0}
					                                </td>
					                                <td className="px-3 py-2 text-base text-on-surface-variant border border-black align-top tabular-nums text-right">
					                                  {totalInvoiceQtyByItemId[String(it.itemId ?? '').trim()] ?? 0}
					                                </td>
					                                <td className="px-3 py-2 text-base text-on-surface-variant border border-black align-top tabular-nums text-right">
					                                  {totalGrnQtyByItemId[String(it.itemId ?? '').trim()] ?? 0}
					                                </td>
					                                <td className="px-3 py-2 text-base text-on-surface-variant border border-black align-top tabular-nums text-right">
					                                  {totalApprovedQtyByItemId[String(it.itemId ?? '').trim()] ?? 0}
					                                </td>
					                                <td className="px-3 py-2 text-base text-on-surface-variant border border-black align-top tabular-nums text-right">
					                                  {totalRejectedQtyByItemId[String(it.itemId ?? '').trim()] ?? 0}
					                                </td>
					                              </>
					                            ) : null}
					                          </tr>
					                        ))
					                      ) : (
				                        <tr>
				                          <td
				                            colSpan={showApprovedPrItemSummaryCols ? 8 : 3}
				                            className="px-4 py-6 text-sm text-on-surface-variant text-center border border-black"
				                          >
				                            No items.
				                          </td>
				                        </tr>
				                      )}
				                    </tbody>
			                  </table>
			                </div>
			              </div>
		              {/*
		              {prItems.map((it) => (
		                <div key={it.item} className="text-sm text-on-surface">
		                  <div className="font-medium">
                    {it.item} â€” Qty {it.quantity}
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
		            ) : null}
		            {pr.status === 'Pending Approval' ? (
		              <div className="flex justify-end gap-2">
		                <button
		                  type="button"
		                  disabled={busy || loadingMasterItems}
		                  className="btn-primary btn-sm disabled:opacity-50"
		                  onClick={() => {
		                    const tempId = `NEW-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		                    setDraftPrItems((prev) => [
		                      ...prev,
		                      {
		                        id: tempId,
		                        prId: pr.id,
		                        itemId: '',
		                        item: '',
		                        quantity: 1,
		                        specification: '',
		                      },
		                    ]);
		                  }}
		                >
		                  + Add Item
		                </button>
		                <button
		                  type="button"
		                  disabled={busy}
			                  className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
			                  onClick={() => {
		                    setError(null);
		                    setApproveByUserId('');
		                    setApproveDialogOpen(true);
		                  }}
		                >
	                  Approve PR
	                </button>
	                <button
	                  type="button"
	                  disabled={busy}
		                  className="btn btn-sm disabled:opacity-50"
		                  onClick={() => {
		                    setError(null);
		                    setRejectByUserId('');
		                    setRejectReason('');
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
                    className="btn btn-sm"
                    onClick={closeApproveDialog}
                  >
                    Close
                  </button>
	                </div>
	                <div className="p-5 space-y-3">
	                  <Field label="Approved By">
	                    <SearchableSelect
	                      value={approveByUserId}
	                      options={users.map((u) => ({ value: u.id, label: u.name }))}
	                      onChange={setApproveByUserId}
	                      disabled={busy || loadingUsers}
	                      placeholder={loadingUsers ? 'Loading users...' : 'Select user...'}
	                    />
	                  </Field>
	                  <div className="-mx-5 mt-4 px-5 py-4 border-t border-outline-variant/10 bg-surface-container-low flex justify-end gap-2">
	                    <button
	                      type="button"
	                      className="btn btn-sm"
                      onClick={closeApproveDialog}
                    >
                      Cancel
	                    </button>
	                    <button
	                      type="button"
	                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
	                      disabled={busy || !approveByUserId.trim()}
		                      onClick={() => {
		                        const by = users.find((u) => u.id === approveByUserId)?.name ?? '';
		                        if (!by) {
		                          setError('Approved By is required.');
		                          return;
		                        }
		                        const lines = draftPrItems.slice();
		                        if (!lines.length) {
		                          setError('At least one item is required to approve a PR.');
		                          return;
		                        }
			                        if (lines.some((l) => !Number.isFinite(Number(l.quantity)) || Number(l.quantity) <= 0)) {
			                          setError('All item quantities must be greater than 0.');
			                          return;
			                        }
			                        if (lines.some((l) => !String(l.itemId ?? '').trim() || !String(l.item ?? '').trim())) {
			                          setError('All item rows must have an item selected.');
			                          return;
			                        }
			                        closeApproveDialog();
		                        run(() =>
		                          approvePr(
		                            pr.id,
		                            by,
		                            lines.map((l) => ({
		                              id: String(l.id ?? '').trim(),
		                              quantity: Number(l.quantity),
		                              itemId: String(l.itemId ?? '').trim(),
		                              item: String(l.item ?? '').trim(),
		                              specification: String(l.specification ?? ''),
		                            }))
		                          )
		                        );
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
                    className="btn btn-sm"
                    onClick={closeRejectDialog}
                  >
                    Close
                  </button>
	                </div>
	                <div className="p-5 space-y-3">
	                  <Field label="Rejected By">
	                    <SearchableSelect
	                      value={rejectByUserId}
	                      options={users.map((u) => ({ value: u.id, label: u.name }))}
	                      onChange={setRejectByUserId}
	                      disabled={busy || loadingUsers}
	                      placeholder={loadingUsers ? 'Loading users...' : 'Select user...'}
	                    />
	                  </Field>
	                  <Field label="Reason (Required)">
	                    <input
	                      className={inputClass}
	                      value={rejectReason}
	                      onChange={(e) => setRejectReason(e.target.value)}
	                      onKeyDown={(e) => {
	                        if (e.key === 'Escape') closeRejectDialog();
	                        if (e.key === 'Enter') {
	                          const by = users.find((u) => u.id === rejectByUserId)?.name ?? '';
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
	                  <div className="-mx-5 mt-4 px-5 py-4 border-t border-outline-variant/10 bg-surface-container-low flex justify-end gap-2">
	                    <button
	                      type="button"
	                      className="btn btn-sm"
                      onClick={closeRejectDialog}
                    >
                      Cancel
                    </button>
	                    <button
	                      type="button"
	                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
	                      disabled={busy || !rejectByUserId.trim() || !rejectReason.trim()}
	                      onClick={() => {
	                        const by = users.find((u) => u.id === rejectByUserId)?.name ?? '';
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

	          <Section>
	            <div className="text-center text-2xl font-bold text-blue-600">Purchase Orders (PO)</div>
		            {loadingPos ? <div className="text-sm text-on-surface-variant">Loading POs...</div> : null}
			            {!loadingPos && posList.length ? (
			              <div className="space-y-2">
					                <div id="existing-pos-section" className="text-center text-lg font-semibold text-blue-600">
					                  Existing POs
					                </div>
						                <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
						                  <div className="overflow-x-auto">
									                    <table className="w-full min-w-[1900px] table-fixed text-left border-collapse border border-outline-variant">
								                      <colgroup>
								                        <col className="w-[130px]" />
								                        <col className="w-[170px]" />
								                        <col className="w-[90px]" />
								                        <col className="w-[420px]" />
								                        <col className="w-[90px]" />
								                        <col className="w-[90px]" />
								                        <col className="w-[80px]" />
								                        <col className="w-[80px]" />
								                        <col className="w-[100px]" />
								                        <col className="w-[100px]" />
								                        <col className="w-[110px]" />
								                        <col className="w-[110px]" />
								                        <col className="w-[190px]" />
								                        <col className="w-[130px]" />
								                        <col className="w-[200px]" />
								                        <col className="w-[200px]" />
								                        <col className="w-[130px]" />
								                        <col className="w-[130px]" />
								                      </colgroup>
						                      <thead>
						                        <tr className="bg-blue-700">
							                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">PO No</th>
							                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">Supplier</th>
							                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">Terms</th>
							                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">Items</th>
								                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">PO Qty</th>
									                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">PO Rate</th>
								                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">Disc %</th>
									                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">GST %</th>
								                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">Invoice Qty</th>
						                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">GRN Qty</th>
								                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">Accepted Qty</th>
								                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">Rejected Qty</th>
									                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">Checked By</th>
									                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">Check Date</th>
									                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">Sent By</th>
									                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">Sent Proof</th>
									                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">Sent Date</th>
									                          <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant whitespace-normal break-words leading-tight">Actions</th>
								                        </tr>
								                      </thead>
					                      <tbody>
					                        {posList.flatMap((p) => {
				                          const lines = Array.isArray(p.items) && p.items.length ? p.items : [null];
				                          const rowSpan = lines.length;
				                          const poHasInvoice = invoicesForPr.some((inv) => inv.invoice.poId === p.po.id);
				                          return lines.map((it, idx) => {
			                            const prRow = it ? prItems.find((r) => r.itemId === it.itemId) : null;
			                            const specInline = (prRow?.specification || '')
			                              .split(/\r?\n/)
			                              .map((s) => s.trim())
			                              .filter(Boolean)
			                              .join(' - ');
					                            const label = it ? [prRow?.item || it.item, specInline || null].filter(Boolean).join(' - ') : '-';
					                            const poQtyNumber = it ? Number(it.quantity ?? 0) : NaN;
					                            const invQtyNumber = it ? Number(invoicedQtyByPoAndItemId[`${p.po.id}||${it.itemId}`] ?? 0) : NaN;
					                            const grnQtyNumber = it ? Number(grnQtyByPoAndItemId[`${p.po.id}||${it.itemId}`] ?? 0) : NaN;
					                            const poQtyCell = it ? poQtyNumber : '-';
					                            const rateCell = it ? it.rate : '-';
					                            const discCell = it ? (it as any).discountPercent ?? '-' : '-';
					                            const taxCell = it ? (it as any).taxPercent ?? '-' : '-';
					                            const invQtyCell = it ? invQtyNumber : '-';
					                            const grnQtyCell = it ? grnQtyNumber : '-';
					                            const invQtyMismatch =
					                              it && Number.isFinite(poQtyNumber) && Number.isFinite(invQtyNumber) && Math.abs(invQtyNumber - poQtyNumber) > 1e-9;
					                            const grnQtyMismatch =
					                              it && Number.isFinite(poQtyNumber) && Number.isFinite(grnQtyNumber) && Math.abs(grnQtyNumber - poQtyNumber) > 1e-9;
					                            const qtyMismatch = Boolean(invQtyMismatch || grnQtyMismatch);
					                            const qcAcceptedCell = it ? Number(qcAcceptedByPoAndItemId[`${p.po.id}||${it.itemId}`] ?? 0) : '-';
					                            const qcRejectedCell = it ? Number(qcRejectedByPoAndItemId[`${p.po.id}||${it.itemId}`] ?? 0) : '-';
					                            const today = new Date().toISOString().slice(0, 10);
					                            const checkedByName = users.find((u) => u.id === (p.po.checkPoUserId ?? ''))?.name ?? '';
					                            const sentByName = users.find((u) => u.id === (p.po.sentBy ?? ''))?.name ?? '';
					                            return (
					                              <tr key={`${p.po.id}||${it ? it.itemId : 'empty'}||${idx}`} id={idx === 0 ? poRowDomId(p.po.id) : undefined}>
				                                {idx === 0 ? (
				                                  <>
						                                    <td rowSpan={rowSpan} className="px-2 py-2 text-base font-semibold text-on-surface border border-outline-variant align-top break-words">
				                        {formatPoNumber((p as any)?.po?.poNumber ?? '') || '-'}
						                                    </td>
				                                    <td rowSpan={rowSpan} className="px-2 py-2 text-base text-on-surface border border-outline-variant align-top break-words">
				                                      {p.po.supplier || '-'}
				                                    </td>
				                                    <td rowSpan={rowSpan} className="px-2 py-2 text-base text-on-surface-variant border border-outline-variant align-top break-words">
				                                      {p.po.paymentTerms || '-'}
				                                    </td>
			                                  </>
			                                ) : null}

						                                <td
						                                  className={`px-2 py-2 text-base text-on-surface-variant border border-outline-variant ${qtyMismatch ? 'bg-red-100' : ''}`}
						                                >
							                                  {renderInlineWithBoldSpecNames(label)}
							                                </td>
						                                <td className="px-2 py-2 text-base text-on-surface-variant border border-outline-variant">{poQtyCell}</td>
						                                <td className="px-2 py-2 text-base text-on-surface-variant border border-outline-variant">{rateCell}</td>
						                                <td className="px-2 py-2 text-base text-on-surface-variant border border-outline-variant">{discCell}</td>
						                                <td className="px-2 py-2 text-base text-on-surface-variant border border-outline-variant">{taxCell}</td>
						                                <td
						                                  className={`px-2 py-2 text-base text-on-surface-variant border border-outline-variant ${invQtyMismatch ? 'bg-red-100' : ''}`}
						                                >
						                                  {invQtyCell}
						                                </td>
					                                <td
					                                  className={`px-2 py-2 text-base text-on-surface-variant border border-outline-variant ${grnQtyMismatch ? 'bg-red-100' : ''}`}
					                                >
					                                  {grnQtyCell}
					                                </td>
					                                <td className="px-2 py-2 text-base text-on-surface-variant border border-outline-variant">{qcAcceptedCell}</td>
						                                <td className="px-2 py-2 text-base text-on-surface-variant border border-outline-variant">{qcRejectedCell}</td>

				                                {idx === 0 ? (
				                                  <>
								                                    <td rowSpan={rowSpan} className="px-2 py-2 text-base border border-outline-variant align-top whitespace-normal break-words">
								                                      <div className="space-y-1">
								                                        <SearchableSelect
								                                          options={users.map((u) => ({ value: u.id, label: u.name }))}
								                                          value={p.po.checkPoUserId ?? ''}
								                                          onChange={(val) => {
								                                            const selectedUserId = String(val ?? '').trim();
								                                            const checked = Boolean(selectedUserId);
								                                            const nextCheckDate = checked ? today : null;
								                                            const next = {
								                                              checkPo: checked,
								                                              checkPoUserId: selectedUserId || null,
								                                              checkDate: nextCheckDate,
								                                              sentBy: null,
								                                              sentDate: null,
								                                              sentProof: null,
								                                            };
								                                            run(() =>
								                                              updatePoCheckAndSent(p.po.id, {
								                                                ...next,
								                                                updatedBy: 'system',
								                                              }).then((r) => {
								                                                if (r.po) setPosList((prev) => prev.map((x) => (x.po.id === p.po.id ? r.po! : x)));
								                                                return undefined;
								                                              })
								                                            );
								                                          }}
								                                          placeholder="Select user"
								                                          disabled={busy || Boolean(p.po.sentBy)}
								                                        />
									                                        {p.po.checkPoUserId || p.po.checkPo ? (
									                                          <div className="flex items-start justify-between gap-2">
									                                            <div className="text-xs text-on-surface-variant whitespace-normal break-words">
									                                              {checkedByName || p.po.checkPoUserId || '-'}
									                                            </div>
									                                            {!p.po.sentBy ? (
									                                              <button
									                                                type="button"
									                                                disabled={busy}
									                                                className="px-2 py-1 text-[11px] font-semibold text-on-primary bg-error rounded-md hover:bg-error/90 disabled:opacity-50"
									                                                onClick={() => {
									                                                  run(() =>
									                                                    updatePoCheckAndSent(p.po.id, {
									                                                      checkPo: false,
									                                                      checkPoUserId: null,
									                                                      checkDate: null,
									                                                      sentBy: null,
									                                                      sentDate: null,
									                                                      sentProof: null,
									                                                      updatedBy: 'system',
									                                                    }).then((r) => {
									                                                      if (r.po) setPosList((prev) => prev.map((x) => (x.po.id === p.po.id ? r.po! : x)));
									                                                      return undefined;
									                                                    })
									                                                  );
									                                                }}
									                                              >
									                                                Clear
									                                              </button>
									                                            ) : null}
									                                          </div>
									                                        ) : null}
									                                      </div>
									                                    </td>
						                                    <td rowSpan={rowSpan} className="px-2 py-2 text-base border border-outline-variant align-top whitespace-normal break-words">
							                                      <div className="text-base text-on-surface-variant">
							                                        {p.po.checkPoUserId ? formatDateDDMMYYYYOnly(p.po.checkDate || today) : '-'}
							                                      </div>
						                                    </td>
						                                    <td rowSpan={rowSpan} className="px-2 py-2 text-base border border-outline-variant align-top whitespace-normal break-words">
							                                      <SearchableSelect
						                                        options={users.map((u) => ({ value: u.id, label: u.name }))}
						                                        value={
						                                          (Boolean(p.po.checkPoUserId) || Boolean(p.po.checkPo)) && Boolean(p.po.checkDate || today)
						                                            ? (p.po.sentBy ?? '')
						                                            : ''
						                                        }
						                                        onChange={(val) => {
						                                          if (!Boolean(p.po.checkPoUserId) || !Boolean(p.po.checkDate || today)) return;
						                                          const sentBy = String(val ?? '').trim() || null;
						                                          const sentDate = sentBy ? today : null;
						                                          const next = {
						                                            checkPo: true,
						                                            checkPoUserId: p.po.checkPoUserId ?? null,
						                                            checkDate: p.po.checkDate || today,
						                                            sentBy,
						                                            sentDate,
						                                          };
						                                          run(() =>
						                                            updatePoCheckAndSent(p.po.id, { ...next, updatedBy: 'system' }).then((r) => {
						                                              if (r.po) setPosList((prev) => prev.map((x) => (x.po.id === p.po.id ? r.po! : x)));
				                                              return undefined;
				                                            })
				                                          );
						                                        }}
						                                        placeholder="Select user"
						                                        disabled={busy || !Boolean(p.po.checkPoUserId) || !Boolean(p.po.checkDate || today)}
						                                      />
								                                      {p.po.sentBy ? (
								                                        <div className="mt-1 flex items-start justify-between gap-2">
								                                          <div className="text-xs text-on-surface-variant whitespace-normal break-words">{sentByName || p.po.sentBy}</div>
								                                          <button
								                                            type="button"
								                                            disabled={busy}
								                                            className="px-2 py-1 text-[11px] font-semibold text-on-primary bg-error rounded-md hover:bg-error/90 disabled:opacity-50"
								                                            onClick={() => {
								                                              const next = {
								                                                checkPo: Boolean(p.po.checkPoUserId),
								                                                checkPoUserId: p.po.checkPoUserId ?? null,
								                                                checkDate: p.po.checkDate || today,
								                                                sentBy: null,
								                                                sentDate: null,
								                                                sentProof: null,
								                                              };
								                                              run(() =>
								                                                updatePoCheckAndSent(p.po.id, { ...next, updatedBy: 'system' }).then((r) => {
								                                                  if (r.po) setPosList((prev) => prev.map((x) => (x.po.id === p.po.id ? r.po! : x)));
								                                                  return undefined;
								                                                })
								                                              );
								                                            }}
								                                          >
								                                            Clear
								                                          </button>
								                                        </div>
								                                      ) : null}
							                                    </td>
							                                    <td rowSpan={rowSpan} className="px-2 py-2 text-base border border-outline-variant align-top whitespace-normal break-words">
							                                      {p.po.sentBy ? (
							                                        <div className="space-y-1">
						                                          <div className="flex items-center gap-2">
						                                            {p.po.sentProof ? (
						                                              <>
					                                                <button
					                                                  type="button"
					                                                  className="px-2 py-1 text-[11px] font-semibold text-on-primary bg-primary rounded-md hover:bg-primary/90"
					                                                  onClick={() => openDocument(p.po.sentProof || '')}
					                                                >
					                                                  View
					                                                </button>
					                                                <button
					                                                  type="button"
					                                                  disabled={busy}
					                                                  className="px-2 py-1 text-[11px] font-semibold text-on-primary bg-error rounded-md hover:bg-error/90 disabled:opacity-50"
					                                                  onClick={() => {
					                                                    const next = {
					                                                      checkPo: true,
					                                                      checkPoUserId: p.po.checkPoUserId ?? null,
					                                                      checkDate: p.po.checkDate || today,
					                                                      sentBy: p.po.sentBy ?? null,
					                                                      sentDate: p.po.sentDate || today,
					                                                      sentProof: null,
					                                                    };
					                                                    run(() =>
					                                                      updatePoCheckAndSent(p.po.id, { ...next, updatedBy: 'system' }).then((r) => {
					                                                        if (r.po) setPosList((prev) => prev.map((x) => (x.po.id === p.po.id ? r.po! : x)));
					                                                        return undefined;
					                                                      })
					                                                    );
					                                                  }}
					                                                >
					                                                  Clear
					                                                </button>
					                                              </>
						                                            ) : (
							                                              <div className="text-sm text-on-surface-variant">No file</div>
						                                            )}
						                                          </div>
						                                          <input
						                                            type="file"
						                                            accept="image/*"
						                                            disabled={busy}
							                                            className="block w-full text-sm"
						                                            onChange={(e) => {
						                                              const file = e.target.files?.[0];
						                                              e.target.value = '';
						                                              if (!file) return;
						                                              run(async () => {
						                                                const { url: sentProofUrl } = await uploadFileToServer(file);
						                                                const next = {
						                                                  checkPo: true,
						                                                  checkPoUserId: p.po.checkPoUserId ?? null,
						                                                  checkDate: p.po.checkDate || today,
						                                                  sentBy: p.po.sentBy ?? null,
						                                                  sentDate: p.po.sentDate || today,
						                                                  sentProof: sentProofUrl,
						                                                };
						                                                const r = await updatePoCheckAndSent(p.po.id, { ...next, updatedBy: 'system' });
						                                                if (r.po) setPosList((prev) => prev.map((x) => (x.po.id === p.po.id ? r.po! : x)));
						                                                return undefined;
						                                              });
						                                            }}						                                          />
						                                        </div>
							                                      ) : (
							                                        <div className="text-base text-on-surface-variant">-</div>
							                                      )}
							                                    </td>
						                                    <td rowSpan={rowSpan} className="px-2 py-2 text-base border border-outline-variant align-top">
						                                      <div className="text-base text-on-surface-variant">
						                                        {p.po.sentBy ? formatDateDDMMYYYYOnly(p.po.sentDate || today) : '-'}
						                                      </div>
						                                    </td>
					                                  </>
					                                ) : null}

					                                {idx === 0 ? (
						                                  <td rowSpan={rowSpan} className="px-2 py-2 border border-outline-variant align-top">
						                                    <div className="flex items-center gap-2">
				                                      <button
				                                        type="button"
				                                        title="Download PO PDF"
				                                        aria-label="Download PO PDF"
				                                        className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-surface-container-high text-on-surface-variant shadow-sm hover:bg-surface-container-highest transition-colors"
				                                        onClick={() => (window.location.href = `/api/pos/${encodeURIComponent(p.po.id)}.pdf`)}
				                                      >
				                                        <FileText size={16} className="text-error" />
				                                      </button>

				                                      <button
				                                        type="button"
				                                        title={poHasInvoice ? 'Cannot edit after invoice/GRN' : 'Edit PO'}
				                                        aria-label="Edit PO"
				                                        className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-on-primary shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
				                                        disabled={busy || poHasInvoice || loadingSuppliers}
				                                        onClick={() => openPoDetails(p)}
				                                      >
				                                        <Pencil size={16} />
				                                      </button>

					                                      <button
					                                        type="button"
					                                        title={poHasInvoice ? 'Cannot delete after invoice/GRN' : 'Delete PO'}
					                                        aria-label="Delete PO"
					                                        className="btn-icon-danger"
					                                        disabled={busy || poHasInvoice}
					                                        onClick={() => {
					                                          if (!window.confirm(`Delete PO ${p.po.id}?`)) return;
					                                          if (selectedPoId === p.po.id) setSelectedPoId('');
				                                          run(() => deletePo(p.po.id, { deletedBy: 'Purchase Team' }).then(() => undefined));
				                                        }}
				                                      >
				                                        <Trash2 size={16} />
				                                      </button>
				                                    </div>
				                                  </td>
				                                ) : null}
				                              </tr>
				                            );
				                          });
				                        })}
			                      </tbody>
					                  </table>
					                </div>
					              </div>
							              <div className="grid grid-cols-1 gap-3">
										<div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-4">
											<div className="relative mb-3 flex items-center justify-center">
												<div className="absolute inset-x-0 top-1/2 border-t border-outline-variant" />
												<div className="relative px-3 bg-surface-container-lowest text-lg font-bold text-blue-600">PO Pending for Checking</div>
												<div className="absolute right-1 top-1/2 -translate-y-1/2 text-sm font-semibold text-on-surface-variant">{pendingPoForChecking.length}</div>
											</div>
							                  {pendingPoForChecking.length ? (
							                    <div className="mt-3 overflow-x-auto">
							                      <table className="w-full min-w-[1500px] table-fixed text-left border-collapse border border-outline-variant">
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
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO No</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Terms</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Items</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO Qty</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO Rate</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Disc %</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">GST %</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Checked By</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Check Date</th>
						                          </tr>
							                        </thead>
							                        <tbody>
							                          {pendingPoForChecking.flatMap((p) => {
							                            const items = Array.isArray(p.items) ? p.items : [];
							                            const safeItems = items.length ? items : [null];
							                            const rowSpan = safeItems.length;
							                            const today = new Date().toISOString().slice(0, 10);
							                            const checkDateValue = pendingCheckDateByPoId[p.po.id] ?? today;
							                            const proofKey = `pending-check-${p.po.id}`;

							                            return safeItems.map((it, idx) => {
							                              const qty = it ? Number(it.quantity ?? 0) : NaN;
							                              const rate = it ? Number(it.rate ?? 0) : NaN;
							                              const discPct = it ? Number((it as any)?.discountPercent ?? 0) : NaN;
							                              const gstPct = it ? Number((it as any)?.taxPercent ?? 0) : NaN;
							                              const label = it
							                                ? formatPoItemLabel(String((it as any)?.itemId ?? '').trim(), String((it as any)?.item ?? ''))
							                                : '-';

							                              return (
							                                <tr key={`${proofKey}-${String((it as any)?.itemId ?? 'empty')}-${idx}`}>
							                                  {idx === 0 ? (
							                                    <>
								                                      <td
								                                        rowSpan={rowSpan}
								                                        className="px-3 py-2 text-sm font-semibold text-on-surface border border-outline-variant whitespace-normal break-words align-top"
								                                      >
				                        {formatPoNumber((p as any)?.po?.poNumber ?? '') || '-'}
								                                      </td>
							                                      <td
							                                        rowSpan={rowSpan}
							                                        className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words align-top"
							                                      >
							                                        {p.po.supplier || '-'}
							                                      </td>
							                                      <td
							                                        rowSpan={rowSpan}
							                                        className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words align-top"
							                                      >
							                                        {String(p.po.paymentTerms ?? '').trim() || '-'}
							                                      </td>
							                                    </>
							                                  ) : null}

							                                  <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words">
							                                    {label}
							                                  </td>
							                                  <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant tabular-nums">
							                                    {Number.isFinite(qty) ? qty : '-'}
							                                  </td>
							                                  <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant tabular-nums">
							                                    {Number.isFinite(rate) ? rate : '-'}
							                                  </td>
							                                  <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant tabular-nums">
							                                    {Number.isFinite(discPct) && discPct ? discPct : '-'}
							                                  </td>
							                                  <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant tabular-nums">
							                                    {Number.isFinite(gstPct) && gstPct ? gstPct : '-'}
							                                  </td>

							                                  {idx === 0 ? (
							                                    <>
							                                      <td rowSpan={rowSpan} className="px-3 py-2 border border-outline-variant align-top">
							                                        <SearchableSelect
							                                          options={users.map((u) => ({ value: u.id, label: u.name }))}
							                                          value={pendingCheckedByByPoId[p.po.id] ?? ''}
							                                          onChange={(val) => {
							                                            const selectedUserId = String(val ?? '').trim();
							                                            if (!selectedUserId) return;
							                                            setPendingCheckedByByPoId((prev) => ({ ...prev, [p.po.id]: selectedUserId }));
							                                            const next = {
							                                              checkPo: true,
							                                              checkPoUserId: selectedUserId || null,
							                                              checkDate: checkDateValue || today,
							                                              sentBy: null,
							                                              sentDate: null,
							                                              sentProof: null,
							                                            };
							                                            run(() =>
							                                              updatePoCheckAndSent(p.po.id, { ...next, updatedBy: 'system' }).then((res) => {
							                                                if (res.po)
							                                                  setPosList((prev) => prev.map((x) => (x.po.id === p.po.id ? res.po! : x)));
							                                                setPendingCheckDateByPoId((prev) => {
							                                                  if (!(p.po.id in prev)) return prev;
							                                                  const nextMap = { ...prev };
							                                                  delete nextMap[p.po.id];
							                                                  return nextMap;
							                                                });
							                                                setPendingCheckedByByPoId((prev) => {
							                                                  if (!(p.po.id in prev)) return prev;
							                                                  const nextMap = { ...prev };
							                                                  delete nextMap[p.po.id];
							                                                  return nextMap;
							                                                });
							                                                return undefined;
							                                              })
							                                            );
							                                          }}
							                                          placeholder="Select user"
							                                          disabled={busy}
							                                        />
							                                      </td>
								                                      <td rowSpan={rowSpan} className="px-3 py-2 border border-outline-variant align-top">
								                                        <div className="w-full h-9 px-2 text-sm border rounded-md bg-surface text-on-surface border-outline-variant flex items-center cursor-default">
								                                          {formatDateDDMMYYYYOnly(checkDateValue)}
								                                        </div>
								                                      </td>
								                                    </>
								                                  ) : null}
							                                </tr>
							                              );
							                            });
							                          })}
							                        </tbody>
							                      </table>
							                    </div>
							                  ) : (
					                    <div className="mt-2 text-sm text-on-surface-variant">No POs pending for checking.</div>
					                  )}
					                </div>

										<div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-4">
											<div className="relative mb-3 flex items-center justify-center">
												<div className="absolute inset-x-0 top-1/2 border-t border-outline-variant" />
												<div className="relative px-3 bg-surface-container-lowest text-lg font-bold text-blue-600">PO Pending for Sending</div>
												<div className="absolute right-1 top-1/2 -translate-y-1/2 text-sm font-semibold text-on-surface-variant">{pendingPoForSending.length}</div>
											</div>
							                  {pendingPoForSending.length ? (
							                    <div className="mt-3 overflow-x-auto">
							                      <table className="w-full min-w-[1750px] table-fixed text-left border-collapse border border-outline-variant">
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
						                          <col className="w-[220px]" />
						                        </colgroup>
						                        <thead>
						                          <tr className="bg-surface-container-high">
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO No</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Terms</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Items</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO Qty</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO Rate</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Disc %</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">GST %</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Sent By</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Sent Date</th>
						                            <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Sent Proof</th>
						                          </tr>
							                        </thead>
							                        <tbody>
							                          {pendingPoForSending.flatMap((p) => {
							                            const items = Array.isArray(p.items) ? p.items : [];
							                            const safeItems = items.length ? items : [null];
							                            const rowSpan = safeItems.length;
							                            const today = new Date().toISOString().slice(0, 10);
							                            const sentDateValue = pendingSentDateByPoId[p.po.id] ?? today;
							                            const proofInputId = `pending-send-proof-${p.po.id}`;
							                            const keyPrefix = `pending-send-${p.po.id}`;

							                            return safeItems.map((it, idx) => {
							                              const qty = it ? Number(it.quantity ?? 0) : NaN;
							                              const rate = it ? Number(it.rate ?? 0) : NaN;
							                              const discPct = it ? Number((it as any)?.discountPercent ?? 0) : NaN;
							                              const gstPct = it ? Number((it as any)?.taxPercent ?? 0) : NaN;
							                              const label = it
							                                ? formatPoItemLabel(String((it as any)?.itemId ?? '').trim(), String((it as any)?.item ?? ''))
							                                : '-';

							                              return (
							                                <tr key={`${keyPrefix}-${String((it as any)?.itemId ?? 'empty')}-${idx}`}>
							                                  {idx === 0 ? (
							                                    <>
								                                      <td
								                                        rowSpan={rowSpan}
								                                        className="px-3 py-2 text-sm font-semibold text-on-surface border border-outline-variant whitespace-normal break-words align-top"
								                                      >
				                        {formatPoNumber((p as any)?.po?.poNumber ?? '') || '-'}
								                                      </td>
							                                      <td
							                                        rowSpan={rowSpan}
							                                        className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words align-top"
							                                      >
							                                        {p.po.supplier || '-'}
							                                      </td>
							                                      <td
							                                        rowSpan={rowSpan}
							                                        className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words align-top"
							                                      >
							                                        {String(p.po.paymentTerms ?? '').trim() || '-'}
							                                      </td>
							                                    </>
							                                  ) : null}

							                                  <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words">
							                                    {label}
							                                  </td>
							                                  <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant tabular-nums">
							                                    {Number.isFinite(qty) ? qty : '-'}
							                                  </td>
							                                  <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant tabular-nums">
							                                    {Number.isFinite(rate) ? rate : '-'}
							                                  </td>
							                                  <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant tabular-nums">
							                                    {Number.isFinite(discPct) && discPct ? discPct : '-'}
							                                  </td>
							                                  <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant tabular-nums">
							                                    {Number.isFinite(gstPct) && gstPct ? gstPct : '-'}
							                                  </td>

							                                  {idx === 0 ? (
							                                    <>
							                                      <td rowSpan={rowSpan} className="px-3 py-2 border border-outline-variant align-top">
							                                        <SearchableSelect
							                                          options={users.map((u) => ({ value: u.id, label: u.name }))}
							                                          value={pendingSentByByPoId[p.po.id] ?? ''}
							                                          onChange={(val) => {
							                                            const sentBy = String(val ?? '').trim() || null;
							                                            if (!sentBy) return;
							                                            setPendingSentByByPoId((prev) => ({ ...prev, [p.po.id]: sentBy }));
							                                            const next = {
							                                              checkPo: Boolean(p.po.checkPoUserId) || Boolean(p.po.checkPo),
							                                              checkPoUserId: p.po.checkPoUserId ?? null,
							                                              checkDate: p.po.checkDate || today,
							                                              sentBy,
							                                              sentDate: sentDateValue || today,
							                                              sentProof: p.po.sentProof ?? null,
							                                            };
							                                            run(() =>
							                                              updatePoCheckAndSent(p.po.id, { ...next, updatedBy: 'system' }).then((res) => {
							                                                if (res.po)
							                                                  setPosList((prev) => prev.map((x) => (x.po.id === p.po.id ? res.po! : x)));
							                                                setPendingSentDateByPoId((prev) => {
							                                                  if (!(p.po.id in prev)) return prev;
							                                                  const nextMap = { ...prev };
							                                                  delete nextMap[p.po.id];
							                                                  return nextMap;
							                                                });
							                                                setPendingSentByByPoId((prev) => {
							                                                  if (!(p.po.id in prev)) return prev;
							                                                  const nextMap = { ...prev };
							                                                  delete nextMap[p.po.id];
							                                                  return nextMap;
							                                                });
							                                                return undefined;
							                                              })
							                                            );
							                                          }}
							                                          placeholder="Select user"
							                                          disabled={busy}
							                                        />
							                                      </td>
									                                      <td rowSpan={rowSpan} className="px-3 py-2 border border-outline-variant align-top">
										                                        <input
										                                          className="w-full h-9 px-2 text-sm border rounded-md bg-surface text-on-surface border-outline-variant"
										                                          type="date"
										                                          value={sentDateValue}
										                                          disabled={busy}
										                                          onChange={(e) => {
										                                            const sentDate = e.target.value;
										                                            setPendingSentDateByPoId((prev) => ({ ...prev, [p.po.id]: sentDate }));
										                                            const sentBy = String(pendingSentByByPoId[p.po.id] ?? p.po.sentBy ?? '').trim() || null;
										                                            if (!sentBy) return;
										                                            const next = {
										                                              checkPo: Boolean(p.po.checkPoUserId) || Boolean(p.po.checkPo),
										                                              checkPoUserId: p.po.checkPoUserId ?? null,
										                                              checkDate: p.po.checkDate || today,
										                                              sentBy,
										                                              sentDate: sentDate || today,
										                                              sentProof: p.po.sentProof ?? null,
										                                            };
										                                            run(() =>
										                                              updatePoCheckAndSent(p.po.id, { ...next, updatedBy: 'system' }).then((res) => {
										                                                if (res.po)
										                                                  setPosList((prev) => prev.map((x) => (x.po.id === p.po.id ? res.po! : x)));
										                                                setPendingSentDateByPoId((prev) => {
										                                                  if (!(p.po.id in prev)) return prev;
										                                                  const nextMap = { ...prev };
										                                                  delete nextMap[p.po.id];
										                                                  return nextMap;
										                                                });
										                                                setPendingSentByByPoId((prev) => {
										                                                  if (!(p.po.id in prev)) return prev;
										                                                  const nextMap = { ...prev };
										                                                  delete nextMap[p.po.id];
										                                                  return nextMap;
										                                                });
										                                                return undefined;
										                                              })
										                                            );
										                                          }}
										                                        />
									                                      </td>
								                                      <td rowSpan={rowSpan} className="px-3 py-2 border border-outline-variant align-top">
								                                        <div className="flex flex-col gap-2">
							                                          {p.po.sentProof ? (
							                                            <div className="flex items-center gap-2">
							                                              <button
							                                                type="button"
							                                                className="px-2 py-1 text-[11px] font-semibold text-on-primary bg-primary rounded-md hover:bg-primary/90"
							                                                onClick={() => openDocument(p.po.sentProof || '')}
							                                              >
							                                                View
							                                              </button>
							                                              <button
							                                                type="button"
							                                                disabled={busy}
							                                                className="px-2 py-1 text-[11px] font-semibold text-on-primary bg-error rounded-md hover:bg-error/90 disabled:opacity-50"
							                                                onClick={() => {
							                                                  const next = {
							                                                    checkPo: Boolean(p.po.checkPoUserId) || Boolean(p.po.checkPo),
							                                                    checkPoUserId: p.po.checkPoUserId ?? null,
							                                                    checkDate: p.po.checkDate || today,
							                                                    sentBy: null,
							                                                    sentDate: null,
							                                                    sentProof: null,
							                                                  };
							                                                  run(() =>
							                                                    updatePoCheckAndSent(p.po.id, { ...next, updatedBy: 'system' }).then((res) => {
							                                                      if (res.po)
							                                                        setPosList((prev) => prev.map((x) => (x.po.id === p.po.id ? res.po! : x)));
							                                                      return undefined;
							                                                    })
							                                                  );
							                                                }}
							                                              >
							                                                Clear
							                                              </button>
							                                            </div>
							                                          ) : (
							                                            <div className="text-sm text-on-surface-variant">No file</div>
							                                          )}
							                                          <input
							                                            id={proofInputId}
							                                            type="file"
							                                            accept="image/*"
							                                            disabled={busy}
							                                            className="hidden"
							                                            onChange={(e) => {
							                                              const file = e.target.files?.[0];
							                                              e.target.value = '';
							                                              if (!file) return;
							                                              run(async () => {
							                                                const { url: sentProofUrl } = await uploadFileToServer(file);
							                                                const resolvedSentBy = String(pendingSentByByPoId[p.po.id] ?? p.po.sentBy ?? '').trim() || null;
							                                                const resolvedSentDate = pendingSentDateByPoId[p.po.id] ?? p.po.sentDate ?? today;
							                                                const next = {
							                                                  checkPo: Boolean(p.po.checkPoUserId) || Boolean(p.po.checkPo),
							                                                  checkPoUserId: p.po.checkPoUserId ?? null,
							                                                  checkDate: p.po.checkDate || today,
							                                                  sentBy: resolvedSentBy,
							                                                  sentDate: resolvedSentDate,
							                                                  sentProof: sentProofUrl,
							                                                };
							                                                const res = await updatePoCheckAndSent(p.po.id, { ...next, updatedBy: 'system' });
							                                                if (res.po)
							                                                  setPosList((prev) => prev.map((x) => (x.po.id === p.po.id ? res.po! : x)));
							                                                return undefined;
							                                              });
							                                            }}
							                                          />
							                                          <label
							                                            htmlFor={proofInputId}
							                                            className={`inline-flex items-center justify-center w-full px-3 py-2 rounded-md text-xs font-semibold bg-black text-white ${
							                                              busy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-black/90'
							                                            }`}
							                                          >
							                                            Choose file
							                                          </label>
							                                        </div>
							                                      </td>
							                                    </>
							                                  ) : null}
							                                </tr>
							                              );
							                            });
							                          })}
							                        </tbody>
							                      </table>
							                    </div>
							                  ) : (
					                    <div className="mt-2 text-sm text-on-surface-variant">No POs pending for sending.</div>
					                  )}
					                </div>
					              </div>
					              {pr.status === 'Pending Approval' ? (
					                <div className="flex items-center justify-between gap-3 pt-3">
					                  <button
					                    type="button"
				                    className="btn-primary btn-sm"
				                    disabled={busy || loadingMasterItems}
				                    onClick={() => {
				                      const tempId = `NEW-${Date.now()}-${Math.random().toString(16).slice(2)}`;
				                      setDraftPrItems((prev) => [
				                        ...prev,
				                        {
				                          id: tempId,
				                          prId: pr.id,
				                          itemId: '',
				                          item: '',
				                          quantity: 1,
				                          specification: '',
				                        },
				                      ]);
				                    }}
				                  >
				                    + Add Item
				                  </button>
				                  <div className="text-xs text-on-surface-variant">
				                    {loadingMasterItems ? 'Loading items…' : 'Edit items/specs before approval.'}
				                  </div>
				                </div>
				              ) : null}
				            </div>
		            ) : null}

				            {poDetailsOpen && activePoDetails ? (
				              <div className="fixed inset-0 z-50">
				                <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={closePoDetails} />
				                <div className="relative w-full h-full bg-surface-container-lowest border border-outline-variant shadow-xl flex flex-col">
				                  <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant bg-surface-container-lowest">
			  <div className="text-base font-bold text-on-surface">Edit PO: {formatPoNumber((activePoDetails as any)?.po?.poNumber ?? '') || '-'}</div>
				                    <button type="button" className="btn btn-sm" onClick={closePoDetails}>
				                      Close
				                    </button>
				                  </div>

				                  <div className="flex-1 overflow-auto p-5 space-y-4">
				                    {poDetailsError ? <div className="text-sm text-error font-semibold">{poDetailsError}</div> : null}

				                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				                      <Field label="Supplier">
				                        <SearchableSelect
				                          value={editPoSupplierId}
				                          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
				                          onChange={(id) => setEditPoSupplierId(id)}
				                          disabled={busy || loadingSuppliers}
				                          placeholder="Select supplier..."
				                        />
				                      </Field>
				                      <Field label="Payment Terms">
				                        <input
				                          className={inputClass}
				                          value={editPoPaymentTerms}
				                          onChange={(e) => setEditPoPaymentTerms(e.target.value)}
				                          disabled={busy}
				                          placeholder="15 / 30 days"
				                        />
				                      </Field>
				                    </div>

				                    {(() => {
				                      const firmRow = pr ? firms.find((f) => f.id === pr.firmId) : undefined;
				                      const firmAddress = String(firmRow?.address ?? '').trim();
				                      const today = new Date().toISOString().slice(0, 10);
				                      const checkedByName =
				                        users.find((u) => u.id === (activePoDetails.po.checkPoUserId ?? ''))?.name ??
				                        String(activePoDetails.po.checkPoUserId ?? '').trim();
				                      const sentByName =
				                        users.find((u) => u.id === (activePoDetails.po.sentBy ?? ''))?.name ??
				                        String(activePoDetails.po.sentBy ?? '').trim();
				                      return (
				                        <>
				                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				                            <Field label="Shipping Address">
				                              <div className="space-y-2">
				                                <label className="inline-flex items-center gap-2 text-sm text-on-surface-variant">
				                                  <input
				                                    type="checkbox"
				                                    checked={editPoShippingSameAsFirm}
				                                    onChange={(e) => {
				                                      const checked = e.target.checked;
				                                      setEditPoShippingSameAsFirm(checked);
				                                      if (checked) setEditPoShippingAddress(firmAddress);
				                                    }}
				                                    disabled={busy || !firmAddress}
				                                  />
				                                  Same as Firm Address
				                                </label>
				                                <textarea
				                                  className={cn(inputClass, 'h-auto min-h-[160px] py-2')}
				                                  value={editPoShippingAddress}
				                                  onChange={(e) => setEditPoShippingAddress(e.target.value)}
				                                  disabled={busy || (editPoShippingSameAsFirm && Boolean(firmAddress))}
				                                  placeholder="Shipping address"
				                                />
				                              </div>
				                            </Field>
				                            <Field label="Terms & Conditions (from Firm Master)">
				                              <textarea
				                                className={cn(inputClass, 'h-auto min-h-[160px] py-2')}
				                                value={String(firmRow?.termsConditions ?? '').trim()}
				                                disabled
				                                placeholder="Set Terms & Conditions in Firm Master"
				                              />
				                            </Field>
				                          </div>

				                          <div className="text-base text-on-surface-variant flex flex-col gap-2 md:flex-row md:flex-nowrap md:items-center md:gap-6 overflow-x-auto">
				                            <span className="whitespace-nowrap">
				                              <span className="font-bold text-on-surface-variant">Checked By:</span>{' '}
				                              <span className="text-on-surface">{checkedByName || '-'}</span>
				                            </span>
				                            <span className="whitespace-nowrap">
				                              <span className="font-bold text-on-surface-variant">Check Date:</span>{' '}
				                              <span className="text-on-surface">
				                                {activePoDetails.po.checkPoUserId ? formatDateDDMMYYYYOnly(activePoDetails.po.checkDate || today) : '-'}
				                              </span>
				                            </span>
				                            <span className="whitespace-nowrap">
				                              <span className="font-bold text-on-surface-variant">Sent By:</span>{' '}
				                              <span className="text-on-surface">{sentByName || '-'}</span>
				                            </span>
				                            <span className="whitespace-nowrap">
				                              <span className="font-bold text-on-surface-variant">Sent Proof:</span>{' '}
				                              {activePoDetails.po.sentProof ? (
				                                <button
				                                  type="button"
				                                  className="underline font-bold text-on-surface hover:text-primary"
				                                  onClick={() => openSentProof(activePoDetails.po.sentProof || '')}
				                                >
				                                  View
				                                </button>
				                              ) : (
				                                <span className="text-on-surface">-</span>
				                              )}
				                            </span>
					                            <span className="whitespace-nowrap">
					                              <span className="font-bold text-on-surface-variant">Sent Date:</span>{' '}
					                              {activePoDetails.po.sentBy ? (
					                                <input
					                                  className="h-8 px-2 text-sm border rounded-md bg-surface text-on-surface border-outline-variant"
					                                  type="date"
					                                  value={poDetailsSentDate}
					                                  disabled={busy}
					                                  onChange={(e) => {
					                                    const sentDate = e.target.value;
					                                    setPoDetailsSentDate(sentDate);
					                                    const sentBy = String(activePoDetails.po.sentBy ?? '').trim() || null;
					                                    if (!sentBy) return;
					                                    const next = {
					                                      checkPo: Boolean(activePoDetails.po.checkPoUserId) || Boolean(activePoDetails.po.checkPo),
					                                      checkPoUserId: activePoDetails.po.checkPoUserId ?? null,
					                                      checkDate: activePoDetails.po.checkDate || today,
					                                      sentBy,
					                                      sentDate: sentDate || today,
					                                      sentProof: activePoDetails.po.sentProof ?? null,
					                                    };
					                                    run(() =>
					                                      updatePoCheckAndSent(activePoDetails.po.id, { ...next, updatedBy: 'system' }).then((res) => {
					                                        if (res.po) {
					                                          setPosList((prev) => prev.map((x) => (x.po.id === activePoDetails.po.id ? res.po! : x)));
					                                          setActivePoDetails(res.po);
					                                          setPoDetailsSentDate(String(res.po.po.sentDate ?? sentDate).slice(0, 10) || sentDate);
					                                        }
					                                        return undefined;
					                                      })
					                                    );
					                                  }}
					                                />
					                              ) : (
					                                <span className="text-on-surface">-</span>
					                              )}
					                            </span>
				                          </div>
				                        </>
				                      );
				                    })()}

			                    <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
			                      <div className="overflow-x-auto">
				                        <table className="w-full min-w-[980px] text-left border-collapse border border-outline-variant">
				                          <thead>
				                            <tr className="bg-blue-700">
				                              <th className="px-3 py-2 text-[11px] font-bold text-white uppercase tracking-wider border border-outline-variant">Item</th>
				                              <th className="px-3 py-2 text-[11px] font-bold text-white uppercase tracking-wider border border-outline-variant w-[140px]">
				                                Qty
				                              </th>
				                              <th className="px-3 py-2 text-[11px] font-bold text-white uppercase tracking-wider border border-outline-variant w-[140px]">
				                                Rate
				                              </th>
				                              <th className="px-3 py-2 text-[11px] font-bold text-white uppercase tracking-wider border border-outline-variant w-[120px]">
				                                Disc %
				                              </th>
					                              <th className="px-3 py-2 text-[11px] font-bold text-white uppercase tracking-wider border border-outline-variant w-[120px]">
					                                GST %
					                              </th>
				                              <th className="px-3 py-2 text-[11px] font-bold text-white uppercase tracking-wider border border-outline-variant w-[90px]">
				                                Delete
				                              </th>
				                            </tr>
				                          </thead>
			                          <tbody>
			                            {editPoLines.map((ln, idx) => (
			                              <tr key={`${ln.itemId}||${idx}`}>
				                                <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words">
				                                  {renderInlineWithBoldSpecNames(ln.label)}
				                                </td>
			                                <td className="px-3 py-2 border border-outline-variant">
			                                  <input
			                                    className={compactTableInputClass}
			                                    type="number"
			                                    inputMode="decimal"
				                                    value={ln.quantity}
				                                    onChange={(e) =>
				                                      setEditPoLines((prev) =>
				                                        prev.map((x, i) =>
				                                          i === idx ? { ...x, quantity: sanitizeDecimalInput(e.target.value) } : x
				                                        )
				                                      )
				                                    }
				                                    disabled={busy}
				                                  />
			                                </td>
				                                <td className="px-3 py-2 border border-outline-variant">
					                                  <input
					                                    className={compactTableInputClass}
					                                    type="text"
					                                    inputMode="decimal"
					                                    value={ln.rate}
					                                    onChange={(e) =>
					                                      setEditPoLines((prev) =>
					                                        prev.map((x, i) => (i === idx ? { ...x, rate: sanitizeDecimalInput(e.target.value) } : x))
					                                      )
					                                    }
					                                    disabled={busy}
					                                  />
				                                </td>
				                                <td className="px-3 py-2 border border-outline-variant">
					                                  <input
					                                    className={compactTableInputClass}
					                                    type="text"
					                                    inputMode="decimal"
					                                    value={ln.discountPercent}
					                                    onChange={(e) =>
					                                      setEditPoLines((prev) =>
					                                        prev.map((x, i) => (i === idx ? { ...x, discountPercent: sanitizePercentInput(e.target.value) } : x))
					                                      )
					                                    }
					                                    onBlur={() =>
					                                      setEditPoLines((prev) =>
					                                        prev.map((x, i) =>
					                                          i === idx ? { ...x, discountPercent: clampPercentString(x.discountPercent) } : x
					                                        )
					                                      )
					                                    }
					                                    disabled={busy}
					                                  />
				                                </td>
				                                <td className="px-3 py-2 border border-outline-variant">
					                                  <input
					                                    className={compactTableInputClass}
					                                    type="text"
					                                    inputMode="decimal"
					                                    value={ln.taxPercent}
					                                    onChange={(e) =>
					                                      setEditPoLines((prev) =>
					                                        prev.map((x, i) => (i === idx ? { ...x, taxPercent: sanitizePercentInput(e.target.value) } : x))
					                                      )
					                                    }
					                                    onBlur={() =>
					                                      setEditPoLines((prev) =>
					                                        prev.map((x, i) => (i === idx ? { ...x, taxPercent: clampPercentString(x.taxPercent) } : x))
					                                      )
					                                    }
					                                    disabled={busy}
					                                  />
				                                </td>
				                                <td className="px-3 py-2 border border-outline-variant">
					                                  <button
					                                    type="button"
					                                    title="Remove line"
					                                    aria-label="Remove line"
				                                    className="btn-icon-danger"
				                                    disabled={busy || editPoLines.length <= 1}
				                                    onClick={() =>
				                                      setEditPoLines((prev) => prev.filter((_, i) => i !== idx))
				                                    }
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

				                  </div>

				                  <div className="border-t border-outline-variant bg-surface-container-lowest px-5 py-4 flex justify-end gap-2">
				                    <button type="button" className="btn btn-sm" onClick={closePoDetails} disabled={busy}>
				                      Cancel
				                    </button>
				                    <button
				                      type="button"
				                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
				                      disabled={busy}
				                      onClick={() => {
				                        setPoDetailsError(null);
				                        const supplier = suppliers.find((s) => s.id === editPoSupplierId);
				                        if (!supplier) {
				                          setPoDetailsError('Supplier is required.');
				                          return;
				                        }
				                        const terms = editPoPaymentTerms.trim();
				                        if (!terms) {
				                          setPoDetailsError('Payment terms are required.');
				                          return;
				                        }
				                        const lines = editPoLines
				                          .map((l) => ({
				                            itemId: String(l.itemId ?? '').trim(),
				                            quantity: Number(l.quantity ?? 0),
				                            rate: Number(l.rate ?? 0),
				                            discountPercent: Number(l.discountPercent ?? 0),
				                            taxPercent: Number(l.taxPercent ?? 0),
				                          }))
				                          .filter(
				                            (l) =>
				                              l.itemId &&
				                              Number.isFinite(l.quantity) &&
				                              l.quantity > 0 &&
				                              Number.isFinite(l.rate) &&
				                              l.rate >= 0 &&
				                              Number.isFinite(l.discountPercent) &&
				                              l.discountPercent >= 0 &&
				                              Number.isFinite(l.taxPercent) &&
				                              l.taxPercent >= 0
				                          );
				                        if (!lines.length) {
				                          setPoDetailsError('Enter Qty and Rate for at least one line.');
				                          return;
				                        }
				                        const shippingTrimmed = String(editPoShippingAddress ?? '').trim();
				                        if (editPoShippingSameAsFirm && !firmAddress) {
				                          setPoDetailsError('Firm Address is missing. Uncheck "Same as Firm Address" and enter Shipping Address.');
				                          return;
				                        }
				                        if (!shippingTrimmed) {
				                          setPoDetailsError('Shipping Address is required.');
				                          return;
				                        }

				                        run(async () => {
				                          await updatePo(activePoDetails.po.id, {
				                            supplierId: supplier.id,
				                            paymentTerms: terms,
				                            shippingAddress: shippingTrimmed || undefined,
				                            // Terms & Conditions always taken from Firm Master on backend
				                            items: lines,
				                            updatedBy: 'Purchase Team',
				                          });
				                          closePoDetails();
				                        });
				                      }}
				                    >
				                      Save Changes
				                    </button>
				                  </div>
			                </div>
			              </div>
			            ) : null}

					            {pr.status === 'Approved' ? (makePoItems.length ? (
						              <div className="space-y-3">
						                <div className="text-center text-lg font-bold text-blue-600">Make PO</div>
						                <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
								                    <table className="w-full table-fixed text-left border-collapse border border-outline-variant text-sm">
								                      <colgroup>
								                        <col className="w-[240px]" />
								                        <col className="w-[52px]" />
								                        <col className="w-[86px]" />
								                        <col className="w-[76px]" />
								                        <col className="w-[74px]" />
								                        <col className="w-[74px]" />
								                        <col className="w-[70px]" />
								                        <col className="w-[70px]" />
								                        <col className="w-[86px]" />
								                        <col className="w-[70px]" />
								                        <col className="w-[140px]" />
								                        <col className="w-[70px]" />
								                      </colgroup>
					                      <thead>
					                        <tr className="bg-blue-700">
					                          <th className="px-2 py-2 text-[12px] font-bold text-white uppercase tracking-wider border border-outline-variant">Item</th>
					                          <th className="px-2 py-2 text-[12px] font-bold text-white uppercase tracking-wider border border-outline-variant">PR Qty</th>
					                          <th className="px-2 py-2 text-[12px] font-bold text-white uppercase tracking-wider border border-outline-variant whitespace-normal">
					                            PO Qty (Already Created)
					                          </th>
					                          <th className="px-2 py-2 text-[12px] font-bold text-white uppercase tracking-wider border border-outline-variant">Pending Qty</th>
							                          <th className="px-2 py-2 text-[12px] font-bold text-white uppercase tracking-wider border border-outline-variant">Qty PO</th>
							                          <th className="px-2 py-2 text-[12px] font-bold text-white uppercase tracking-wider border border-outline-variant">Rate</th>
							                          <th className="px-2 py-2 text-[12px] font-bold text-white uppercase tracking-wider border border-outline-variant">Disc %</th>
							                          <th className="px-2 py-2 text-[12px] font-bold text-white uppercase tracking-wider border border-outline-variant">GST %</th>
							                          <th className="px-2 py-2 text-[12px] font-bold text-white uppercase tracking-wider border border-outline-variant">Last Supplier</th>
							                          <th className="px-2 py-2 text-[12px] font-bold text-white uppercase tracking-wider border border-outline-variant">Last Rate</th>
							                          <th className="px-2 py-2 text-[12px] font-bold text-white uppercase tracking-wider border border-outline-variant">Supplier</th>
							                          <th className="px-2 py-2 text-[12px] font-bold text-white uppercase tracking-wider border border-outline-variant">Terms</th>
						                        </tr>
						                      </thead>
					                      <tbody>
			                        {(() => {
		                          const makePoItems = prItems.filter((it) => Number(remainingQtyByItemId[it.itemId] ?? 0) > 0);
			                          if (!makePoItems.length) {
				                            return (
				                              <tr>
					                                <td colSpan={12} className="px-2 py-6 text-sm text-on-surface-variant text-center border border-outline-variant">
					                                  All items are already fully ordered.
					                                </td>
					                              </tr>
					                            );
					                          }
			                          return makePoItems.map((it) => {
			                            const lineId = String((it as any)?.id ?? '').trim() || String((it as any)?.itemId ?? '').trim();
			                            const specInline = (it.specification || '')
			                              .split(/\r?\n/)
			                              .map((s) => s.trim())
			                              .filter(Boolean)
			                              .join(' - ');
		                            const label = [it.item, specInline || null].filter(Boolean).join(' - ');
			                            const ordered = orderedQtyByItemId[it.itemId] ?? 0;
				                            const pending = remainingQtyByItemId[it.itemId] ?? 0;
					                            return (
					                              <tr key={lineId}>
					                                <td className="px-2 py-2 text-sm text-on-surface border border-outline-variant break-words whitespace-normal leading-snug">
					                                  {renderInlineWithBoldSpecNames(label)}
					                                </td>
				                                <td className="px-2 py-2 text-sm text-on-surface-variant border border-outline-variant">{it.quantity}</td>
				                                <td className="px-2 py-2 text-sm text-on-surface-variant border border-outline-variant">{ordered}</td>
					                                <td className="px-2 py-2 text-sm text-on-surface-variant border border-outline-variant">{pending}</td>
						                                <td className="px-2 py-2 border border-outline-variant">
							                                  <input
							                                    className={compactTableInputClass}
							                                    value={poQty[lineId] ?? ''}
							                                    onChange={(e) => {
							                                      setPoQtyTouched((prev) => ({ ...prev, [lineId]: true }));
							                                      setPoQty((prev) => ({ ...prev, [lineId]: e.target.value }));
							                                    }}
						                                    inputMode="numeric"
							                                    placeholder=""
							                                    disabled={pending <= 0}
							                                  />
							                                </td>
							                                <td className="px-2 py-2 border border-outline-variant">
							                                  <input
							                                    className={compactTableInputClass}
							                                    value={poRates[lineId] ?? ''}
							                                    onChange={(e) => {
							                                      setPoRatesTouched((prev) => ({ ...prev, [lineId]: true }));
							                                      setPoRates((prev) => ({ ...prev, [lineId]: e.target.value }));
							                                    }}
							                                    inputMode="decimal"
							                                    placeholder=""
							                                  />
							                                </td>
							                                <td className="px-2 py-2 border border-outline-variant">
								                                  <input
								                                    className={compactTableInputClass}
								                                    value={poDiscounts[lineId] ?? ''}
							                                    onChange={(e) => {
							                                      setPoDiscountsTouched((prev) => ({ ...prev, [lineId]: true }));
							                                      setPoDiscounts((prev) => ({ ...prev, [lineId]: e.target.value }));
							                                    }}
								                                    inputMode="decimal"
								                                    placeholder=""
								                                  />
							                                </td>
							                                <td className="px-2 py-2 border border-outline-variant">
								                                  <input
								                                    className={compactTableInputClass}
								                                    value={poTaxes[lineId] ?? ''}
							                                    onChange={(e) => {
							                                      setPoTaxesTouched((prev) => ({ ...prev, [lineId]: true }));
							                                      setPoTaxes((prev) => ({ ...prev, [lineId]: e.target.value }));
							                                    }}
								                                    inputMode="decimal"
								                                    placeholder=""
								                                  />
							                                </td>
						                                <td className="px-2 py-2 text-sm text-on-surface-variant border border-outline-variant break-words whitespace-normal leading-snug">
						                                  {lastSupplierByItemId[it.itemId]?.supplierName ?? '-'}
						                                </td>
					                                <td className="px-2 py-2 text-sm text-on-surface-variant border border-outline-variant">
					                                  {lastSupplierByItemId[it.itemId]?.supplierName ? String(lastSupplierByItemId[it.itemId]?.rate ?? '') : '-'}
					                                </td>
							                                <td className="px-2 py-2 border border-outline-variant">
								                                  <SearchableSelect
								                                    value={poSupplierByItemId[lineId] ?? ''}
								                                    options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
								                                    onChange={(id) => {
								                                      setPoSupplierTouched((prev) => ({ ...prev, [lineId]: true }));
					                                      const safeId = String(id ?? '').trim();
					                                      setPoSupplierByItemId((prev) => ({ ...prev, [lineId]: safeId }));

					                                      if (!safeId) {
					                                        // Clearing supplier should also clear terms for the same row.
					                                        setPoPaymentTermsByItemId((prev) => ({ ...prev, [lineId]: '' }));
					                                        return;
					                                      }

					                                      const selected = suppliers.find((s) => s.id === safeId);
					                                      const paymentTerms = String(selected?.paymentTerms ?? '').trim();
					                                      setPoPaymentTermsByItemId((prev) => {
					                                        const current = String(prev[lineId] ?? '').trim();
					                                        if (current) return prev; // don't overwrite manually entered terms
					                                        return { ...prev, [lineId]: paymentTerms };
					                                      });
								                                    }}
								                                    disabled={loadingSuppliers}
							                                    placeholder="Select supplier..."
							                                    allowClear
								                                    inputClassName="h-9 text-sm pl-2 pr-8 rounded-md"
								                                  />
						                                </td>
					                                <td className="px-2 py-2 border border-outline-variant">
					                                  <input
					                                    className={compactSurfaceInputClass}
					                                    value={poPaymentTermsByItemId[lineId] ?? ''}
					                                    onChange={(e) => setPoPaymentTermsByItemId((prev) => ({ ...prev, [lineId]: e.target.value }))}
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

							                {/* PO Details (per supplier) now shown only in Edit PO modal */}
		
		                <div className="flex justify-end">
			                  <button
			                    type="button"
		                    disabled={busy || prItems.every((it) => Number(remainingQtyByItemId[it.itemId] ?? 0) <= 0)}
		                    className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
		                    onClick={() => {
		                      const supplierById = new Map<string, Supplier>(suppliers.map((s) => [s.id, s]));
			                      const makePoItems = prItems.filter((it) => Number(remainingQtyByItemId[it.itemId] ?? 0) > 0);
				                      const lines = makePoItems
				                        .map((it) => {
				                          const lineId = String((it as any)?.id ?? '').trim() || String((it as any)?.itemId ?? '').trim();
				                          const itemId = String(it.itemId ?? '').trim();
				                          return {
				                            lineId,
				                            itemId,
				                            quantity: Number(poQty[lineId] ?? 0),
				                            rate: Number(poRates[lineId] ?? 0),
				                            discountPercent: Number(poDiscounts[lineId] ?? 0),
				                            taxPercent: Number(poTaxes[lineId] ?? 0),
				                            remaining: Number(remainingQtyByItemId[itemId] ?? 0),
				                            supplierId: String(poSupplierByItemId[lineId] ?? '').trim(),
				                            paymentTerms: String(poPaymentTermsByItemId[lineId] ?? '').trim(),
				                          };
				                        })
				                        .filter((x) => x.lineId && x.itemId && Number.isFinite(x.quantity) && x.quantity > 0);
	
		                      if (!lines.length) {
		                        setError('Enter Qty PO for at least one item.');
		                        return;
		                      }
			                      if (lines.some((x) => !Number.isFinite(x.rate) || x.rate < 0)) {
			                        setError('Enter valid rate for all items where Qty PO is entered.');
			                        return;
			                      }
				                      if (lines.some((x) => !Number.isFinite(x.discountPercent) || x.discountPercent < 0 || x.discountPercent > 100)) {
				                        setError('Enter valid Disc % (0 to 100) for all items where Qty PO is entered.');
				                        return;
				                      }
				                      if (lines.some((x) => !Number.isFinite(x.taxPercent) || x.taxPercent < 0 || x.taxPercent > 100)) {
				                        setError('Enter valid GST % (0 to 100) for all items where Qty PO is entered.');
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
		                        {
		                          supplier: string;
		                          paymentTerms: string;
		                          shippingAddress?: string;
		                          termsConditions?: string;
		                          items: Array<{
		                            itemId: string;
		                            quantity: number;
		                            rate: number;
		                            discountPercent?: number;
		                            taxPercent?: number;
		                          }>;
		                        }
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
		                        const itemLine = {
		                          itemId: l.itemId,
		                          quantity: l.quantity,
		                          rate: l.rate,
		                          discountPercent: l.discountPercent,
		                          taxPercent: l.taxPercent,
		                        };
		                        if (existing) existing.items.push(itemLine);
		                        else groups.set(key, { supplier: supplierName, paymentTerms: l.paymentTerms, items: [itemLine] });
		                      }

					                          run(async () => {
					                            for (const [, g] of groups.entries()) {
					                              await createPo(pr.id, {
					                                supplier: g.supplier,
					                                paymentTerms: g.paymentTerms,
					                                // Shipping Address + Terms & Conditions default from Firm Master (editable in Edit PO only)
					                                items: g.items,
					                              });
					                            }
				                        setPoQty((prev) => {
				                          const next = { ...prev };
				                          for (const l of lines) next[l.lineId] = '';
				                          return next;
				                        });
			                        setPoQtyTouched((prev) => {
			                          const next = { ...prev };
			                          for (const l of lines) delete next[l.lineId];
			                          return next;
			                        });
				                        setPoRatesTouched((prev) => {
				                          const next = { ...prev };
				                          for (const l of lines) delete next[l.lineId];
				                          return next;
				                        });
				                        setPoDiscountsTouched((prev) => {
				                          const next = { ...prev };
				                          for (const l of lines) delete next[l.lineId];
				                          return next;
				                        });
				                        setPoTaxesTouched((prev) => {
				                          const next = { ...prev };
				                          for (const l of lines) delete next[l.lineId];
				                          return next;
				                        });
				                        setPoSupplierTouched((prev) => {
				                          const next = { ...prev };
				                          for (const l of lines) delete next[l.lineId];
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
		              <div className="text-sm text-on-surface-variant">All items are already fully ordered.</div>
		            )) : (
	              <div className="text-sm text-on-surface-variant">Approve PR first.</div>
	            )}
          </Section>

		          <Section>
		            <div className="text-center text-2xl font-bold text-blue-600">Invoices</div>
			            {invoiceCreateOpen && selectedPo ? (
		              <div className="space-y-4">
		                <div className="flex justify-end">
		                  <button
		                    type="button"
		                    className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
		                    onClick={() => setInvoiceCreateOpen(false)}
		                  >
			                    Back to Pending PO
			                  </button>
			                </div>
		                <div className="invoice-parent-grid">
		                  <div className="invoice-parent-card">
		                    <div className="invoice-parent-card-header">
		                      <div className="text-[11px] font-bold uppercase tracking-widest text-white">PO &amp; Invoice Basic Details</div>
		                    </div>
		                    <div className="invoice-parent-card-body">
		                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
		                        <label className="space-y-1">
		                          <div className={cn(labelClass, 'text-blue-800')}>PO Number</div>
			              <input className={cn(inputClass, 'py-2')} value={formatPoNumber((selectedPo as any)?.po?.poNumber ?? '') || '-'} readOnly />
		                        </label>
		                        <label className="space-y-1">
		                          <div className={cn(labelClass, 'text-blue-800')}>
		                            Supplier Invoice No <span className="text-error">*</span>
		                          </div>
		                          <input
		                            className={cn(inputClass, 'py-2')}
		                            value={invoiceNo}
		                            onChange={(e) => {
		                              setInvoiceFormError(null);
		                              setInvoiceNo(e.target.value);
		                            }}
		                            placeholder="Enter supplier invoice no"
		                          />
		                        </label>
		                        <label className="space-y-1">
		                          <div className={cn(labelClass, 'text-blue-800')}>
		                            Invoice Date <span className="text-error">*</span>
		                          </div>
		                          <input
		                            className={cn(inputClass, 'py-2')}
		                            value={invoiceDate}
		                            onChange={(e) => {
		                              setInvoiceFormError(null);
		                              setInvoiceDate(e.target.value);
		                            }}
		                            type="date"
		                          />
		                        </label>
		                        <label className="space-y-1">
		                          <div className={cn(labelClass, 'text-blue-800')}>
		                            Updated By <span className="text-error">*</span>
		                          </div>
		                          <SearchableSelect
		                            options={users.map((u) => ({ value: u.id, label: u.name }))}
		                            value={invoiceUpdatedBy}
		                            onChange={(v) => {
		                              setInvoiceFormError(null);
		                              setInvoiceUpdatedBy(v);
		                            }}
		                            placeholder="Select user"
		                          />
		                        </label>
		                        <div className="rounded-lg border border-outline-variant/30 bg-primary-container/25 p-3">
		                          <div className="text-[11px] font-bold uppercase tracking-widest text-blue-800">Invoice Amount</div>
		                          <div className="text-lg font-extrabold tabular-nums text-on-surface">{computedInvoiceAmountText}</div>
		                          <div className="mt-2 text-[11px] font-bold uppercase tracking-widest text-blue-800">Item Total</div>
		                          <div className="text-sm font-bold tabular-nums text-on-surface">{computedInvoiceLinesTotalNumber.toFixed(2)}</div>
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
		                          <input
		                            className={cn(inputClass, 'py-2')}
		                            value={invoiceCourierCharge}
		                            onChange={(e) => {
		                              setInvoiceFormError(null);
		                              setInvoiceCourierCharge(sanitizeDecimalInput(e.target.value));
		                            }}
		                            type="text"
		                            inputMode="decimal"
		                          />
		                        </label>
		                        <label className="space-y-1">
		                          <div className={cn(labelClass, 'text-blue-800')}>Packing Charge</div>
		                          <input
		                            className={cn(inputClass, 'py-2')}
		                            value={invoicePackingCharge}
		                            onChange={(e) => {
		                              setInvoiceFormError(null);
		                              setInvoicePackingCharge(sanitizeDecimalInput(e.target.value));
		                            }}
		                            type="text"
		                            inputMode="decimal"
		                          />
		                        </label>
		                        <label className="space-y-1">
		                          <div className={cn(labelClass, 'text-blue-800')}>Labour Charge</div>
		                          <input
		                            className={cn(inputClass, 'py-2')}
		                            value={invoiceLabourCharge}
		                            onChange={(e) => {
		                              setInvoiceFormError(null);
		                              setInvoiceLabourCharge(sanitizeDecimalInput(e.target.value));
		                            }}
		                            type="text"
		                            inputMode="decimal"
		                          />
		                        </label>
		                        <label className="space-y-1">
		                          <div className={cn(labelClass, 'text-blue-800')}>Other Charge</div>
		                          <input
		                            className={cn(inputClass, 'py-2')}
		                            value={invoiceOtherCharge}
		                            onChange={(e) => {
		                              setInvoiceFormError(null);
		                              setInvoiceOtherCharge(sanitizeDecimalInput(e.target.value));
		                            }}
		                            type="text"
		                            inputMode="decimal"
		                          />
		                        </label>
		                        <label className="space-y-1">
		                          <div className={cn(labelClass, 'text-blue-800')}>GST on Charges</div>
		                          <input
		                            className={cn(inputClass, 'py-2')}
		                            value={invoiceChargesGstAmount}
		                            onChange={(e) => {
		                              setInvoiceFormError(null);
		                              setInvoiceChargesGstAmount(sanitizeDecimalInput(e.target.value));
		                            }}
		                            type="text"
		                            inputMode="decimal"
		                          />
		                        </label>
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
		                          <SearchableSelect
		                            options={transporters.map((t) => ({ value: t.id, label: t.name }))}
		                            value={invoiceTransporterId}
		                            onChange={(v) => {
		                              setInvoiceFormError(null);
		                              setInvoiceTransporterId(v);
		                            }}
		                            placeholder="Select transporter"
		                          />
		                          {invoiceTransporterId ? (
		                            <div className="text-xs text-on-surface-variant">
		                              Selected transporter: {transporters.find((t) => t.id === invoiceTransporterId)?.name || '-'}
		                            </div>
		                          ) : null}
		                        </label>
		                        <label className="space-y-1">
		                          <div className={cn(labelClass, 'text-blue-800')}>E-Way Bill No</div>
		                          <input
		                            className={cn(inputClass, 'py-2')}
		                            value={ewayBillNumber}
		                            onChange={(e) => {
		                              setInvoiceFormError(null);
		                              setEwayBillNumber(e.target.value);
		                            }}
		                            placeholder="Optional"
		                          />
		                        </label>
		                        <label className="space-y-1">
		                          <div className={cn(labelClass, 'text-blue-800')}>CN/Courier No</div>
		                          <input
		                            className={cn(inputClass, 'py-2')}
		                            value={cnNumber}
		                            onChange={(e) => {
		                              setInvoiceFormError(null);
		                              setCnNumber(e.target.value);
		                            }}
		                            placeholder="Optional"
		                          />
		                        </label>
		                      </div>
		                    </div>
		                  </div>

		                  <div className="invoice-parent-card">
		                    <div className="invoice-parent-card-header">
		                      <div className="text-[11px] font-bold uppercase tracking-widest text-white">Attachments &amp; References</div>
		                    </div>
		                    <div className="invoice-parent-card-body">
		                      <div className="grid grid-cols-1 gap-4">
		                        <label className="space-y-1">
		                          <div className={cn(labelClass, 'text-blue-800')}>Invoice PDF</div>
		                          <div className="flex items-center gap-2 min-w-0">
		                            <label className="btn btn-sm cursor-pointer select-none whitespace-nowrap" htmlFor="pr-invoice-pdf-upload">
		                              Choose File
		                            </label>
		                            <input
		                              id="pr-invoice-pdf-upload"
		                              type="file"
		                              accept="application/pdf,image/*"
		                              disabled={busy}
		                              className="hidden"
		                              onChange={(e) => {
		                                const file = e.target.files?.[0];
		                                e.target.value = '';
		                                if (!file) return;
		                                const reader = new FileReader();
		                                reader.onload = () => {
		                                  const result = reader.result;
		                                  const dataUrl = typeof result === 'string' ? result : '';
		                                  if (!dataUrl) return;
		                                  setInvoiceFormError(null);
		                                  setInvoicePdfFileName(file.name);
		                                  setInvoicePdf(dataUrl);
		                                };
		                                reader.readAsDataURL(file);
		                              }}
		                            />
		                            <div className="text-xs text-on-surface-variant truncate min-w-0">{invoicePdfFileName || (invoicePdf ? 'Uploaded' : 'No file chosen')}</div>
		                          </div>
		                          <div className={cn('text-xs', invoicePdf ? 'text-on-surface' : 'text-on-surface-variant')}>{invoicePdf ? 'Uploaded' : 'Not uploaded'}</div>
		                        </label>
		                        <label className="space-y-1">
		                          <div className={cn(labelClass, 'text-blue-800')}>CN/Courier Copy</div>
		                          <div className="flex items-center gap-2 min-w-0">
		                            <label className="btn btn-sm cursor-pointer select-none whitespace-nowrap" htmlFor="pr-invoice-courier-copy-upload">
		                              Choose File
		                            </label>
		                            <input
		                              id="pr-invoice-courier-copy-upload"
		                              type="file"
		                              accept="application/pdf,image/*"
		                              disabled={busy}
		                              className="hidden"
		                              onChange={(e) => {
		                                const file = e.target.files?.[0];
		                                e.target.value = '';
		                                if (!file) return;
		                                const reader = new FileReader();
		                                reader.onload = () => {
		                                  const result = reader.result;
		                                  const dataUrl = typeof result === 'string' ? result : '';
		                                  if (!dataUrl) return;
		                                  setInvoiceFormError(null);
		                                  setInvoiceCourierCopyFileName(file.name);
		                                  setInvoiceCourierCopy(dataUrl);
		                                };
		                                reader.readAsDataURL(file);
		                              }}
		                            />
		                            <div className="text-xs text-on-surface-variant truncate min-w-0">
		                              {invoiceCourierCopyFileName || (invoiceCourierCopy ? 'Uploaded' : 'No file chosen')}
		                            </div>
		                          </div>
		                          <div className={cn('text-xs', invoiceCourierCopy ? 'text-on-surface' : 'text-on-surface-variant')}>
		                            {invoiceCourierCopy ? 'Uploaded' : 'Not uploaded'}
		                          </div>
		                        </label>
		                      </div>
		                    </div>
		                  </div>
		                </div>

		                <div className="hidden bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
	                  <div className="overflow-x-auto">
		                    <table className="w-full min-w-[900px] table-fixed text-left border-collapse border border-outline-variant">
	                      <colgroup>
	                        <col className="w-[18%]" />
	                        <col className="w-[32%]" />
	                        <col className="w-[18%]" />
	                        <col className="w-[32%]" />
	                      </colgroup>
		                      <thead>
		                        <tr className="bg-blue-700">
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Particular</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Value</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Particular</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Value</th>
		                        </tr>
		                      </thead>
		                      <tbody>
		                        <tr>
		                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">PO</td>
		                          <td className="px-4 py-3 border border-outline-variant">
		                            {invoicePoOptions.length ? (
		                              <SearchableSelect
		                                options={invoicePoOptions}
		                                value={selectedPoId}
		                                onChange={setSelectedPoId}
		                                placeholder="Select PO (pending only)"
		                              />
		                            ) : (
		                              <div className="h-10 px-3 text-sm text-on-surface bg-surface-container-lowest border border-outline-variant rounded-lg flex items-center">
		                                No pending items for invoice.
		                              </div>
		                            )}
		                          </td>
		                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">Supplier Invoice No</td>
		                          <td className="px-4 py-3 border border-outline-variant">
		                            <input
		                              className={tableInputClass}
	                              value={invoiceNo}
	                              onChange={(e) => {
	                                setInvoiceFormError(null);
	                                setInvoiceNo(e.target.value);
	                              }}
	                            />
	                          </td>
	                        </tr>
	                        <tr>
		                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">Invoice Date</td>
		                          <td className="px-4 py-3 border border-outline-variant">
		                            <input
		                              className={tableInputClass}
		                              value={invoiceDate}
	                              onChange={(e) => {
	                                setInvoiceFormError(null);
	                                setInvoiceDate(e.target.value);
	                              }}
	                              type="date"
	                            />
	                          </td>
		                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">Updated By</td>
		                          <td className="px-4 py-3 border border-outline-variant">
		                            <SearchableSelect
		                              options={users.map((u) => ({ value: u.id, label: u.name }))}
		                              value={invoiceUpdatedBy}
	                              onChange={(v) => {
	                                setInvoiceFormError(null);
	                                setInvoiceUpdatedBy(v);
	                              }}
		                              placeholder="Select user"
		                            />
		                          </td>
		                        </tr>
				                        <tr>
					                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">Invoice Total Amount</td>
				                          <td className="px-4 py-3 border border-outline-variant">
				                            <input
			                              className={tableInputClass}
			                              value={computedInvoiceAmountText}
			                              type="number"
			                              readOnly
			                              tabIndex={-1}
			                              inputMode="decimal"
			                              step="0.01"
			                              placeholder="Total invoice amount"
				                            />
				                          </td>
				                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">Inv Pdf</td>
				                          <td className="px-4 py-3 border border-outline-variant">
				                            <div className="flex flex-col gap-2">
				                              {invoicePdf ? (
				                                <div className="flex items-center gap-2">
				                                  <button
				                                    type="button"
				                                    className="px-2 py-1 text-[11px] font-semibold text-on-primary bg-primary rounded-md hover:bg-primary/90"
				                                    onClick={() => openDocument(invoicePdf || '')}
				                                  >
				                                    View
				                                  </button>
				                                  <button
				                                    type="button"
				                                    disabled={busy}
				                                    className="px-2 py-1 text-[11px] font-semibold text-on-primary bg-error rounded-md hover:bg-error/90 disabled:opacity-50"
				                                    onClick={() => setInvoicePdf('')}
				                                  >
				                                    Clear
				                                  </button>
				                                </div>
				                              ) : (
				                                <div className="text-sm text-on-surface-variant">No file</div>
				                              )}
				                              <input
				                                id="invoice-pdf-upload"
				                                type="file"
				                                accept="application/pdf,image/*"
				                                disabled={busy}
				                                className="hidden"
				                                onChange={(e) => {
				                                  const file = e.target.files?.[0];
				                                  e.target.value = '';
				                                  if (!file) return;
				                                  const reader = new FileReader();
				                                  reader.onload = () => {
				                                    const result = reader.result;
				                                    const dataUrl = typeof result === 'string' ? result : '';
				                                    if (!dataUrl) return;
				                                    setInvoiceFormError(null);
				                                    setInvoicePdf(dataUrl);
				                                  };
				                                  reader.readAsDataURL(file);
				                                }}
				                              />
				                              <label
				                                htmlFor="invoice-pdf-upload"
				                                className={`inline-flex items-center justify-center w-full px-3 py-2 rounded-md text-xs font-semibold bg-black text-white ${
				                                  busy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-black/90'
				                                }`}
				                              >
				                                Choose file
				                              </label>
				                            </div>
				                          </td>
				                        </tr>
			                        <tr>
			                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">Courier Charge</td>
			                          <td className="px-4 py-3 border border-outline-variant">
			                            <input
			                              className={tableInputClass}
			                              value={invoiceCourierCharge}
			                              type="number"
			                              onChange={(e) => {
			                                setInvoiceFormError(null);
			                                setInvoiceCourierCharge(e.target.value);
			                              }}
			                              inputMode="decimal"
			                              step="0.01"
			                              placeholder="0"
			                            />
			                          </td>
			                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">Packing Charge</td>
			                          <td className="px-4 py-3 border border-outline-variant">
			                            <input
			                              className={tableInputClass}
			                              value={invoicePackingCharge}
			                              type="number"
			                              onChange={(e) => {
			                                setInvoiceFormError(null);
			                                setInvoicePackingCharge(e.target.value);
			                              }}
			                              inputMode="decimal"
			                              step="0.01"
			                              placeholder="0"
			                            />
			                          </td>
			                        </tr>
				                        <tr>
				                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">Labour Charge</td>
			                          <td className="px-4 py-3 border border-outline-variant">
			                            <input
			                              className={tableInputClass}
			                              value={invoiceLabourCharge}
			                              type="number"
			                              onChange={(e) => {
			                                setInvoiceFormError(null);
			                                setInvoiceLabourCharge(e.target.value);
			                              }}
			                              inputMode="decimal"
			                              step="0.01"
			                              placeholder="0"
			                            />
			                          </td>
				                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">Other Charge</td>
			                          <td className="px-4 py-3 border border-outline-variant">
				                            <input
				                              className={tableInputClass}
				                              value={invoiceOtherCharge}
				                              type="number"
				                              onChange={(e) => {
				                                setInvoiceFormError(null);
				                                setInvoiceOtherCharge(e.target.value);
				                              }}
				                              inputMode="decimal"
				                              step="0.01"
				                            />
				                          </td>
				                        </tr>
				                        <tr>
				                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">GST on Charges</td>
				                          <td className="px-4 py-3 border border-outline-variant">
				                            <input
				                              className={tableInputClass}
				                              value={invoiceChargesGstAmount}
				                              type="number"
				                              onChange={(e) => {
				                                setInvoiceFormError(null);
				                                setInvoiceChargesGstAmount(e.target.value);
				                              }}
				                              inputMode="decimal"
				                              step="0.01"
				                            />
				                          </td>
				                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant"></td>
				                          <td className="px-4 py-3 border border-outline-variant"></td>
				                        </tr>
			                        <tr>
			                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">E-way bill No.</td>
			                          <td className="px-4 py-3 border border-outline-variant">
			                            <input
		                              className={tableInputClass}
		                              value={ewayBillNumber}
		                              onChange={(e) => {
		                                setInvoiceFormError(null);
		                                setEwayBillNumber(e.target.value);
		                              }}
		                            />
		                          </td>
		                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">CN/Courier No</td>
		                          <td className="px-4 py-3 border border-outline-variant">
		                            <input
		                              className={tableInputClass}
		                              value={cnNumber}
		                              onChange={(e) => {
		                                setInvoiceFormError(null);
		                                setCnNumber(e.target.value);
		                              }}
		                            />
		                          </td>
		                        </tr>
		                        <tr>
		                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">Transporter</td>
		                          <td className="px-4 py-3 border border-outline-variant">
					                            <SearchableSelect
					                              options={transporterOptions}
					                              value={invoiceTransporterId}
					                              disabled={loadingTransporters || busy}
					                              onChange={(v) => {
					                                setInvoiceFormError(null);
					                                setInvoiceTransporterId(v);
					                              }}
					                              placeholder={loadingTransporters ? 'Loading transporters...' : 'Select transporter'}
					                              allowClear
					                            />
				                          </td>
					                          <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant">CN/Courier Copy</td>
					                          <td className="px-4 py-3 border border-outline-variant">
				                            <div className="flex flex-col gap-2">
				                              {invoiceCourierCopy ? (
				                                <div className="flex items-center gap-2">
				                                  <button
				                                    type="button"
				                                    className="px-2 py-1 text-[11px] font-semibold text-on-primary bg-primary rounded-md hover:bg-primary/90"
				                                    onClick={() => window.open(invoiceCourierCopy || '', '_blank')}
				                                  >
				                                    View
				                                  </button>
				                                  <button
				                                    type="button"
				                                    disabled={busy}
				                                    className="px-2 py-1 text-[11px] font-semibold text-on-primary bg-error rounded-md hover:bg-error/90 disabled:opacity-50"
				                                    onClick={() => setInvoiceCourierCopy('')}
				                                  >
				                                    Clear
				                                  </button>
				                                </div>
				                              ) : (
				                                <div className="text-sm text-on-surface-variant">No file</div>
				                              )}
				                              <input
				                                id="invoice-courier-copy-upload"
				                                type="file"
				                                accept="application/pdf,image/*"
				                                disabled={busy}
				                                className="hidden"
				                                onChange={(e) => {
				                                  const file = e.target.files?.[0];
				                                  e.target.value = '';
				                                  if (!file) return;
				                                  const reader = new FileReader();
				                                  reader.onload = () => {
				                                    const result = reader.result;
				                                    const dataUrl = typeof result === 'string' ? result : '';
				                                    if (!dataUrl) return;
				                                    setInvoiceFormError(null);
				                                    setInvoiceCourierCopy(dataUrl);
				                                  };
				                                  reader.readAsDataURL(file);
				                                }}
				                              />
				                              <label
				                                htmlFor="invoice-courier-copy-upload"
				                                className={`inline-flex items-center justify-center w-full px-3 py-2 rounded-md text-xs font-semibold bg-black text-white ${
				                                  busy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-black/90'
				                                }`}
				                              >
				                                Choose file
				                              </label>
				                            </div>
					                          </td>
					                        </tr>
		                      </tbody>
	                    </table>
	                  </div>
	                </div>

                <div className="bg-white rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
	                  <div className="overflow-x-auto">
	                    <table className="w-full text-left border-collapse border border-outline-variant">
	                      <thead>
		                        <tr className="bg-blue-700">
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Item</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Pending Qty</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO Rate</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Inv Rate</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GST %</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Invoice Qty</th>
		                        </tr>
		                      </thead>
	                      <tbody>
		                        {loadingPendingItems ? (
	                          <tr>
	                            <td colSpan={6} className="px-4 py-6 text-sm text-on-surface-variant text-center border border-outline-variant">Loading pending items...</td>
	                          </tr>
				                        ) : pendingInvoiceItems.length ? (
					                          pendingInvoiceItems.map((it) => {
					                            const poLine = selectedPo?.items?.find((x) => x.itemId === it.itemId);
						                            const gstPct = Number((poLine as any)?.taxPercent ?? 0);
						                            const gstValue =
						                              invoiceGstPct[it.itemId] ??
						                              (Number.isFinite(gstPct) && gstPct !== 0 ? String(gstPct) : '');
					                            const prRow = prItems.find((r) => r.itemId === it.itemId);
					                            const specInline = (prRow?.specification || '')
					                              .split(/\r?\n/)
					                              .map((s) => s.trim())
			                              .filter(Boolean)
			                              .join(' - ');
			                            const label = [prRow?.item || it.item, specInline || null].filter(Boolean).join(' - ');
			                            return (
			                            <tr key={it.itemId}>
			                              <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant whitespace-normal break-words">
			                                {renderInlineWithBoldSpecNames(label)}
			                              </td>
		                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{it.pendingQty}</td>
		                              <td className="px-4 py-3 border border-outline-variant">
			                                <input className={cn(tableInputClass, 'bg-surface-container-lowest text-on-surface-variant')} value={String(it.rate)} readOnly tabIndex={-1} />
			                              </td>
				                              <td className="px-4 py-3 border border-outline-variant">
				                                <input
				                                  className={tableInputClass}
				                                  value={invoiceRates[it.itemId] ?? String(it.rate)}
			                                  onChange={(e) => {
			                                    setInvoiceFormError(null);
			                                    setInvoiceRates((prev) => ({ ...prev, [it.itemId]: e.target.value }));
			                                  }}
			                                  type="number"
			                                  min={0}
			                                  inputMode="decimal"
					                                  step="0.01"
					                                />
					                              </td>
						                              <td className="px-4 py-3 border border-outline-variant">
						                                <input
						                                  className={tableInputClass}
						                                  value={gstValue}
						                                  onChange={(e) => {
						                                    setInvoiceFormError(null);
						                                    setInvoiceGstPct((prev) => ({
						                                      ...prev,
						                                      [it.itemId]: sanitizePercentInput(e.target.value),
						                                    }));
						                                  }}
						                                  onBlur={() =>
						                                    setInvoiceGstPct((prev) => ({
						                                      ...prev,
						                                      [it.itemId]: clampPercentString(prev[it.itemId] ?? ''),
						                                    }))
						                                  }
						                                  type="text"
						                                  inputMode="decimal"
						                                />
						                              </td>
					                              <td className="px-4 py-3 border border-outline-variant">
					                                <input
					                                  className={tableInputClass}
					                                  value={invoiceQty[it.itemId] ?? String(it.pendingQty)}
			                                  onChange={(e) => {
			                                    setInvoiceFormError(null);
			                                    setInvoiceQty((prev) => ({ ...prev, [it.itemId]: e.target.value }));
			                                  }}
			                                  type="number"
			                                  min={0}
			                                  max={it.pendingQty}
			                                  inputMode="numeric"
			                                  step="1"
			                                />
			                              </td>
				                            </tr>
				                          );
				                          })
			                        ) : (
	                          <tr>
	                            <td colSpan={6} className="px-4 py-6 text-sm text-on-surface-variant text-center border border-outline-variant">No pending items for invoice.</td>
	                          </tr>
	                        )}
	                      </tbody>
                    </table>
                  </div>
	                </div>

	                {invoiceFormError ? (
	                  <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">
	                    {invoiceFormError}
	                  </div>
		                ) : null}
	
		                <div className="flex items-center justify-between flex-wrap gap-3">
		                  <div className="flex items-center gap-4 flex-wrap">
		                    <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-4 py-2">
		                      <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Invoice Total</div>
		                      <div className="text-sm font-bold tabular-nums text-on-surface">{computedInvoiceLinesTotalNumber.toFixed(2)}</div>
		                    </div>
		                    <div className="rounded-lg border border-outline-variant/30 bg-primary-container/40 px-4 py-2">
		                      <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Invoice Total Amount</div>
		                      <div className="text-base font-extrabold tabular-nums text-on-surface">{computedInvoiceAmountText}</div>
		                    </div>
		                  </div>
		                  <div className="flex items-center gap-2">
		                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setInvoiceCreateOpen(false)}>
		                      Cancel
		                    </button>
		                    <button
		                      type="button"
			                      disabled={busy || loadingPendingItems || pendingInvoiceItems.length === 0}
		                      className="btn-primary btn-sm"
		                      onClick={() => {
		                      setInvoiceFormError(null);
		                      if (!selectedPo) return;
		                      if (!invoiceNo.trim() || !invoiceDate.trim()) {
		                        setInvoiceFormError('Invoice no and date are required.');
	                        return;
	                      }
		                      if (!invoiceUpdatedBy.trim()) {
		                        setInvoiceFormError('Updated By is required.');
		                        return;
		                      }
			                      if (!pendingInvoiceItems.length) {
			                        setInvoiceFormError('No pending items for invoice.');
			                        return;
			                      }
				                      const selectedPoItems =
				                        posList.find((p) => p.po.id === selectedPoId)?.items ??
				                        (workflow?.po?.po?.id === selectedPoId ? (workflow?.po?.items ?? []) : []);
				                      const items = pendingInvoiceItems.map((it) => {
				                        const quantity = Number(invoiceQty[it.itemId] ?? it.pendingQty);
				                        const rate = Number(invoiceRates[it.itemId] ?? it.rate);
				                        const poTaxPct = Number((selectedPoItems.find((x) => x.itemId === it.itemId) as any)?.taxPercent ?? 0);
				                        const rawTax = invoiceGstPct[it.itemId] ?? (Number.isFinite(poTaxPct) && poTaxPct !== 0 ? String(poTaxPct) : '');
				                        const taxPercent = rawTax.trim() ? Number(clampPercentString(rawTax)) : 0;
				                        return { itemId: it.itemId, item: it.item, quantity, rate, taxPercent, pendingQty: it.pendingQty };
				                      });
				                      if (
				                        items.some(
				                          (x) =>
				                            !Number.isFinite(x.quantity) ||
				                            x.quantity <= 0 ||
				                            x.quantity > x.pendingQty ||
				                            !Number.isFinite(x.rate) ||
				                            x.rate < 0 ||
				                            !Number.isFinite(x.taxPercent) ||
				                            x.taxPercent < 0 ||
				                            x.taxPercent > 100
				                        )
				                      ) {
				                        setInvoiceFormError('Enter valid invoice qty/rate (qty must be <= pending qty).');
				                        return;
				                      }
				                      const createItems = items.map(({ pendingQty: _pendingQty, ...rest }) => rest);
				                      const invoiceAmountNumber = Number.isFinite(computedInvoiceAmountNumber) ? computedInvoiceAmountNumber : undefined;
					                      const courierChargeNumber = invoiceCourierCharge.trim() ? Number(invoiceCourierCharge) : undefined;
					                      const packingChargeNumber = invoicePackingCharge.trim() ? Number(invoicePackingCharge) : undefined;
					                      const labourChargeNumber = invoiceLabourCharge.trim() ? Number(invoiceLabourCharge) : undefined;
					                      const otherChargeNumber = invoiceOtherCharge.trim() ? Number(invoiceOtherCharge) : undefined;
					                      const chargesGstAmountNumber = invoiceChargesGstAmount.trim() ? Number(invoiceChargesGstAmount) : undefined;
			                      if (invoiceCourierCharge.trim() && (!Number.isFinite(courierChargeNumber) || (courierChargeNumber ?? 0) < 0)) {
			                        setInvoiceFormError('Enter a valid courier charge.');
			                        return;
			                      }
			                      if (invoicePackingCharge.trim() && (!Number.isFinite(packingChargeNumber) || (packingChargeNumber ?? 0) < 0)) {
			                        setInvoiceFormError('Enter a valid packing charge.');
			                        return;
			                      }
			                      if (invoiceLabourCharge.trim() && (!Number.isFinite(labourChargeNumber) || (labourChargeNumber ?? 0) < 0)) {
			                        setInvoiceFormError('Enter a valid labour charge.');
			                        return;
			                      }
					                      if (invoiceOtherCharge.trim() && (!Number.isFinite(otherChargeNumber) || (otherChargeNumber ?? 0) < 0)) {
					                        setInvoiceFormError('Enter a valid other charge.');
					                        return;
					                      }
					                      if (invoiceChargesGstAmount.trim() && (!Number.isFinite(chargesGstAmountNumber) || (chargesGstAmountNumber ?? 0) < 0)) {
					                        setInvoiceFormError('Enter a valid GST on charges amount.');
					                        return;
					                      }
				                      const transporterName = transporters.find((t) => t.id === invoiceTransporterId)?.name || '';
				                      const cnOrCourierNo = String(cnNumber || courierNumber || '').trim();
				                      if (invoiceCourierCopy.trim()) {
				                        if (!cnOrCourierNo) {
				                          setInvoiceFormError('Enter CN/Courier No before uploading CN/Courier Copy.');
				                          return;
				                        }
				                        if (!transporterName) {
				                          setInvoiceFormError('Select Transporter before uploading CN/Courier Copy.');
				                          return;
				                        }
				                      }
				                      run(() =>
					                        createInvoice(selectedPo.po.id, {
				                          supplierInvoiceNo: invoiceNo,
				                          invoiceDate,
				                          invoiceAmount: invoiceAmountNumber,
			                          courierCharge: courierChargeNumber,
			                          packingCharge: packingChargeNumber,
			                          labourCharge: labourChargeNumber,
			                          otherCharge: otherChargeNumber,
			                          chargesGstAmount: chargesGstAmountNumber,
				                          documentUrl: invoicePdf || undefined,
				                          ewayBillNumber: ewayBillNumber || undefined,
				                          cnNumber: cnNumber || undefined,
			                          courierNumber: courierNumber || undefined,
			                          transporterName: transporterName || undefined,
			                          updatedBy: invoiceUpdatedBy || undefined,
			                          items: createItems,
			                        })
			                          .then((res) => {
			                            const created = (res as any)?.invoice as InvoiceWithItems | undefined;
			                            const createdInvoiceId = String((created as any)?.invoice?.id ?? (created as any)?.id ?? '').trim();
			                            if (invoiceCourierCopy.trim() && createdInvoiceId) {
			                              return saveLogistics(createdInvoiceId, {
			                                dispatchProof: invoiceCourierCopy,
			                                cnOrCourierNo,
			                                transporterName,
			                              }).then(() => undefined);
			                            }
			                            return undefined;
			                          })
			                          .catch((e) => {
			                            setInvoiceFormError(e instanceof Error ? e.message : String(e));
			                            throw e;
		                          })
	                      );
		                      }}
			                    >
			                      Record Invoice
			                    </button>
		                  </div>
		                </div>
		              </div>
		            ) : pendingInvoicePoRows.length ? (
		              <div className="space-y-2">
		                <div className="text-center text-lg font-semibold text-blue-600">
		                  Pending PO for Invoice ({pendingInvoicePoRows.length})
		                </div>
		                <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
		                  <div className="overflow-x-auto">
			                    <table className="w-full min-w-[2100px] table-fixed text-left border-collapse border border-outline-variant">
			                      <colgroup>
			                        <col className="w-[140px]" />
			                        <col className="w-[220px]" />
			                        <col className="w-[180px]" />
			                        <col className="w-[520px]" />
			                        <col className="w-[110px]" />
			                        <col className="w-[110px]" />
			                        <col className="w-[90px]" />
			                        <col className="w-[90px]" />
			                        <col className="w-[130px]" />
			                        <col className="w-[170px]" />
			                        <col className="w-[170px]" />
			                        <col className="w-[170px]" />
			                      </colgroup>
			                      <thead>
			                        <tr className="bg-blue-700">
			                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO No</th>
			                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Supplier</th>
			                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Terms</th>
			                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Items</th>
			                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO Qty</th>
			                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO Rate</th>
			                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Disc %</th>
			                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GST %</th>
			                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Pending Invoice Qty</th>
			                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Checked By</th>
			                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Sent By</th>
			                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Action</th>
			                        </tr>
			                      </thead>
			                      <tbody>
			                        {pendingInvoicePoRows.flatMap((r) => {
			                          const lines = Array.isArray(r.lines) && r.lines.length ? r.lines : [null];
			                          const rowSpan = lines.length;
			                          return lines.map((it, idx) => {
			                            const prRow = it ? prItems.find((x) => x.itemId === it.itemId) : null;
			                            const specInline = (prRow?.specification || '')
			                              .split(/\r?\n/)
			                              .map((s) => s.trim())
			                              .filter(Boolean)
			                              .join(' - ');
			                            const label = it ? [prRow?.item || '', specInline || null].filter(Boolean).join(' - ') : '-';
			                            const poQtyCell = it && Number.isFinite(it.poQty) ? it.poQty : '-';
			                            const poRateCell = it && Number.isFinite(it.poRate) ? it.poRate : '-';
			                            const discCell = it && Number.isFinite(it.discountPercent) ? it.discountPercent : '-';
			                            const gstCell = it && Number.isFinite(it.taxPercent) ? it.taxPercent : '-';
			                            const pendingCell = it && Number.isFinite(it.pendingInvoiceQty) ? it.pendingInvoiceQty : '-';

			                            return (
			                              <tr key={`${r.poId}||${it ? it.itemId : 'empty'}||${idx}`}>
			                                {idx === 0 ? (
			                                  <>
				                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
					                                      {formatPoNumber(r.poNumber ?? '') || '-'}
				                                    </td>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
			                                      {r.supplier || '-'}
			                                    </td>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
			                                      {r.paymentTerms || '-'}
			                                    </td>
			                                  </>
			                                ) : null}

			                                <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant whitespace-normal break-words">
			                                  {renderInlineWithBoldSpecNames(label || '-')}
			                                </td>
			                                <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{poQtyCell}</td>
			                                <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{poRateCell}</td>
			                                <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{discCell}</td>
			                                <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{gstCell}</td>
			                                <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{pendingCell}</td>

			                                {idx === 0 ? (
			                                  <>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
			                                      {r.checkedBy || '-'}
			                                    </td>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
			                                      {r.sentBy || '-'}
			                                    </td>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 border border-outline-variant align-top">
			                                      <button
			                                        type="button"
			                                        className="px-3 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
			                                        onClick={() => {
			                                          setSelectedPoId(r.poId);
			                                          setInvoiceFormError(null);
			                                          setInvoiceNo('');
			                                          setInvoiceDate(new Date().toISOString().slice(0, 10));
			                                          setInvoiceCreateOpen(true);
			                                        }}
			                                      >
			                                        Create Invoice
			                                      </button>
			                                    </td>
			                                  </>
			                                ) : null}
			                              </tr>
			                            );
			                          });
			                        })}
			                      </tbody>
			                    </table>
		                  </div>
		                </div>
		              </div>
		            ) : (
		              <div className="text-sm text-on-surface-variant text-center">No pending PO for invoice.</div>
		            )}

		            {invoicesForPr.length ? (
		              <div className="space-y-2">
		                <div className="text-center text-lg font-semibold text-blue-600">Recorded Invoices ({invoicesForPr.length})</div>
		                <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
		                  <div className="overflow-x-auto">
					                    <table className="w-full min-w-[2650px] table-fixed text-left border-collapse border border-outline-variant border-black [&_th]:border-black [&_td]:border-black">
						                      <colgroup>
						                        <col className="w-[140px]" />
						                        <col className="w-[180px]" />
						                        <col className="w-[140px]" />
						                        <col className="w-[120px]" />
						                        <col className="w-[120px]" />
						                        <col className="w-[120px]" />
						                        <col className="w-[120px]" />
						                        <col className="w-[120px]" />
						                        <col className="w-[120px]" />
						                        <col className="w-[140px]" />
						                        <col className="w-[450px]" />
						                        <col className="w-[120px]" />
						                        <col className="w-[110px]" />
						                        <col className="w-[110px]" />
						                        <col className="w-[150px]" />
					                        <col className="w-[110px]" />
					                        <col className="w-[160px]" />
					                        <col className="w-[110px]" />
					                      </colgroup>
					                      <thead>
					                        <tr className="bg-blue-700">
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Invoice No</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Invoice Date</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Amount</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Courier Charge</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Packing Charge</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Labour Charge</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Other Charge</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Status</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Payment Status</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Item</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Inv Qty</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO Rate</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Inv Rate</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Effective Item Price</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GRN Qty</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Created At</th>
					                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Action</th>
					                        </tr>
					                      </thead>
				                      <tbody>
			                        {invoicesForPr.flatMap((inv) => {
			                          const lines = Array.isArray(inv.items) && inv.items.length ? inv.items : [null];
			                          const rowSpan = lines.length;
			                          const itemCount = Array.isArray(inv.items) ? inv.items.length : 0;
			                          const amountCell =
			                            typeof inv.invoice.invoiceAmount === 'number' && Number.isFinite(inv.invoice.invoiceAmount) ? inv.invoice.invoiceAmount.toFixed(2) : '-';
			                          const courierChargeCell =
			                            typeof inv.invoice.courierCharge === 'number' && Number.isFinite(inv.invoice.courierCharge)
			                              ? inv.invoice.courierCharge.toFixed(2)
			                              : '-';
			                          const packingChargeCell =
			                            typeof inv.invoice.packingCharge === 'number' && Number.isFinite(inv.invoice.packingCharge)
			                              ? inv.invoice.packingCharge.toFixed(2)
			                              : '-';
			                          const labourChargeCell =
			                            typeof inv.invoice.labourCharge === 'number' && Number.isFinite(inv.invoice.labourCharge)
			                              ? inv.invoice.labourCharge.toFixed(2)
			                              : '-';
			                          const otherChargeCell =
			                            typeof inv.invoice.otherCharge === 'number' && Number.isFinite(inv.invoice.otherCharge) ? inv.invoice.otherCharge.toFixed(2) : '-';
			                          const totalExtraCharges =
			                            (typeof inv.invoice.courierCharge === 'number' && Number.isFinite(inv.invoice.courierCharge) ? inv.invoice.courierCharge : 0) +
			                            (typeof inv.invoice.packingCharge === 'number' && Number.isFinite(inv.invoice.packingCharge) ? inv.invoice.packingCharge : 0) +
			                            (typeof inv.invoice.labourCharge === 'number' && Number.isFinite(inv.invoice.labourCharge) ? inv.invoice.labourCharge : 0) +
			                            (typeof inv.invoice.otherCharge === 'number' && Number.isFinite(inv.invoice.otherCharge) ? inv.invoice.otherCharge : 0);
			                          const extraChargePerItemLine = itemCount > 0 ? totalExtraCharges / itemCount : 0;

			                          return lines.map((it, idx) => {
			                            const prRow = it ? prItems.find((r) => r.itemId === it.itemId) : null;
				                            const specInline = (prRow?.specification || '')
				                              .split(/\r?\n/)
				                              .map((s) => s.trim())
				                              .filter(Boolean)
				                              .join(' - ');
					                            const label = it ? [prRow?.item || it.item, specInline || null].filter(Boolean).join(' - ') : '-';
					                            const invQtyNumber = it ? Number(it.quantity ?? 0) : NaN;
					                            const poRateCell = it ? poRateByPoIdItemId[`${inv.invoice.poId}||${it.itemId}`] : undefined;
					                            const poRateNumber = it ? Number(poRateCell ?? NaN) : NaN;
					                            const invRateNumber = it ? Number(it.rate ?? 0) : NaN;
					                            const invQtyCell = it ? invQtyNumber : '-';
					                            const invRateCell = it ? invRateNumber : '-';
					                            const rateMismatch =
					                              it &&
					                              Number.isFinite(poRateNumber) &&
					                              Number.isFinite(invRateNumber) &&
					                              Math.abs(invRateNumber - poRateNumber) > 1e-9;
				                            const effectiveItemPriceCell =
				                              it && typeof it.rate === 'number' && Number.isFinite(it.rate) && typeof it.quantity === 'number' && Number.isFinite(it.quantity) && it.quantity > 0
				                                ? (it.rate + extraChargePerItemLine / it.quantity).toFixed(2)
				                                : '-';
						                            const grnQtyCell = it ? Number(linkedGrnQtyByInvoiceIdItemId[`${inv.invoice.id}||${it.itemId}`] ?? 0) : '-';

			                            return (
			                              <tr key={`${inv.invoice.id}||${it ? it.itemId : 'empty'}||${idx}`}>
			                                {idx === 0 ? (
			                                  <>
				                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
				                            {displayPoNumberById(inv.invoice.poId)}
				                                    </td>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
			                                      {inv.invoice.supplierInvoiceNo || '-'}
			                                    </td>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
				                                      {formatDateDDMMYYYYOnly(inv.invoice.invoiceDate)}
			                                    </td>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
			                                      {amountCell}
			                                    </td>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
			                                      {courierChargeCell}
			                                    </td>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
			                                      {packingChargeCell}
			                                    </td>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
			                                      {labourChargeCell}
			                                    </td>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
			                                      {otherChargeCell}
			                                    </td>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
			                                      {inv.invoice.status}
			                                    </td>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
			                                      {String(inv.invoice.paymentStatus ?? '').trim() || '-'}
			                                    </td>
			                                  </>
			                                ) : null}

					                                <td
					                                  className={`px-4 py-3 text-xs text-on-surface-variant border border-outline-variant ${rateMismatch ? 'bg-red-100' : ''}`}
					                                >
						                                  <div className="whitespace-normal break-words">{renderInlineWithBoldSpecNames(label)}</div>
						                                </td>
					                                <td
					                                  className={`px-4 py-3 text-sm text-on-surface-variant border border-outline-variant ${rateMismatch ? 'bg-red-100' : ''}`}
					                                >
					                                  {invQtyCell}
					                                </td>
					                                <td
					                                  className={`px-4 py-3 text-sm text-on-surface-variant border border-outline-variant ${rateMismatch ? 'bg-red-100' : ''}`}
					                                >
					                                  {poRateCell ?? '-'}
					                                </td>
					                                <td
					                                  className={`px-4 py-3 text-sm text-on-surface-variant border border-outline-variant ${rateMismatch ? 'bg-red-100' : ''}`}
					                                >
					                                  {invRateCell}
					                                </td>
					                                <td
					                                  className={`px-4 py-3 text-sm text-on-surface-variant border border-outline-variant ${rateMismatch ? 'bg-red-100' : ''}`}
					                                >
					                                  {effectiveItemPriceCell}
					                                </td>
					                                <td
					                                  className={`px-4 py-3 text-sm text-on-surface-variant border border-outline-variant ${rateMismatch ? 'bg-red-100' : ''}`}
					                                >
					                                  {grnQtyCell}
					                                </td>

			                                {idx === 0 ? (
			                                  <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
				                                    {formatDateDDMMYYYYOnly(inv.invoice.createdAt)}
			                                  </td>
			                                ) : null}

		                                {idx === 0 ? (
		                                  <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
		                                    <div className="flex items-center gap-2">
			                                      <button
			                                        type="button"
			                                        title="View"
			                                        aria-label="View"
			                                        className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-on-primary shadow-sm hover:bg-primary-dim transition-colors"
			                                        onClick={() => openInvoiceDetails(inv, 'view')}
			                                      >
			                                        <Eye size={16} />
			                                      </button>
				                                      <button
				                                        type="button"
				                                        title="Edit"
				                                        aria-label="Edit"
				                                        className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-on-primary shadow-sm hover:bg-primary-dim transition-colors"
				                                        onClick={() => openInvoiceDetails(inv, 'edit')}
				                                      >
				                                        <Pencil size={16} />
				                                      </button>
					                                      <button
					                                        type="button"
					                                        title="Delete"
					                                        aria-label="Delete"
					                                        className="btn-icon-danger"
					                                        onClick={() => {
					                                          if (!confirm(`Delete invoice ${inv.invoice.supplierInvoiceNo || inv.invoice.id}?`)) return;
					                                          run(() => deleteInvoice(inv.invoice.id).then(() => undefined));
					                                        }}
				                                      >
				                                        <Trash2 size={16} />
				                                      </button>
			                                    </div>
			                                  </td>
			                                ) : null}
		                              </tr>
		                            );
		                          });
		                        })}
		                      </tbody>
		                    </table>
		                  </div>
	                </div>
	              </div>
	            ) : (
		              <div className="text-sm text-on-surface-variant">No invoices recorded yet.</div>
		            )}

		            <div className="space-y-2 mt-4">
		              <div className="text-center text-lg font-semibold text-blue-600">Invoice Due for Payment ({invoicesDueForPayment.length})</div>
		              {invoicesDueForPayment.length ? (
		                <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant border-black">
		                  <div className="overflow-x-auto">
		                    <table className="w-full min-w-[1910px] table-fixed text-left border-collapse border border-outline-variant border-black [&_th]:border-black [&_td]:border-black">
		                      <colgroup>
		                        <col className="w-[140px]" />
		                        <col className="w-[180px]" />
		                        <col className="w-[140px]" />
		                        <col className="w-[120px]" />
		                        <col className="w-[120px]" />
		                        <col className="w-[140px]" />
		                        <col className="w-[140px]" />
		                        <col className="w-[450px]" />
		                        <col className="w-[120px]" />
		                        <col className="w-[110px]" />
		                        <col className="w-[110px]" />
		                        <col className="w-[110px]" />
		                        <col className="w-[160px]" />
		                        <col className="w-[110px]" />
		                      </colgroup>
		                      <thead>
		                        <tr className="bg-blue-700">
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Invoice No</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Invoice Date</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Amount</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Status</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Payment Status</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Payment Date</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Item</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Inv Qty</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO Rate</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Inv Rate</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GRN Qty</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Created At</th>
		                          <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Action</th>
		                        </tr>
		                      </thead>
		                      <tbody>
		                        {invoicesDueForPayment.flatMap((inv) => {
		                          const lines = Array.isArray(inv.items) && inv.items.length ? inv.items : [null];
		                          const rowSpan = lines.length;
		                          const amountCell =
		                            typeof inv.invoice.invoiceAmount === 'number' && Number.isFinite(inv.invoice.invoiceAmount)
		                              ? inv.invoice.invoiceAmount.toFixed(2)
		                              : '-';

		                          return lines.map((it, idx) => {
		                            const prRow = it ? prItems.find((r) => r.itemId === it.itemId) : null;
		                            const specInline = (prRow?.specification || '')
		                              .split(/\r?\n/)
		                              .map((s) => s.trim())
		                              .filter(Boolean)
		                              .join(' - ');
		                            const label = it ? [prRow?.item || it.item, specInline || null].filter(Boolean).join(' - ') : '-';
		                            const invQtyCell = it ? it.quantity : '-';
		                            const poRateCell = it ? poRateByPoIdItemId[`${inv.invoice.poId}||${it.itemId}`] : undefined;
		                            const invRateCell = it ? it.rate : '-';
		                            const grnQtyCell = it ? Number(linkedGrnQtyByInvoiceIdItemId[`${inv.invoice.id}||${it.itemId}`] ?? 0) : '-';

		                            return (
		                              <tr key={`due||${inv.invoice.id}||${it ? it.itemId : 'empty'}||${idx}`}>
		                                {idx === 0 ? (
		                                  <>
				                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
				                            {displayPoNumberById(inv.invoice.poId)}
				                                    </td>
		                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
		                                      {inv.invoice.supplierInvoiceNo || '-'}
		                                    </td>
		                                    <td
		                                      rowSpan={rowSpan}
		                                      className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top"
		                                    >
		                                      {formatDateDDMMYYYYOnly(inv.invoice.invoiceDate)}
		                                    </td>
		                                    <td
		                                      rowSpan={rowSpan}
		                                      className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top"
		                                    >
		                                      {amountCell}
		                                    </td>
		                                    <td
		                                      rowSpan={rowSpan}
		                                      className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top"
		                                    >
		                                      {inv.invoice.status}
		                                    </td>
			                                    <td rowSpan={rowSpan} className="px-4 py-3 border border-outline-variant align-top">
			                                      <SearchableSelect
			                                        options={paymentStatusOptions}
			                                        value={String(paymentStatusByInvoiceId[inv.invoice.id] ?? inv.invoice.paymentStatus ?? '')}
			                                        disabled={busy}
			                                        onChange={(v) =>
			                                          setPaymentStatusByInvoiceId((prev) => ({ ...prev, [inv.invoice.id]: String(v ?? '') }))
			                                        }
			                                        placeholder="Select"
			                                        allowClear
			                                      />
			                                    </td>
		                                    <td rowSpan={rowSpan} className="px-4 py-3 border border-outline-variant align-top">
		                                      <input
		                                        className={tableInputClass}
		                                        type="date"
		                                        value={
		                                          String(
		                                            paymentDateByInvoiceId[inv.invoice.id] ??
		                                              (inv.invoice.paymentDate ? String(inv.invoice.paymentDate).slice(0, 10) : '')
		                                          )
		                                        }
		                                        disabled={busy}
		                                        onChange={(e) =>
		                                          setPaymentDateByInvoiceId((prev) => ({ ...prev, [inv.invoice.id]: e.target.value }))
		                                        }
		                                      />
		                                    </td>
		                                  </>
		                                ) : null}

		                                <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
						                                      <div className="whitespace-normal break-words">{renderInlineWithBoldSpecNames(label)}</div>
					                                    </td>
		                                <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{invQtyCell}</td>
		                                <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{poRateCell ?? '-'}</td>
		                                <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{invRateCell}</td>
		                                <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{grnQtyCell}</td>

		                                {idx === 0 ? (
		                                  <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
		                                    {formatDateDDMMYYYYOnly(inv.invoice.createdAt)}
		                                  </td>
		                                ) : null}

		                                {idx === 0 ? (
		                                  <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
		                                    <div className="flex items-center gap-2">
		                                      <button
		                                        type="button"
		                                        title="Update Payment"
		                                        aria-label="Update Payment"
		                                        className="px-3 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
		                                        disabled={busy}
		                                        onClick={() => {
		                                          const paymentStatus = String(
		                                            paymentStatusByInvoiceId[inv.invoice.id] ?? inv.invoice.paymentStatus ?? ''
		                                          ).trim();
		                                          const paymentDate = String(
		                                            paymentDateByInvoiceId[inv.invoice.id] ??
		                                              (inv.invoice.paymentDate ? String(inv.invoice.paymentDate).slice(0, 10) : '')
		                                          ).trim();
		                                          if (paymentStatus !== 'Partly Paid' && paymentStatus !== 'Full Paid') {
		                                            setError('Select Payment Status (Partly Paid / Full Paid).');
		                                            return;
		                                          }
		                                          if (!paymentDate) {
		                                            setError('Select Payment Date.');
		                                            return;
		                                          }
		                                          run(() =>
		                                            updateInvoicePayment(inv.invoice.id, {
		                                              paymentStatus: paymentStatus as 'Partly Paid' | 'Full Paid',
		                                              paymentDate,
		                                              updatedBy: invoiceUpdatedBy || undefined,
		                                            })
		                                              .then((res) => {
		                                                const updated = (res as any)?.invoice as InvoiceWithItems | undefined;
		                                                if (updated) {
		                                                  setInvoicesForPr((prev) =>
		                                                    prev.map((x) => (x.invoice.id === inv.invoice.id ? updated : x))
		                                                  );
		                                                }
		                                                setError(null);
		                                              })
		                                              .catch((e) => {
		                                                setError(e instanceof Error ? e.message : String(e));
		                                                throw e;
		                                              })
		                                          );
		                                        }}
		                                      >
		                                        Update
		                                      </button>
		                                    </div>
		                                  </td>
		                                ) : null}
		                              </tr>
		                            );
		                          });
		                        })}
		                      </tbody>
		                    </table>
		                  </div>
		                </div>
		              ) : (
		                <div className="text-sm text-on-surface-variant">No invoices due for payment yet.</div>
		              )}
		            </div>

			            {invoiceDetailsOpen && activeInvoiceDetails ? (
			              <div className="fixed inset-0 z-50">
			                <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={closeInvoiceDetails} />
			                <div className="relative w-full h-full bg-surface-container-lowest border border-outline-variant shadow-xl flex flex-col">
				                  <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant bg-surface-container-lowest">
					                    <div className="text-sm font-bold text-on-surface">
					                      Invoice No
					                      {activeInvoiceDetails.invoice.supplierInvoiceNo ? `: ${activeInvoiceDetails.invoice.supplierInvoiceNo}` : ''}
					                    </div>
			                    <button
			                      type="button"
			                      className="btn btn-sm"
			                      onClick={closeInvoiceDetails}
		                    >
			                      Close
			                    </button>
			                  </div>

			                  <div className="flex-1 overflow-auto p-5 space-y-4">
			                    {invoiceDetailsError ? <div className="text-sm text-error font-semibold">{invoiceDetailsError}</div> : null}

				                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
					                      <Field label="PO">
	            <input className={inputClass} value={displayPoNumberById(activeInvoiceDetails.invoice.poId)} disabled />
					                      </Field>
			                      <Field label="Status">
			                        <input className={inputClass} value={activeInvoiceDetails.invoice.status} disabled />
			                      </Field>
				                      <Field label="Created At">
				                        <input className={inputClass} value={formatDateDDMMYYYYOnly(activeInvoiceDetails.invoice.createdAt)} disabled />
				                      </Field>
			                      {activeInvoiceReadyForPayment ? (
			                        <>
				                          <Field label="Payment Status">
				                            <SearchableSelect
				                              options={paymentStatusOptions}
				                              value={String(
				                                paymentStatusByInvoiceId[activeInvoiceDetails.invoice.id] ??
				                                  activeInvoiceDetails.invoice.paymentStatus ??
				                                  ''
				                              )}
				                              disabled={busy}
				                              onChange={(v) =>
				                                setPaymentStatusByInvoiceId((prev) => ({
				                                  ...prev,
				                                  [activeInvoiceDetails.invoice.id]: String(v ?? ''),
				                                }))
				                              }
				                              placeholder="Select"
				                              allowClear
				                            />
				                          </Field>
			                          <Field label="Payment Date">
			                            <input
			                              className={inputClass}
			                              type="date"
			                              value={
			                                String(
			                                  paymentDateByInvoiceId[activeInvoiceDetails.invoice.id] ??
			                                    (activeInvoiceDetails.invoice.paymentDate
			                                      ? String(activeInvoiceDetails.invoice.paymentDate).slice(0, 10)
			                                      : '')
			                                )
			                              }
			                              disabled={busy}
			                              onChange={(e) =>
			                                setPaymentDateByInvoiceId((prev) => ({
			                                  ...prev,
			                                  [activeInvoiceDetails.invoice.id]: e.target.value,
			                                }))
			                              }
			                            />
			                          </Field>
			                          <Field label="Payment Update">
			                            <button
			                              type="button"
			                              className="btn btn-sm"
			                              disabled={busy}
			                              onClick={() => {
			                                const invoiceId = String(activeInvoiceDetails.invoice.id ?? '').trim();
			                                const paymentStatus = String(
			                                  paymentStatusByInvoiceId[invoiceId] ?? activeInvoiceDetails.invoice.paymentStatus ?? ''
			                                ).trim();
			                                const paymentDate = String(
			                                  paymentDateByInvoiceId[invoiceId] ??
			                                    (activeInvoiceDetails.invoice.paymentDate
			                                      ? String(activeInvoiceDetails.invoice.paymentDate).slice(0, 10)
			                                      : '')
			                                ).trim();
			                                if (paymentStatus !== 'Partly Paid' && paymentStatus !== 'Full Paid') {
			                                  setInvoiceDetailsError('Select Payment Status (Partly Paid / Full Paid).');
			                                  return;
			                                }
			                                if (!paymentDate) {
			                                  setInvoiceDetailsError('Select Payment Date.');
			                                  return;
			                                }
			                                run(() =>
			                                  updateInvoicePayment(invoiceId, {
			                                    paymentStatus: paymentStatus as 'Partly Paid' | 'Full Paid',
			                                    paymentDate,
			                                    updatedBy: invoiceUpdatedBy || undefined,
			                                  })
			                                    .then((res) => {
			                                      const updated = (res as any)?.invoice as InvoiceWithItems | undefined;
			                                      if (updated) {
			                                        setInvoicesForPr((prev) =>
			                                          prev.map((x) => (x.invoice.id === invoiceId ? updated : x))
			                                        );
			                                        setActiveInvoiceDetails(updated);
			                                      }
			                                      setInvoiceDetailsError(null);
			                                    })
			                                    .catch((e) => {
			                                      setInvoiceDetailsError(e instanceof Error ? e.message : String(e));
			                                      throw e;
			                                    })
			                                );
			                              }}
			                            >
			                              Update
			                            </button>
			                          </Field>
			                        </>
			                      ) : null}
			                      <Field label="Invoice No">
			                        <input
			                          className={inputClass}
			                          value={invoiceDetailsMode === 'edit' ? editInvoiceNo : activeInvoiceDetails.invoice.supplierInvoiceNo || ''}
			                          onChange={(e) => setEditInvoiceNo(e.target.value)}
			                          disabled={busy || invoiceDetailsMode !== 'edit'}
			                        />
			                      </Field>
			                      <Field label="Invoice Date">
			                        <input
			                          className={inputClass}
			                          type="date"
			                          value={invoiceDetailsMode === 'edit' ? editInvoiceDate : activeInvoiceDetails.invoice.invoiceDate || ''}
			                          onChange={(e) => setEditInvoiceDate(e.target.value)}
			                          disabled={busy || invoiceDetailsMode !== 'edit'}
			                        />
			                      </Field>
				                      <Field label="Invoice Amount">
			                        <input
			                          className={inputClass}
			                          type="number"
		                          value={
		                            invoiceDetailsMode === 'edit'
		                              ? editInvoiceAmount
		                              : typeof activeInvoiceDetails.invoice.invoiceAmount === 'number' && Number.isFinite(activeInvoiceDetails.invoice.invoiceAmount)
		                                ? String(activeInvoiceDetails.invoice.invoiceAmount)
		                                : ''
		                          }
		                          onChange={(e) => setEditInvoiceAmount(e.target.value)}
				                          disabled={busy || invoiceDetailsMode !== 'edit'}
				                        />
				                      </Field>
				                      <Field label="Courier Charge">
				                        <input
				                          className={inputClass}
				                          type="number"
				                          value={
				                            invoiceDetailsMode === 'edit'
				                              ? editInvoiceCourierCharge
				                              : typeof activeInvoiceDetails.invoice.courierCharge === 'number' && Number.isFinite(activeInvoiceDetails.invoice.courierCharge) && activeInvoiceDetails.invoice.courierCharge !== 0
				                                ? String(activeInvoiceDetails.invoice.courierCharge)
				                                : ''
				                          }
				                          onChange={(e) => setEditInvoiceCourierCharge(e.target.value)}
				                          disabled={busy || invoiceDetailsMode !== 'edit'}
				                          inputMode="decimal"
				                          step="0.01"
				                        />
				                      </Field>
				                      <Field label="Packing Charge">
				                        <input
				                          className={inputClass}
				                          type="number"
				                          value={
				                            invoiceDetailsMode === 'edit'
				                              ? editInvoicePackingCharge
				                              : typeof activeInvoiceDetails.invoice.packingCharge === 'number' && Number.isFinite(activeInvoiceDetails.invoice.packingCharge) && activeInvoiceDetails.invoice.packingCharge !== 0
				                                ? String(activeInvoiceDetails.invoice.packingCharge)
				                                : ''
				                          }
				                          onChange={(e) => setEditInvoicePackingCharge(e.target.value)}
				                          disabled={busy || invoiceDetailsMode !== 'edit'}
				                          inputMode="decimal"
				                          step="0.01"
				                        />
				                      </Field>
				                      <Field label="Labour Charge">
				                        <input
				                          className={inputClass}
				                          type="number"
				                          value={
				                            invoiceDetailsMode === 'edit'
				                              ? editInvoiceLabourCharge
				                              : typeof activeInvoiceDetails.invoice.labourCharge === 'number' && Number.isFinite(activeInvoiceDetails.invoice.labourCharge) && activeInvoiceDetails.invoice.labourCharge !== 0
				                                ? String(activeInvoiceDetails.invoice.labourCharge)
				                                : ''
				                          }
				                          onChange={(e) => setEditInvoiceLabourCharge(e.target.value)}
				                          disabled={busy || invoiceDetailsMode !== 'edit'}
				                          inputMode="decimal"
				                          step="0.01"
				                        />
				                      </Field>
				                      <Field label="Other Charge">
				                        <input
				                          className={inputClass}
				                          type="number"
				                          value={
				                            invoiceDetailsMode === 'edit'
				                              ? editInvoiceOtherCharge
				                              : typeof activeInvoiceDetails.invoice.otherCharge === 'number' && Number.isFinite(activeInvoiceDetails.invoice.otherCharge) && activeInvoiceDetails.invoice.otherCharge !== 0
				                                ? String(activeInvoiceDetails.invoice.otherCharge)
				                                : ''
				                          }
				                          onChange={(e) => setEditInvoiceOtherCharge(e.target.value)}
				                          disabled={busy || invoiceDetailsMode !== 'edit'}
				                          inputMode="decimal"
				                          step="0.01"
				                        />
				                      </Field>
				                      <Field label="Updated By">
				                        <input className={inputClass} value={activeInvoiceDetails.invoice.updatedBy || ''} disabled />
				                      </Field>
			                      <Field label="Transporter">
			                        <input
			                          className={inputClass}
			                          value={activeInvoiceDetails.invoice.transporterName || activeInvoiceDetails.logistics?.transporterName || ''}
			                          disabled
			                        />
			                      </Field>
			                      <Field label="E-way Bill No">
			                        <input className={inputClass} value={activeInvoiceDetails.invoice.ewayBillNumber || ''} disabled />
			                      </Field>
			                      <Field label="CN No">
			                        <input className={inputClass} value={activeInvoiceDetails.invoice.cnNumber || ''} disabled />
			                      </Field>
			                      <Field label="Courier No">
			                        <input className={inputClass} value={activeInvoiceDetails.invoice.courierNumber || ''} disabled />
			                      </Field>
			                      <Field label="Inv PDF">
			                        <input className={inputClass} value={activeInvoiceDetails.invoice.documentUrl || ''} disabled />
			                      </Field>
			                    </div>
			                    {activeInvoiceDetails.invoice.status === 'On Hold' && activeInvoiceDetails.invoice.holdReason ? (
			                      <div className="text-sm text-on-surface-variant">Hold Reason: {activeInvoiceDetails.invoice.holdReason}</div>
			                    ) : null}
	
		                <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant border-black">
			                      <div className="overflow-x-auto">
				                        <table className="w-full min-w-[1160px] table-fixed text-left border-collapse border border-outline-variant border-black [&_th]:border-black [&_td]:border-black">
				                          <colgroup>
				                            <col className="w-[520px]" />
				                            <col className="w-[120px]" />
				                            <col className="w-[120px]" />
				                            <col className="w-[120px]" />
				                            <col className="w-[140px]" />
				                            <col className="w-[120px]" />
				                          </colgroup>
				                          <thead>
				                            <tr className="bg-blue-700">
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Item</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Inv Qty</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO Rate</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Inv Rate</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Effective Item Price</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GRN Qty</th>
				                            </tr>
					                          </thead>
					                          <tbody>
				                            {invoiceDetailsMode === 'edit' ? (
					                              editInvoiceLines.length ? (
				                                editInvoiceLines.map((l) => {
				                                  const poRateCell = poRateByPoIdItemId[`${activeInvoiceDetails.invoice.poId}||${l.itemId}`];
				                                  const totalExtraCharges =
				                                    (typeof activeInvoiceDetails.invoice.courierCharge === 'number' && Number.isFinite(activeInvoiceDetails.invoice.courierCharge)
				                                      ? activeInvoiceDetails.invoice.courierCharge
				                                      : 0) +
				                                    (typeof activeInvoiceDetails.invoice.packingCharge === 'number' && Number.isFinite(activeInvoiceDetails.invoice.packingCharge)
				                                      ? activeInvoiceDetails.invoice.packingCharge
				                                      : 0) +
				                                    (typeof activeInvoiceDetails.invoice.labourCharge === 'number' && Number.isFinite(activeInvoiceDetails.invoice.labourCharge)
				                                      ? activeInvoiceDetails.invoice.labourCharge
				                                      : 0) +
				                                    (typeof activeInvoiceDetails.invoice.otherCharge === 'number' && Number.isFinite(activeInvoiceDetails.invoice.otherCharge)
				                                      ? activeInvoiceDetails.invoice.otherCharge
				                                      : 0);
				                                  const extraChargePerItemLine = editInvoiceLines.length ? totalExtraCharges / editInvoiceLines.length : 0;
				                                  const quantityNumber = Number(l.quantity ?? 0);
				                                  const rateNumber = Number(l.rate ?? 0);
				                                  const effectiveItemPriceCell =
				                                    Number.isFinite(rateNumber) && Number.isFinite(quantityNumber) && quantityNumber > 0
				                                      ? (rateNumber + extraChargePerItemLine / quantityNumber).toFixed(2)
				                                      : '-';
				                                  return (
				                                  <tr key={l.itemId}>
					                                    <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
					                                      <div className="whitespace-normal break-words" title={l.label}>
					                                        {renderInlineWithBoldSpecNames(l.label)}
					                                      </div>
					                                    </td>
			                                    <td className="px-4 py-3 border border-outline-variant">
			                                      <input
			                                        className={tableInputClass}
			                                        value={l.quantity}
			                                        inputMode="numeric"
			                                        disabled={busy}
			                                        onChange={(e) =>
			                                          setEditInvoiceLines((prev) =>
			                                            prev.map((x) => (x.itemId === l.itemId ? { ...x, quantity: e.target.value } : x))
			                                          )
			                                        }
			                                      />
			                                    </td>
			                                    <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{poRateCell ?? '-'}</td>
				                                    <td className="px-4 py-3 border border-outline-variant">
				                                      <input
				                                        className={tableInputClass}
				                                        value={l.rate}
				                                        inputMode="decimal"
				                                        disabled={busy}
				                                        onChange={(e) =>
				                                          setEditInvoiceLines((prev) =>
				                                            prev.map((x) => (x.itemId === l.itemId ? { ...x, rate: e.target.value } : x))
				                                          )
				                                        }
				                                      />
				                                    </td>
				                                    <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{effectiveItemPriceCell}</td>
				                                    <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">
					                                      {Number(grnQtyByPoAndItemId[`${activeInvoiceDetails.invoice.poId}||${l.itemId}`] ?? 0)}
					                                    </td>
				                                  </tr>
				                                  );
					                                })
				                              ) : (
				                                <tr>
				                                  <td colSpan={6} className="px-4 py-6 text-sm text-on-surface-variant text-center border border-outline-variant">
				                                    No invoice items recorded.
				                                  </td>
				                                </tr>
				                              )
					                            ) : activeInvoiceDetails.items?.length ? (
					                              activeInvoiceDetails.items.map((it, idx) => {
			                                const prRow = prItems.find((r) => r.itemId === it.itemId);
					                                const specInline = (prRow?.specification || '')
				                                  .split(/\r?\n/)
				                                  .map((s) => s.trim())
				                                  .filter(Boolean)
				                                  .join(' - ');
					                                const label = [prRow?.item || it.item, specInline || null].filter(Boolean).join(' - ');
					                                const poRateCell = poRateByPoIdItemId[`${activeInvoiceDetails.invoice.poId}||${it.itemId}`];
					                                const totalExtraCharges =
					                                  (typeof activeInvoiceDetails.invoice.courierCharge === 'number' && Number.isFinite(activeInvoiceDetails.invoice.courierCharge)
					                                    ? activeInvoiceDetails.invoice.courierCharge
					                                    : 0) +
					                                  (typeof activeInvoiceDetails.invoice.packingCharge === 'number' && Number.isFinite(activeInvoiceDetails.invoice.packingCharge)
					                                    ? activeInvoiceDetails.invoice.packingCharge
					                                    : 0) +
					                                  (typeof activeInvoiceDetails.invoice.labourCharge === 'number' && Number.isFinite(activeInvoiceDetails.invoice.labourCharge)
					                                    ? activeInvoiceDetails.invoice.labourCharge
					                                    : 0) +
					                                  (typeof activeInvoiceDetails.invoice.otherCharge === 'number' && Number.isFinite(activeInvoiceDetails.invoice.otherCharge)
					                                    ? activeInvoiceDetails.invoice.otherCharge
					                                    : 0);
					                                const itemCount = activeInvoiceDetails.items?.length ?? 0;
					                                const extraChargePerItemLine = itemCount > 0 ? totalExtraCharges / itemCount : 0;
					                                const effectiveItemPriceCell =
					                                  typeof it.rate === 'number' &&
					                                  Number.isFinite(it.rate) &&
					                                  typeof it.quantity === 'number' &&
					                                  Number.isFinite(it.quantity) &&
					                                  it.quantity > 0
					                                    ? (it.rate + extraChargePerItemLine / it.quantity).toFixed(2)
					                                    : '-';
					                                return (
					                                  <tr key={`${activeInvoiceDetails.invoice.id}-${it.itemId}-${idx}`}>
					                                    <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
			                                  <div className="whitespace-normal break-words">{renderInlineWithBoldSpecNames(label)}</div>
			                                </td>
					                                    <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{it.quantity}</td>
					                                    <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{poRateCell ?? '-'}</td>
					                                    <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{it.rate}</td>
					                                    <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{effectiveItemPriceCell}</td>
					                                    <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">
					                                      {Number(grnQtyByPoAndItemId[`${activeInvoiceDetails.invoice.poId}||${it.itemId}`] ?? 0)}
					                                    </td>
					                                  </tr>
					                                );
					                              })
					                            ) : (
					                              <tr>
					                                <td colSpan={6} className="px-4 py-6 text-sm text-on-surface-variant text-center border border-outline-variant">
					                                  No invoice items recorded.
					                                </td>
					                              </tr>
					                            )}
			                          </tbody>
			                        </table>
		                      </div>
		                    </div>

		                    <div className="flex justify-end gap-2">
		                      {invoiceDetailsMode === 'edit' ? (
		                        <button
		                          type="button"
		                          disabled={busy}
		                          className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
		                          onClick={() => {
		                            setInvoiceDetailsError(null);
		                            const invoiceNo = editInvoiceNo.trim();
		                            const invoiceDate = editInvoiceDate.trim();
		                            if (!invoiceNo || !invoiceDate) {
		                              setInvoiceDetailsError('Invoice no and date are required.');
		                              return;
		                            }
			                            const amount = editInvoiceAmount.trim();
			                            const invoiceAmountNumber = amount ? Number(amount) : undefined;
			                            if (amount && (!Number.isFinite(invoiceAmountNumber) || invoiceAmountNumber < 0)) {
			                              setInvoiceDetailsError('Enter a valid invoice amount.');
			                              return;
			                            }
			                            const courierChargeNumber = editInvoiceCourierCharge.trim() ? Number(editInvoiceCourierCharge) : undefined;
			                            const packingChargeNumber = editInvoicePackingCharge.trim() ? Number(editInvoicePackingCharge) : undefined;
			                            const labourChargeNumber = editInvoiceLabourCharge.trim() ? Number(editInvoiceLabourCharge) : undefined;
			                            const otherChargeNumber = editInvoiceOtherCharge.trim() ? Number(editInvoiceOtherCharge) : undefined;
			                            if (editInvoiceCourierCharge.trim() && (!Number.isFinite(courierChargeNumber) || (courierChargeNumber ?? 0) < 0)) {
			                              setInvoiceDetailsError('Enter a valid courier charge.');
			                              return;
			                            }
			                            if (editInvoicePackingCharge.trim() && (!Number.isFinite(packingChargeNumber) || (packingChargeNumber ?? 0) < 0)) {
			                              setInvoiceDetailsError('Enter a valid packing charge.');
			                              return;
			                            }
			                            if (editInvoiceLabourCharge.trim() && (!Number.isFinite(labourChargeNumber) || (labourChargeNumber ?? 0) < 0)) {
			                              setInvoiceDetailsError('Enter a valid labour charge.');
			                              return;
			                            }
			                            if (editInvoiceOtherCharge.trim() && (!Number.isFinite(otherChargeNumber) || (otherChargeNumber ?? 0) < 0)) {
			                              setInvoiceDetailsError('Enter a valid other charge.');
			                              return;
			                            }
			                            const normalized = editInvoiceLines
			                              .map((l) => ({
			                                itemId: l.itemId,
			                                quantity: Number(l.quantity ?? 0),
		                                rate: Number(l.rate ?? 0),
		                              }))
		                              .filter((l) => l.itemId && Number.isFinite(l.quantity) && l.quantity > 0 && Number.isFinite(l.rate) && l.rate >= 0);
		                            if (!normalized.length) {
		                              setInvoiceDetailsError('Enter invoice qty and rate for at least one item.');
		                              return;
		                            }

			                            run(() =>
			                              updateInvoice(activeInvoiceDetails.invoice.id, {
			                                supplierInvoiceNo: invoiceNo,
			                                invoiceDate,
			                                invoiceAmount: invoiceAmountNumber,
			                                courierCharge: courierChargeNumber,
			                                packingCharge: packingChargeNumber,
			                                labourCharge: labourChargeNumber,
			                                otherCharge: otherChargeNumber,
			                                items: normalized.map((l) => ({ itemId: l.itemId, quantity: l.quantity, rate: l.rate })),
			                              }).then(() => undefined)
			                            ).then(() => closeInvoiceDetails());
		                          }}
		                        >
			                          {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
			                          Save
			                        </button>
		                      ) : null}
		                    </div>
		                  </div>
		                </div>
		              </div>
		            ) : null}

	          </Section>

			          <Section>
				            <div className="text-center text-2xl font-bold text-blue-600">GRN</div>
				            {selectedPo ? (
				              <div className="space-y-2">
				                {grnCreateOpen ? (
				                  <>
				                    <div className="flex justify-end">
				                      <button
				                        type="button"
				                        className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
				                        onClick={() => setGrnCreateOpen(false)}
				                      >
				                        Back to Pending PO
				                      </button>
				                    </div>

				                    {showGrnCreateFields ? (
				                      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
				                        <Field label="PO">
				                          <SearchableSelect
				                            options={pendingGrnPoOptions}
				                            value={selectedPoId}
				                            onChange={setSelectedPoId}
				                            placeholder="Select PO"
				                          />
				                        </Field>
				                        <Field label="Received Date">
				                          <input className={inputClass} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} type="date" />
				                        </Field>
				                        <Field label="Updated By">
				                          <SearchableSelect
				                            options={users.map((u) => ({ value: u.id, label: u.name }))}
				                            value={grnUpdatedBy}
				                            onChange={setGrnUpdatedBy}
				                            placeholder="Select user"
				                          />
				                        </Field>
				                        <Field label="Material Received By">
				                          <SearchableSelect
				                            options={users.map((u) => ({ value: u.id, label: u.name }))}
				                            value={grnMaterialReceivedBy}
				                            onChange={setGrnMaterialReceivedBy}
				                            placeholder="Select user"
				                          />
				                        </Field>
				                        <Field label="Goods Collected By">
				                          <SearchableSelect
				                            options={users.map((u) => ({ value: u.id, label: u.name }))}
				                            value={grnGoodsCollectedBy}
				                            onChange={setGrnGoodsCollectedBy}
				                            placeholder="Select user"
				                          />
				                        </Field>
				                      </div>
				                    ) : null}

				                    {showGrnCreateFields ? (
				                      loadingPendingGrnItems ? (
				                        <div className="px-4 py-6 text-sm text-on-surface-variant text-center">Loading pending GRN items...</div>
				                      ) : pendingGrnItems.length ? (
				                        <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
				                          <div className="overflow-x-auto">
				                            <table className="w-full min-w-[880px] table-fixed text-left border-collapse border border-outline-variant">
				                              <colgroup>
				                                <col className="w-[520px]" />
				                                <col className="w-[120px]" />
				                                <col className="w-[120px]" />
				                                <col className="w-[120px]" />
				                              </colgroup>
				                              <thead>
				                                <tr className="bg-blue-700">
				                                  <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Item</th>
				                                  <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO Qty</th>
				                                  <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Pending GRN Qty</th>
				                                  <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GRN Qty</th>
				                                </tr>
				                              </thead>
				                              <tbody>
				                                {pendingGrnItems.map((it) => {
				                                  const poLine = selectedPo.items?.find((x) => x.itemId === it.itemId);
				                                  const poQtyCell = poLine ? poLine.quantity : '-';
				                                  const prRow = prItems.find((r) => r.itemId === it.itemId);
				                                  const specInline = (prRow?.specification || '')
				                                    .split(/\r?\n/)
				                                    .map((s) => s.trim())
				                                    .filter(Boolean)
				                                    .join(' - ');
				                                  const label = [prRow?.item || it.item, specInline || null].filter(Boolean).join(' - ');
				                                  return (
				                                    <tr key={it.itemId}>
				                                      <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
				                                        <div className="whitespace-normal break-words">{renderInlineWithBoldSpecNames(label)}</div>
				                                      </td>
				                                      <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{poQtyCell}</td>
				                                      <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{it.pendingQty}</td>
				                                      <td className="px-4 py-3 border border-outline-variant">
				                                        <input
				                                          className={tableInputClass}
				                                          value={grnQty[it.itemId] ?? String(it.pendingQty)}
				                                          onChange={(e) => setGrnQty((prev) => ({ ...prev, [it.itemId]: e.target.value }))}
				                                          type="number"
				                                          min={0}
				                                          max={it.pendingQty}
				                                          inputMode="numeric"
				                                          step="1"
				                                        />
				                                      </td>
				                                    </tr>
				                                  );
				                                })}
				                              </tbody>
				                            </table>
				                          </div>
				                        </div>
				                      ) : null
				                    ) : null}

				                    {showGrnCreateFields ? (
				                      <>
				                        {grnFormError ? (
				                          <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">
				                            {grnFormError}
				                          </div>
				                        ) : null}
				                        {pendingGrnItems.length ? (
				                          <div className="flex justify-end">
				                            <button
				                              type="button"
				                              disabled={busy || loadingPendingGrnItems || pendingGrnItems.length === 0}
				                              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
				                              onClick={() => {
				                                setGrnFormError(null);
				                                const poId = (selectedPoId || selectedPo.po.id || '').trim();
				                                if (!poId) {
				                                  setGrnFormError('PO is required.');
				                                  return;
				                                }
				                                if (!grnUpdatedBy.trim()) {
				                                  setGrnFormError('Updated By is required.');
				                                  return;
				                                }
				                                const items = pendingGrnItems.map((it) => ({
				                                  itemId: it.itemId,
				                                  item: it.item,
				                                  pendingQty: it.pendingQty,
				                                  quantityReceived: Number(grnQty[it.itemId] ?? it.pendingQty),
				                                }));
				                                if (items.every((x) => !x.quantityReceived)) {
				                                  setGrnFormError('Enter at least one received qty.');
				                                  return;
				                                }
				                                if (
				                                  items.some(
				                                    (x) =>
				                                      !Number.isFinite(x.quantityReceived) ||
				                                      x.quantityReceived < 0 ||
				                                      x.quantityReceived > x.pendingQty
				                                  )
				                                ) {
				                                  setGrnFormError('Enter valid received qty (must be <= pending GRN qty).');
				                                  return;
				                                }
				                                const createItems = items
				                                  .filter((x) => x.quantityReceived > 0)
				                                  .map(({ pendingQty: _pendingQty, ...rest }) => rest);
				                                run(() =>
				                                  createGrnForPo(poId, {
				                                    receivedDate,
				                                    updatedBy: grnUpdatedBy,
				                                    materialReceivedBy: grnMaterialReceivedBy || null,
				                                    goodsCollectedBy: grnGoodsCollectedBy || null,
				                                    items: createItems,
				                                  })
				                                    .then(() => undefined)
				                                    .catch((e) => {
				                                      setGrnFormError(e instanceof Error ? e.message : String(e));
				                                      throw e;
				                                    })
				                                );
				                              }}
				                            >
				                              Create GRN
				                            </button>
				                          </div>
				                        ) : null}
				                      </>
				                    ) : null}
				                  </>
				                ) : pendingGrnPoRows.length ? (
				                  <div className="space-y-2">
				                    <div className="text-center text-lg font-semibold text-blue-600">
				                      Pending PO for GRN ({pendingGrnPoRows.length})
				                    </div>
				                    <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
				                      <div className="overflow-x-auto">
				                        <table className="w-full min-w-[2100px] table-fixed text-left border-collapse border border-outline-variant">
				                          <colgroup>
				                            <col className="w-[140px]" />
				                            <col className="w-[220px]" />
				                            <col className="w-[180px]" />
				                            <col className="w-[520px]" />
				                            <col className="w-[110px]" />
				                            <col className="w-[110px]" />
				                            <col className="w-[90px]" />
				                            <col className="w-[90px]" />
				                            <col className="w-[130px]" />
				                            <col className="w-[170px]" />
				                            <col className="w-[170px]" />
				                            <col className="w-[170px]" />
				                          </colgroup>
				                          <thead>
				                            <tr className="bg-blue-700">
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO No</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Supplier</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Terms</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Items</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO Qty</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO Rate</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Disc %</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GST %</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Pending GRN Qty</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Checked By</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Sent By</th>
				                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Action</th>
				                            </tr>
				                          </thead>
				                          <tbody>
				                            {pendingGrnPoRows.flatMap((r) => {
				                              const lines = Array.isArray(r.lines) && r.lines.length ? r.lines : [null];
				                              const rowSpan = lines.length;
				                              return lines.map((it, idx) => {
				                                const prRow = it ? prItems.find((x) => x.itemId === it.itemId) : null;
				                                const specInline = (prRow?.specification || '')
				                                  .split(/\r?\n/)
				                                  .map((s) => s.trim())
				                                  .filter(Boolean)
				                                  .join(' - ');
				                                const label = it ? [prRow?.item || '', specInline || null].filter(Boolean).join(' - ') : '-';
				                                const poQtyCell = it && Number.isFinite(it.poQty) ? it.poQty : '-';
				                                const poRateCell = it && Number.isFinite(it.poRate) ? it.poRate : '-';
				                                const discCell = it && Number.isFinite(it.discountPercent) ? it.discountPercent : '-';
				                                const gstCell = it && Number.isFinite(it.taxPercent) ? it.taxPercent : '-';
				                                const pendingCell = it && Number.isFinite(it.pendingGrnQty) ? it.pendingGrnQty : '-';

				                                return (
				                                  <tr key={`${r.poId}||${it ? it.itemId : 'empty'}||${idx}`}>
				                                    {idx === 0 ? (
				                                      <>
					                                        <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
					                                      {formatPoNumber(r.poNumber ?? '') || '-'}
				                                    </td>
				                                        <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
				                                          {r.supplier || '-'}
				                                        </td>
				                                        <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
				                                          {r.paymentTerms || '-'}
				                                        </td>
				                                      </>
				                                    ) : null}

				                                    <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant whitespace-normal break-words">
				                                      {renderInlineWithBoldSpecNames(label || '-')}
				                                    </td>
				                                    <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{poQtyCell}</td>
				                                    <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{poRateCell}</td>
				                                    <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{discCell}</td>
				                                    <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{gstCell}</td>
				                                    <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">{pendingCell}</td>

				                                    {idx === 0 ? (
				                                      <>
				                                        <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
				                                          {r.checkedBy || '-'}
				                                        </td>
				                                        <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
				                                          {r.sentBy || '-'}
				                                        </td>
				                                        <td rowSpan={rowSpan} className="px-4 py-3 border border-outline-variant align-top">
				                                          <button
				                                            type="button"
				                                            className="px-3 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
				                                            onClick={() => {
				                                              setSelectedPoId(r.poId);
				                                              setGrnFormError(null);
				                                              setReceivedDate(new Date().toISOString().slice(0, 10));
				                                              setGrnCreateOpen(true);
				                                            }}
				                                          >
				                                            Create GRN
				                                          </button>
				                                        </td>
				                                      </>
				                                    ) : null}
				                                  </tr>
				                                );
				                              });
				                            })}
				                          </tbody>
				                        </table>
				                      </div>
				                    </div>
				                  </div>
				                ) : (
				                  <div className="text-sm text-on-surface-variant text-center">No pending PO for GRN.</div>
				                )}

				                {loadingRecordedGrns ? (
				                  <div className="pt-2 text-sm text-on-surface-variant">Loading GRNs...</div>
				                ) : recordedGrns.length ? (
		                  <div className="pt-2 space-y-2">
			                    <div className="text-center text-lg font-semibold text-blue-600">Recorded GRNs ({recordedGrns.length})</div>
			                    <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
			                      <div className="overflow-x-auto">
			                        <table className="w-full min-w-[1440px] table-fixed text-left border-collapse border border-outline-variant">
			                          <colgroup>
			                            <col className="w-[170px]" />
			                            <col className="w-[170px]" />
			                            <col className="w-[140px]" />
			                            <col className="w-[520px]" />
			                            <col className="w-[110px]" />
			                            <col className="w-[170px]" />
			                            <col className="w-[160px]" />
			                          </colgroup>
			                          <thead>
			                            <tr className="bg-blue-700">
			                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GRN</th>
			                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO Number</th>
			                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Received Date</th>
			                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Item</th>
			                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Qty</th>
			                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Updated By</th>
			                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Action</th>
			                            </tr>
			                          </thead>
			                          <tbody>
                    {recordedGrns.flatMap((g) => {
                      const lines = Array.isArray(g.items) && g.items.length ? g.items : [null];
                      const rowSpan = lines.length;
			                              const updatedByCell = g.grn.updatedBy
			                                ? users.find((u) => u.id === g.grn.updatedBy)?.name ?? String(g.grn.updatedBy)
			                                : '-';

			                              return lines.map((it, idx) => {
			                                const prRow = it ? prItems.find((r) => r.itemId === it.itemId) : null;
			                                const specInline = (prRow?.specification || '')
			                                  .split(/\r?\n/)
			                                  .map((s) => s.trim())
			                                  .filter(Boolean)
			                                  .join(' - ');
			                                const label = it ? [prRow?.item || it.item, specInline || null].filter(Boolean).join(' - ') : '-';
			                                const qtyCell = it ? Number(it.quantityReceived ?? 0) : '-';

			                                return (
                              <tr key={`${g.grn.id}||${it ? it.itemId : 'empty'}||${idx}`}>
                                {idx === 0 ? (
                                  <>
                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
                                          {displayGrnNumber(g.grn)}
                                    </td>
                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">
                                          {displayPoNumberById(g.grn.poId)}
                                    </td>
			                                        <td
			                                          rowSpan={rowSpan}
			                                          className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top"
			                                        >
				                                          {formatDateDDMMYYYYOnly(g.grn.receivedDate)}
			                                        </td>
			                                      </>
			                                    ) : null}
			                                    <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
				                                  <div className="whitespace-normal break-words">{renderInlineWithBoldSpecNames(label)}</div>
				                                </td>
			                                    <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{qtyCell}</td>
			                                    {idx === 0 ? (
			                                      <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
			                                        {updatedByCell}
			                                      </td>
			                                    ) : null}
			                                    {idx === 0 ? (
			                                      <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
			                                        <div className="flex items-center gap-2">
			                                          <button
			                                            type="button"
			                                            title="View"
			                                            aria-label="View"
			                                            className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-on-primary shadow-sm hover:bg-primary-dim transition-colors"
			                                            onClick={() => openGrnDetails(g, 'view')}
			                                          >
			                                            <Eye size={16} />
			                                          </button>
			                                          <button
			                                            type="button"
			                                            title="Edit"
			                                            aria-label="Edit"
			                                            className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-on-primary shadow-sm hover:bg-primary-dim transition-colors"
			                                            onClick={() => openGrnDetails(g, 'edit')}
			                                          >
			                                            <Pencil size={16} />
			                                          </button>
				                                          <button
				                                            type="button"
				                                            title="Delete"
				                                            aria-label="Delete"
				                                            className="btn-icon-danger"
				                                            onClick={() => {
                                              if (!confirm(`Delete GRN ${displayGrnNumber(g.grn)}?`)) return;
				                                              run(() => deleteGrn(g.grn.id).then(() => undefined));
				                                            }}
			                                          >
			                                            <Trash2 size={16} />
			                                          </button>
			                                        </div>
			                                      </td>
			                                    ) : null}
			                                  </tr>
			                                );
			                              });
			                            })}
			                          </tbody>
			                        </table>
			                      </div>
			                    </div>
			                  </div>
		                ) : null}
	              </div>
		            ) : (
		              <div className="text-sm text-on-surface-variant">Create PO first.</div>
		            )}
			          </Section>

				          {grnDetailsOpen && activeGrnDetails ? (
				            <div className="fixed inset-0 z-50">
				              <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={closeGrnDetails} />
				              <div className="relative w-full h-full bg-surface-container-lowest border border-outline-variant shadow-xl flex flex-col">
				                <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant bg-surface-container-lowest">
					                  <div className="text-sm font-bold text-on-surface">
					                    GRN Number: {activeGrnDetails.grn.id}
					                  </div>
				                  <button type="button" className="btn btn-sm" onClick={closeGrnDetails}>
				                    Close
				                  </button>
				                </div>

				                <div className="flex-1 overflow-auto p-5 space-y-4">
				                  {grnDetailsError ? <div className="text-sm text-error font-semibold">{grnDetailsError}</div> : null}
				                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
				                    <Field label="PO Number">
				                      <div className="px-3 py-2 text-sm text-on-surface bg-surface-container-lowest border border-outline-variant rounded-lg">
			                                          {displayPoNumberById(activeGrnDetails.grn.poId)}
			                      </div>
			                    </Field>
			                    <Field label="Received Date">
			                      {grnDetailsMode === 'edit' ? (
			                        <input
			                          className={inputClass}
			                          value={editGrnReceivedDate}
			                          onChange={(e) => setEditGrnReceivedDate(e.target.value)}
			                          type="date"
			                        />
			                      ) : (
			                        <div className="px-3 py-2 text-sm text-on-surface bg-surface-container-lowest border border-outline-variant rounded-lg">
				                          {formatDateDDMMYYYYOnly(activeGrnDetails.grn.receivedDate)}
			                        </div>
			                      )}
			                    </Field>
				                    <Field label="Updated By">
				                      {grnDetailsMode === 'edit' ? (
				                        <SearchableSelect
				                          options={users.map((u) => ({ value: u.id, label: u.name }))}
				                          value={editGrnUpdatedBy}
				                          onChange={setEditGrnUpdatedBy}
				                          placeholder="Select user"
				                        />
				                      ) : (
				                        <div className="px-3 py-2 text-sm text-on-surface bg-surface-container-lowest border border-outline-variant rounded-lg">
				                          {activeGrnDetails.grn.updatedBy
				                            ? users.find((u) => u.id === activeGrnDetails.grn.updatedBy)?.name ?? activeGrnDetails.grn.updatedBy
				                            : '-'}
				                        </div>
				                      )}
				                    </Field>
				                    <Field label="Material Received By">
				                      {grnDetailsMode === 'edit' ? (
				                        <SearchableSelect
				                          options={users.map((u) => ({ value: u.id, label: u.name }))}
				                          value={editGrnMaterialReceivedBy}
				                          onChange={setEditGrnMaterialReceivedBy}
				                          placeholder="Select user"
				                        />
				                      ) : (
				                        <div className="px-3 py-2 text-sm text-on-surface bg-surface-container-lowest border border-outline-variant rounded-lg">
				                          {activeGrnDetails.grn.materialReceivedBy
				                            ? users.find((u) => u.id === activeGrnDetails.grn.materialReceivedBy)?.name ??
				                              activeGrnDetails.grn.materialReceivedBy
				                            : '-'}
				                        </div>
				                      )}
				                    </Field>
				                    <Field label="Goods Collected By">
				                      {grnDetailsMode === 'edit' ? (
				                        <SearchableSelect
				                          options={users.map((u) => ({ value: u.id, label: u.name }))}
				                          value={editGrnGoodsCollectedBy}
				                          onChange={setEditGrnGoodsCollectedBy}
				                          placeholder="Select user"
				                        />
				                      ) : (
				                        <div className="px-3 py-2 text-sm text-on-surface bg-surface-container-lowest border border-outline-variant rounded-lg">
				                          {activeGrnDetails.grn.goodsCollectedBy
				                            ? users.find((u) => u.id === activeGrnDetails.grn.goodsCollectedBy)?.name ??
				                              activeGrnDetails.grn.goodsCollectedBy
				                            : '-'}
				                        </div>
				                      )}
				                    </Field>
				                  </div>

			                  <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
			                    <div className="overflow-x-auto">
			                      <table className="w-full min-w-[720px] table-fixed text-left border-collapse border border-outline-variant">
			                        <colgroup>
			                          <col className="w-[520px]" />
			                          <col className="w-[160px]" />
			                        </colgroup>
			                        <thead>
			                          <tr className="bg-blue-700">
			                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Item</th>
			                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GRN Qty</th>
			                          </tr>
			                        </thead>
			                        <tbody>
			                          {(activeGrnDetails.items ?? []).map((it) => {
			                            const prRow = prItems.find((r) => r.itemId === it.itemId);
			                            const specInline = (prRow?.specification || '')
			                              .split(/\r?\n/)
			                              .map((s) => s.trim())
			                              .filter(Boolean)
			                              .join(' - ');
			                            const label = [prRow?.item || it.item, specInline || null].filter(Boolean).join(' - ');
			                            return (
			                              <tr key={`${activeGrnDetails.grn.id}::${it.itemId}`}>
			                                <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
			                                  <div className="whitespace-normal break-words">{renderInlineWithBoldSpecNames(label)}</div>
			                                </td>
			                                <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">
			                                  {Number(it.quantityReceived ?? 0)}
			                                </td>
			                              </tr>
			                            );
			                          })}
			                        </tbody>
			                      </table>
			                    </div>
			                  </div>

			                  {grnDetailsMode === 'edit' ? (
			                    <div className="flex justify-end gap-2">
			                      <button
			                        type="button"
			                        disabled={busy}
			                        className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
			                        onClick={() => {
			                          setGrnDetailsError(null);
			                          const receivedDate = editGrnReceivedDate.trim();
			                          const updatedBy = editGrnUpdatedBy.trim();
			                          if (!receivedDate) {
			                            setGrnDetailsError('Received date is required.');
			                            return;
			                          }
			                          if (!updatedBy) {
			                            setGrnDetailsError('Updated By is required.');
			                            return;
			                          }
				                          run(() =>
				                            updateGrn(activeGrnDetails.grn.id, {
				                              receivedDate,
				                              updatedBy,
				                              materialReceivedBy: editGrnMaterialReceivedBy || null,
				                              goodsCollectedBy: editGrnGoodsCollectedBy || null,
				                            }).then(() => undefined)
				                          ).then(() => closeGrnDetails());
				                        }}
			                      >
			                        {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
			                        Save
			                      </button>
			                    </div>
			                  ) : null}
			                </div>
			              </div>
			            </div>
			          ) : null}

				          {recordedGrns.length ? (
				          <Section>
				            <div className="text-center text-2xl font-bold text-blue-600">QC + Stock Posting</div>
			            <div className="space-y-3">
		              {pendingQcGrns.length ? (
		                <div className="space-y-2">
		                  <div className="text-sm font-semibold text-on-surface">QC Pending</div>
		                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
		                    <Field label="GRN Number">
		                      <SearchableSelect
		                        options={pendingQcGrnOptions}
		                        value={selectedQcGrnId}
		                        onChange={setSelectedQcGrnId}
		                        placeholder="Select GRN"
		                      />
			                    </Field>
			                    <Field label="Inspected By">
			                      <SearchableSelect
			                        options={users.map((u) => ({ value: u.id, label: u.name }))}
			                        value={qcInspectedBy}
			                        onChange={setQcInspectedBy}
			                        placeholder="Select user"
			                      />
			                    </Field>
		                    <Field label="Location">
		                      <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} />
		                    </Field>
		                    <Field label="Updated By">
		                      <SearchableSelect
		                        options={users.map((u) => ({ value: u.id, label: u.name }))}
		                        value={qcUpdatedBy}
		                        onChange={setQcUpdatedBy}
		                        placeholder="Select user"
		                      />
		                    </Field>
		                  </div>

		                  {activePendingQcGrn ? (
		                    <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
		                      <div className="overflow-x-auto">
		                        <table className="w-full min-w-[980px] table-fixed text-left border-collapse border border-outline-variant">
		                          <colgroup>
		                            <col className="w-[520px]" />
		                            <col className="w-[120px]" />
		                            <col className="w-[140px]" />
		                            <col className="w-[140px]" />
		                            <col className="w-[260px]" />
		                          </colgroup>
		                          <thead>
		                            <tr className="bg-blue-700">
		                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Item</th>
		                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GRN Qty</th>
		                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Accepted</th>
		                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Rejected</th>
		                              <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Remarks</th>
		                            </tr>
		                          </thead>
		                          <tbody>
		                            {activePendingQcGrn.items.map((it) => {
		                              const prRow = prItems.find((r) => r.itemId === it.itemId);
		                              const specInline = (prRow?.specification || '')
		                                .split(/\r?\n/)
		                                .map((s) => s.trim())
		                                .filter(Boolean)
		                                .join(' - ');
		                              const label = [prRow?.item || it.item, specInline || null].filter(Boolean).join(' - ');
		                              return (
		                                <tr key={it.itemId}>
		                                  <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
			                                    <div className="whitespace-normal break-words">{renderInlineWithBoldSpecNames(label)}</div>
			                                  </td>
		                                  <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(it.quantityReceived ?? 0)}</td>
		                                  <td className="px-4 py-3 border border-outline-variant">
		                                    <input
		                                      className={tableInputClass}
		                                      value={qcAccepted[it.itemId] ?? String(it.quantityReceived)}
		                                      onChange={(e) => setQcAccepted((prev) => ({ ...prev, [it.itemId]: e.target.value }))}
		                                      inputMode="numeric"
		                                    />
		                                  </td>
		                                  <td className="px-4 py-3 border border-outline-variant">
		                                    <input
		                                      className={tableInputClass}
		                                      value={qcRejected[it.itemId] ?? '0'}
		                                      onChange={(e) => setQcRejected((prev) => ({ ...prev, [it.itemId]: e.target.value }))}
		                                      inputMode="numeric"
		                                    />
		                                  </td>
		                                  <td className="px-4 py-3 border border-outline-variant">
		                                    <input
		                                      className={tableInputClass}
		                                      value={qcRemarks[it.itemId] ?? ''}
		                                      onChange={(e) => setQcRemarks((prev) => ({ ...prev, [it.itemId]: e.target.value }))}
		                                    />
		                                  </td>
		                                </tr>
		                              );
		                            })}
		                          </tbody>
		                        </table>
		                      </div>
		                    </div>
		                  ) : null}

		                  <div className="flex justify-end">
		                    <button
		                      type="button"
		                      disabled={busy || !activePendingQcGrn}
		                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
		                      onClick={() => {
		                        const g = activePendingQcGrn;
		                        if (!g) return;
			                        if (!qcInspectedBy.trim()) {
			                          setError('Inspected By is required.');
			                          return;
			                        }
			                        if (!qcUpdatedBy.trim()) {
			                          setError('Updated By is required.');
			                          return;
			                        }
		                        const items = g.items.map((it) => ({
		                          itemId: it.itemId,
		                          item: it.item,
		                          quantityAccepted: Number(qcAccepted[it.itemId] ?? it.quantityReceived),
		                          quantityRejected: Number(qcRejected[it.itemId] ?? 0),
		                          remarks: qcRemarks[it.itemId] ?? '',
		                        }));
		                        if (items.some((x) => !Number.isFinite(x.quantityAccepted) || !Number.isFinite(x.quantityRejected) || x.quantityAccepted < 0 || x.quantityRejected < 0)) {
		                          setError('Enter valid QC quantities.');
		                          return;
		                        }
				                        run(() =>
				                          recordQc(g.grn.id, { inspectedBy: qcInspectedBy, location, updatedBy: qcUpdatedBy, items })
				                            .then(async () => {
				                              if (!requestId) return;
				                              const rows = await fetchQcRecordsByPrId(requestId);
				                              setQcRecords(rows);
				                              setQcReloadKey((k) => k + 1);
				                            })
				                            .then(() => undefined)
				                        );
				                      }}
				                    >
			                      Update QC
			                    </button>
			                  </div>
			                </div>
			              ) : null}

		              <div className="space-y-2">
		                <div className="text-center text-lg font-semibold text-blue-600">QC Recorded</div>
		                {loadingQcRecords ? (
		                  <div className="text-sm text-on-surface-variant">Loading QC...</div>
		                ) : qcRecords.length ? (
		                  <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
		                    <div className="overflow-x-auto">
				                      <table className="w-full min-w-[1560px] table-fixed text-left border-collapse border border-outline-variant">
				                        <colgroup>
				                          <col className="w-[160px]" />
				                          <col className="w-[160px]" />
				                          <col className="w-[140px]" />
				                          <col className="w-[420px]" />
				                          <col className="w-[110px]" />
				                          <col className="w-[110px]" />
				                          <col className="w-[120px]" />
				                          <col className="w-[110px]" />
				                          <col className="w-[260px]" />
				                          <col className="w-[170px]" />
				                          <col className="w-[160px]" />
				                        </colgroup>
			                        <thead>
			                          <tr className="bg-blue-700">
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GRN</th>
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO Number</th>
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">QC Date</th>
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Item</th>
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GRN Qty</th>
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Approved Qty</th>
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Invoice Link Qty</th>
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Rejected</th>
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Remarks</th>
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Updated By</th>
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Action</th>
				                          </tr>
			                        </thead>
			                        <tbody>
			                          {Array.from(qcByGrnId.entries()).map(([grnId, rows]) => {
			                            const rowSpan = rows.length || 1;
			                            const head = rows[0];
			                            const poId = String(head?.poId ?? '');
			                            const qcDate = String(head?.qcDate ?? '');
			                            const updatedByCellRaw = String(head?.updatedBy ?? head?.qcBy ?? '');
			                            const updatedByCell = users.find((u) => u.id === updatedByCellRaw)?.name ?? updatedByCellRaw;
			                            return rows.map((r, idx) => {
			                              const prRow = prItems.find((it) => it.itemId === r.itemId);
		                              const specInline = (prRow?.specification || '')
		                                .split(/\r?\n/)
		                                .map((s) => s.trim())
		                                .filter(Boolean)
		                                .join(' - ');
		                              const label = [prRow?.item || r.item, specInline || null].filter(Boolean).join(' - ');
		                              return (
		                                <tr key={r.id}>
		                                  {idx === 0 ? (
		                                    <>
				                                      <td rowSpan={rowSpan} className="px-4 py-3 text-sm font-semibold text-on-surface border border-outline-variant align-top">{displayGrnNumberById(grnId)}</td>
			                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">{displayPoNumberById(poId)}</td>
		                                      <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
			                                        {qcDate ? formatDateDDMMYYYYOnly(qcDate) : '-'}
		                                      </td>
		                                    </>
		                                  ) : null}
		                                  <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
				                                    <div className="whitespace-normal break-words">{renderInlineWithBoldSpecNames(label)}</div>
				                                  </td>
		                                  <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">
					                                    {Number(grnQtyByGrnIdItemId[`${grnId}||${r.itemId}`] ?? 0)}
		                                  </td>
		                                  <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.acceptedQty ?? 0)}</td>
		                                  <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">
		                                    {Number(invoiceLinkQtyByGrnIdItemId[`${grnId}||${r.itemId}`] ?? 0)}
		                                  </td>
		                                  <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.rejectedQty ?? 0)}</td>
		                                  <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
		                                    <div className="truncate">{r.remarks || '-'}</div>
		                                  </td>
			                                  {idx === 0 ? (
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">{updatedByCell || '-'}</td>
			                                  ) : null}
			                                  {idx === 0 ? (
			                                    <td rowSpan={rowSpan} className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
			                                      <div className="flex items-center gap-2">
			                                        <button
			                                          type="button"
			                                          title="View"
			                                          aria-label="View"
			                                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-on-primary shadow-sm hover:bg-primary-dim transition-colors"
			                                          onClick={() => openQcDetails(grnId, 'view')}
			                                        >
			                                          <Eye size={16} />
			                                        </button>
			                                        <button
			                                          type="button"
			                                          title="Edit"
			                                          aria-label="Edit"
			                                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-on-primary shadow-sm hover:bg-primary-dim transition-colors"
			                                          onClick={() => openQcDetails(grnId, 'edit')}
			                                        >
			                                          <Pencil size={16} />
			                                        </button>
				                                        <button
				                                          type="button"
				                                          title="Delete"
				                                          aria-label="Delete"
					                                          className="btn-icon-danger"
					                                          onClick={() => {
			                            if (!confirm(`Delete QC for GRN ${displayGrnNumberById(grnId)}?`)) return;
						                                            run(() =>
						                                              deleteQcForGrn(grnId, { by: qcUpdatedBy || 'system' })
					                                                .then(async () => {
				                                                  if (!requestId) return;
				                                                  const rows = await fetchQcRecordsByPrId(requestId);
				                                                  setQcRecords(rows);
				                                                  setQcReloadKey((k) => k + 1);
				                                                })
				                                                .then(() => undefined)
				                                            );
				                                          }}
				                                        >
			                                          <Trash2 size={16} />
			                                        </button>
			                                      </div>
			                                    </td>
			                                  ) : null}
			                                </tr>
			                              );
			                            });
			                          })}
		                        </tbody>
		                      </table>
		                    </div>
		                  </div>
		                ) : (
		                  <div className="text-sm text-on-surface-variant">No QC recorded.</div>
		                )}
		              </div>

			              <div className="space-y-2">
				                <div className="text-center text-lg font-semibold text-blue-600">GRN ↔ Invoice Link</div>


				                {linkLocalError ? (
				                  <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">
				                    {linkLocalError}
				                  </div>
				                ) : null}
				                {pendingGrnInvoiceLinkRows.length ? (
			                  <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
			                    <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-outline-variant">
			                      <div className="text-sm font-semibold text-on-surface">Pending Links</div>
			                      <button
			                        type="button"
			                        disabled={busy}
			                        className="px-3 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
			                        onClick={saveAllGrnInvoiceLinks}
			                      >
			                        {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
			                        Save All
			                      </button>
			                    </div>
				                    <div className="overflow-x-auto">
					                      <table className="w-full min-w-[1650px] table-fixed text-left border-collapse border border-outline-variant">
				                        <colgroup>
				                          <col className="w-[170px]" />
				                          <col className="w-[140px]" />
				                          <col className="w-[170px]" />
				                          <col className="w-[520px]" />
				                          <col className="w-[110px]" />
					                          <col className="w-[220px]" />
					                          <col className="w-[140px]" />
					                          <col className="w-[120px]" />
					                          <col className="w-[120px]" />
					                          <col className="w-[110px]" />
					                          <col className="w-[110px]" />
					                          <col className="w-[110px]" />
					                          <col className="w-[140px]" />
				                        </colgroup>
				                        <thead>
				                          <tr className="bg-blue-700">
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GRN</th>
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Received</th>
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">PO</th>
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Item</th>
				                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GRN Qty</th>
					                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Invoice No</th>
					                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Invoice Date</th>
					                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Total Invoice Qty</th>
					                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Already Link Qty</th>
					                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Approved Qty</th>
					                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Pending Linking Qty</th>
					                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Link Qty</th>
					                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Action</th>
				                          </tr>
				                        </thead>
				                        <tbody>
				                          {pendingGrnInvoiceLinkRows.map((r) => (
				                            <tr key={r.grnItemId}>
				                              {(() => {
				                                const acceptedQty = Number(r.acceptedQty ?? 0);
				                                const linked = linkedInvoicesByGrnItemId.get(r.grnItemId) ?? [];
				                                const totalLinked = linked.reduce((sum, x) => sum + Number((x as any)?.linkedQty ?? 0), 0);
				                                const pendingLinkQty = Math.max(0, acceptedQty - totalLinked);
				                                const selectedInvoiceIdRaw = String(selectedInvoiceIdByGrnItemId[r.grnItemId] ?? '').trim();
				                                const optionsAll = invoiceDropdownOptionsByPoItemKey.get(`${r.poId}||${r.itemId}`) ?? [];
				                                const options = optionsAll.filter((o) => {
				                                  const invoiceId = String(o.value ?? '').trim();
				                                  if (!invoiceId) return false;
				                                  const invQty = invQtyByInvoiceIdItemId.get(`${invoiceId}||${r.itemId}`) ?? 0;
				                                  const linkedTotal = Number(linkedGrnQtyByInvoiceIdItemId[`${invoiceId}||${r.itemId}`] ?? 0);
				                                  return Number.isFinite(invQty) && Number.isFinite(linkedTotal) && invQty - linkedTotal > 1e-9;
				                                });
				                                const selectedInvoiceId = options.some((o) => o.value === selectedInvoiceIdRaw) ? selectedInvoiceIdRaw : '';
				                                const invoiceDate = selectedInvoiceId ? invoiceHeaderById.get(selectedInvoiceId)?.invoiceDate ?? '' : '';
				                                const invQty = selectedInvoiceId ? invQtyByInvoiceIdItemId.get(`${selectedInvoiceId}||${r.itemId}`) ?? 0 : null;
				                                const linkQty = selectedInvoiceId ? linkedQtyByGrnItemIdInvoiceId.get(`${r.grnItemId}||${selectedInvoiceId}`) ?? 0 : null;
				                                const placeholder = options.length ? 'Select invoice' : 'No invoices';

					                                const otherLinkedTotal = selectedInvoiceId
					                                  ? (linked ?? [])
					                                      .filter((x) => String((x as any)?.invoiceId ?? '').trim() !== selectedInvoiceId)
					                                      .reduce((sum, x) => sum + Number((x as any)?.linkedQty ?? 0), 0)
					                                  : totalLinked;
					                                const maxByAccepted = Math.max(0, acceptedQty - otherLinkedTotal);
					                                const invoiceItemLinkedTotal = selectedInvoiceId
					                                  ? Number(linkedGrnQtyByInvoiceIdItemId[`${selectedInvoiceId}||${r.itemId}`] ?? 0)
					                                  : 0;
					                                const currentInvoiceLinkQty = selectedInvoiceId ? Number(linkQty ?? 0) : 0;
					                                const remainingOnInvoice =
					                                  selectedInvoiceId && typeof invQty === 'number' && Number.isFinite(invQty)
					                                    ? Math.max(0, invQty - Math.max(0, invoiceItemLinkedTotal - currentInvoiceLinkQty))
					                                    : maxByAccepted;
					                                const suggestedQty = selectedInvoiceId ? Math.max(0, Math.min(remainingOnInvoice, maxByAccepted)) : 0;
					                                const typedLinkQty = linkQtyInputByGrnItemId[r.grnItemId];
					                                const hasTypedLinkQty = typedLinkQty != null && String(typedLinkQty).trim() !== '';
					                                const linkQtyValue = hasTypedLinkQty ? String(typedLinkQty) : selectedInvoiceId ? String(suggestedQty) : '';

				                                return (
				                                  <>
						                              <td className="px-4 py-3 text-sm font-semibold text-on-surface border border-outline-variant align-top">{formatGrnNumber((r as any).grnNumber ?? '') || '-'}</td>
				                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
					                                {r.receivedDate ? formatDateDDMMYYYYOnly(r.receivedDate) : '-'}
				                              </td>
					                              <td className="px-4 py-3 text-sm text-on-surface border border-outline-variant align-top">{formatPoNumber((r as any).poNumber ?? '') || '-'}</td>
				                              <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
				                                <div className="whitespace-normal break-words" title={r.itemLabel}>
				                                  {renderInlineWithBoldSpecNames(r.itemLabel)}
				                                </div>
				                              </td>
				                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{r.grnQty}</td>
					                              <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
					                                <SearchableSelect
					                                  options={options}
					                                  value={selectedInvoiceId}
							                                  onChange={(invoiceId) => {
							                                    const nextId = String(invoiceId ?? '').trim();
							                                    setSelectedInvoiceIdByGrnItemId((prev) => ({ ...prev, [r.grnItemId]: nextId }));
							                                    const current = nextId ? linkedQtyByGrnItemIdInvoiceId.get(`${r.grnItemId}||${nextId}`) ?? 0 : 0;
							                                    const otherTotal = nextId
							                                      ? (linked ?? [])
							                                          .filter((x) => String((x as any)?.invoiceId ?? '').trim() !== nextId)
							                                          .reduce((sum, x) => sum + Number((x as any)?.linkedQty ?? 0), 0)
							                                      : totalLinked;
							                                    const maxAllowed = Math.max(0, acceptedQty - otherTotal);
							                                    const invoiceKey = `${nextId}||${r.itemId}`;
							                                    const invLimit = nextId ? invQtyByInvoiceIdItemId.get(invoiceKey) ?? maxAllowed : maxAllowed;
							                                    const invoiceLinkedTotal = nextId ? Number(linkedGrnQtyByInvoiceIdItemId[invoiceKey] ?? 0) : 0;
							                                    const remainingOnInvoice = nextId
							                                      ? Math.max(0, Number(invLimit ?? 0) - Math.max(0, invoiceLinkedTotal - Number(current ?? 0)))
							                                      : maxAllowed;
							                                    const suggested = Math.max(0, Math.min(remainingOnInvoice, maxAllowed));
							                                    const nextQty = current > 0 ? current : suggested;
							                                    setLinkQtyInputByGrnItemId((prev) => ({ ...prev, [r.grnItemId]: String(nextQty) }));
							                                    setLinkLocalError(null);
							                                  }}
					                                  placeholder={placeholder}
					                                  disabled={busy || !qcDoneGrnIds.has(r.grnId) || !options.length}
					                                />
					                              </td>
				                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">
					                                {invoiceDate ? formatDateDDMMYYYYOnly(invoiceDate) : '-'}
				                              </td>
						                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{invQty == null ? '-' : invQty}</td>
						                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">
						                                {selectedInvoiceId ? invoiceItemLinkedTotal : '-'}
						                              </td>
						                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{r.acceptedQty}</td>
						                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{pendingLinkQty}</td>
						                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">
						                                <input
						                                  className={compactSurfaceInputClass}
						                                  type="number"
						                                  min={0}
						                                  step="any"
						                                  value={linkQtyValue}
						                                  onChange={(e) =>
						                                    setLinkQtyInputByGrnItemId((prev) => ({
						                                      ...prev,
						                                      [r.grnItemId]: e.target.value,
						                                    }))
						                                  }
						                                  disabled={busy || !qcDoneGrnIds.has(r.grnId) || !selectedInvoiceId}
						                                />
						                              </td>
						                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant align-top">
						                                <div className="flex items-center gap-2">
					                                  <button
					                                    type="button"
					                                    disabled={busy || !qcDoneGrnIds.has(r.grnId) || !selectedInvoiceId}
					                                    className="px-3 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
						                                    onClick={() => {
						                                      const invoiceId = String(selectedInvoiceId ?? '').trim();
						                                      if (!invoiceId) return;
							                                      const typed = linkQtyInputByGrnItemId[r.grnItemId];
							                                      const raw =
							                                        typed != null && String(typed).trim() !== '' ? String(typed).trim() : String(suggestedQty);
							                                      const desiredQty = raw ? Number(raw) : 0;
					                                      if (!Number.isFinite(desiredQty) || desiredQty < 0) {
					                                        setLinkLocalError('Enter valid Link Qty (0 or more).');
					                                        return;
					                                      }
					                                      const invoiceItemLinkedTotal = Number(
					                                        linkedGrnQtyByInvoiceIdItemId[`${invoiceId}||${r.itemId}`] ?? 0
					                                      );
					                                      const currentInvoiceLinkQty = Number(
					                                        linkedQtyByGrnItemIdInvoiceId.get(`${r.grnItemId}||${invoiceId}`) ?? 0
					                                      );
					                                      const remainingOnInvoice =
					                                        typeof invQty === 'number' && Number.isFinite(invQty)
					                                          ? Math.max(0, invQty - Math.max(0, invoiceItemLinkedTotal - currentInvoiceLinkQty))
					                                          : null;
					                                      if (
					                                        typeof remainingOnInvoice === 'number' &&
					                                        Number.isFinite(remainingOnInvoice) &&
					                                        desiredQty > remainingOnInvoice + 1e-9
					                                      ) {
					                                        setLinkLocalError('Link Qty cannot be more than remaining Invoice Qty.');
					                                        return;
					                                      }
					                                      if (desiredQty > Number(r.acceptedQty ?? 0) + 1e-9) {
					                                        setLinkLocalError('Link Qty cannot be more than Accepted Qty.');
					                                        return;
					                                      }

					                                      const otherLinkedTotal = (linked ?? [])
					                                        .filter((x) => String(x.invoiceId ?? '').trim() !== invoiceId)
					                                        .reduce((sum, x) => sum + Number(x.linkedQty ?? 0), 0);
					                                      if (otherLinkedTotal + desiredQty > Number(r.acceptedQty ?? 0) + 1e-9) {
					                                        setLinkLocalError('Total linked qty across invoices cannot be more than Accepted Qty.');
					                                        return;
					                                      }

					                                      const invoiceItemId = invoiceItemIdByInvoiceIdItemId.get(`${invoiceId}||${r.itemId}`) ?? '';
					                                      if (!invoiceItemId) {
					                                        setLinkLocalError('Invoice item not found for this item.');
					                                        return;
					                                      }

					                                      const links: Array<{ invoiceItemId: string; linkedQty: number }> = [];
					                                      for (const x of linked ?? []) {
					                                        const id = String(x.invoiceId ?? '').trim();
					                                        if (!id) continue;
					                                        if (id === invoiceId) continue;
					                                        const invIt = invoiceItemIdByInvoiceIdItemId.get(`${id}||${r.itemId}`) ?? '';
					                                        const qty = Number(x.linkedQty ?? 0);
					                                        if (!invIt || !Number.isFinite(qty) || qty <= 0) continue;
					                                        links.push({ invoiceItemId: invIt, linkedQty: qty });
					                                      }
					                                      if (desiredQty > 0) links.push({ invoiceItemId, linkedQty: desiredQty });

					                                      run(async () => {
					                                        await setGrnItemInvoiceLinks(r.grnItemId, { updatedBy: 'system', links });
					                                        if (requestId) {
					                                          const next = await fetchGrnItemInvoiceLinkSummaryByPrId(requestId);
					                                          setGrnItemInvoiceLinkSummary(next);
					                                        }
					                                        setSelectedInvoiceIdByGrnItemId((prev) => {
					                                          const next = { ...prev };
					                                          delete next[r.grnItemId];
					                                          return next;
					                                        });
					                                        setLinkQtyInputByGrnItemId((prev) => {
					                                          const next = { ...prev };
					                                          delete next[r.grnItemId];
					                                          return next;
					                                        });
					                                        setLinkLocalError(null);
					                                      });
					                                    }}
					                                  >
					                                    {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
					                                    Save
					                                  </button>
					                                  <button
					                                    type="button"
					                                    disabled={busy || !qcDoneGrnIds.has(r.grnId) || !selectedInvoiceId}
					                                    className="px-3 py-2 text-xs font-semibold text-on-primary bg-error hover:bg-error/90 rounded-lg transition-colors disabled:opacity-50"
					                                    onClick={() => {
					                                      const invoiceId = String(selectedInvoiceId ?? '').trim();
					                                      if (!invoiceId) return;
					                                      setLinkQtyInputByGrnItemId((prev) => ({ ...prev, [r.grnItemId]: '0' }));
					                                    }}
					                                  >
					                                    Clear
					                                  </button>
					                                </div>
					                              </td>
					                                  </>
					                                );
					                              })()}
				                            </tr>
				                          ))}
				                        </tbody>
				                      </table>
		                    </div>
		                  </div>
			                ) : null}

			                {linkedItemRowsOrdered.length ? (
			                  <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
			                    <div className="px-4 py-3 text-center text-lg font-semibold text-blue-600 border-b border-outline-variant">Linked Items</div>
			                    <div className="overflow-x-auto">
			                      <table className="w-full min-w-[1200px] table-fixed text-left border-collapse border border-outline-variant">
			                        <colgroup>
			                          <col className="w-[170px]" />
			                          <col className="w-[520px]" />
			                          <col className="w-[220px]" />
			                          <col className="w-[140px]" />
			                          <col className="w-[110px]" />
			                          <col className="w-[110px]" />
			                          <col className="w-[110px]" />
			                          <col className="w-[120px]" />
			                        </colgroup>
			                        <thead>
			                          <tr className="bg-blue-700">
			                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">GRN</th>
			                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Item</th>
			                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Invoice No</th>
			                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Invoice Date</th>
			                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Inv Qty</th>
			                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Link Qty</th>
			                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Accepted</th>
			                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Action</th>
			                          </tr>
			                        </thead>
			                        <tbody>
			                          {linkedItemRowsOrdered.map((lr) => (
			                            <tr key={`${lr.grnItemId}||${lr.invoiceId}`}>
				                              <td className="px-4 py-3 text-sm font-semibold text-on-surface border border-outline-variant align-top">{displayGrnNumberById(lr.grnId)}</td>
				                              <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
				                                <div className="whitespace-normal break-words" title={lr.itemLabel}>
				                                  {renderInlineWithBoldSpecNames(lr.itemLabel)}
				                                </div>
				                              </td>
			                              <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">{lr.invoiceNo}</td>
			                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">
			                                {lr.invoiceDate ? formatDateDDMMYYYYOnly(lr.invoiceDate) : '-'}
			                              </td>
			                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{lr.invoiceQty}</td>
			                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{lr.linkedQty}</td>
			                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{lr.acceptedQty}</td>
			                              <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant">
			                                <button
			                                  type="button"
			                                  className="px-3 py-2 text-xs font-semibold text-on-primary bg-error hover:bg-error/90 rounded-lg transition-colors disabled:opacity-50"
			                                  disabled={busy || !qcDoneGrnIds.has(lr.grnId)}
			                                  onClick={() => {
			                                    if (!confirm('Delete this linked invoice item?')) return;
			                                    const linked = linkedInvoicesByGrnItemId.get(lr.grnItemId) ?? [];
			                                    const links: Array<{ invoiceItemId: string; linkedQty: number }> = [];
			                                    for (const x of linked) {
			                                      const id = String((x as any)?.invoiceId ?? '').trim();
			                                      if (!id || id === lr.invoiceId) continue;
			                                      const invIt = invoiceItemIdByInvoiceIdItemId.get(`${id}||${lr.itemId}`) ?? '';
			                                      const qty = Number((x as any)?.linkedQty ?? 0);
			                                      if (!invIt || !Number.isFinite(qty) || qty <= 0) continue;
			                                      links.push({ invoiceItemId: invIt, linkedQty: qty });
			                                    }
			                                    run(() =>
			                                      setGrnItemInvoiceLinks(lr.grnItemId, { updatedBy: 'system', links }).then(() => {
			                                        setLinkLocalError(null);
			                                      })
			                                    );
			                                  }}
			                                >
			                                  Delete
			                                </button>
			                              </td>
			                            </tr>
			                          ))}
			                        </tbody>
			                      </table>
			                    </div>
			                  </div>
			                ) : null}
			              </div>
			            </div>
					          </Section>
			          ) : null}

				          {qcDetailsOpen && activeQcDetails ? (
				            <div className="fixed inset-0 z-50">
				              <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={closeQcDetails} />
				              <div className="relative w-full h-full bg-surface-container-lowest border border-outline-variant shadow-xl flex flex-col">
				                <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant bg-surface-container-lowest">
					                  <div className="text-sm font-bold text-on-surface">QC Details: {formatGrnNumber(activeQcDetails.grnId)}</div>
				                  <button type="button" className="btn btn-sm" onClick={closeQcDetails}>
				                    Close
				                  </button>
				                </div>

				                <div className="flex-1 overflow-auto p-5 space-y-4">
				                  {qcDetailsError ? <div className="text-sm text-error font-semibold">{qcDetailsError}</div> : null}

			                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
				                    <Field label="GRN Number">
				                      <input className={inputClass} value={formatGrnNumber(activeQcDetails.grnId)} disabled />
				                    </Field>
			                    <Field label="PO Number">
	        <input className={inputClass} value={displayPoNumberById(activeQcDetails.poId)} disabled />
			                    </Field>
			                    <Field label="QC Date">
				                      <input className={inputClass} value={activeQcDetails.qcDate ? formatDateDDMMYYYYOnly(activeQcDetails.qcDate) : '-'} disabled />
			                    </Field>
			                    <Field label="Inspected By">
			                      {qcDetailsMode === 'edit' ? (
			                        <SearchableSelect
			                          options={users.map((u) => ({ value: u.id, label: u.name }))}
			                          value={editQcBy}
			                          onChange={setEditQcBy}
			                          placeholder="Select user"
			                        />
			                      ) : (
			                        <input className={inputClass} value={users.find((u) => u.id === activeQcDetails.qcBy)?.name ?? activeQcDetails.qcBy} disabled />
			                      )}
			                    </Field>
			                    <Field label="Updated By">
			                      {qcDetailsMode === 'edit' ? (
			                        <SearchableSelect
			                          options={users.map((u) => ({ value: u.id, label: u.name }))}
			                          value={editQcUpdatedBy}
			                          onChange={setEditQcUpdatedBy}
			                          placeholder="Select user"
			                        />
				                      ) : (
				                        <input
				                          className={inputClass}
				                          value={
				                            users.find((u) => u.id === (activeQcDetails.updatedBy || activeQcDetails.qcBy))?.name ??
				                            (activeQcDetails.updatedBy || activeQcDetails.qcBy)
				                          }
				                          disabled
				                        />
				                      )}
				                    </Field>
				                    <Field label="Location">
				                      <input
				                        className={inputClass}
				                        value={qcDetailsMode === 'edit' ? editQcLocation : 'Main Store'}
				                        onChange={(e) => setEditQcLocation(e.target.value)}
				                        disabled={busy || qcDetailsMode !== 'edit'}
				                      />
				                    </Field>
			                  </div>

			                  <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-outline-variant">
			                    <div className="overflow-x-auto">
			                      <table className="w-full min-w-[980px] table-fixed text-left border-collapse border border-outline-variant">
			                        <colgroup>
			                          <col className="w-[520px]" />
			                          <col className="w-[150px]" />
			                          <col className="w-[150px]" />
			                          <col className="w-[360px]" />
			                        </colgroup>
			                        <thead>
			                          <tr className="bg-blue-700">
			                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Item</th>
			                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Accepted</th>
			                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Rejected</th>
			                            <th className="px-4 py-3 text-[11px] font-bold text-white uppercase tracking-widest border border-outline-variant">Remarks</th>
			                          </tr>
			                        </thead>
			                        <tbody>
			                          {qcDetailsMode === 'edit' ? (
			                            editQcLines.length ? (
			                              editQcLines.map((l) => (
			                                <tr key={l.itemId}>
				                                  <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
				                                    <div className="whitespace-normal break-words" title={l.label}>
				                                      {renderInlineWithBoldSpecNames(l.label)}
				                                    </div>
				                                  </td>
			                                  <td className="px-4 py-3 border border-outline-variant">
			                                    <input
			                                      className={tableInputClass}
			                                      value={l.accepted}
			                                      inputMode="numeric"
			                                      disabled={busy}
			                                      onChange={(e) =>
			                                        setEditQcLines((prev) =>
			                                          prev.map((x) => (x.itemId === l.itemId ? { ...x, accepted: e.target.value } : x))
			                                        )
			                                      }
			                                    />
			                                  </td>
			                                  <td className="px-4 py-3 border border-outline-variant">
			                                    <input
			                                      className={tableInputClass}
			                                      value={l.rejected}
			                                      inputMode="numeric"
			                                      disabled={busy}
			                                      onChange={(e) =>
			                                        setEditQcLines((prev) =>
			                                          prev.map((x) => (x.itemId === l.itemId ? { ...x, rejected: e.target.value } : x))
			                                        )
			                                      }
			                                    />
			                                  </td>
			                                  <td className="px-4 py-3 border border-outline-variant">
			                                    <input
			                                      className={tableInputClass}
			                                      value={l.remarks}
			                                      disabled={busy}
			                                      onChange={(e) =>
			                                        setEditQcLines((prev) =>
			                                          prev.map((x) => (x.itemId === l.itemId ? { ...x, remarks: e.target.value } : x))
			                                        )
			                                      }
			                                    />
			                                  </td>
			                                </tr>
			                              ))
			                            ) : (
			                              <tr>
			                                <td colSpan={4} className="px-4 py-6 text-sm text-on-surface-variant text-center border border-outline-variant">
			                                  No QC items.
			                                </td>
			                              </tr>
			                            )
			                          ) : (
			                            activeQcDetails.items.map((r) => {
			                              const prRow = prItems.find((it) => it.itemId === r.itemId);
			                              const specInline = (prRow?.specification || '')
			                                .split(/\r?\n/)
			                                .map((s) => s.trim())
			                                .filter(Boolean)
			                                .join(' - ');
			                              const label = [prRow?.item || r.item, specInline || null].filter(Boolean).join(' - ');
			                              return (
			                                <tr key={r.id}>
			                                  <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
			                                    <div className="whitespace-normal break-words">{renderInlineWithBoldSpecNames(label)}</div>
			                                  </td>
			                                  <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">
				                                    {Number(grnQtyByGrnIdItemId[`${activeQcDetails.grnId}||${r.itemId}`] ?? 0)}
			                                  </td>
			                                  <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.acceptedQty ?? 0)}</td>
			                                  <td className="px-4 py-3 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.rejectedQty ?? 0)}</td>
			                                  <td className="px-4 py-3 text-xs text-on-surface-variant border border-outline-variant">
			                                    <div className="truncate">{r.remarks || '-'}</div>
			                                  </td>
			                                </tr>
			                              );
			                            })
			                          )}
			                        </tbody>
			                      </table>
			                    </div>
			                  </div>

			                  {qcDetailsMode === 'edit' ? (
			                    <div className="flex justify-end">
			                      <button
			                        type="button"
			                        disabled={busy}
			                        className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
			                        onClick={() => {
			                          setQcDetailsError(null);
			                          const inspectedBy = editQcBy.trim();
			                          const updatedBy = editQcUpdatedBy.trim();
			                          const loc = editQcLocation.trim() || 'Main Store';
			                          if (!inspectedBy) {
			                            setQcDetailsError('Inspected By is required.');
			                            return;
			                          }
			                          if (!updatedBy) {
			                            setQcDetailsError('Updated By is required.');
			                            return;
			                          }
			                          const items = editQcLines.map((l) => ({
			                            itemId: l.itemId,
			                            quantityAccepted: Number(l.accepted ?? 0),
			                            quantityRejected: Number(l.rejected ?? 0),
			                            remarks: l.remarks ?? '',
			                          }));
			                          if (items.some((x) => !Number.isFinite(x.quantityAccepted) || !Number.isFinite(x.quantityRejected) || x.quantityAccepted < 0 || x.quantityRejected < 0)) {
			                            setQcDetailsError('Enter valid QC quantities.');
			                            return;
			                          }
				                          run(() =>
				                            updateQcForGrn(activeQcDetails.grnId, { inspectedBy, location: loc, updatedBy, items })
				                              .then(async () => {
				                                if (!requestId) return;
				                                const rows = await fetchQcRecordsByPrId(requestId);
				                                setQcRecords(rows);
				                                setQcReloadKey((k) => k + 1);
				                              })
				                              .then(() => undefined)
				                          ).then(() => closeQcDetails());
				                        }}
				                      >
			                        {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
			                        Save
			                      </button>
			                    </div>
			                  ) : null}
			                </div>
			              </div>
			            </div>
				          ) : null}

					          {grnItemLinkModalOpen && activeGrnItemLink ? (
					            <div className="fixed inset-0 z-50">
					              <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={closeGrnItemLinkModal} />
					              <div className="relative w-full h-full bg-surface-container-lowest border border-outline-variant shadow-xl flex flex-col">
						                <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant bg-surface-container-lowest">
						                  <div className="text-sm font-bold text-on-surface">
						                    Invoice Linking: {formatGrnNumber(activeGrnItemLink.grnId)}
						                  </div>
					                  <button type="button" className="btn btn-sm" onClick={closeGrnItemLinkModal}>
					                    Close
					                  </button>
					                </div>

					                <div className="flex-1 overflow-auto p-5 space-y-4">
					                  {grnItemLinkLocalError ? <div className="text-sm text-error font-semibold">{grnItemLinkLocalError}</div> : null}

					                  {!qcDoneGrnIds.has(activeGrnItemLink.grnId) ? (
					                    <div className="text-sm text-on-surface-variant">Record QC for GRN {formatGrnNumber(activeGrnItemLink.grnId)} before linking invoices.</div>
					                  ) : null}

					                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
					                    <Field label="GRN">
					                      <input className={inputClass} value={formatGrnNumber(activeGrnItemLink.grnId)} disabled />
					                    </Field>
				                    <Field label="Item">
				                      <input className={inputClass} value={activeGrnItemLink.itemLabel} disabled />
				                    </Field>
				                    <Field label="GRN Qty">
				                      <input className={inputClass} value={String(activeGrnItemLink.grnQty ?? '')} disabled />
				                    </Field>
					                    <Field label="Invoice No">
					                      <SearchableSelect
					                        options={activeGrnItemInvoiceItemOptions}
				                        value={grnItemLinkSelectedInvoiceItemId}
				                        onChange={setGrnItemLinkSelectedInvoiceItemId}
				                        placeholder={activeGrnItemInvoiceItemOptions.length ? 'Select invoice' : 'No invoice items'}
				                        disabled={busy || !activeGrnItemInvoiceItemOptions.length}
				                      />
				                    </Field>
				                    <Field label="Linked Qty">
				                      <input
				                        className={inputClass}
				                        type="number"
				                        min={0}
				                        step="any"
				                        value={grnItemLinkSelectedQty}
				                        onChange={(e) => setGrnItemLinkSelectedQty(e.target.value)}
				                        disabled={busy || !qcDoneGrnIds.has(activeGrnItemLink.grnId) || !grnItemLinkSelectedInvoiceItemId}
				                      />
				                    </Field>
				                  </div>

				                  <div className="flex items-center justify-end gap-2">
				                    <button
				                      type="button"
				                      className="px-4 py-2 text-xs font-semibold text-on-surface bg-surface-container-high hover:bg-surface-container-highest rounded-lg transition-colors disabled:opacity-50"
				                      disabled={busy || !grnItemLinkSelectedInvoiceItemId}
				                      onClick={() => {
				                        const id = String(grnItemLinkSelectedInvoiceItemId ?? '').trim();
				                        if (!id) return;
				                        const raw = String(grnItemLinkSelectedQty ?? '').trim();
				                        const linkedQty = raw ? Number(raw) : 0;
				                        if (!Number.isFinite(linkedQty) || linkedQty < 0) {
				                          setGrnItemLinkLocalError('Enter valid linked qty (0 or more).');
				                          return;
				                        }
				                        setGrnItemLinkQtyByInvoiceItemId((prev) => ({ ...prev, [id]: String(linkedQty) }));
				                        setGrnItemLinkLocalError(null);
				                      }}
				                    >
				                      Apply
				                    </button>
				                    <button
				                      type="button"
				                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-error hover:bg-error/90 rounded-lg transition-colors disabled:opacity-50"
				                      disabled={busy || !grnItemLinkSelectedInvoiceItemId}
				                      onClick={() => {
				                        const id = String(grnItemLinkSelectedInvoiceItemId ?? '').trim();
				                        if (!id) return;
				                        setGrnItemLinkQtyByInvoiceItemId((prev) => ({ ...prev, [id]: '0' }));
				                        setGrnItemLinkSelectedQty('0');
				                        setGrnItemLinkLocalError(null);
				                      }}
				                    >
				                      Remove
				                    </button>
				                    <button
				                      type="button"
				                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
				                      disabled={busy || !qcDoneGrnIds.has(activeGrnItemLink.grnId)}
				                      onClick={() => {
				                        const selectedId = String(grnItemLinkSelectedInvoiceItemId ?? '').trim();
				                        const draft: Record<string, string> = { ...grnItemLinkQtyByInvoiceItemId };
				                        if (selectedId) draft[selectedId] = String(grnItemLinkSelectedQty ?? '');
				                        const links = Object.entries(draft)
				                          .map(([invoiceItemId, raw]) => ({
				                            invoiceItemId: String(invoiceItemId ?? '').trim(),
				                            linkedQty: String(raw ?? '').trim() ? Number(raw) : 0,
				                          }))
				                          .filter((l) => l.invoiceItemId && Number.isFinite(l.linkedQty) && l.linkedQty >= 0);

				                        if (!links.length) {
				                          setGrnItemLinkLocalError('Select an invoice to link.');
				                          return;
				                        }
				                        if (links.some((l) => !l.invoiceItemId || !Number.isFinite(l.linkedQty) || l.linkedQty < 0)) {
				                          setGrnItemLinkLocalError('Enter valid linked quantities (0 or more).');
				                          return;
				                        }
				                        run(() =>
				                          setGrnItemInvoiceLinks(activeGrnItemLink.grnItemId, {
				                            updatedBy: 'system',
				                            links,
				                          }).then((res) => {
				                            const rows = Array.isArray((res as any)?.links) ? ((res as any).links as GrnItemInvoiceLinkRow[]) : [];
				                            setActiveGrnItemInvoiceLinks(rows);
				                            const next: NumMap = {};
				                            for (const r of rows) next[r.invoiceItemId] = String(r.linkedQty ?? 0);
				                            setGrnItemLinkQtyByInvoiceItemId(next);
				                            closeGrnItemLinkModal();
				                          })
				                        );
				                      }}
				                    >
				                      {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
				                      Save
				                    </button>
				                    <button
				                      type="button"
				                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-error hover:bg-error/90 rounded-lg transition-colors disabled:opacity-50"
				                      disabled={busy || !qcDoneGrnIds.has(activeGrnItemLink.grnId)}
				                      onClick={() => {
				                        if (!confirm('Delete all invoice linking for this GRN item?')) return;
				                        const filter = String(grnItemLinkInvoiceIdFilter ?? '').trim();
				                        if (!filter) {
				                          run(() =>
				                          setGrnItemInvoiceLinks(activeGrnItemLink.grnItemId, { updatedBy: 'system', links: [] }).then(() => {
				                            closeGrnItemLinkModal();
				                          })
				                          );
				                          return;
				                        }

				                        // When opened from an invoice-filtered context, delete links only for that invoice and preserve others.
				                        run(() => {
				                          const draft: Record<string, string> = { ...grnItemLinkQtyByInvoiceItemId };
				                          for (const invoiceItemId of activeGrnItemInvoiceItemMeta.keys()) draft[invoiceItemId] = '0';
				                          const links = Object.entries(draft)
				                            .map(([invoiceItemId, raw]) => ({
				                              invoiceItemId: String(invoiceItemId ?? '').trim(),
				                              linkedQty: String(raw ?? '').trim() ? Number(raw) : 0,
				                            }))
				                            .filter((l) => l.invoiceItemId && Number.isFinite(l.linkedQty) && l.linkedQty > 0);
				                          return setGrnItemInvoiceLinks(activeGrnItemLink.grnItemId, { updatedBy: 'system', links }).then(() => {
				                            closeGrnItemLinkModal();
				                          });
				                        });
				                      }}
				                    >
				                      Delete All
				                    </button>
				                  </div>

				                  <div className="bg-surface-container rounded-xl border border-outline-variant/10 p-4 space-y-2">
				                    <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Current Links</div>
				                    {loadingActiveGrnItemInvoiceLinks ? (
				                      <div className="flex items-center gap-2 text-sm text-on-surface-variant">
				                        <Spinner className="h-4 w-4" /> Loading...
				                      </div>
				                    ) : activeGrnItemInvoiceLinks.length ? (
				                      <div className="overflow-x-auto">
				                        <table className="w-full min-w-[720px] table-fixed text-left border-collapse border border-outline-variant">
				                          <colgroup>
				                            <col className="w-[280px]" />
				                            <col className="w-[160px]" />
				                            <col className="w-[140px]" />
				                            <col className="w-[140px]" />
				                          </colgroup>
				                          <thead>
				                            <tr className="bg-surface-container-high">
				                              <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Invoice</th>
				                              <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Date</th>
				                              <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Linked Qty</th>
				                              <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Invoice Qty</th>
				                            </tr>
				                          </thead>
				                          <tbody>
				                            {activeGrnItemInvoiceLinks.map((l) => {
				                              const meta = activeGrnItemInvoiceItemMeta.get(l.invoiceItemId);
				                              return (
				                                <tr key={l.invoiceItemId}>
				                                  <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant">{l.invoiceNo}</td>
				                                  <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">
				                                    {l.invoiceDate ? formatDateDDMMYYYYOnly(l.invoiceDate) : '-'}
				                                  </td>
				                                  <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{l.linkedQty}</td>
				                                  <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{meta?.invoiceQty ?? '-'}</td>
				                                </tr>
				                              );
				                            })}
				                          </tbody>
				                        </table>
				                      </div>
				                    ) : (
				                      <div className="text-sm text-on-surface-variant">No linked invoices yet.</div>
				                    )}
				                  </div>
				                </div>
				              </div>
				            </div>
				          ) : null}

	        </div>
	      ) : null}
	    </div>
	  );
	}
