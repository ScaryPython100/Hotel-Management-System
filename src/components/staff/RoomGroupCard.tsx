import React from "react";
import { RoomRequest } from "../../types";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Clock, Trash2, BedDouble } from "lucide-react";

interface RoomGroupCardProps {
  roomId: string;
  requests: RoomRequest[];
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  isPending: boolean;
}

export default function RoomGroupCard({
  roomId,
  requests,
  onComplete,
  onDelete,
  isPending
}: RoomGroupCardProps) {
  return (
    <div className={`bg-white p-6 border ${isPending ? 'border-[#A68966]' : 'border-[#E5E1DB]'} flex flex-col h-full relative`}>
      {isPending && <div className="absolute top-0 left-0 w-full h-[2px] bg-[#A68966]"></div>}

      <div className="flex justify-between items-center pb-4 border-b border-dashed border-[#E5E1DB] mb-6">
        <div className="flex items-center text-[#2D2926] font-serif text-xl">
          <BedDouble className="w-5 h-5 mr-3 text-[#A68966]" />
          Room {roomId}
        </div>
        <div className="text-[10px] uppercase tracking-widest text-[#8C857D] font-medium bg-[#F9F7F4] px-2 py-1 border border-[#E5E1DB]">
          {requests.length} Request{requests.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="flex-1 space-y-6">
        {requests.map((request, idx) => (
          <div key={request.id || idx} className="relative">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center text-[10px] uppercase tracking-widest text-[#8C857D] font-medium">
                <Clock className="w-3 h-3 mr-1.5" />
                {formatDistanceToNow(request.createdAt, { addSuffix: true })}
              </div>
            </div>

            <div className="space-y-3 pl-4 border-l-2 border-[#E5E1DB]">
              {request.items && request.items.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {request.items.map((item, itemIdx) => (
                    <span key={itemIdx} className="bg-[#F9F7F4] border border-[#E5E1DB] text-[#2D2926] px-3 py-1 text-[10px] font-medium uppercase tracking-widest">
                      {item}
                    </span>
                  ))}
                </div>
              )}

              {request.customMessage && (
                <p className="text-[#2D2926] text-sm bg-[#F9F7F4] p-3 border border-[#E5E1DB] italic">
                  "{request.customMessage}"
                </p>
              )}
            </div>

            <div className="mt-3 flex gap-2 justify-end">
              {isPending && (
                <button
                  onClick={() => onComplete(request.id!)}
                  className="bg-[#A68966] text-white px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] font-medium hover:bg-[#8E7455] transition-colors flex items-center"
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Mark Done
                </button>
              )}
              <button
                onClick={() => onDelete(request.id!)}
                className={`p-1.5 text-[#8C857D] hover:text-red-500 hover:bg-[#F9F7F4] border border-transparent hover:border-[#E5E1DB] transition-colors ${!isPending ? 'border border-[#E5E1DB]' : ''}`}
                title="Delete request"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {idx < requests.length - 1 && <div className="my-4 border-b border-dashed border-[#E5E1DB]" />}
          </div>
        ))}
      </div>
    </div>
  );
}
