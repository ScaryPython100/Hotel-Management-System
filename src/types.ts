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
  { name: "Water Glasses", isLimited: true, category: "Item", defaultLimit: 10 },
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
  requestId?: string;
}

export function extractBaseItemName(itemString: string): string {
  if (!itemString) return "";
  return itemString.replace(/\s*\((?:qty:\s*)?\d+x?\)/i, "").replace(/\s*x\s*\d+$/i, "").trim();
}

export function extractItemQuantity(itemString: string): number {
  if (!itemString) return 1;
  const match = itemString.match(/\((?:qty:\s*)?(\d+)x?\)/i) || itemString.match(/x\s*(\d+)$/i);
  if (match && match[1]) {
    return Math.max(1, parseInt(match[1], 10) || 1);
  }
  return 1;
}

export function isReturnableItem(name: string): boolean {
  if (!name) return false;
  const clean = extractBaseItemName(name).trim().toLowerCase();

  // Glass / Water Glasses is physical & returnable
  if (clean === 'glasses' || clean === 'water glasses' || clean.includes('water glass') || clean.includes('glass')) {
    return true;
  }

  // Explicit non-returnables (consumables, one-way supplies, and services)
  const nonReturnableKeywords = [
    'water bottle', 'bottle', 'plastic', 'soap', 'shampoo', 
    'hand wash', 'refill', 'wifi', 'extend', 'laundry', 
    'room service', 'tea bag', 'coffee', 'sugar'
  ];
  if (nonReturnableKeywords.some(kw => clean.includes(kw))) {
    return false;
  }

  const found = COMMON_ITEMS.find(i => i.name.toLowerCase() === clean);
  if (found) {
    // Only physical Items (e.g. Kettle, Iron Box, Hair Dryer, Laptop Table, Adapters, Glasses) that are not consumable
    return found.category === 'Item';
  }

  return false;
}

export const DEFAULT_ROOMS: Room[] = [
  // 1st Floor
  { id: "room-101", roomNumber: "101", qrCodeHash: "101", status: "occupied" },
  { id: "room-102", roomNumber: "102", qrCodeHash: "102", status: "vacant" },
  { id: "room-103", roomNumber: "103", qrCodeHash: "103", status: "occupied" },
  { id: "room-104", roomNumber: "104", qrCodeHash: "104", status: "vacant" },
  // 2nd Floor
  { id: "room-201", roomNumber: "201", qrCodeHash: "201", status: "vacant" },
  { id: "room-202", roomNumber: "202", qrCodeHash: "202", status: "occupied" },
  { id: "room-203", roomNumber: "203", qrCodeHash: "203", status: "vacant" },
  { id: "room-204", roomNumber: "204", qrCodeHash: "204", status: "vacant" },
  // 3rd Floor
  { id: "room-301", roomNumber: "301", qrCodeHash: "301", status: "vacant" },
  { id: "room-302", roomNumber: "302", qrCodeHash: "302", status: "vacant" },
  { id: "room-303", roomNumber: "303", qrCodeHash: "303", status: "vacant" },
  { id: "room-304", roomNumber: "304", qrCodeHash: "304", status: "vacant" },
  // 4th Floor
  { id: "room-401", roomNumber: "401", qrCodeHash: "401", status: "vacant" },
  { id: "room-402", roomNumber: "402", qrCodeHash: "402", status: "vacant" },
  { id: "room-403", roomNumber: "403", qrCodeHash: "403", status: "vacant" },
  { id: "room-404", roomNumber: "404", qrCodeHash: "404", status: "vacant" },
  // 5th Floor
  { id: "room-501", roomNumber: "501", qrCodeHash: "501", status: "vacant" },
  { id: "room-502", roomNumber: "502", qrCodeHash: "502", status: "vacant" },
  { id: "room-503", roomNumber: "503", qrCodeHash: "503", status: "vacant" },
  { id: "room-504", roomNumber: "504", qrCodeHash: "504", status: "vacant" },
  // 6th Floor
  { id: "room-601", roomNumber: "601", qrCodeHash: "601", status: "vacant" },
  { id: "room-602", roomNumber: "602", qrCodeHash: "602", status: "vacant" },
];
