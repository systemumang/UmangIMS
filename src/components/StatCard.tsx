import React from 'react';
import { LucideIcon, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/src/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  trend?: {
    value: string;
    isUp: boolean;
  };
  subtext?: string;
  progress?: number;
}

export default function StatCard({ label, value, icon: Icon, trend, subtext, progress }: StatCardProps) {
  return (
    <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">{label}</span>
        <Icon className="text-primary" size={20} />
      </div>
      <div className="text-2xl font-bold text-on-surface font-headline">{value}</div>
      
      {trend && (
        <div className={cn(
          "text-[11px] font-medium mt-1 flex items-center gap-1",
          trend.isUp ? "text-amber-600" : "text-emerald-600"
        )}>
          {trend.isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {trend.value}
        </div>
      )}

      {subtext && !trend && (
        <div className="text-[11px] text-on-surface-variant font-medium mt-1">
          {subtext}
        </div>
      )}

      {progress !== undefined && (
        <div className="w-full bg-surface-container-low h-1.5 rounded-full mt-3 overflow-hidden">
          <div 
            className="bg-primary h-full rounded-full transition-all duration-500" 
            style={{ width: `${progress}%` }} 
          />
        </div>
      )}
    </div>
  );
}
