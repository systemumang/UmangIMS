import React, { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { createVehicle, deleteVehicle, fetchVehicles, updateVehicle, type Vehicle } from '@/src/lib/masters';

export default function VehicleMasterView({ currentUserName = '' }: { currentUserName?: string }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleNo, setVehicleNo] = useState('');
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => fetchVehicles().then(setVehicles).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void load(); }, []);
  const filtered = vehicles.filter((v) => v.vehicleNo.toLowerCase().includes(query.trim().toLowerCase()));
  const reset = () => { setEditing(null); setVehicleNo(''); setError(''); };
  const save = async () => {
    const value = vehicleNo.trim().toUpperCase();
    if (!value) return setError('Vehicle No. is required.');
    setSaving(true); setError('');
    try {
      if (editing) await updateVehicle(editing.id, { vehicleNo: value, updatedBy: currentUserName || undefined });
      else await createVehicle({ vehicleNo: value, createdBy: currentUserName || undefined });
      reset(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  return <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm p-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="font-headline font-bold text-lg">Vehicle Master</div><div className="text-sm text-on-surface-variant">Manage vehicle numbers used for courier collection.</div></div>
      <div className="text-sm text-on-surface-variant">{filtered.length} / {vehicles.length} vehicles</div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 rounded-lg bg-surface-container-low p-4 items-end">
      <label className="space-y-1"><div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Vehicle No.</div><input className="w-full h-10 rounded-md border border-outline-variant bg-surface-container-lowest px-3 text-sm outline-none focus:border-primary" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="e.g. DL 01 AB 1234" /></label>
      <button type="button" className="btn-primary min-h-10 px-4" onClick={() => void save()} disabled={saving}>{editing ? 'Save Vehicle' : <><Plus size={16} /> Add Vehicle</>}</button>
      {editing ? <button type="button" className="btn min-h-10 px-4" onClick={reset}>Cancel</button> : null}
    </div>
    {error ? <div className="text-sm text-error bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div> : null}
    <div className="flex justify-end"><input className="w-full sm:w-72 h-10 rounded-md border border-outline-variant bg-surface-container-low px-3 text-sm outline-none" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search vehicle no..." /></div>
    <div className="overflow-x-auto"><table className="w-full border-collapse border border-outline-variant"><thead><tr className="bg-black text-white"><th className="px-3 py-2 text-left text-xs">#</th><th className="px-3 py-2 text-left text-xs">Vehicle No.</th><th className="px-3 py-2 text-center text-xs">Action</th></tr></thead><tbody>{filtered.length ? filtered.map((vehicle, index) => <tr key={vehicle.id}><td className="px-3 py-2 border border-outline-variant">{index + 1}</td><td className="px-3 py-2 border border-outline-variant font-medium">{vehicle.vehicleNo}</td><td className="px-3 py-2 border border-outline-variant"><div className="flex justify-center gap-2"><button type="button" className="btn btn-sm" onClick={() => { setEditing(vehicle); setVehicleNo(vehicle.vehicleNo); setError(''); }} title="Edit"><Pencil size={14} /></button><button type="button" className="btn btn-sm text-error" onClick={() => { if (confirm(`Delete vehicle ${vehicle.vehicleNo}?`)) void deleteVehicle(vehicle.id).then(load).catch((e) => setError(e instanceof Error ? e.message : String(e))); }} title="Delete"><Trash2 size={14} /></button></div></td></tr>) : <tr><td className="px-3 py-4 text-center text-sm" colSpan={3}>No vehicles found.</td></tr>}</tbody></table></div>
  </div>;
}
