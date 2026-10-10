import React from "react";
import { BedDouble, ArrowRight } from "lucide-react";

interface RoomSelectorScreenProps {
  manualRoomInput: string;
  onManualRoomInputChange: (val: string) => void;
  onSelectRoom: (num: string) => void;
}

export default function RoomSelectorScreen({
  manualRoomInput,
  onManualRoomInputChange,
  onSelectRoom
}: RoomSelectorScreenProps) {
  const quickRooms = ["101", "102", "103", "104", "201", "202"];

  return (
    <div className="min-h-screen bg-[#F9F7F4] flex flex-col items-center justify-center p-6 text-center text-[#2D2926] font-sans">
      <div className="max-w-md w-full bg-white border border-[#E5E1DB] p-8 shadow-sm">
        <div className="w-12 h-12 bg-[#F2EFE9] text-[#A68966] mx-auto rounded-full flex items-center justify-center mb-4 border border-[#E5E1DB]">
          <BedDouble className="w-6 h-6" />
        </div>
        <h2 className="text-3xl font-serif italic mb-2">Welcome to Hues Stay</h2>
        <p className="text-[#8C857D] text-xs uppercase tracking-[0.15em] mb-6">
          Please confirm your room number
        </p>

        <div className="grid grid-cols-3 gap-2 mb-6">
          {quickRooms.map(rm => (
            <button
              key={rm}
              type="button"
              onClick={() => onSelectRoom(rm)}
              className="py-3 px-2 border border-[#E5E1DB] bg-[#FAF8F5] hover:bg-[#A68966] hover:text-white font-serif text-lg transition-colors"
            >
              Room {rm}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSelectRoom(manualRoomInput);
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={manualRoomInput}
            onChange={(e) => onManualRoomInputChange(e.target.value)}
            placeholder="Or enter room number"
            className="flex-1 border border-[#E5E1DB] px-4 py-2.5 text-sm focus:outline-none focus:border-[#A68966]"
          />
          <button
            type="submit"
            disabled={!manualRoomInput.trim()}
            className="bg-[#2D2926] text-white px-4 py-2.5 text-xs uppercase tracking-wider hover:bg-black disabled:opacity-50 flex items-center gap-1"
          >
            Enter <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
