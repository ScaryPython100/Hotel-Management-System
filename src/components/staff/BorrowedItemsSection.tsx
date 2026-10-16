import React, { useState } from "react";
import { BorrowedItem, RoomRequest, normalizeReturnableName, extractFloorFromRoom, getFloorRelayBadge } from "../../types";
import { formatDistanceToNow } from "date-fns";
import { 
  CheckCircle2, 
  Clock, 
  Trash2, 
  BedDouble, 
  Package, 
  ArrowRightLeft, 
  Zap, 
  SlidersHorizontal,
  Layers
} from "lucide-react";

interface BorrowedItemsSectionProps {
  activeBorrowed: BorrowedItem[];
  pendingRequests?: RoomRequest[];
  onMarkReturned: (borrowedId: string, itemName: string) => void;
  onDeleteBorrowed: (id: string, itemName: string) => void;
  onRelayItem?: (
    sourceBorrowedId: string,
    sourceRoom: string,
    targetRoom: string,
    itemName: string,
    targetRequestId?: string,
    currentRelayCount?: number
  ) => void;
}

export default function BorrowedItemsSection({
  activeBorrowed,
  pendingRequests = [],
  onMarkReturned,
  onDeleteBorrowed,
  onRelayItem
}: BorrowedItemsSectionProps) {
  const [proximityFirst, setProximityFirst] = useState(true);

  return (
    <section>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-6 border-b border-[#E5E1DB] gap-3">
        <div>
          <h3 className="text-sm uppercase tracking-[0.2em] font-bold text-[#2D2926] flex items-center">
            <Package className="w-4 h-4 mr-2 text-[#A68966]" />
            Appliances & Items In Rooms ({activeBorrowed.length})
          </h3>
          <p className="text-xs text-[#8C857D] mt-1">
            Delivered appliances currently inside guest rooms. Use 1-Tap Floor Relay to hand off directly to next guest in queue.
          </p>
        </div>

        {/* Priority Strategy Toggle */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setProximityFirst(!proximityFirst)}
            className={`px-3 py-1.5 border text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-colors ${
              proximityFirst
                ? "bg-[#2D2926] text-white border-[#2D2926]"
                : "bg-white text-[#59534C] border-[#E5E1DB] hover:bg-neutral-50"
            }`}
            title="Toggle between Proximity-First (same-floor relay) and Strict FIFO (first-come first-served)"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#A68966]" />
            <span>{proximityFirst ? "Proximity-First Relay: On" : "Strict FIFO Queue: On"}</span>
          </button>
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
          {activeBorrowed.map(item => {
            const canonicalAppliance = normalizeReturnableName(item.itemName);
            const sourceFloor = extractFloorFromRoom(item.roomId);

            // Match active item against pending waitlist requests
            const matchingRequests = (pendingRequests || []).filter(r => {
              if (r.status !== "pending") return false;
              if (String(r.roomId).trim().toLowerCase() === String(item.roomId).trim().toLowerCase()) return false;
              if (r.waitlistForItem && normalizeReturnableName(r.waitlistForItem) === canonicalAppliance) return true;
              return (r.items || []).some(i => normalizeReturnableName(i) === canonicalAppliance);
            });

            // Sort matching requests based on selected strategy
            const sortedWaitlist = [...matchingRequests].sort((a, b) => {
              if (proximityFirst) {
                const floorA = extractFloorFromRoom(a.roomId);
                const floorB = extractFloorFromRoom(b.roomId);
                const distA = Math.abs(floorA - sourceFloor);
                const distB = Math.abs(floorB - sourceFloor);
                if (distA !== distB) return distA - distB;
              }
              return (a.createdAt || 0) - (b.createdAt || 0);
            });

            const nextWaitlistReq = sortedWaitlist[0];
            const relayBadge = nextWaitlistReq ? getFloorRelayBadge(item.roomId, nextWaitlistReq.roomId) : null;

            return (
              <div key={item.id} className="bg-white p-6 border border-[#E5E1DB] shadow-sm flex flex-col relative">
                <div className="absolute top-0 left-0 w-full h-[3px] bg-[#A68966]"></div>

                <div className="flex justify-between items-start pb-4 border-b border-dashed border-[#E5E1DB] mb-5">
                  <div>
                    <div className="flex items-center text-[#2D2926] font-serif text-2xl font-bold">
                      <BedDouble className="w-5 h-5 mr-2.5 text-[#A68966]" />
                      Room {item.roomId}
                    </div>
                    <span className="text-[11px] text-[#8C857D] font-mono mt-0.5 block">
                      Floor {sourceFloor}
                    </span>
                  </div>

                  <span className="inline-flex items-center px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] uppercase font-bold tracking-wider">
                    In Room — Needs Collection
                  </span>
                </div>

                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="text-[10px] uppercase tracking-[0.2em] text-[#8C857D] font-bold">
                      Delivered Appliance
                    </h4>
                    {item.relayedFromRoom && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 border border-emerald-200 rounded-xs">
                        <Layers className="w-3 h-3 text-emerald-600" />
                        Relayed from Rm {item.relayedFromRoom} {item.relayCount ? `(#${item.relayCount})` : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-lg font-semibold text-[#2D2926]">{item.itemName}</p>
                  <div className="mt-3 flex items-center text-[11px] text-[#8C857D]">
                    <Clock className="w-3.5 h-3.5 mr-1.5 text-[#A68966]" />
                    Delivered {formatDistanceToNow(item.createdAt, { addSuffix: true })}
                  </div>

                  {/* Floor-to-Floor Relay Banner */}
                  {nextWaitlistReq && relayBadge && (
                    <div className="mt-4 p-3 bg-amber-50/90 border border-amber-200 rounded-xs flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-1 flex-wrap">
                        <span className="text-[11px] font-bold tracking-wide text-amber-950 flex items-center gap-1">
                          <Zap className="w-3.5 h-3.5 text-amber-600 fill-amber-500 shrink-0" />
                          <span>Next In Line: Room {nextWaitlistReq.roomId}</span>
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 uppercase tracking-wider rounded-xs ${
                          relayBadge.isSameFloor 
                            ? "bg-emerald-100 text-emerald-900 border border-emerald-300" 
                            : "bg-amber-100 text-amber-900 border border-amber-300"
                        }`}>
                          {relayBadge.badgeText}
                        </span>
                      </div>
                      <p className="text-[10px] text-[#786F66] leading-tight">
                        Floor {relayBadge.sourceFloor} &rarr; Floor {relayBadge.targetFloor}. 
                        {sortedWaitlist.length > 1 ? ` (${sortedWaitlist.length} guests in queue)` : " (1 guest waiting)"}
                      </p>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="mt-6 pt-5 border-t border-dashed border-[#E5E1DB] flex flex-col gap-2.5">
                  {/* 1-Tap Direct Relay Button */}
                  {nextWaitlistReq && onRelayItem && (
                    <button
                      onClick={() => onRelayItem(
                        item.id!,
                        item.roomId,
                        nextWaitlistReq.roomId,
                        item.itemName,
                        nextWaitlistReq.id,
                        item.relayCount
                      )}
                      className="w-full bg-[#A68966] hover:bg-[#8E7455] text-white py-2.5 px-3 text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                      title={`Directly handover ${item.itemName} from Room ${item.roomId} to Room ${nextWaitlistReq.roomId}`}
                    >
                      <ArrowRightLeft className="w-4 h-4" />
                      <span>Relay Directly: Rm {item.roomId} &rarr; Rm {nextWaitlistReq.roomId}</span>
                    </button>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onMarkReturned(item.id!, item.itemName)}
                      className="flex-1 bg-[#2D2926] text-white py-2.5 px-3 text-xs font-semibold uppercase tracking-wider hover:bg-[#A68966] transition-colors flex items-center justify-center gap-2 cursor-pointer"
                      title="Collect item back to desk / housekeeping storage"
                    >
                      <CheckCircle2 className="w-4 h-4 text-[#A68966]" />
                      <span>Collect & Return to Desk</span>
                    </button>
                    <button
                      onClick={() => onDeleteBorrowed(item.id!, item.itemName)}
                      className="p-2.5 text-[#8C857D] hover:text-red-600 hover:bg-red-50 border border-[#E5E1DB] transition-colors cursor-pointer"
                      title="Remove this card from dashboard view (keeps database history safe)"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
