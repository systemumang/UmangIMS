import React from 'react';
import StatCard from '../StatCard';
import { ClipboardList, CreditCard, Timer } from 'lucide-react';

export default function DashboardView() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard label="Active Requests" value="18" icon={ClipboardList} trend={{ value: '4.2% from last week', isUp: false }} />
        <StatCard label="Total Monthly Spend" value="142,502.20" icon={CreditCard} subtext="Budget: 180,000 max" progress={79} />
        <StatCard label="Avg Approval Time" value="1.4 Days" icon={Timer} trend={{ value: '0.2d increase this period', isUp: true }} />
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-6 shadow-sm">
        <h3 className="font-headline font-bold text-sm text-on-surface mb-2">Overview</h3>
        <p className="text-sm text-on-surface-variant">
          Select a module from the left sidebar to view details.
        </p>
      </div>
    </div>
  );
}
