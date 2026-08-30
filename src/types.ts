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
  category: 'Service' | 'Item';
  defaultLimit?: number;
}

export const COMMON_ITEMS: AmenityItem[] = [
  // Services
  { name: "Soap Refill", category: "Service" },
  { name: "Shampoo Refill", category: "Service" },
  { name: "Hand wash Refill", category: "Service" },
  { name: "Wifi Password Request", category: "Service" },
  { name: "Extend the Stay", category: "Service" },
  { name: "Room Service Required (message before 9am)", category: "Service" },
  { name: "Water Bottle (Paid)", category: "Service" },
  { name: "Laundry wash assistance (Paid, self responsibility)", category: "Service" },
  
  // Items (Inventory)
  { name: "Iron Box", isLimited: true, category: "Item", defaultLimit: 5 },
  { name: "Kettle", isLimited: true, category: "Item", defaultLimit: 5 },
  { name: "Hair Dryer", isLimited: true, category: "Item", defaultLimit: 2 },
  { name: "Laptop Table", isLimited: true, category: "Item", defaultLimit: 2 },
  { name: "Leg Massager (Paid)", isLimited: true, category: "Item", defaultLimit: 1 },
  { name: "Glasses", isLimited: true, category: "Item", defaultLimit: 10 },
  { name: "USB 2.0 Adaptor + Cable", isLimited: true, category: "Item", defaultLimit: 2 },
  { name: "USB 3.0 Adaptor + Cable", isLimited: true, category: "Item", defaultLimit: 2 }
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
