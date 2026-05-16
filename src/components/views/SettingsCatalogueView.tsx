import React, { useEffect, useState } from 'react';
import Spinner from '@/src/components/common/Spinner';

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

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/links');
      const data = await res.json();
      if (!res.ok) throw new Error(String(data?.error ?? 'Failed to load catalogue'));
      const next = Array.isArray(data?.links) ? (data.links as CatalogueRow[]) : [];
      setRows(next);
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
            {saving ? 'Saving...' : 'Upload'}
          </button>
        </div>
        {error ? <div className="text-xs text-error mt-2">{error}</div> : null}
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-5">
        <div className="text-sm text-on-surface-variant mb-3">Links</div>
        <div className="overflow-auto">
          <table className="min-w-[720px] w-full text-sm border-collapse border border-blue-600">
            <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
              <tr>
                <th className="text-left px-3 py-2 border border-blue-600">Name</th>
                <th className="text-left px-3 py-2 border border-blue-600">Link</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 border border-blue-600">{row.name}</td>
                    <td className="px-3 py-2 border border-blue-600">
                      <a href={row.link} target="_blank" rel="noreferrer" className="text-primary underline break-all">
                        {row.link}
                      </a>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-2 border border-blue-600 text-on-surface-variant" colSpan={2}>No link uploaded.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
