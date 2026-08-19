import React, { useEffect, useMemo, useState } from 'react';
import { Eye, FileText, Pencil, Plus, Upload } from 'lucide-react';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import { fetchProjects, fetchSuppliers, type Project, type Supplier } from '@/src/lib/masters';
import { fetchOperationsPos, type OperationsPoListRow } from '@/src/lib/operations';
import { uploadFileToServer } from '@/src/lib/uploads';
import { openDocument } from '@/src/lib/utils';
import {
  addCourierUpdate,
  createCourier,
  fetchCourierUpdates,
  fetchCouriers,
  fetchPendingReceiptCouriers,
  type CourierRow,
  type CourierStatus,
  type CourierUpdateRow,
} from '@/src/lib/couriers';

type Props = {
  mode: 'all' | 'pending';
  currentUserName?: string;
};

const STATUS_OPTIONS: CourierStatus[] = ['In Progress', 'Received', 'Cancel'];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value?: string) {
  if (!value) return '-';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : value;
}

function fileHref(value?: string) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('/api/uploads/')) return raw;
  if (raw.startsWith('/uploads/')) return `/api${raw}`;
  if (raw.startsWith('uploads/')) return `/api/${raw}`;
  return raw;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-outline-variant flex items-center justify-between gap-3">
          <div className="font-headline text-base font-bold text-on-surface">{title}</div>
          <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="p-4 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

