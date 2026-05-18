import React, { useEffect, useMemo, useState } from 'react';
import Spinner from '@/src/components/common/Spinner';
import { Trash2 } from 'lucide-react';

type CatalogueRow = {
  id: string;
  name: string;
  link: string;
  updatedAt?: string | null;
};

export default function SettingsCatalogueView() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [rows, setRows] = useState<CatalogueRow[]>([]);
  const [search, setSearch] = useState('');

	  const load = async () => {
	    setLoading(true);
	    setError(null);
	    try {
	      const res = await fetch('/api/settings/links');
	      const data = await res.json();
	      if (!res.ok) throw new Error(String(data?.error ?? 'Failed to load catalogue'));
	      const next = Array.isArray(data?.links) ? (data.links as CatalogueRow[]) : [];
	      setRows(next);
	      try {
	        const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
	        const isCatalogueName = (name: unknown) => {
	          const n = norm(name);
	          return n === 'catelouge' || n === 'catelogue' || n === 'catalogue' || n === 'catalog';
	        };
	        const found = next.find((r) => isCatalogueName((r as any)?.name));
	        const url = String(found?.link ?? '').trim();
	        if (url) localStorage.setItem('ims.settings.catelougeLink', url);
	      } catch {}
	    } catch (e) {
	      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), link: link.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data?.error ?? 'Failed to save catalogue'));
      setName('');
      setLink('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/settings/links/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((data as any)?.error ?? 'Failed to delete link'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const filteredRows = useMemo(() => {
    const q = String(search ?? '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.name ?? '').toLowerCase().includes(q) || String(r.link ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  if (loading) return <div className="p-8 flex justify-center"><Spinner /></div>;

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-5">
        <div className="text-sm font-bold text-on-surface mb-3 uppercase tracking-wider">Settings</div>
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-3">
          <input
            className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
          />
          <input
            className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://..."
          />
          <button
            type="button"
            className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
            disabled={saving || !name.trim() || !link.trim()}
            onClick={onSave}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        {error ? <div className="text-xs text-error mt-2">{error}</div> : null}
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-5">
        <div className="text-sm text-on-surface-variant mb-3">Links</div>
        <div className="mb-3">
          <input
            className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search links..."
          />
        </div>
        <div className="overflow-auto">
          <table className="min-w-[720px] w-full text-sm border-collapse border border-blue-600">
            <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
              <tr>
                <th className="text-left px-3 py-2 border border-blue-600">Name</th>
                <th className="text-left px-3 py-2 border border-blue-600">Link</th>
                <th className="text-left px-3 py-2 border border-blue-600 w-[80px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length ? (
                filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 border border-blue-600">{row.name}</td>
                    <td className="px-3 py-2 border border-blue-600">
                      <a href={row.link} target="_blank" rel="noreferrer" className="text-primary underline break-all">
                        {row.link}
                      </a>
                    </td>
                    <td className="px-3 py-2 border border-blue-600">
                      <button
                        type="button"
                        className="inline-flex items-center justify-center w-8 h-8 rounded bg-red-600 text-white hover:bg-red-700"
                        title="Delete link"
                        onClick={() => onDelete(row.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-2 border border-blue-600 text-on-surface-variant" colSpan={3}>No link uploaded.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
