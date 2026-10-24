import { Room } from "../../types";
import { toast } from "sonner";

/** Rooms sorted naturally (101, 102, ..., 1001) */
export function sortRooms(rooms: Room[]): Room[] {
  return [...rooms].sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
}

export function printRoomQR(room: Room) {
  const url = `${window.location.origin}/room/${room.qrCodeHash || room.roomNumber}`;
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    toast.error("Please allow popups to print QR codes");
    return;
  }

  const svgElement = document.getElementById(`qr-svg-${room.roomNumber}`);
  const svgHtml = svgElement ? svgElement.outerHTML : "";

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Room ${room.roomNumber} - Hues Stay QR Code</title>
        <style>
          body { font-family: 'Playfair Display', Georgia, serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 90vh; margin: 0; background: #faf9f6; }
          .card { text-align: center; border: 1.5px solid #2D2926; padding: 48px; background: white; max-width: 360px; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
          h1 { font-size: 32px; font-weight: 400; font-style: italic; margin: 0 0 8px 0; color: #2D2926; }
          .tagline { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase; color: #8C857D; margin-bottom: 28px; }
          .qr-box { padding: 16px; background: white; border: 1px solid #E5E1DB; display: inline-block; margin-bottom: 24px; }
          .instructions { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px; color: #555; line-height: 1.5; margin: 0; }
          .url { font-family: monospace; font-size: 10px; color: #8C857D; margin-top: 16px; word-break: break-all; }
          @media print {
            body { background: white; }
            .card { box-shadow: none; border-color: #000; }
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Room ${room.roomNumber}</h1>
          <div class="tagline">Hues Stay Luxury Guest Service</div>
          <div class="qr-box">
            ${svgHtml}
          </div>
          <p class="instructions">Scan with your smartphone camera to order amenities and request housekeeping service.</p>
          <p class="url">${url}</p>
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 300);
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}
