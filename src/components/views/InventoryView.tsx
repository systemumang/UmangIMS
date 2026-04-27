import React from 'react';
import { Search } from 'lucide-react';

export default function InventoryView() {
  return (
    <div className="space-y-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <div className="font-headline font-bold text-sm text-on-surface">Item Sheet</div>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" size={16} />
            <input
              type="text"
              placeholder="Search items..."
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg pl-9 pr-3 py-2 text-sm text-on-surface-variant placeholder:text-on-surface-variant shadow-sm outline-none focus:border-outline-variant focus:ring-2 focus:ring-outline-variant/15"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead className="bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
              <tr>
                <th className="p-3 border-b border-outline-variant">Full Item name</th>
                <th className="p-3 border-b border-outline-variant text-right">Opening Stock</th>
                <th className="p-3 border-b border-outline-variant text-right">Purchase</th>
                <th className="p-3 border-b border-outline-variant text-right">Issue</th>
                <th className="p-3 border-b border-outline-variant text-right">Return</th>
                <th className="p-3 border-b border-outline-variant text-right">Damage</th>
                <th className="p-3 border-b border-outline-variant text-right">PO In Progres</th>
                <th className="p-3 border-b border-outline-variant text-right">Re order level</th>
                <th className="p-3 border-b border-outline-variant text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {/* Add a few placeholder rows for design demonstration */}
              <tr className="hover:bg-surface-container-low/50 transition-colors">
                <td className="p-3 text-on-surface font-semibold">Dell Latitude 5420 - 16GB RAM - 512GB SSD</td>
                <td className="p-3 text-on-surface-variant text-right">50</td>
                <td className="p-3 text-on-surface-variant text-right">20</td>
                <td className="p-3 text-on-surface-variant text-right">15</td>
                <td className="p-3 text-on-surface-variant text-right">2</td>
                <td className="p-3 text-on-surface-variant text-right">1</td>
                <td className="p-3 text-on-surface-variant text-right">10</td>
                <td className="p-3 text-on-surface-variant text-right">5</td>
                <td className="p-3 text-on-surface font-bold text-right">56</td>
              </tr>
              <tr className="hover:bg-surface-container-low/50 transition-colors">
                <td className="p-3 text-on-surface font-semibold">Logitech MX Master 3S - Black</td>
                <td className="p-3 text-on-surface-variant text-right">100</td>
                <td className="p-3 text-on-surface-variant text-right">50</td>
                <td className="p-3 text-on-surface-variant text-right">40</td>
                <td className="p-3 text-on-surface-variant text-right">5</td>
                <td className="p-3 text-on-surface-variant text-right">0</td>
                <td className="p-3 text-on-surface-variant text-right">0</td>
                <td className="p-3 text-on-surface-variant text-right">10</td>
                <td className="p-3 text-on-surface font-bold text-right">115</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

