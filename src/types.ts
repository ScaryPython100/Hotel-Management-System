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

export interface AmenityItem {
  name: string;
  isLimited?: boolean;
}

export const COMMON_ITEMS: AmenityItem[] = [
  { name: "Extra Blanket" },
  { name: "Ironing Machine", isLimited: true },
  { name: "Fresh Towels" },
  { name: "Bottled Water" },
  { name: "Room Cleaning" },
  { name: "Toiletries" },
  { name: "Coffee / Tea" }
];

export interface InventoryItem {
  id?: string;
  name: string;
  inUse: number;
  limit: number;
}

export interface BorrowedItem {
  id?: string;
  roomId: string;
  itemName: string;
  status: 'borrowed' | 'returned';
  createdAt: number;
  returnedAt?: number;
}
