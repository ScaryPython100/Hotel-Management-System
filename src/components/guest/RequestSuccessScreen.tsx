import React from "react";
import { Check, Clock, Trash2 } from "lucide-react";

export const ITEM_EMOJI_MAP: Record<string, string> = {
  // Page 1: Daily Services
  "Extra Person (w/ or w/o Mattress) (₹500/-)": "🛏️",
  "Shower Gel Refill": "🧴",
  "Shampoo Refill": "🧴",
  "Hand Wash Refill": "🧼",
  "First Aid Kit": "🩹",
  "Housekeeping Service (Only Between 10 A.M. and 4 P.M.)": "🧹",
  "Toothpaste": "🪥",
  "Toothbrush": "🪥",

  // Page 2: Returnable Items
  "Iron Box": "👕",
  "Kettle": "🫖",
  "Hair Dryer": "💇‍♀️",
  "Laptop Table": "💻",
  "Hot Pack": "🌡️",

  // Page 3: F&B Essentials & Quick Food
  "Set of Plates": "🍽️",
  "Set of Cups/Bowls": "🥣",
  "Set of Glasses": "🥛",
  "Empty Water Bottle": "🍶",
  "Cooking Oil Dispenser": "🫒",
  "Maggi": "🍜",
  "Eggs": "🥚",
  "Coffee Sachet": "☕",
  "Soft Drinks (300mL)": "🥤",
  "Toned Milk": "🥛",
  "Masala Box": "🧂",
  // Backward compatibility:
  "Maggi (₹20)": "🍜",
  "Eggs (₹10)": "🥚",
  "Coffee Sachet (₹5 per sachet)": "☕",
  "Soft Drinks (₹50)": "🥤",
  "Toned Milk 200/500 mL (₹30)": "🥛",
  "Masala Box (₹50)": "🧂",

  // Legacy fallback
  "Leg Massager (Paid)": "🦵",
  "Glasses (Set of 2)": "🥃",
  "USB 3.0 Cable + Adaptor": "🔌",
  "Infrared Heat Therapy Lamp (Paid)": "💡"
};

interface RequestSuccessScreenProps {
  roomNumber: string;
  selectedItems: string[];
  onMakeAnotherRequest: () => void;
  onCancelRequest: () => void;
  isWaitlist?: boolean;
  waitlistForItem?: string;
  queuePosition?: number;
}

export default function RequestSuccessScreen({
  roomNumber,
  selectedItems,
  onMakeAnotherRequest,
  onCancelRequest,
  isWaitlist = false,
  waitlistForItem,
  queuePosition = 1
}: RequestSuccessScreenProps) {
  return (
    <div className="min-h-screen bg-[#F9F7F4] flex flex-col items-center justify-center p-6 text-center text-[#2D2926] font-sans">
      <div className={`w-20 h-20 ${isWaitlist ? "bg-amber-50 text-amber-600 border-amber-200" : "bg-[#F2EFE9] text-[#A68966] border-[#E5E1DB]"} rounded-full flex items-center justify-center mb-6 border shadow-xs`}>
        {isWaitlist ? (
          <Clock className="w-10 h-10 stroke-[2.2]" />
        ) : (
          <Check className="w-10 h-10 stroke-[2.5]" />
        )}
      </div>

      <h2 className="text-3xl font-serif italic mb-2">
        {isWaitlist ? "Reserved! Item is in Use" : "Request Received"}
      </h2>
      <p className="text-[#8C857D] mb-6 max-w-md text-sm">
        {isWaitlist
          ? `Item is in Use • ${queuePosition === 1 ? "Next in Queue" : `No. ${queuePosition} in Queue`}. Housekeeping will bring the ${waitlistForItem || selectedItems[0] || "item"} straight to Room ${roomNumber} as soon as it is returned.`
          : `Our housekeeping and guest service team has been notified and will attend to Room ${roomNumber} promptly.`}
      </p>

      {isWaitlist && (
        <div className="bg-amber-50/80 border border-amber-200/90 p-4 mb-6 max-w-sm w-full text-left">
          <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5 mb-1">
            <Clock className="w-3.5 h-3.5 text-amber-700" />
            Queue Status: {queuePosition === 1 ? "Next in Queue" : `No. ${queuePosition} in Queue`}
          </p>
          <p className="text-[11px] text-amber-800 leading-relaxed">
            The {waitlistForItem || "item"} is currently in use. When it is returned, housekeeping will bring it straight to Room {roomNumber}.
          </p>
        </div>
      )}

      {selectedItems.length > 0 && (
        <div className="bg-white border border-[#E5E1DB] p-4 mb-8 max-w-sm w-full text-left shadow-2xs">
          <span className="text-[10px] uppercase tracking-widest text-[#8C857D] font-mono block mb-2 font-semibold">
            {isWaitlist ? "Reserved Items" : "Requested Items"}
          </span>
          <ul className="space-y-1.5 text-sm text-[#2D2926]">
            {selectedItems.map(item => {
              const emoji = ITEM_EMOJI_MAP[item];

              return (
                <li key={item} className="flex justify-between items-center py-1 border-b border-[#F2EFE9] last:border-0">
                  <span className="font-serif">
                    {emoji && <span className="mr-1.5">{emoji}</span>}
                    {item}
                  </span>
                  <span className={`font-mono text-xs ${isWaitlist ? "text-amber-700 bg-amber-50 border-amber-200" : "text-[#A68966] bg-[#FAF8F5] border-[#EBE7E1]"} px-2 py-0.5 border rounded-xs`}>
                    {isWaitlist ? (queuePosition === 1 ? "Next in Queue" : `No. ${queuePosition} in Queue`) : "Requested"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onMakeAnotherRequest}
          className="px-8 py-4 bg-[#A68966] text-white font-medium uppercase tracking-[0.2em] text-xs hover:bg-[#8E7455] transition-colors rounded-none cursor-pointer"
        >
          Make Another Request
        </button>
        <button
          type="button"
          onClick={onCancelRequest}
          className="px-6 py-4 bg-white text-red-700 border border-red-200 font-medium uppercase tracking-[0.2em] text-xs hover:bg-red-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5 text-red-500" />
          Cancel / Remove Request
        </button>
      </div>
    </div>
  );
}
