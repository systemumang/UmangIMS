import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import Pagination from '@/src/components/common/Pagination';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import { type AuthUser } from '@/src/lib/auth';
import { downloadTextFile, toCsv } from '@/src/lib/csvFile';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { sanitizeDecimalInput } from '@/src/lib/numberInput';
import {
  createSupplierAdvance,
  deleteSupplierAdvance,
  fetchPendingSupplierAdvances,
  type SupplierAdvanceFilters,
  type SupplierAdvanceRow,
} from '@/src/lib/supplierAdvances';
import { formatUploadSize, uploadFileToServer } from '@/src/lib/uploads';
import { cn } from '@/src/lib/utils';
import { inputClass, labelClass, Modal, useQueueMasters } from './queues/shared';

const emptyFilters: SupplierAdvanceFilters = { q: '', firmId: '', supplierId: '', from: '', to: '' };

function uploadDocumentHref(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('/api/uploads/')) return raw;
  if (raw.startsWith('/uploads/')) return `/api${raw}`;
  return raw;
}

export default function SupplierAdvancesView({
  currentUser,
  onMakePo,
}: {
  currentUser?: AuthUser | null;
  onMakePo: (advance: SupplierAdvanceRow) => void;
}) {
  const masters = useQueueMasters({ includeSuppliers: true });
  const currentUserName = String(currentUser?.name ?? currentUser?.loginId ?? '').trim() || 'system';
  const [filters, setFilters] = useState<SupplierAdvanceFilters>({ ...emptyFilters });
  const deferredFilters = useDeferredValue(filters);
  const [rows, setRows] = useState<SupplierAdvanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [firmId, setFirmId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [advanceDate, setAdvanceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [paymentCopy, setPaymentCopy] = useState('');
  const [uploadSummary, setUploadSummary] = useState('');
  const [remarks, setRemarks] = useState('');
  const pageSize = 20;
  // Pending supplier advances are linked only after the PO is created.

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    fetchPendingSupplierAdvances(deferredFilters, controller.signal)
      .then(setRows)
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [deferredFilters, refreshTick]);

  useEffect(() => setPage(1), [deferredFilters]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    if (page > totalPages) setPage(totalPages);
  }, [page, rows.length]);

  const firmOptions = useMemo(
    () => masters.firms.slice().sort((a, b) => a.name.localeCompare(b.name)).map((firm) => ({
      value: firm.id,
      label: String(firm.sortName ?? '').trim() || firm.name,
    })),
    [masters.firms]
  );
  const supplierOptions = useMemo(
    () => masters.suppliers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((supplier) => ({
      value: supplier.id,
      label: supplier.name,
    })),
    [masters.suppliers]
  );
  const pagedRows = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [page, rows]);

  const resetForm = () => {
    setFirmId('');
    setSupplierId('');
    setAdvanceDate(new Date().toISOString().slice(0, 10));
    setAdvanceAmount('');
    setPaymentMode('');
    setPaymentCopy('');
    setUploadSummary('');
    setRemarks('');
    setFormError(null);
    setUploading(false);
  };

  const closeModal = () => {
    if (saving || uploading) return;
    setModalOpen(false);
    resetForm();
  };

  const saveAdvance = async () => {
    const amount = Number(advanceAmount);
    if (!firmId) return setFormError('Firm is required.');
    if (!supplierId) return setFormError('Supplier is required.');
    if (!advanceDate) return setFormError('Advance Date is required.');
    if (!Number.isFinite(amount) || amount <= 0) return setFormError('Advance Amount must be greater than zero.');
    if (!paymentMode) return setFormError('Payment Mode is required.');
    setSaving(true);
    setFormError(null);
    try {
      await createSupplierAdvance({
        firmId,
        supplierId,
        advanceDate,
        advanceAmount: amount,
        paymentMode,
        paymentCopy: paymentCopy || undefined,
        remarks: remarks.trim() || undefined,
        createdBy: currentUserName,
      });
      setModalOpen(false);
      resetForm();
      setRefreshTick((value) => value + 1);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const exportRows = rows.map((row) => ({
      advanceId: row.id,
      advanceDate: row.advanceDate,
      firm: row.firmShortName || row.firmName,
      supplier: row.supplierName,
      amount: row.advanceAmount,
      paymentMode: row.paymentMode,
      remarks: row.remarks || '',
      createdBy: row.createdBy || '',
    }));
    downloadTextFile(
      `advances-pending-po-${new Date().toISOString().slice(0, 10)}.csv`,
      exportRows.length ? toCsv(Object.keys(exportRows[0]), exportRows) : 'advanceId\n',
      'text/csv; charset=utf-8'
    );
  };

  const removeAdvance = async (row: SupplierAdvanceRow) => {
    const confirmed = window.confirm(`Delete the pending advance for ${row.supplierName}?`);
    if (!confirmed) return;
    setDeletingId(row.id);
    setDeleteError(null);
    try {
      await deleteSupplierAdvance(row.id);
      setRows((previous) => previous.filter((item) => item.id !== row.id));
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingId('');
    }
  };

  return (
    <div className='space-y-5'>
      <div className='flex items-center justify-between gap-3 flex-wrap'>
        <div>
          <h2 className='font-headline text-xl font-bold text-on-surface'>Advances Pending PO</h2>
          <p className='text-sm text-on-surface-variant'>Supplier advances waiting to be linked with a new purchase order.</p>
        </div>
        <div className='flex items-center gap-2'>
          <button type='button' className='btn btn-sm' onClick={exportCsv} disabled={loading}>Export</button>
          <button type='button' className='btn-primary btn-sm' onClick={() => { resetForm(); setModalOpen(true); }}>
            <Plus size={15} /> Add Supplier Advance
          </button>
        </div>
      </div>

      <div className='bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-4'>
        <div className='grid grid-cols-1 md:grid-cols-6 gap-3 items-end'>
          <label className='space-y-1 md:col-span-2'>
            <div className={labelClass}>Search</div>
            <input
              className={inputClass}
              value={filters.q ?? ''}
              onChange={(event) => setFilters((previous) => ({ ...previous, q: event.target.value }))}
              placeholder='advance / supplier / firm / remarks...'
            />
          </label>
          <label className='space-y-1'>
            <div className={labelClass}>Firm</div>
            <SearchableSelect
              value={filters.firmId ?? ''}
              options={[{ value: '', label: 'All Firms' }, ...firmOptions]}
              onChange={(value) => setFilters((previous) => ({ ...previous, firmId: value }))}
            />
          </label>
          <label className='space-y-1'>
            <div className={labelClass}>Supplier</div>
            <SearchableSelect
              value={filters.supplierId ?? ''}
              options={[{ value: '', label: 'All Suppliers' }, ...supplierOptions]}
              onChange={(value) => setFilters((previous) => ({ ...previous, supplierId: value }))}
            />
          </label>
          <label className='space-y-1'>
            <div className={labelClass}>From</div>
            <input type='date' className={inputClass} value={filters.from ?? ''}
              onChange={(event) => setFilters((previous) => ({ ...previous, from: event.target.value }))} />
          </label>
          <label className='space-y-1'>
            <div className={labelClass}>To</div>
            <input type='date' className={inputClass} value={filters.to ?? ''}
              onChange={(event) => setFilters((previous) => ({ ...previous, to: event.target.value }))} />
          </label>
          <button type='button' className='btn btn-sm' onClick={() => setFilters({ ...emptyFilters })}>Clear</button>
        </div>
      </div>

      {loadError ? <div className='bg-error-container/40 rounded-xl border p-4 text-sm'>Failed to load: {loadError}</div> : null}
      {deleteError ? <div className='bg-error-container/40 rounded-xl border p-4 text-sm'>Delete failed: {deleteError}</div> : null}

      <div className='bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden'>
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[1080px] table-fixed text-left border-collapse border border-outline-variant text-sm'>
            <thead>
              <tr className='bg-primary text-on-primary'>
                <th className='px-3 py-2 border w-[115px]'>Advance Date</th>
                <th className='px-3 py-2 border w-[130px]'>Firm</th>
                <th className='px-3 py-2 border w-[190px]'>Supplier</th>
                <th className='px-3 py-2 border w-[125px] text-right'>Amount</th>
                <th className='px-3 py-2 border w-[115px]'>Payment Mode</th>
                <th className='px-3 py-2 border'>Remarks</th>
                <th className='px-3 py-2 border w-[105px]'>Payment Copy</th>
                <th className='px-3 py-2 border w-[125px]'>Created By</th>
                <th className='px-3 py-2 border w-[195px] text-center'>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className='px-3 py-8 border text-center text-on-surface-variant'>Loading...</td></tr>
              ) : !pagedRows.length ? (
                <tr><td colSpan={9} className='px-3 py-8 border text-center text-on-surface-variant'>No advances are pending PO.</td></tr>
              ) : pagedRows.map((row) => (
                <tr key={row.id} className='hover:bg-surface-container-high/40'>
                  <td className='px-3 py-2 border'>{formatDateDDMMYYYYOnly(row.advanceDate) || '-'}</td>
                  <td className='px-3 py-2 border'>{row.firmShortName || row.firmName}</td>
                  <td className='px-3 py-2 border font-semibold'>{row.supplierName}</td>
                  <td className='px-3 py-2 border text-right tabular-nums font-semibold'>{Number(row.advanceAmount).toFixed(3)}</td>
                  <td className='px-3 py-2 border'>{row.paymentMode || '-'}</td>
                  <td className='px-3 py-2 border whitespace-normal break-words'>{row.remarks || '-'}</td>
                  <td className='px-3 py-2 border'>
                    {row.paymentCopy ? (
                      <a className='inline-flex items-center gap-1 text-primary underline font-semibold'
                        href={uploadDocumentHref(row.paymentCopy)} target='_blank' rel='noreferrer'>
                        <FileText size={14} /> View
                      </a>
                    ) : '-'}
                  </td>
                  <td className='px-3 py-2 border'>{row.createdBy || '-'}</td>
                  <td className='px-3 py-2 border text-center'>
                    <div className='flex items-center justify-center gap-2'>
                      <button type='button' className='btn-primary btn-sm whitespace-nowrap' disabled={deletingId === row.id}
                        onClick={() => onMakePo(row)}>Make PO</button>
                      <button type='button' className='btn btn-sm text-error border-error/30 whitespace-nowrap' title='Delete pending advance'
                        aria-label='Delete pending advance' disabled={deletingId === row.id} onClick={() => removeAdvance(row)}>
                        <Trash2 size={15} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination totalItems={rows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
      </div>

      <Modal
        open={modalOpen}
        title='Add Supplier Advance'
        onClose={closeModal}
        maxWidthClass='max-w-4xl'
        footer={
          <>
            <button type='button' className='btn btn-sm' onClick={closeModal} disabled={saving || uploading}>Cancel</button>
            <button type='button' className='btn-primary btn-sm' onClick={saveAdvance} disabled={saving || uploading}>
              {saving ? 'Saving...' : 'Save Advance'}
            </button>
          </>
        }
      >
        {formError ? <div className='p-3 rounded-lg border border-error/30 bg-error/10 text-error text-sm'>{formError}</div> : null}
        <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
          <label className='space-y-1'>
            <div className={labelClass}>Firm *</div>
            <SearchableSelect value={firmId} options={firmOptions} onChange={setFirmId} placeholder='Select firm...' />
          </label>
          <label className='space-y-1'>
            <div className={labelClass}>Supplier *</div>
            <SearchableSelect value={supplierId} options={supplierOptions} onChange={setSupplierId} placeholder='Select supplier...' />
          </label>
          <label className='space-y-1'>
            <div className={labelClass}>Advance Date *</div>
            <input type='date' className={inputClass} value={advanceDate} onChange={(event) => setAdvanceDate(event.target.value)} />
          </label>
          <label className='space-y-1'>
            <div className={labelClass}>Advance Amount *</div>
            <input className={inputClass} inputMode='decimal' value={advanceAmount}
              onChange={(event) => setAdvanceAmount(sanitizeDecimalInput(event.target.value))} placeholder='0' />
          </label>
          <label className='space-y-1'>
            <div className={labelClass}>Payment Mode *</div>
            <select className={inputClass} value={paymentMode} onChange={(event) => setPaymentMode(event.target.value)}>
              <option value=''>Select</option>
              <option value='Cash'>Cash</option>
              <option value='UPI'>UPI</option>
              <option value='Cheque'>Cheque</option>
              <option value='NEFT'>NEFT</option>
              <option value='RTGS'>RTGS</option>
              <option value='IMPS'>IMPS</option>
              <option value='Card'>Card</option>
            </select>
          </label>
          <div className='space-y-1'>
            <div className={labelClass}>Payment Copy</div>
            <div className='flex items-center gap-3 min-h-10'>
              <label className={cn('btn btn-sm cursor-pointer', (saving || uploading) && 'opacity-60 pointer-events-none')}>
                {uploading ? 'Uploading...' : paymentCopy ? 'Change Document' : 'Upload Document'}
                <input
                  type='file'
                  className='hidden'
                  disabled={saving || uploading}
                  onChange={async (event) => {
                    const input = event.currentTarget;
                    const file = input.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    setFormError(null);
                    try {
                      const result = await uploadFileToServer(file);
                      setPaymentCopy(result.url);
                      setUploadSummary(result.optimized ? `Optimized: ${formatUploadSize(result)}` : `Upload size: ${formatUploadSize(result)}`);
                    } catch (error) {
                      setFormError(error instanceof Error ? error.message : String(error));
                    } finally {
                      setUploading(false);
                      input.value = '';
                    }
                  }}
                />
              </label>
              {paymentCopy ? (
                <div className='flex flex-col gap-1'>
                  <a className='text-sm text-primary underline font-semibold' href={uploadDocumentHref(paymentCopy)}
                    target='_blank' rel='noreferrer'>View uploaded document</a>
                  {uploadSummary ? <span className='text-xs text-on-surface-variant'>{uploadSummary}</span> : null}
                </div>
              ) : (
                <span className='text-xs text-on-surface-variant'>Images are optimized before upload. Maximum size is 5 MB.</span>
              )}
            </div>
          </div>
          <label className='space-y-1 md:col-span-2'>
            <div className={labelClass}>Remarks</div>
            <textarea className={cn(inputClass, 'h-24 resize-y')} value={remarks}
              onChange={(event) => setRemarks(event.target.value)} placeholder='Enter payment reference or remarks...' />
          </label>
        </div>
      </Modal>
    </div>
  );
}
