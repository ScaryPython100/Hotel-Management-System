import React from "react";
import { Check, Trash2 } from "lucide-react";

export const ITEM_EMOJI_MAP: Record<string, string> = {
  "Iron Box": "👕",
  "Kettle": "🫖",
  "Hair Dryer": "💇‍♀️",
  "Laptop Table": "💻",
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
}

export default function RequestSuccessScreen({
  roomNumber,
  selectedItems,
  onMakeAnotherRequest,
  onCancelRequest
}: RequestSuccessScreenProps) {
  return (
    <div className="min-h-screen bg-[#F9F7F4] flex flex-col items-center justify-center p-6 text-center text-[#2D2926] font-sans">
      <div className="w-20 h-20 bg-[#F2EFE9] text-[#A68966] rounded-full flex items-center justify-center mb-6 border border-[#E5E1DB] shadow-xs">
        <Check className="w-10 h-10 stroke-[2.5]" />
      </div>
      <h2 className="text-3xl font-serif italic mb-2">Request Received</h2>
      <p className="text-[#8C857D] mb-6 max-w-md text-sm">
        Our housekeeping and guest service team has been notified and will attend to Room {roomNumber} promptly.
      </p>

      {selectedItems.length > 0 && (
        <div className="bg-white border border-[#E5E1DB] p-4 mb-8 max-w-sm w-full text-left shadow-2xs">
          <span className="text-[10px] uppercase tracking-widest text-[#8C857D] font-mono block mb-2 font-semibold">
            Requested Items
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
                  <span className="font-mono text-xs text-[#A68966] bg-[#FAF8F5] px-2 py-0.5 border border-[#EBE7E1] rounded-xs">
                    Requested
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
