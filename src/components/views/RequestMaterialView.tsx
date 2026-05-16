import React, { useEffect, useMemo, useState } from 'react';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import Spinner from '@/src/components/common/Spinner';
import {
  fetchCustomers,
  fetchItemNames,
  fetchItems,
  fetchProjects,
  fetchSpecificationValues,
  fetchSpecifications,
  fetchSuppliers,
  fetchUsers,
  type Customer,
  type Item,
  type ItemName,
  type Project,
  type Specification,
  type SpecificationValue,
  type Supplier,
  type User,
} from '@/src/lib/masters';
import { createMaterialRequest } from '@/src/lib/materialRequests';
import { Plus, Trash2, X } from 'lucide-react';

export default function RequestMaterialView() {
  type Row = {
    itemId: string;
    itemNameId: string;
    specs: Record<string, string>;
    quantity: string;
  };

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [customerId, setCustomerId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [requestByType, setRequestByType] = useState<'Inhouse' | 'Vendor'>('Inhouse');
  const [requestByUserId, setRequestByUserId] = useState('');
  const [requestBySupplierId, setRequestBySupplierId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [rows, setRows] = useState<Row[]>([{ itemId: '', itemNameId: '', specs: {}, quantity: '' }]);
  const [rowErrors, setRowErrors] = useState<string[]>([]);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [itemNames, setItemNames] = useState<ItemName[]>([]);
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [specValueOptions, setSpecValueOptions] = useState<Record<string, SpecificationValue[]>>({});
  const [masterItems, setMasterItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [c, p, s, u, itemNameRows, specRows, i] = await Promise.all([
          fetchCustomers(),
          fetchProjects(),
          fetchSuppliers(),
          fetchUsers(),
          fetchItemNames(),
          fetchSpecifications(),
          fetchItems()
        ]);
        setCustomers(c);
        setProjects(p);
        setSuppliers(s.filter(it => it.isVendor));
        setUsers(u);
        setItemNames(itemNameRows);
        setSpecs(specRows);
        setMasterItems(i);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const specNameById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);

  const getItemNameSpecIds = (itemNameId: string): string[] => {
    const row = itemNames.find((n) => n.id === itemNameId);
    const ids = Array.isArray((row as any)?.specificationIds) ? ((row as any).specificationIds as any[]).map((x) => String(x)) : [];
    return ids.filter(Boolean);
  };

  const specValueKey = (itemNameId: string, specificationId: string) => `${itemNameId}::${specificationId}`;

  const parseSpecObject = (specificationsJson: string) => {
    try {
      const parsed = JSON.parse(specificationsJson || '{}');
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  const formatSpecsLines = (specificationsJson: string) => {
    const specObj = parseSpecObject(specificationsJson);
    return Object.entries(specObj)
      .map(([specId, value]) => {
        const name = specNameById?.[specId] ?? specId;
        const v = String(value ?? '').trim();
        if (!v) return '';
        return `${name}: ${v}`;
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  };

  const resolveSelectedItem = (itemNameId: string, specValues: Record<string, string>) => {
    if (!itemNameId) return null;
    const specIds = getItemNameSpecIds(itemNameId);
    const candidates = masterItems.filter((it) => it.itemNameId === itemNameId);
    if (!candidates.length) return null;
    if (!specIds.length) return candidates[0] ?? null;
    if (specIds.some((specId) => !String(specValues?.[specId] ?? '').trim())) return null;
    return (
      candidates.find((it) => {
        const saved = parseSpecObject(it.specificationsJson);
        return specIds.every((specId) => String(saved[specId] ?? '').trim() === String(specValues?.[specId] ?? '').trim());
      }) ?? null
    );
  };

  const handleAddItem = () => {
    setRows((prev) => [...prev, { itemId: '', itemNameId: '', specs: {}, quantity: '' }]);
    setRowErrors((prev) => [...prev, '']);
  };

  const handleRemoveItem = (index: number) => {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
    setRowErrors((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const nextErrors: string[] = [];
      const payloadItems = rows
        .map((row, idx) => {
          const itemId = String(row.itemId ?? '').trim();
          const quantity = Number(row.quantity);
          if (!itemId) nextErrors[idx] = 'Select item and specifications.';
          else if (!Number.isFinite(quantity) || quantity <= 0) nextErrors[idx] = 'Enter valid quantity.';
          const matched = masterItems.find((it) => it.id === itemId);
          return {
            itemId,
            quantity,
            specification: matched ? formatSpecsLines(matched.specificationsJson) : '',
          };
        })
        .filter((row, idx) => !nextErrors[idx]);
      setRowErrors(nextErrors);
      if (!payloadItems.length) {
        throw new Error('Please add at least one valid item row.');
      }

      await createMaterialRequest({
        date,
        customerId: customerId || null,
        projectId: projectId || null,
        requestByType,
        requestByUserId: requestByType === 'Inhouse' ? requestByUserId : null,
        requestBySupplierId: requestByType === 'Vendor' ? requestBySupplierId : null,
        remarks,
        items: payloadItems,
      });
      setSuccess(true);
      // Reset form
      setCustomerId('');
      setProjectId('');
      setRequestByUserId('');
      setRequestBySupplierId('');
      setRemarks('');
      setRows([{ itemId: '', itemNameId: '', specs: {}, quantity: '' }]);
      setRowErrors([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 flex justify-center"><Spinner /></div>;

  return (
    <div className="p-4 max-w-5xl mx-auto">
      {success && (
        <div className="mb-4 p-3 bg-success-container text-on-success-container rounded-lg flex justify-between items-center">
          <span>Material Request created successfully!</span>
          <button onClick={() => setSuccess(false)}><X size={18} /></button>
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-error-container text-on-error-container rounded-lg flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X size={18} /></button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-outline-variant/10 bg-surface-container-low">
          <h2 className="text-lg font-bold text-on-surface">New Material Request</h2>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="block space-y-1">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Date</span>
              <input
                type="date"
                className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Customer</span>
              <SearchableSelect
                options={customers.map(c => ({ value: c.id, label: c.name }))}
                value={customerId}
                onChange={setCustomerId}
                placeholder="Select Customer"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Project</span>
              <SearchableSelect
                options={projects.map(p => ({ value: p.id, label: p.name }))}
                value={projectId}
                onChange={setProjectId}
                placeholder="Select Project"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-outline-variant/10 pt-4">
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block">Request By Type</span>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="requestByType"
                    checked={requestByType === 'Inhouse'}
                    onChange={() => setRequestByType('Inhouse')}
                  />
                  <span className="text-sm">Inhouse</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="requestByType"
                    checked={requestByType === 'Vendor'}
                    onChange={() => setRequestByType('Vendor')}
                  />
                  <span className="text-sm">Vendor</span>
                </label>
              </div>
            </div>

            {requestByType === 'Inhouse' ? (
              <label className="block space-y-1">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">User</span>
                <SearchableSelect
                  options={users.map(u => ({ value: u.id, label: u.name }))}
                  value={requestByUserId}
                  onChange={setRequestByUserId}
                  placeholder="Select User"
                />
              </label>
            ) : (
              <label className="block space-y-1">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Vendor</span>
                <SearchableSelect
                  options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                  value={requestBySupplierId}
                  onChange={setRequestBySupplierId}
                  placeholder="Select Vendor"
                />
              </label>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Remarks</span>
            <textarea
              className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm min-h-[80px]"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="Any additional information..."
            />
          </label>

          <div className="space-y-4 pt-4 border-t border-outline-variant/10">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider">Items</h3>
              <button
                type="button"
                onClick={handleAddItem}
                className="inline-flex items-center gap-2 text-xs font-bold text-primary hover:bg-primary/5 px-2 py-1 rounded"
              >
                <Plus size={14} /> Add Item
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="bg-surface-container-low">
                    <th className="px-3 py-2 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider border border-outline-variant/20">Item</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider border border-outline-variant/20">Specification</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider border border-outline-variant/20 w-32">Qty</th>
                    <th className="px-3 py-2 border border-outline-variant/20 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index}>
                      <td className="p-1 border border-outline-variant/20">
                        <SearchableSelect
                          options={itemNames.map((i) => ({ value: i.id, label: i.name }))}
                          value={row.itemNameId}
                          onChange={(itemNameId) => {
                            const specIds = itemNameId ? getItemNameSpecIds(itemNameId) : [];
                            for (const specId of specIds) {
                              const key = specValueKey(itemNameId, specId);
                              if ((specValueOptions[key] ?? []).length) continue;
                              fetchSpecificationValues(specId, { itemNameId })
                                .then((vals) => setSpecValueOptions((m) => ({ ...m, [key]: vals })))
                                .catch(() => {});
                            }
                            setRowErrors((prev) => prev.map((m, i) => (i === index ? '' : m)));
                            setRows((prev) => prev.map((p, i) => (i === index ? { ...p, itemNameId, itemId: '', specs: {} } : p)));
                          }}
                          placeholder="Search item name..."
                        />
                      </td>
                      <td className="p-1 border border-outline-variant/20">
                        {row.itemNameId ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1">
                            {getItemNameSpecIds(row.itemNameId).map((specId) => {
                              const specName = specNameById?.[specId] ?? specId;
                              const value = String(row.specs?.[specId] ?? '');
                              const key = specValueKey(row.itemNameId, specId);
                              const options = (specValueOptions[key] ?? []).map((v) => ({ value: v.value, label: v.value }));
                              if (value && !options.some((opt) => opt.value === value)) options.unshift({ value, label: value });
                              return (
                                <label key={`${index}-${specId}`} className="space-y-1">
                                  <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{specName}</div>
                                  <SearchableSelect
                                    value={value}
                                    options={options}
                                    placeholder="Select value..."
                                    onChange={(selectedValue) => {
                                      setRowErrors((prev) => prev.map((m, i) => (i === index ? '' : m)));
                                      setRows((prev) =>
                                        prev.map((p, i) => {
                                          if (i !== index) return p;
                                          const nextSpecs = { ...(p.specs ?? {}), [specId]: selectedValue };
                                          const matched = resolveSelectedItem(p.itemNameId, nextSpecs);
                                          return { ...p, specs: nextSpecs, itemId: matched?.id ?? '' };
                                        })
                                      );
                                    }}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="px-2 py-1 text-sm text-on-surface-variant">Select Item Name first</div>
                        )}
                      </td>
                      <td className="p-1 border border-outline-variant/20">
                        <input
                          type="number"
                          className="w-full bg-transparent px-2 py-1 text-sm outline-none"
                          value={row.quantity}
                          onChange={e => {
                            const quantity = String(e.target.value ?? '');
                            setRowErrors((prev) => prev.map((m, i) => (i === index ? '' : m)));
                            setRows((prev) => prev.map((p, i) => (i === index ? { ...p, quantity } : p)));
                          }}
                          min="0.001"
                          step="any"
                        />
                        {rowErrors[index] ? <div className="text-[11px] text-error px-2 pb-1">{rowErrors[index]}</div> : null}
                      </td>
                      <td className="p-1 border border-outline-variant/20 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(index)}
                          className="text-error hover:bg-error/5 p-1 rounded"
                          disabled={items.length === 1}
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

        <div className="p-6 bg-surface-container-low border-t border-outline-variant/10 flex justify-end gap-3">
          <button
            type="submit"
            disabled={saving}
            className="bg-primary text-on-primary px-6 py-2 rounded-lg font-bold text-sm shadow-sm hover:shadow transition-shadow disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving ? <Spinner className="h-4 w-4" /> : null}
            Submit Material Request
          </button>
        </div>
      </form>
    </div>
  );
}
