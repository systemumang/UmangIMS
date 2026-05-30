import React, { useEffect, useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Search, X } from 'lucide-react';
import {
  fetchGstNumbers,
  createGstNumber,
  updateGstNumber,
  deleteGstNumber,
  type GstNumber,
} from '@/src/lib/masters';
import { useAuth } from '@/src/lib/auth';
import { Spinner } from '@/src/components/common/Spinner';

export default function GstView() {
  const { user } = useAuth();
  const [gstNumbers, setGstNumbers] = useState<GstNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGst, setEditingGst] = useState<GstNumber | null>(null);
  const [gstValue, setGstValue] = useState('');
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    loadGstNumbers();
  }, []);

  async function loadGstNumbers() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGstNumbers();
      setGstNumbers(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load GST numbers');
    } finally {
      setLoading(false);
    }
  }

  const filteredGstNumbers = useMemo(() => {
    return gstNumbers.filter((g) =>
      g.gstNumber.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [gstNumbers, searchQuery]);

  function handleAdd() {
    setEditingGst(null);
    setGstValue('');
    setModalError(null);
    setIsModalOpen(true);
  }

  function handleEdit(gst: GstNumber) {
    setEditingGst(gst);
    setGstValue(gst.gstNumber);
    setModalError(null);
    setIsModalOpen(true);
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Are you sure you want to delete this GST number?')) return;
    try {
      await deleteGstNumber(id, { deletedBy: user?.username });
      await loadGstNumbers();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete GST number');
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!gstValue.trim()) {
      setModalError('GST Number is required');
      return;
    }

    setModalSaving(true);
    setModalError(null);
    try {
      if (editingGst) {
        await updateGstNumber(editingGst.id, {
          gstNumber: gstValue.trim(),
          updatedBy: user?.username,
        });
      } else {
        await createGstNumber({
          gstNumber: gstValue.trim(),
          createdBy: user?.username,
        });
      }
      await loadGstNumbers();
      setIsModalOpen(false);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Failed to save GST number');
    } finally {
      setModalSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
        <div>
          <h1 className="text-xl font-bold text-on-surface">GST Numbers</h1>
          <p className="text-sm text-on-surface-variant">Manage GST registration numbers</p>
        </div>
        <button
          onClick={handleAdd}
          className="flex items-center px-4 py-2 bg-primary text-on-primary rounded-lg font-semibold hover:bg-primary/90 transition-colors"
        >
          <Plus size={18} className="mr-2" />
          Add GST Number
        </button>
      </div>

      <div className="p-6 flex flex-col gap-4 overflow-hidden">
        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" size={18} />
          <input
            type="text"
            placeholder="Search GST numbers..."
            className="w-full pl-10 pr-4 py-2 bg-surface-container-low border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Spinner className="h-8 w-8" />
            </div>
          ) : error ? (
            <div className="p-8 text-center text-error">{error}</div>
          ) : filteredGstNumbers.length === 0 ? (
            <div className="p-20 text-center text-on-surface-variant">
              No GST numbers found.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant sticky top-0">
                  <th className="px-6 py-3 font-bold text-sm uppercase tracking-wider text-on-surface-variant">GST Number</th>
                  <th className="px-6 py-3 font-bold text-sm uppercase tracking-wider text-on-surface-variant text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {filteredGstNumbers.map((g) => (
                  <tr key={g.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-6 py-4 font-medium text-on-surface">{g.gstNumber}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleEdit(g)}
                          className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Pencil size={18} />
                        </button>
                        <button
                          onClick={() => handleDelete(g.id)}
                          className="p-2 text-error hover:bg-error/10 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-surface rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
              <h2 className="text-lg font-bold text-on-surface">
                {editingGst ? 'Edit GST Number' : 'Add GST Number'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              {modalError && (
                <div className="p-3 text-sm bg-error/10 text-error rounded-lg border border-error/20">
                  {modalError}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-semibold text-on-surface-variant">
                  GST Number
                </label>
                <input
                  type="text"
                  className="w-full px-4 py-2 bg-surface-container-low border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Enter GST registration number"
                  value={gstValue}
                  onChange={(e) => setGstValue(e.target.value.toUpperCase())}
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
                  disabled={modalSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-primary text-on-primary text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                  disabled={modalSaving}
                >
                  {modalSaving ? (
                    <div className="flex items-center">
                      <Spinner className="mr-2 h-4 w-4 border-2" />
                      Saving...
                    </div>
                  ) : (
                    'Save GST Number'
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
