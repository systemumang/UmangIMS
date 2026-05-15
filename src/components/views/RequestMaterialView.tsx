import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchFirms, type Firm } from '@/src/lib/purchaseRequests';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import Spinner from '@/src/components/common/Spinner';
import { fetchCustomers, fetchProjects, fetchSuppliers, fetchUsers, type Customer, type Project, type Supplier, type User } from '@/src/lib/masters';
import { createMaterialRequest } from '@/src/lib/materialRequests';
import { fetchItems, type Item } from '@/src/lib/masters';
import { Plus, Trash2, X } from 'lucide-react';

export default function RequestMaterialView() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [customerId, setCustomerId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [requestByType, setRequestByType] = useState<'Inhouse' | 'Vendor'>('Inhouse');
  const [requestByUserId, setRequestByUserId] = useState('');
  const [requestBySupplierId, setRequestBySupplierId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [items, setItems] = useState<Array<{ itemId: string; specification: string; quantity: number }>>([
    { itemId: '', specification: '', quantity: 1 }
  ]);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [masterItems, setMasterItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [c, p, s, u, i] = await Promise.all([
          fetchCustomers(),
          fetchProjects(),
          fetchSuppliers(),
          fetchUsers(),
          fetchItems()
        ]);
        setCustomers(c);
        setProjects(p);
        setSuppliers(s.filter(it => it.isVendor));
        setUsers(u);
        setMasterItems(i);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleAddItem = () => {
    setItems([...items, { itemId: '', specification: '', quantity: 1 }]);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    const next = [...items];
    next[index] = { ...next[index], [field]: value };
    setItems(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createMaterialRequest({
        date,
        customerId: customerId || null,
        projectId: projectId || null,
        requestByType,
        requestByUserId: requestByType === 'Inhouse' ? requestByUserId : null,
        requestBySupplierId: requestByType === 'Vendor' ? requestBySupplierId : null,
        remarks,
        items: items.filter(it => it.itemId && it.quantity > 0)
      });
      setSuccess(true);
      // Reset form
      setCustomerId('');
      setProjectId('');
      setRequestByUserId('');
      setRequestBySupplierId('');
      setRemarks('');
      setItems([{ itemId: '', specification: '', quantity: 1 }]);
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
                  {items.map((item, index) => (
                    <tr key={index}>
                      <td className="p-1 border border-outline-variant/20">
                        <SearchableSelect
                          options={masterItems.map(i => ({ value: i.id, label: (i.itemName || '') + ' - ' + (i.itemCode || '') }))}
                          value={item.itemId}
                          onChange={val => handleItemChange(index, 'itemId', val)}
                          placeholder="Select Item"
                        />
                      </td>
                      <td className="p-1 border border-outline-variant/20">
                        <input
                          className="w-full bg-transparent px-2 py-1 text-sm outline-none"
                          value={item.specification}
                          onChange={e => handleItemChange(index, 'specification', e.target.value)}
                          placeholder="Specification"
                        />
                      </td>
                      <td className="p-1 border border-outline-variant/20">
                        <input
                          type="number"
                          className="w-full bg-transparent px-2 py-1 text-sm outline-none"
                          value={item.quantity}
                          onChange={e => handleItemChange(index, 'quantity', Number(e.target.value))}
                          min="0.001"
                          step="any"
                        />
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
