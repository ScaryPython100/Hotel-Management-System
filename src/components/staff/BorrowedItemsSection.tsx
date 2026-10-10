import React from "react";
import { BorrowedItem } from "../../types";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Clock, Trash2, BedDouble, Package } from "lucide-react";

interface BorrowedItemsSectionProps {
  activeBorrowed: BorrowedItem[];
  onMarkReturned: (borrowedId: string, itemName: string) => void;
  onDeleteBorrowed: (id: string, itemName: string) => void;
}

export default function BorrowedItemsSection({
  activeBorrowed,
  onMarkReturned,
  onDeleteBorrowed
}: BorrowedItemsSectionProps) {
  return (
    <section>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-6 border-b border-[#E5E1DB] gap-2">
        <div>
          <h3 className="text-sm uppercase tracking-[0.2em] font-bold text-[#2D2926] flex items-center">
            <Package className="w-4 h-4 mr-2 text-[#A68966]" />
            Appliances & Items In Rooms ({activeBorrowed.length})
          </h3>
          <p className="text-xs text-[#8C857D] mt-1">
            Delivered appliances currently inside guest rooms. Mark collected once housekeeping retrieves them.
          </p>
        </div>
      </div>

      {activeBorrowed.length === 0 ? (
        <div className="bg-white border border-dashed border-[#E5E1DB] p-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-[#A68966] mx-auto mb-4 opacity-50" />
          <h4 className="text-sm font-semibold text-[#2D2926] mb-1">No items currently in guest rooms</h4>
          <p className="text-xs text-[#8C857D] max-w-md mx-auto">
            When you mark a request done for a Kettle, Iron Box, or other appliance, it is automatically logged here so you know which room has it and needs to be collected back.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {activeBorrowed.map(item => (
            <div key={item.id} className="bg-white p-6 border border-[#E5E1DB] shadow-sm flex flex-col relative">
              <div className="absolute top-0 left-0 w-full h-[3px] bg-[#A68966]"></div>

              <div className="flex justify-between items-start pb-4 border-b border-dashed border-[#E5E1DB] mb-5">
                <div className="flex items-center text-[#2D2926] font-serif text-2xl font-bold">
                  <BedDouble className="w-5 h-5 mr-2.5 text-[#A68966]" />
                  Room {item.roomId}
                </div>
                <span className="inline-flex items-center px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] uppercase font-bold tracking-wider">
                  In Room — Needs Collection
                </span>
              </div>

              <div className="flex-1">
                <h4 className="text-[10px] uppercase tracking-[0.2em] text-[#8C857D] font-bold mb-1.5">Delivered Appliance</h4>
                <p className="text-lg font-semibold text-[#2D2926]">{item.itemName}</p>
                <div className="mt-3 flex items-center text-[11px] text-[#8C857D]">
                  <Clock className="w-3.5 h-3.5 mr-1.5 text-[#A68966]" />
                  Delivered {formatDistanceToNow(item.createdAt, { addSuffix: true })}
                </div>
              </div>

              <div className="mt-6 pt-5 border-t border-dashed border-[#E5E1DB] flex items-center gap-2">
                <button
                  onClick={() => onMarkReturned(item.id!, item.itemName)}
                  className="flex-1 bg-[#2D2926] text-white py-2.5 px-3 text-xs font-semibold uppercase tracking-wider hover:bg-[#A68966] transition-colors flex items-center justify-center gap-2"
                  title="Click once you collect the item back from the room"
                >
                  <CheckCircle2 className="w-4 h-4 text-[#A68966]" />
                  <span>Collect & Return</span>
                </button>
                <button
                  onClick={() => onDeleteBorrowed(item.id!, item.itemName)}
                  className="p-2.5 text-[#8C857D] hover:text-red-600 hover:bg-red-50 border border-[#E5E1DB] transition-colors"
                  title="Remove this card from dashboard view (keeps database history safe)"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
