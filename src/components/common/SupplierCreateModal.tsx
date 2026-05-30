import React, { useEffect, useMemo, useState } from 'react';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import GstSelect from '@/src/components/common/GstSelect';
import {
  createCity,
  createState,
  createSupplier,
  fetchCities,
  fetchStates,
  type City,
  type State,
  type Supplier,
} from '@/src/lib/masters';

const inputClass =
  'w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none';

function normalizeTenDigitPhoneInput(value: string) {
  return value.replace(/\D/g, '').slice(0, 10);
}

function isValidTenDigitPhone(value: string) {
  return /^\d{10}$/.test(value);
}

export default function SupplierCreateModal({
  initialName = '',
  onClose,
  onCreated,
}: {
  initialName?: string;
  onClose: () => void;
  onCreated: (supplier: Supplier) => void;
}) {
  const [name, setName] = useState(initialName);
  const [gstNumber, setGstNumber] = useState('');
  const [gstType, setGstType] = useState<'Intra-State' | 'Inter-State'>('Intra-State');
  const [creditVoucherApplicable, setCreditVoucherApplicable] = useState(false);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [mobile2, setMobile2] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactPersonMobile, setContactPersonMobile] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [catalogueLink, setCatalogueLink] = useState('');
  const [isVendor, setIsVendor] = useState(false);
  const [states, setStates] = useState<State[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchStates(ac.signal).then(setStates).catch(() => setStates([]));
    fetchCities({ signal: ac.signal }).then(setCities).catch(() => setCities([]));
    return () => ac.abort();
  }, []);

  const stateOptions = useMemo(
    () =>
      states
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({ value: s.name, label: s.name })),
    [states]
  );

  const cityOptions = useMemo(
    () =>
      cities
        .filter((c) => String(c.state ?? '').trim() === String(state ?? '').trim())
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: c.name, label: c.name })),
    [cities, state]
  );

  async function save() {
    const supplierName = name.trim();
    const selectedState = state.trim();
    const selectedCity = city.trim();
    const mobile1 = phone.trim();
    const mobile2Value = mobile2.trim();
    const contactMobile = contactPersonMobile.trim();

    if (!supplierName || !selectedState || !selectedCity) {
      setError('Please fill Supplier Name, State and City.');
      return;
    }
    if (gstNumber.trim() && !gstType.trim()) {
      setError('GST Type is required when GST is entered.');
      return;
    }
    if (mobile1 && !isValidTenDigitPhone(mobile1)) {
      setError('Mobile 1 must be a 10 digit number.');
      return;
    }
    if (mobile2Value && !isValidTenDigitPhone(mobile2Value)) {
      setError('Mobile 2 must be a 10 digit number.');
      return;
    }
    if (contactMobile && !isValidTenDigitPhone(contactMobile)) {
      setError('Contact Person Mobile must be a 10 digit number.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await createSupplier({
        name: supplierName,
	        gstNumber: gstNumber.trim() || undefined,
	        gstType: gstNumber.trim() ? gstType : undefined,
        creditVoucherApplicable,
        address: address.trim() || undefined,
        phone: mobile1 || undefined,
        mobile2: mobile2Value || undefined,
        contactPerson: contactPerson.trim() || undefined,
        contactPersonMobile: contactMobile || undefined,
        city: selectedCity,
        state: selectedState,
        paymentTerms: paymentTerms.trim() || undefined,
        isVendor,
        catalogueLink: catalogueLink.trim() || undefined,
        createdBy: 'system',
      });
      if (!result.supplier) throw new Error('Invalid supplier response');
      onCreated(result.supplier);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70]">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close add supplier modal" />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
            <div className="text-sm font-bold text-on-surface">Add Supplier</div>
            <button type="button" className="btn btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
          <div className="p-4 overflow-y-auto max-h-[70vh] space-y-3">
            {error ? <div className="p-2 rounded border border-error/30 bg-error/10 text-error text-xs">{error}</div> : null}
            <label className="space-y-1 block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Supplier Name <span className="text-red-600">*</span></div>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="ABC Traders" />
            </label>
            <label className="space-y-1 block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">GST</div>
              <GstSelect
                value={gstNumber}
                onChange={setGstNumber}
                placeholder="Select GST No."
              />
            </label>
            <label className="space-y-1 block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">GST Type {gstNumber.trim() ? <span className="text-red-600">*</span> : null}</div>
              <SearchableSelect
                value={gstType}
                options={[{ value: 'Intra-State', label: 'Intra-State' }, { value: 'Inter-State', label: 'Inter-State' }]}
                onChange={(v) => setGstType(v === 'Inter-State' ? 'Inter-State' : 'Intra-State')}
                placeholder="Select GST type"
              />
            </label>
            <label className="flex items-center gap-2 pt-1 select-none">
              <input type="checkbox" checked={creditVoucherApplicable} onChange={(e) => setCreditVoucherApplicable(Boolean(e.target.checked))} />
              <span className="text-sm text-on-surface-variant">Credit Voucher Applicable (invoice not required)</span>
            </label>
            <label className="space-y-1 block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Address</div>
              <textarea className={`${inputClass} min-h-[80px]`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" />
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="space-y-1">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Mobile 1</div>
                <input className={inputClass} value={phone} onChange={(e) => setPhone(normalizeTenDigitPhoneInput(e.target.value))} placeholder="Phone" inputMode="numeric" maxLength={10} />
              </label>
              <label className="space-y-1">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Mobile 2</div>
                <input className={inputClass} value={mobile2} onChange={(e) => setMobile2(normalizeTenDigitPhoneInput(e.target.value))} placeholder="Mobile 2" inputMode="numeric" maxLength={10} />
              </label>
              <label className="space-y-1">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Contact Person</div>
                <input className={inputClass} value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="Contact person" />
              </label>
              <label className="space-y-1">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Contact Person Mobile</div>
                <input className={inputClass} value={contactPersonMobile} onChange={(e) => setContactPersonMobile(normalizeTenDigitPhoneInput(e.target.value))} placeholder="Contact person mobile" inputMode="numeric" maxLength={10} />
              </label>
              <label className="space-y-1">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">State <span className="text-red-600">*</span></div>
                <SearchableSelect
                  value={state}
                  options={stateOptions}
                  onChange={(v) => {
                    setState(v);
                    setCity('');
                  }}
                  placeholder="Select state..."
                  showCreateWhenEmpty
                  alwaysShowCreate
                  createLabel={(q) => (q ? `+ Add State "${q}"` : '+ Add State')}
                  onCreate={async (label) => {
                    const nextName = String(label ?? '').trim();
                    if (!nextName) return null;
                    const created = await createState({ name: nextName, createdBy: 'system' });
                    const next = created.state;
                    if (!next) return null;
                    setStates((prev) => [...prev.filter((s) => s.id !== next.id), next]);
                    setState(next.name);
                    setCity('');
                    return { value: next.name, label: next.name };
                  }}
                />
              </label>
              <label className="space-y-1">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">City <span className="text-red-600">*</span></div>
                <SearchableSelect
                  value={city}
                  options={cityOptions}
                  onChange={setCity}
                  placeholder={state.trim() ? 'Select city...' : 'Select state first'}
                  disabled={!state.trim()}
                  showCreateWhenEmpty
                  alwaysShowCreate
                  createLabel={(q) => (q ? `+ Add City "${q}"` : '+ Add City')}
                  onCreate={async (label) => {
                    const selectedState = state.trim();
                    const nextName = String(label ?? '').trim();
                    if (!selectedState || !nextName) return null;
                    const created = await createCity({ state: selectedState, name: nextName, createdBy: 'system' });
                    const next = created.city;
                    if (!next) return null;
                    setCities((prev) => [...prev.filter((c) => c.id !== next.id), next]);
                    setCity(next.name);
                    return { value: next.name, label: next.name };
                  }}
                />
              </label>
              <label className="space-y-1">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Payment Terms</div>
                <input className={inputClass} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="30 days" />
              </label>
              <label className="space-y-1">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Catalogue Link</div>
                <input className={inputClass} value={catalogueLink} onChange={(e) => setCatalogueLink(e.target.value)} placeholder="https://..." />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
              <input type="checkbox" className="w-4 h-4 rounded border-outline-variant" checked={isVendor} onChange={(e) => setIsVendor(e.target.checked)} />
              <span className="font-semibold text-on-surface">Vendor</span>
            </label>
          </div>
          <div className="px-4 py-3 border-t border-outline-variant flex justify-end gap-2">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" disabled={busy || !name.trim() || !city.trim() || !state.trim()} onClick={save}>
              {busy ? 'Saving...' : 'Save Supplier'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
