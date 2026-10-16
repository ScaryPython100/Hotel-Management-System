import React from "react";
import { RoomRequest } from "../../types";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Clock, Trash2, BedDouble, Zap } from "lucide-react";
import { cn } from "../../lib/utils";

export function parseGuestDetails(customMessage?: string): {
  guestName?: string;
  phoneNumber?: string;
  cleanedMessage?: string;
} {
  if (!customMessage) return {};
  let guestName: string | undefined;
  let phoneNumber: string | undefined;
  let cleanedMessage = customMessage;

  const nameMatch = cleanedMessage.match(/Guest Name:\s*([^\n]+)/i);
  if (nameMatch) {
    guestName = nameMatch[1].trim();
    cleanedMessage = cleanedMessage.replace(/Guest Name:\s*[^\n]+\n?/i, "");
  }

  const phoneMatch = cleanedMessage.match(/Phone Number:\s*([^\n]+)/i);
  if (phoneMatch) {
    phoneNumber = phoneMatch[1].trim();
    cleanedMessage = cleanedMessage.replace(/Phone Number:\s*[^\n]+\n?/i, "");
  }

  cleanedMessage = cleanedMessage.replace(/\[WAITLIST:[^\]]+\]\s*/i, "");
  cleanedMessage = cleanedMessage.replace(/^Message:\s*/i, "").trim();

  return { guestName, phoneNumber, cleanedMessage: cleanedMessage || undefined };
}

export function isQuickActionRequest(request: RoomRequest): boolean {
  const quickKeywords = [
    "inform checkout",
    "late checkout",
    "request late checkout",
    "stay extension",
    "request stay extension",
    "checkout"
  ];

  const hasQuickItem = (request.items || []).some(item => {
    const lower = item.toLowerCase();
    return quickKeywords.some(kw => lower.includes(kw));
  });
  if (hasQuickItem) return true;

  const msgLower = (request.customMessage || "").toLowerCase();
  return (
    msgLower.includes("inform checkout") ||
    msgLower.includes("late checkout") ||
    msgLower.includes("stay extension")
  );
}

interface RoomGroupCardProps {
  request?: RoomRequest;
  requests?: RoomRequest[];
  roomId?: string;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  isPending: boolean;
}

export default function RoomGroupCard({
  request,
  requests,
  roomId: propRoomId,
  onComplete,
  onDelete,
  isPending
}: RoomGroupCardProps) {
  const req = request || (requests && requests[0]);
  if (!req) return null;

  const effectiveRoomId = req.roomId || propRoomId || "Unknown";
  const { guestName, phoneNumber, cleanedMessage } = parseGuestDetails(req.customMessage);
  const isQuickAction = isQuickActionRequest(req);

  return (
    <div
      className={cn(
        "p-6 border flex flex-col h-full relative transition-all duration-200 shadow-xs",
        isQuickAction
          ? "border-2 border-[#ff6961] bg-white"
          : isPending
          ? "border-[#A68966] bg-white"
          : "border-[#E5E1DB] bg-white opacity-85"
      )}
    >
      {/* Top accent bar: STRICTLY #ff6961 for quick action, #A68966 for normal pending */}
      {isQuickAction ? (
        <div className="absolute top-0 left-0 w-full h-[4px] bg-[#ff6961]"></div>
      ) : isPending ? (
        <div className="absolute top-0 left-0 w-full h-[3px] bg-[#A68966]"></div>
      ) : null}

      {/* Header: Room Number and Quick Action or Status badge */}
      <div className="flex justify-between items-center pb-3 border-b border-dashed border-[#E5E1DB] mb-4">
        <div className="flex items-center text-[#2D2926] font-serif text-xl">
          <BedDouble className={cn("w-5 h-5 mr-2.5", isQuickAction ? "text-[#ff6961]" : "text-[#A68966]")} />
          <span>Room {effectiveRoomId}</span>
        </div>

        <div>
          {isQuickAction ? (
            <span className="bg-[#ff6961] text-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-xs inline-flex items-center gap-1 shadow-2xs">
              ⚡ Quick Action
            </span>
          ) : req.isWaitlist ? (
            <span className="bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-xs flex items-center gap-1">
              <Zap className="w-2.5 h-2.5 text-amber-600 fill-amber-500" />
              {req.queuePosition === 1 ? "Next in Queue" : `No. ${req.queuePosition || 1} in Queue`}
            </span>
          ) : (
            <div className="flex items-center text-[10px] uppercase tracking-widest text-[#8C857D] font-medium bg-[#F9F7F4] px-2 py-1 border border-[#E5E1DB]">
              <Clock className="w-3 h-3 mr-1" />
              {formatDistanceToNow(req.createdAt || Date.now(), { addSuffix: true })}
            </div>
          )}
        </div>
      </div>

      {/* Guest Name & Phone Number */}
      {(guestName || phoneNumber) && (
        <div className="mb-3 p-2.5 bg-[#FAF8F5] border border-[#E5E1DB] flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[#8C857D] text-[10px] uppercase tracking-wider font-semibold">Guest:</span>
            <span className="font-semibold text-[#2D2926]">{guestName || "Guest"}</span>
          </div>
          {phoneNumber && (
            <a
              href={`tel:${phoneNumber}`}
              className="text-[#A68966] font-mono font-medium hover:underline text-xs flex items-center gap-1"
            >
              📞 {phoneNumber}
            </a>
          )}
        </div>
      )}

      {/* Quick Action Time indicator if isQuickAction */}
      {isQuickAction && (
        <div className="flex items-center text-[10px] uppercase tracking-widest text-[#8C857D] font-medium mb-3">
          <Clock className="w-3 h-3 mr-1.5 text-[#ff6961]" />
          {formatDistanceToNow(req.createdAt || Date.now(), { addSuffix: true })}
        </div>
      )}

      {/* Items Section */}
      <div className="flex-1 space-y-3">
        {req.items && req.items.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {req.items.map((item, itemIdx) => {
              const isItemQuick = [
                "inform checkout",
                "late checkout",
                "stay extension",
                "checkout"
              ].some(kw => item.toLowerCase().includes(kw));

              return (
                <span
                  key={itemIdx}
                  className={cn(
                    "px-3 py-1 text-[11px] font-semibold uppercase tracking-wider border rounded-xs",
                    isItemQuick
                      ? "bg-[#ff6961] text-white border-[#ff6961] shadow-2xs"
                      : "bg-[#F9F7F4] border-[#E5E1DB] text-[#2D2926]"
                  )}
                >
                  {item}
                </span>
              );
            })}
          </div>
        )}

        {/* Notes/Custom Message */}
        {cleanedMessage && (
          <p className="text-[#2D2926] text-xs bg-[#FAF8F5] p-3 border border-[#E5E1DB] italic leading-relaxed">
            "{cleanedMessage}"
          </p>
        )}
      </div>

      {/* Action Buttons */}
      <div className="mt-4 pt-3 border-t border-[#E5E1DB] flex gap-2 justify-end">
        {isPending && (
          <button
            type="button"
            onClick={() => onComplete(req.id!)}
            className={cn(
              "text-white px-3.5 py-1.5 text-[10px] uppercase tracking-[0.2em] font-semibold transition-colors flex items-center cursor-pointer shadow-xs",
              isQuickAction ? "bg-[#ff6961] hover:bg-[#e05851]" : "bg-[#A68966] hover:bg-[#8E7455]"
            )}
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            Mark Done
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(req.id!)}
          className="p-1.5 text-[#8C857D] hover:text-red-500 hover:bg-red-50 border border-[#E5E1DB] hover:border-red-200 transition-colors cursor-pointer"
          title="Delete request"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
