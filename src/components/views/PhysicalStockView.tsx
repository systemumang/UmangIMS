import React, { useState } from 'react';
import PhysicalStockFormView from './PhysicalStockFormView';
import PhysicalStockMasterView from './PhysicalStockMasterView';

export default function PhysicalStockView({
  initialMode = 'form',
  onCreated,
}: {
  initialMode?: 'form' | 'master';
  onCreated?: () => void;
}) {
  const [mode, setMode] = useState<'form' | 'master'>(initialMode);

  if (mode === 'form') {
    return (
      <div className="p-6">
        <PhysicalStockFormView
          onSuccess={() => {
            if (onCreated) onCreated();
            setMode('master');
          }}
          onCancel={() => setMode('master')}
        />
      </div>
    );
  }

  return <PhysicalStockMasterView onAdd={() => setMode('form')} />;
}
