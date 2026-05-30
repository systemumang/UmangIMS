import React, { useEffect, useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Search, X } from 'lucide-react';
import {
  fetchGstRates,
  createGstRate,
  updateGstRate,
  deleteGstRate,
  type GstRate,
} from '@/src/lib/masters';
import { type AuthUser } from '@/src/lib/auth';
import Spinner from '@/src/components/common/Spinner';

export default function GstView() {
  const user = useMemo<AuthUser | null>(() => {
    try {
      const raw = sessionStorage.getItem('ims.currentUser');
      if (!raw) return null;
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }, []);
  const [rates, setRates] = useState<GstRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<GstRate | null>(null);
  const [rateValue, setRateValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRates();
  }, []);

  async function loadRates() {
    try {
      setLoading(true);
      const data = await fetchGstRates();
      setRates(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const filteredRates = useMemo(() => {
    return rates.filter((r) => 
      String(r.rate).toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [rates, searchQuery]);

  function handleAdd() {
    setEditingRate(null);
    setRateValue('');
    setError(null);
    setIsModalOpen(true);
  }

  function handleEdit(rate: GstRate) {
    setEditingRate(rate);
    setRateValue(String(rate.rate));
    setError(null);
    setIsModalOpen(true);
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this GST rate?')) return;
    try {
      await deleteGstRate(id, { deletedBy: user?.name });
      setRates(rates.filter((r) => r.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to delete');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numericRate = parseFloat(rateValue);
    if (isNaN(numericRate)) {
      setError('Please enter a valid numeric rate');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      if (editingRate) {
        await updateGstRate(editingRate.id, { rate: numericRate, updatedBy: user?.name });
      } else {
        await createGstRate({ rate: numericRate, createdBy: user?.name });
      }
      await loadRates();
      setIsModalOpen(false);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">GST Rates</h1>
          <p className="text-sm text-on-surface-variant">Manage tax percentage master</p>
        </div>
        <button
          onClick={handleAdd}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          Add GST Rate
        </button>
      </div>

      <div className="bg-surface-container rounded-xl border border-outline-variant/10 overflow-hidden">
        <div className="p-4 border-b border-outline-variant/10 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" size={18} />
            <input
              type="text"
              placeholder="Search rates..."
              className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg pl-10 pr-4 py-2 text-sm outline-none focus:border-primary/50"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-container-high text-on-surface-variant">
              <tr>
                <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[11px]">GST Rate (%)</th>
                <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[11px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {loading ? (
                <tr>
                  <td colSpan={2} className="px-6 py-8 text-center">
                    <Spinner className="mx-auto h-8 w-8" />
                  </td>
                </tr>
              ) : filteredRates.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-6 py-8 text-center text-on-surface-variant">
                    No GST rates found.
                  </td>
                </tr>
              ) : (
                filteredRates.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-container-low transition-colors group">
                    <td className="px-6 py-4 font-medium text-on-surface text-lg">
                      {r.rate}%
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleEdit(r)}
                          className="p-2 hover:bg-primary/10 text-primary rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Pencil size={18} />
                        </button>
                        <button
                          onClick={() => handleDelete(r.id)}
                          className="p-2 hover:bg-error/10 text-error rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface-container rounded-2xl border border-outline-variant/20 shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between p-4 border-b border-outline-variant/10 bg-surface-container-high">
              <h3 className="font-bold text-lg text-on-surface">
                {editingRate ? 'Edit GST Rate' : 'Add GST Rate'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 hover:bg-on-surface/10 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-error/10 text-error text-xs flex items-center gap-2">
                  <span>{error}</span>
                </div>
              )}
              
              <div className="space-y-2">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                  Rate Percentage (%)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  autoFocus
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3 text-lg outline-none focus:border-primary/50 transition-all font-semibold"
                  placeholder="e.g. 18"
                  value={rateValue}
                  onChange={(e) => setRateValue(e.target.value)}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-outline-variant/30 text-sm font-semibold hover:bg-on-surface/5 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 btn-primary py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {submitting ? (
                    <div className="flex items-center gap-2">
                      <Spinner className="h-4 w-4 border-2" />
                      <span>Saving...</span>
                    </div>
                  ) : (
                    'Save GST Rate'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