export default function CourierTrackingView({ mode, currentUserName = '' }: Props) {
  const [rows, setRows] = useState<CourierRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pos, setPos] = useState<OperationsPoListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [detailsFor, setDetailsFor] = useState<CourierRow | null>(null);
  const [updates, setUpdates] = useState<CourierUpdateRow[]>([]);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [updateFor, setUpdateFor] = useState<CourierRow | null>(null);

  const [date, setDate] = useState(todayIso());
  const [courierNo, setCourierNo] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [poId, setPoId] = useState('');
  const [courierCopyUrl, setCourierCopyUrl] = useState('');
  const [courierCopyName, setCourierCopyName] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [updateDate, setUpdateDate] = useState(todayIso());
  const [updatedBy, setUpdatedBy] = useState(currentUserName || '');
  const [updateStatus, setUpdateStatus] = useState<CourierStatus>('In Progress');
  const [remarks, setRemarks] = useState('');

  const inputClass = 'w-full h-10 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm outline-none focus:border-primary';
  const labelClass = 'text-[10px] font-bold uppercase tracking-wider text-on-surface-variant';
  const thClass = 'px-3 py-2 border border-outline-variant bg-black text-white text-[10px] font-bold uppercase tracking-wider whitespace-nowrap';
  const tdClass = 'px-3 py-2 border border-outline-variant text-sm align-top';

  const supplierOptions = useMemo(() => suppliers.map((s) => ({ value: s.id, label: s.name })), [suppliers]);
  const projectOptions = useMemo(() => projects.map((p) => ({ value: p.id, label: p.name })), [projects]);
  const poOptions = useMemo(
    () => pos.map((p) => ({ value: p.poId, label: `${p.poNumber}${p.supplierName ? ` - ${p.supplierName}` : ''}` })),
    [pos]
  );

  const loadRows = () => {
    setLoading(true);
    setError(null);
    const ac = new AbortController();
    const load = mode === 'pending' ? fetchPendingReceiptCouriers : fetchCouriers;
    Promise.all([
      load(ac.signal),
      fetchSuppliers(ac.signal).catch(() => []),
      fetchProjects(ac.signal).catch(() => []),
      fetchOperationsPos(undefined, ac.signal).catch(() => []),
    ])
      .then(([courierRows, supplierRows, projectRows, poRows]) => {
        setRows(courierRows);
        setSuppliers(supplierRows);
        setProjects(projectRows);
        setPos(poRows);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    return () => ac.abort();
  };

  useEffect(() => loadRows(), [mode]);

  const resetAddForm = () => {
    setDate(todayIso());
    setCourierNo('');
    setSupplierId('');
    setProjectId('');
    setPoId('');
    setCourierCopyUrl('');
    setCourierCopyName('');
    setExpectedDate('');
    setFormError(null);
  };

  const openUpdate = (row: CourierRow) => {
    setUpdateFor(row);
    setUpdateDate(todayIso());
    setUpdatedBy(currentUserName || row.lastUpdateBy || '');
    setUpdateStatus(row.status || 'In Progress');
    setRemarks('');
    setFormError(null);
  };

  const openDetails = (row: CourierRow) => {
    setDetailsFor(row);
    setUpdates([]);
    setUpdatesLoading(true);
    fetchCourierUpdates(row.id)
      .then(setUpdates)
      .catch((e) => setFormError(e instanceof Error ? e.message : String(e)))
      .finally(() => setUpdatesLoading(false));
  };

  const submitAdd = async () => {
    setFormError(null);
    if (!date) return setFormError('Date is required.');
    if (!courierNo.trim()) return setFormError('Courier No. is required.');
    if (!supplierId) return setFormError('Supplier is required.');
    if (!expectedDate) return setFormError('Expected Date is required.');
    setSaving(true);
    try {
      await createCourier({
        date,
        courierNo: courierNo.trim(),
        supplierId,
        projectId: projectId || undefined,
        poId: poId || undefined,
        courierCopyUrl: courierCopyUrl || undefined,
        expectedDate,
        createdBy: currentUserName || undefined,
      });
      setAddOpen(false);
      resetAddForm();
      loadRows();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const submitUpdate = async () => {
    if (!updateFor) return;
    setFormError(null);
    if (!updateDate) return setFormError('Update Date is required.');
    if (!updatedBy.trim()) return setFormError('Update By is required.');
    setSaving(true);
    try {
      await addCourierUpdate(updateFor.id, { updateDate, updatedBy: updatedBy.trim(), status: updateStatus, remarks: remarks.trim() });
      setUpdateFor(null);
      loadRows();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const autoFillFromPo = (nextPoId: string) => {
    setPoId(nextPoId);
    const po = pos.find((p) => p.poId === nextPoId);
    if (!po) return;
    if (po.supplierId) setSupplierId(po.supplierId);
    if (po.projectId) setProjectId(po.projectId);
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden">
        <div className="p-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-headline font-bold text-sm text-on-surface">{mode === 'pending' ? 'Pending Courier' : 'Couriers'}</div>
            <div className="text-xs text-on-surface-variant">Courier Tracking</div>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'all' ? (
              <button type="button" className="btn-primary btn-sm" onClick={() => { resetAddForm(); setAddOpen(true); }}>
                <Plus size={15} className="mr-1" /> Add Courier
              </button>
            ) : null}
          </div>
        </div>

        {error ? <div className="m-4 text-sm text-error bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div> : null}

        <div className="p-4 overflow-x-auto">
          <table className="w-full min-w-[1320px] border-2 border-outline-variant border-collapse">
            <thead>
              <tr>
                <th className={thClass}>Date</th>
                <th className={thClass}>Courier No.</th>
                <th className={thClass}>Supplier</th>
                <th className={thClass}>Project No</th>
                <th className={thClass}>PO No.</th>
                <th className={thClass}>Courier Copy</th>
                <th className={thClass}>Expected Date</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Last Update Date</th>
                <th className={thClass}>Last Update By</th>
                <th className={thClass}>Last Update Remarks</th>
                <th className={thClass}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className={`${tdClass} text-center`} colSpan={12}>Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td className={`${tdClass} text-center`} colSpan={12}>No courier rows found.</td></tr>
              ) : rows.map((row) => (
                <tr key={row.id}>
                  <td className={tdClass}>{formatDate(row.date)}</td>
                  <td className={`${tdClass} font-semibold`}>{row.courierNo}</td>
                  <td className={tdClass}>{row.supplierName || row.supplierId || '-'}</td>
                  <td className={tdClass}>{row.projectName || row.projectId || '-'}</td>
                  <td className={tdClass}>{row.poNumber || row.poId || '-'}</td>
                  <td className={tdClass}>{row.courierCopyUrl ? <button type="button" className="text-primary underline" onClick={() => openDocument(fileHref(row.courierCopyUrl))}>View</button> : '-'}</td>
                  <td className={tdClass}>{formatDate(row.expectedDate)}</td>
                  <td className={tdClass}>{row.status}</td>
                  <td className={tdClass}>{formatDate(row.lastUpdateDate)}</td>
                  <td className={tdClass}>{row.lastUpdateBy || '-'}</td>
                  <td className={`${tdClass} max-w-[240px] whitespace-pre-wrap`}>{row.lastUpdateRemarks || '-'}</td>
                  <td className={tdClass}>
                    <div className="flex items-center gap-2">
                      <button type="button" className="btn btn-sm" onClick={() => openDetails(row)} title="Details"><Eye size={14} className="mr-1" /> Details</button>
                      {mode === 'pending' ? <button type="button" className="btn-primary btn-sm" onClick={() => openUpdate(row)} title="Update"><Pencil size={14} className="mr-1" /> Update</button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {addOpen ? (
        <Modal title="Add Courier" onClose={() => setAddOpen(false)}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1"><div className={labelClass}>Date</div><input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="space-y-1"><div className={labelClass}>Courier No.</div><input className={inputClass} value={courierNo} onChange={(e) => setCourierNo(e.target.value)} /></label>
            <div className="space-y-1"><div className={labelClass}>Supplier</div><SearchableSelect value={supplierId} options={supplierOptions} onChange={setSupplierId} placeholder="Select supplier..." controlClassName={inputClass} /></div>
            <div className="space-y-1"><div className={labelClass}>Project No</div><SearchableSelect value={projectId} options={projectOptions} onChange={setProjectId} placeholder="Optional" allowClear controlClassName={inputClass} /></div>
            <div className="space-y-1"><div className={labelClass}>PO No.</div><SearchableSelect value={poId} options={poOptions} onChange={autoFillFromPo} placeholder="Optional" allowClear controlClassName={inputClass} /></div>
            <label className="space-y-1"><div className={labelClass}>Expected Date</div><input className={inputClass} type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></label>
            <div className="space-y-1 md:col-span-2">
              <div className={labelClass}>Courier Copy</div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="btn btn-sm cursor-pointer select-none">
                  <Upload size={14} className="mr-1" /> Upload
                  <input
                    type="file"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setSaving(true);
                      setFormError(null);
                      try {
                        const { url } = await uploadFileToServer(file);
                        setCourierCopyUrl(url);
                        setCourierCopyName(file.name);
                      } catch (err) {
                        setFormError(err instanceof Error ? err.message : String(err));
                      } finally {
                        setSaving(false);
                      }
                    }}
                  />
                </label>
                <span className="text-sm text-on-surface-variant">{courierCopyName || (courierCopyUrl ? 'Uploaded' : 'No file chosen')}</span>
                {courierCopyUrl ? <button type="button" className="btn btn-sm" onClick={() => openDocument(fileHref(courierCopyUrl))}><FileText size={14} className="mr-1" /> View</button> : null}
              </div>
            </div>
          </div>
          {formError ? <div className="mt-4 text-sm text-error bg-red-50 border border-red-200 rounded-md px-3 py-2">{formError}</div> : null}
          <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setAddOpen(false)}>Cancel</button><button type="button" className="btn-primary" onClick={submitAdd} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></div>
        </Modal>
      ) : null}

      {updateFor ? (
        <Modal title={`Update Courier - ${updateFor.courierNo}`} onClose={() => setUpdateFor(null)}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1"><div className={labelClass}>Update Date</div><input className={inputClass} type="date" value={updateDate} onChange={(e) => setUpdateDate(e.target.value)} /></label>
            <label className="space-y-1"><div className={labelClass}>Update By</div><input className={inputClass} value={updatedBy} onChange={(e) => setUpdatedBy(e.target.value)} /></label>
            <label className="space-y-1"><div className={labelClass}>Status</div><select className={inputClass} value={updateStatus} onChange={(e) => setUpdateStatus(e.target.value as CourierStatus)}>{STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label className="space-y-1 md:col-span-2"><div className={labelClass}>Remarks</div><textarea className="w-full min-h-[110px] rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm outline-none focus:border-primary" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
          </div>
          {formError ? <div className="mt-4 text-sm text-error bg-red-50 border border-red-200 rounded-md px-3 py-2">{formError}</div> : null}
          <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setUpdateFor(null)}>Cancel</button><button type="button" className="btn-primary" onClick={submitUpdate} disabled={saving}>{saving ? 'Saving...' : 'Save Update'}</button></div>
        </Modal>
      ) : null}

      {detailsFor ? (
        <Modal title={`Courier Details - ${detailsFor.courierNo}`} onClose={() => setDetailsFor(null)}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm mb-4">
            <div><span className="font-semibold">Supplier:</span> {detailsFor.supplierName || '-'}</div>
            <div><span className="font-semibold">Status:</span> {detailsFor.status}</div>
            <div><span className="font-semibold">Expected:</span> {formatDate(detailsFor.expectedDate)}</div>
          </div>
          <table className="w-full min-w-[720px] border-2 border-outline-variant border-collapse">
            <thead><tr><th className={thClass}>Update Date</th><th className={thClass}>Update By</th><th className={thClass}>Status</th><th className={thClass}>Remarks</th></tr></thead>
            <tbody>
              {updatesLoading ? <tr><td className={`${tdClass} text-center`} colSpan={4}>Loading...</td></tr> : updates.length === 0 ? <tr><td className={`${tdClass} text-center`} colSpan={4}>No updates found.</td></tr> : updates.map((u) => (
                <tr key={u.id}><td className={tdClass}>{formatDate(u.updateDate)}</td><td className={tdClass}>{u.updatedBy}</td><td className={tdClass}>{u.status}</td><td className={`${tdClass} whitespace-pre-wrap`}>{u.remarks || '-'}</td></tr>
              ))}
            </tbody>
          </table>
        </Modal>
      ) : null}
    </div>
  );
}
