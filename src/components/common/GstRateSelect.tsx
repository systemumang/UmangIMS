import React, { useEffect, useState } from 'react';
import SearchableSelect from './SearchableSelect';
import { fetchGstRates, type GstRate } from '@/src/lib/masters';

export default function GstRateSelect({
  value,
  onChange,
  placeholder = 'Select GST Rate...',
  disabled,
  className,
  inputClassName,
}: {
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchGstRates()
      .then((data) => {
        if (!active) return;
        setOptions(data.map((g) => ({ value: String(g.rate), label: `${g.rate}%` })));
      })
      .catch((err) => console.error('Failed to fetch GST rates:', err))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <SearchableSelect
      value={String(value)}
      options={options}
      onChange={onChange}
      placeholder={loading ? 'Loading GST...' : placeholder}
      disabled={disabled}
      className={className}
      inputClassName={inputClassName}
      onCreate={(query) => {
        const val = parseFloat(query.trim());
        if (isNaN(val)) return null;
        return { value: String(val), label: `${val}%` };
      }}
      createLabel={(query) => `Use "${query}%"`}
    />
  );
}
