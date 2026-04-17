import React from 'react';
import { MoreVertical, ChevronLeft, ChevronRight, Download, Filter, Calendar } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { avatarColorClass, getInitials, statusPillClass, type Firm, type PurchaseRequest } from '@/src/lib/purchaseRequests';
import { formatDateDDMMYYYY } from '@/src/lib/date';

import { motion } from 'motion/react';
			
export default function PurchaseTable({
  requests,
  firms,
  onSelectRequest,
  onExportExcel,
}: {
  requests: PurchaseRequest[];
  firms: Firm[];
  onSelectRequest?: (id: string) => void;
	onExportExcel?: () => void;
	}) {
		  return (
		    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-surface-container-lowest p-4 rounded-xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.06)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-surface-container-low px-3 py-1.5 rounded-lg">
            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Status</label>
	            <select className="bg-transparent border-none text-xs font-medium focus:ring-0 cursor-pointer p-0 pr-6 outline-none">
	              <option>All Statuses</option>
	              <option>Pending Approval</option>
	              <option>Approved</option>
	              <option>Rejected</option>
	            </select>
          </div>
          <div className="flex items-center gap-2 bg-surface-container-low px-3 py-1.5 rounded-lg">
            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Date Range</label>
            <div className="flex items-center gap-2 text-xs font-medium">
              <span>Oct 01, 2023</span>
              <span className="text-outline-variant">—</span>
              <span>Dec 31, 2023</span>
              <Calendar size={14} className="text-outline-variant" />
            </div>
          </div>
          <div className="flex items-center gap-2 bg-surface-container-low px-3 py-1.5 rounded-lg">
            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Department</label>
            <select className="bg-transparent border-none text-xs font-medium focus:ring-0 cursor-pointer p-0 pr-6 outline-none">
              <option>All Depts</option>
              <option>Operations</option>
              <option>R&D</option>
              <option>Marketing</option>
              <option>Logistics</option>
            </select>
          </div>
        </div>
	        <div className="flex items-center gap-2">
	          <button
	            type="button"
	            onClick={onExportExcel}
	            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-colors"
	          >
	            <Download size={14} />
	            Export Excel
	          </button>
	          <button className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-colors">
	            <Filter size={14} />
            Advanced Filters
          </button>
        </div>
      </div>

	      {/* Table */}
	      <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-blue-600">
	        <div className="overflow-x-auto">
	          <table className="w-full text-left border-collapse">
	            <thead>
		              <tr className="bg-surface-container-low/50 border-b border-blue-600">
		                <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-blue-600">PR ID</th>
		                <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-blue-600">Firm</th>
		                <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-blue-600">Department</th>
		                <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-blue-600">Requested By</th>
		                <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-blue-600">Required Date</th>
		                <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-blue-600">Status</th>
		                <th className="px-6 py-4 border border-blue-600"></th>
		              </tr>
	            </thead>
		            <tbody>
		              {requests.map((req, idx) => (
		                <motion.tr 
		                  key={req.id} 
	                  initial={{ opacity: 0, y: 10 }}
	                  animate={{ opacity: 1, y: 0 }}
	                  transition={{ delay: idx * 0.05 }}
	                  tabIndex={onSelectRequest ? 0 : -1}
	                  onClick={() => onSelectRequest?.(req.id)}
	                  onKeyDown={(e) => {
	                    if (!onSelectRequest) return;
	                    if (e.key === 'Enter' || e.key === ' ') onSelectRequest(req.id);
	                  }}
	                  className={cn(
	                    "hover:bg-surface-container/30 transition-colors group",
	                    onSelectRequest && "cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-container focus:ring-inset",
	                    idx === 2 && "bg-surface-container-low/20"
		                  )}
		                >
		                  <td className="px-6 py-4 font-headline font-bold text-sm text-primary border border-blue-600">{req.id}</td>
		                  <td className="px-6 py-4 text-sm text-on-surface-variant border border-blue-600">
		                    {firms.find((f) => f.id === req.firmId)?.name ?? req.firmId}
		                  </td>
		                  <td className="px-6 py-4 text-sm text-on-surface-variant border border-blue-600">{req.department}</td>
		                  <td className="px-6 py-4 border border-blue-600">
		                    <div className="flex items-center gap-3">
		                      <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold", avatarColorClass(req.requestedBy))}>
		                        {getInitials(req.requestedBy)}
		                      </div>
		                      <span className="text-sm font-medium text-on-surface">{req.requestedBy}</span>
		                    </div>
		                  </td>
			                  <td className="px-6 py-4 text-sm text-on-surface-variant border border-blue-600">{formatDateDDMMYYYY(req.requiredDate)}</td>
		                  <td className="px-6 py-4 border border-blue-600">
		                    <span className={cn(
		                      "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
		                      statusPillClass(req.status)
		                    )}>
		                      {req.status}
		                    </span>
	                  </td>
		                  <td className="px-6 py-4 text-right border border-blue-600">
		                    <button
		                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-outline-variant hover:text-primary"
		                      type="button"
		                      onClick={(e) => e.stopPropagation()}
	                    >
	                      <MoreVertical size={16} />
	                    </button>
	                  </td>
	                </motion.tr>
	              ))}
	            </tbody>
          </table>
        </div>

	        {/* Pagination */}
		        <div className="px-6 py-4 bg-surface-container-low/30 border-t border-blue-600 flex items-center justify-between">
	          <span className="text-xs text-on-surface-variant">
	            {requests.length ? `Showing 1 to ${requests.length} of ${requests.length} entries` : 'Showing 0 entries'}
	          </span>
	          <div className="flex items-center gap-1">
            <button className="p-1.5 rounded hover:bg-surface-container transition-colors disabled:opacity-30" disabled>
              <ChevronLeft size={16} />
            </button>
            <button className="px-3 py-1 text-xs font-bold bg-primary text-on-primary rounded shadow-sm">1</button>
            <button className="px-3 py-1 text-xs font-medium text-on-surface-variant hover:bg-surface-container rounded transition-colors">2</button>
            <button className="px-3 py-1 text-xs font-medium text-on-surface-variant hover:bg-surface-container rounded transition-colors">3</button>
            <span className="px-2 text-outline-variant">...</span>
            <button className="px-3 py-1 text-xs font-medium text-on-surface-variant hover:bg-surface-container rounded transition-colors">25</button>
            <button className="p-1.5 rounded hover:bg-surface-container transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
