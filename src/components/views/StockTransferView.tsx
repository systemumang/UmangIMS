import React, { useEffect, useMemo, useState } from 'react';
import { fetchFirms, type Firm } from '@/src/lib/purchaseRequests';
import { createTransfer } from '@/src/lib/stockMaster';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import Spinner from '@/src/components/common/Spinner';
import { Trash2 } from 'lucide-react';
import { fetchDepartments, fetchItems, fetchUsers, type Department, type Item, type User } from '@/src/lib/masters';

export default function StockTransferView({
  onCreated,
  onCancel,
}: {
  onCreated: (newId?: string) => void;
  onCancel: () => void;
}) {
  type ItemDraft = { itemId: string; item: string; quantity: string };

  function formatSpecsLines(specificationsJson: string) {
    try {
      const obj = JSON.parse(specificationsJson) as Record<string, unknown>;
      const entries = Object.entries(obj);
      return entries.map(([k, v]) => `${k}: ${String(v ?? '')}`).filter(Boolean);
    } catch {
      return specificationsJson
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  function formatItemInline(itemName: string, specificationsJson: string) {
    const specs = formatSpecsLines(specificationsJson);
    return [itemName, ...specs].join(' - ');
  }

  const [firms, setFirms] = useState<Firm[]>([]);
  const [loadingFirms, setLoadingFirms] = useState(true);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingDepartments, setLoadingDepartments] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [masterItems, setMasterItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);

  const [fromFirmId, setFromFirmId] = useState('');
  const [fromDepartmentId, setFromDepartmentId] = useState('');
  const [toFirmId, setToFirmId] = useState('');
  const [toDepartmentId, setToDepartmentId] = useState('');
  const [transferByUserId, setTransferByUserId] = useState('');
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [items, setItems] = useState<ItemDraft[]>([{ itemId: '', item: '', quantity: '' }]);
  const [itemRowErrors, setItemRowErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoadingFirms(true);
    fetchFirms(ac.signal)
      .then(setFirms)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingFirms(false));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoadingDepartments(true);
    fetchDepartments(ac.signal)
      .then(setDepartments)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingDepartments(false));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoadingUsers(true);
    fetchUsers(ac.signal)
      .then(setUsers)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingUsers(false));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoadingItems(true);
    fetchItems(ac.signal)
      .then(setMasterItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingItems(false));
    return () => ac.abort();
  }, []);

  const firmOptions = useMemo(
    () => firms.map((f) => ({ value: f.id, label: f.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [firms]
  );
  const deptOptions = useMemo(
    () => departments.map((d) => ({ value: d.id, label: d.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [departments]
  );
  const userOptions = useMemo(
    () => users.map((u) => ({ value: u.id, label: u.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [users]
  );

  const itemOptions = useMemo(() => {
    return masterItems
      .map((it) => ({
        value: it.id,
        label: formatItemInline(it.itemName, it.specificationsJson),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [masterItems]);

  const fromFirmName = useMemo(() => firms.find((f) => f.id === fromFirmId)?.name ?? fromFirmId, [firms, fromFirmId]);
  const toFirmName = useMemo(() => firms.find((f) => f.id === toFirmId)?.name ?? toFirmId, [firms, toFirmId]);
  const fromDepartment = useMemo(
    () => departments.find((d) => d.id === fromDepartmentId)?.name ?? fromDepartmentId,
    [departments, fromDepartmentId]
  );
  const toDepartment = useMemo(
    () => departments.find((d) => d.id === toDepartmentId)?.name ?? toDepartmentId,
    [departments, toDepartmentId]
  );
  const transferBy = useMemo(
    () => users.find((u) => u.id === transferByUserId)?.name ?? transferByUserId,
    [users, transferByUserId]
  );

  const computeItems = (rows: ItemDraft[]) => {
    const normalized: Array<{ itemId: string; item: string; quantity: number }> = [];
    const errors: string[] = [];

    for (const row of rows) {
      const qty = Number.parseFloat(row.quantity || '0');
      const hasAny = Boolean(row.itemId.trim() || row.item.trim() || row.quantity.trim());
      if (!hasAny) continue;

      if (!row.itemId.trim()) {
        errors.push('Please select item for all filled rows.');
        continue;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        errors.push('Please enter Qty > 0 for all selected items.');
        continue;
      }
      normalized.push({
        itemId: row.itemId,
        item: row.item,
        quantity: qty,
      });
    }

    return { normalized, errors };
  };

  const computed = useMemo(() => computeItems(items), [items]);

  useEffect(() => {
    setItemRowErrors(computed.errors);
  }, [computed.errors]);

  const canSave = useMemo(() => {
    if (!fromFirmId.trim()) return false;
    if (!fromDepartmentId.trim()) return false;
    if (!toFirmId.trim()) return false;
    if (!toDepartmentId.trim()) return false;
    if (!transferByUserId.trim()) return false;
    if (!transferDate.trim()) return false;
    return computed.normalized.length > 0 && computed.errors.length === 0;
  }, [fromFirmId, fromDepartmentId, toFirmId, toDepartmentId, transferByUserId, transferDate, computed.normalized.length, computed.errors.length]);

  return (
    <div className="space-y-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden">
        <div className="p-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <div className="font-headline font-bold text-sm text-on-surface">Stock Transfer</div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-sm" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
              disabled={saving || !canSave}
              onClick={() => {
                if (saving) return;
                setError(null);
                const { normalized: normalizedItems, errors: rowErrors } = computeItems(items);
                if (!fromFirmId.trim() || !fromDepartmentId.trim() || !toFirmId.trim() || !toDepartmentId.trim() || !transferByUserId.trim() || !transferDate.trim()) {
                  setError('Please fill From Firm, From Department, To Firm, To Department, Transfer By, and Transfer Date.');
                  return;
                }
                if (!normalizedItems.length || rowErrors.length) {
                  setItemRowErrors(rowErrors);
                  setError('Please add at least one valid item row.');
                  return;
                }

                setSaving(true);
                createTransfer({
                  firmId: fromFirmName,
                  department: fromDepartment,
                  toFirmId: toFirmName,
                  toDepartment,
                  person: transferBy,
                  date: transferDate,
                  items: normalizedItems.map((it) => ({
                    item: it.item,
                    quantity: it.quantity,
                    specification: '',
                  })),
                })
                  .then((row) => onCreated(row.id))
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSaving(false));
              }}
            >
              {saving ? 'Saving...' : 'Save Transfer'}
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {error ? (
            <div className="rounded-lg border border-error/30 bg-error/10 text-error text-sm px-3 py-2">{error}</div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <label className="block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">From Firm</div>
              {loadingFirms ? (
                <div className="mt-2 flex items-center gap-2 text-on-surface-variant text-sm">
                  <Spinner className="h-4 w-4" /> Loading...
                </div>
              ) : (
                <SearchableSelect value={fromFirmId} options={firmOptions} onChange={setFromFirmId} placeholder="Search firm..." />
              )}
            </label>

            <label className="block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">From Department</div>
              {loadingDepartments ? (
                <div className="mt-2 flex items-center gap-2 text-on-surface-variant text-sm">
                  <Spinner className="h-4 w-4" /> Loading...
                </div>
              ) : (
                <SearchableSelect
                  value={fromDepartmentId}
                  options={deptOptions}
                  onChange={setFromDepartmentId}
                  placeholder="Search department..."
                />
              )}
            </label>

            <label className="block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Transfer By</div>
              {loadingUsers ? (
                <div className="mt-2 flex items-center gap-2 text-on-surface-variant text-sm">
                  <Spinner className="h-4 w-4" /> Loading...
                </div>
              ) : (
                <SearchableSelect value={transferByUserId} options={userOptions} onChange={setTransferByUserId} placeholder="Search user..." />
              )}
            </label>

            <label className="block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">To Firm</div>
              {loadingFirms ? (
                <div className="mt-2 flex items-center gap-2 text-on-surface-variant text-sm">
                  <Spinner className="h-4 w-4" /> Loading...
                </div>
              ) : (
                <SearchableSelect value={toFirmId} options={firmOptions} onChange={setToFirmId} placeholder="Search firm..." />
              )}
            </label>

            <label className="block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">To Department</div>
              {loadingDepartments ? (
                <div className="mt-2 flex items-center gap-2 text-on-surface-variant text-sm">
                  <Spinner className="h-4 w-4" /> Loading...
                </div>
              ) : (
                <SearchableSelect
                  value={toDepartmentId}
                  options={deptOptions}
                  onChange={setToDepartmentId}
                  placeholder="Search department..."
                />
              )}
            </label>

            <label className="block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Transfer Date</div>
              <input
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                className="w-full mt-2 bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface-variant shadow-sm outline-none focus:border-outline-variant focus:ring-2 focus:ring-outline-variant/15"
              />
            </label>
          </div>

          <div className="rounded-xl border border-outline-variant overflow-hidden">
            <div className="p-3 bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
              Items
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-surface-container-low text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
                  <tr>
                    <th className="p-3 border-b border-outline-variant">Item</th>
                    <th className="p-3 border-b border-outline-variant text-right">Qty</th>
                    <th className="p-3 border-b border-outline-variant text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {items.map((row, idx) => (
                    <tr key={idx} className="hover:bg-surface-container-low/50">
                      <td className="p-3 min-w-[320px]">
                        {loadingItems ? (
                          <div className="flex items-center gap-2 text-on-surface-variant text-sm">
                            <Spinner className="h-4 w-4" /> Loading...
                          </div>
                        ) : (
                          <SearchableSelect
                            value={row.itemId}
                            options={itemOptions}
                            onChange={(v) => {
                              const selected = masterItems.find((m) => m.id === v) ?? null;
                              setItems((prev) =>
                                prev.map((p, i) =>
                                  i !== idx
                                    ? p
                                    : {
                                        ...p,
                                        itemId: v,
                                        item: selected ? formatItemInline(selected.itemName, selected.specificationsJson) : p.item,
                                      }
                                )
                              );
                            }}
                            placeholder="Search item..."
                            allowClear
                          />
                        )}
                      </td>
                      <td className="p-3 text-right w-[120px]">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={row.quantity}
                          onChange={(e) => setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, quantity: e.target.value } : p)))}
                          className="w-28 text-right bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface-variant shadow-sm outline-none focus:border-outline-variant focus:ring-2 focus:ring-outline-variant/15"
                          placeholder="0"
                        />
                      </td>
                      <td className="p-3 text-right w-[90px]">
                        <button
                          type="button"
                          className="text-error hover:text-error/80 transition-colors disabled:opacity-50"
                          title="Remove"
                          disabled={items.length === 1}
                          onClick={() => {
                            setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-outline-variant bg-surface-container-low flex items-center justify-between">
              <div className="text-xs text-on-surface-variant">
                {itemRowErrors.length ? itemRowErrors[0] : 'Add items to transfer.'}
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setItems((prev) => [...prev, { itemId: '', item: '', quantity: '' }])}
              >
                + Add Row
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
