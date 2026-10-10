import React from "react";
import { RoomRequest } from "../../types";
import {
  Clock,
  Trash2,
  BedDouble,
  Search,
  Filter,
  Check,
  RotateCcw
} from "lucide-react";

interface RequestsTableViewProps {
  requests: RoomRequest[];
  filteredTableRequests: RoomRequest[];
  pendingCount: number;
  completedCount: number;
  hasBorrowedItems: boolean;
  tableSearch: string;
  onTableSearchChange: (val: string) => void;
  tableFilter: "all" | "pending" | "completed";
  onTableFilterChange: (val: "all" | "pending" | "completed") => void;
  onToggleStatus: (id: string, currentStatus: "pending" | "completed") => void;
  onDelete: (id: string) => void;
  onClearCompleted: () => void;
  onClearAllDatabase: () => void;
}

export default function RequestsTableView({
  requests,
  filteredTableRequests,
  pendingCount,
  completedCount,
  hasBorrowedItems,
  tableSearch,
  onTableSearchChange,
  tableFilter,
  onTableFilterChange,
  onToggleStatus,
  onDelete,
  onClearCompleted,
  onClearAllDatabase
}: RequestsTableViewProps) {
  return (
    <div className="bg-white border border-[#E5E1DB] shadow-sm">
      {/* Table Toolbar */}
      <div className="p-4 border-b border-[#E5E1DB] flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#FAF8F5]">
        <div className="flex items-center gap-3 flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="w-4 h-4 text-[#8C857D] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search room, amenity, message..."
              value={tableSearch}
              onChange={(e) => onTableSearchChange(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-[#E5E1DB] bg-white text-xs text-[#2D2926] focus:outline-none focus:border-[#A68966]"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-[#8C857D] font-bold flex items-center mr-1">
            <Filter className="w-3 h-3 mr-1" />
            Status:
          </span>
          <div className="inline-flex border border-[#E5E1DB] bg-white p-0.5 text-xs">
            <button
              onClick={() => onTableFilterChange("all")}
              className={`px-3 py-1 font-medium text-[11px] uppercase tracking-wider transition-colors ${
                tableFilter === "all" ? "bg-[#A68966] text-white" : "text-[#8C857D] hover:text-[#2D2926]"
              }`}
            >
              All ({requests.length})
            </button>
            <button
              onClick={() => onTableFilterChange("pending")}
              className={`px-3 py-1 font-medium text-[11px] uppercase tracking-wider transition-colors ${
                tableFilter === "pending" ? "bg-[#A68966] text-white" : "text-[#8C857D] hover:text-[#2D2926]"
              }`}
            >
              Pending ({pendingCount})
            </button>
            <button
              onClick={() => onTableFilterChange("completed")}
              className={`px-3 py-1 font-medium text-[11px] uppercase tracking-wider transition-colors ${
                tableFilter === "completed" ? "bg-[#A68966] text-white" : "text-[#8C857D] hover:text-[#2D2926]"
              }`}
            >
              Done ({completedCount})
            </button>
          </div>

          {completedCount > 0 && (
            <button
              onClick={onClearCompleted}
              className="px-3 py-1.5 border border-red-200 text-red-700 bg-white hover:bg-red-50 text-[10px] uppercase font-bold tracking-wider transition-colors flex items-center gap-1"
              title="Remove all completed requests from the view (preserved in Supabase)"
            >
              <Trash2 className="w-3 h-3 text-red-500" />
              Clear Done ({completedCount})
            </button>
          )}

          {(requests.length > 0 || hasBorrowedItems) && (
            <button
              onClick={onClearAllDatabase}
              className="px-3 py-1.5 border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 text-[10px] uppercase font-bold tracking-wider transition-colors flex items-center gap-1"
              title="Wipe all requests from database completely"
            >
              <Trash2 className="w-3 h-3 text-red-600" />
              Clear All Database
            </button>
          )}
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#E5E1DB] bg-[#F4F1EC] text-[#2D2926] uppercase text-[10px] tracking-wider font-semibold">
              <th className="py-3 px-4">Room Number</th>
              <th className="py-3 px-4">Requests Asked</th>
              <th className="py-3 px-4">Message</th>
              <th className="py-3 px-4">Date</th>
              <th className="py-3 px-4">Day</th>
              <th className="py-3 px-4">Time</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E1DB]">
            {filteredTableRequests.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-[#8C857D] italic bg-white">
                  No requests match your current filters.
                </td>
              </tr>
            ) : (
              filteredTableRequests.map((req) => {
                const dateObj = req.createdAt ? new Date(req.createdAt) : new Date();
                const isPending = req.status === "pending";

                return (
                  <tr
                    key={req.id}
                    className={`transition-colors hover:bg-[#FAF8F5] ${
                      isPending ? "bg-white" : "bg-[#FAF8F5]/40 opacity-75"
                    }`}
                  >
                    {/* Room Number */}
                    <td className="py-3 px-4 font-mono font-bold text-[#2D2926]">
                      <span className="inline-flex items-center px-2 py-1 bg-[#F4F1EC] border border-[#E5E1DB] rounded-none">
                        <BedDouble className="w-3.5 h-3.5 mr-1.5 text-[#A68966]" />
                        {req.roomId || "N/A"}
                      </span>
                    </td>

                    {/* Requests Asked */}
                    <td className="py-3 px-4 text-[#2D2926]">
                      {req.items && req.items.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {req.items.map((item, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 bg-[#F9F7F4] border border-[#E5E1DB] text-[10px] font-medium uppercase tracking-wider text-[#2D2926]"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[#8C857D] italic">—</span>
                      )}
                    </td>

                    {/* Message */}
                    <td className="py-3 px-4 text-[#2D2926] max-w-xs">
                      {req.customMessage ? (
                        <span className="italic text-[#555] block truncate" title={req.customMessage}>
                          "{req.customMessage}"
                        </span>
                      ) : (
                        <span className="text-[#8C857D] italic">—</span>
                      )}
                    </td>

                    {/* Date */}
                    <td className="py-3 px-4 text-[#555] whitespace-nowrap font-mono">
                      {dateObj.toLocaleDateString()}
                    </td>

                    {/* Day */}
                    <td className="py-3 px-4 text-[#555] whitespace-nowrap">
                      {dateObj.toLocaleDateString(undefined, { weekday: "long" })}
                    </td>

                    {/* Time */}
                    <td className="py-3 px-4 text-[#555] whitespace-nowrap font-mono">
                      {dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <button
                        onClick={() => onToggleStatus(req.id!, req.status || "pending")}
                        className={`inline-flex items-center px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors border ${
                          isPending
                            ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                            : "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                        }`}
                        title="Click to toggle status"
                      >
                        {isPending ? (
                          <>
                            <Clock className="w-3 h-3 mr-1 text-amber-600" />
                            Pending
                          </>
                        ) : (
                          <>
                            <Check className="w-3 h-3 mr-1 text-emerald-600" />
                            Completed
                          </>
                        )}
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => onToggleStatus(req.id!, req.status || "pending")}
                          className="p-1 text-[#8C857D] hover:text-[#2D2926] border border-[#E5E1DB] bg-white transition-colors"
                          title={isPending ? "Mark as Done" : "Mark as Pending"}
                        >
                          {isPending ? <Check className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => onDelete(req.id!)}
                          className="p-1 text-red-500 hover:text-red-700 border border-red-200 hover:bg-red-50 transition-colors"
                          title="Delete Record"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Table Footer Summary */}
      <div className="p-3 border-t border-[#E5E1DB] bg-[#FAF8F5] flex items-center justify-between text-[11px] text-[#8C857D]">
        <span>
          Showing {filteredTableRequests.length} of {requests.length} total request records
        </span>
        <span className="font-mono">
          {pendingCount} pending · {completedCount} completed
        </span>
      </div>
    </div>
  );
}
