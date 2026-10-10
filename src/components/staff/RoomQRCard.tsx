import React from "react";
import { Room } from "../../types";
import { QRCodeSVG } from "qrcode.react";
import { Trash2, Printer, ExternalLink, Copy, Check } from "lucide-react";

interface RoomQRCardProps {
  room: Room;
  copiedHash: string | null;
  onPrint: (room: Room) => void;
  onCopy: (room: Room) => void;
  onDelete: (id: string, roomNumber: string) => void;
}

export default function RoomQRCard({
  room,
  copiedHash,
  onPrint,
  onCopy,
  onDelete,
}: RoomQRCardProps) {
  const guestUrl = `${window.location.origin}/room/${room.qrCodeHash || room.roomNumber}`;
  const isCopied = copiedHash === (room.qrCodeHash || room.roomNumber);

  return (
    <div className="bg-white border border-[#E5E1DB] p-6 flex flex-col items-center text-center hover:border-[#A68966] transition-all shadow-sm">
      <div className="w-full flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-[0.2em] font-mono text-[#8C857D]">
          Floor {room.roomNumber.charAt(0)}
        </span>
        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-[#FAF8F5] border border-[#E5E1DB] text-[#8C857D]">
          Room #{room.roomNumber}
        </span>
      </div>

      <h3 className="text-3xl font-serif text-[#2D2926] mb-1">Room {room.roomNumber}</h3>
      <p className="text-[10px] uppercase tracking-[0.15em] text-[#8C857D] mb-5">
        QR: /room/{room.qrCodeHash || room.roomNumber}
      </p>

      <div className="bg-white p-3.5 border border-[#E5E1DB] mb-5 shadow-inner">
        <QRCodeSVG id={`qr-svg-${room.roomNumber}`} value={guestUrl} size={140} />
      </div>

      <div className="w-full grid grid-cols-2 gap-2 mb-3">
        <button
          type="button"
          onClick={() => onPrint(room)}
          className="bg-[#F9F7F4] text-[#2D2926] border border-[#E5E1DB] py-2.5 px-3 text-[10px] uppercase tracking-[0.15em] font-medium hover:bg-[#E5E1DB] transition-colors flex items-center justify-center"
        >
          <Printer className="w-3.5 h-3.5 mr-1.5 shrink-0" />
          Print QR
        </button>
        <button
          type="button"
          onClick={() => onCopy(room)}
          className="bg-[#F9F7F4] text-[#2D2926] border border-[#E5E1DB] py-2.5 px-3 text-[10px] uppercase tracking-[0.15em] font-medium hover:bg-[#E5E1DB] transition-colors flex items-center justify-center"
        >
          {isCopied ? (
            <>
              <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-600 shrink-0" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 mr-1.5 shrink-0" />
              Copy Link
            </>
          )}
        </button>
      </div>

      <div className="w-full flex items-center justify-between pt-3 border-t border-dashed border-[#E5E1DB]">
        <a
          href={guestUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] uppercase tracking-[0.15em] text-[#A68966] font-semibold hover:underline flex items-center gap-1"
        >
          <ExternalLink className="w-3 h-3" />
          Open Guest View
        </a>
        <button
          type="button"
          onClick={() => onDelete(room.id || `room-${room.roomNumber}`, room.roomNumber)}
          className="p-1.5 text-[#8C857D] hover:text-red-600 transition-colors"
          title={`Delete Room ${room.roomNumber}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
