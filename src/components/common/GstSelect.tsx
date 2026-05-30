import React, { useEffect, useState } from 'react';
import SearchableSelect from './SearchableSelect';
import { fetchGstNumbers, type GstNumber } from '@/src/lib/masters';

export default function GstSelect({
  value,
  onChange,
  placeholder = 'Select GST...',
  disabled,
  className,
  inputClassName,
}: {
  value: string;
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
    fetchGstNumbers()
      .then((data) => {
        if (!active) return;
        setOptions(data.map((g) => ({ value: g.gstNumber, label: g.gstNumber })));
      })
      .catch((err) => console.error('Failed to fetch GST numbers:', err))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <SearchableSelect
      value={value}
      options={options}
      onChange={onChange}
      placeholder={loading ? 'Loading GST...' : placeholder}
      disabled={disabled}
      className={className}
      inputClassName={inputClassName}
      // Allow custom GST number input by using onCreate
      onCreate={(query) => {
        const val = query.trim().toUpperCase();
        if (!val) return null;
        return { value: val, label: val };
      }}
      createLabel={(query) => `Use "${query.toUpperCase()}"`}
    />
  );
}
