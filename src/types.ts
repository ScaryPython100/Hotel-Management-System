export interface Room {
  id?: string;
  roomNumber: string;
  qrCodeHash: string;
  status: 'occupied' | 'vacant';
}

export interface RoomRequest {
  id?: string;
  roomId: string; // Refers to roomNumber now for display
  qrCodeHash: string; // The hash used to make the request
  items: string[];
  customMessage: string;
  status: 'pending' | 'completed';
  createdAt: number;
}

export const COMMON_ITEMS = [
  "Extra Blanket",
  "Ironing Machine",
  "Fresh Towels",
  "Bottled Water",
  "Room Cleaning",
  "Toiletries",
  "Coffee / Tea"
];
