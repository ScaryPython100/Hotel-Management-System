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
  unitMultiplier?: number;
}

export const COMMON_ITEMS: AmenityItem[] = [
  // Services
  { name: "Wifi Password (HuesStay123@)", category: "Service" },
  { name: "Supervisor Contact Number (8431995152)", category: "Service" },
  { name: "Soap Refill", category: "Service" },
  { name: "Shampoo Refill", category: "Service" },
  { name: "Hand wash Refill", category: "Service" },
  { name: "Stay Extension", category: "Service" },
  { name: "Housekeeping Service (Only Between 9 A.M. and 5 P.M.)", category: "Service" },
  { name: "Water Bottle (Paid)", category: "Service" },
  
  // Items (Inventory)
  { name: "Iron Box", isLimited: true, category: "Item", defaultLimit: 1, unitMultiplier: 1 },
  { name: "Kettle", isLimited: true, category: "Item", defaultLimit: 5, unitMultiplier: 1 },
  { name: "Hair Dryer", isLimited: true, category: "Item", defaultLimit: 2, unitMultiplier: 1 },
  { name: "Laptop Table", isLimited: true, category: "Item", defaultLimit: 2, unitMultiplier: 1 },
  { name: "Leg Massager (Paid)", isLimited: true, category: "Item", defaultLimit: 1, unitMultiplier: 1 },
  { name: "Glasses (Set of 2)", isLimited: true, category: "Item", defaultLimit: 10, unitMultiplier: 2 },
  { name: "USB 3.0 Cable + Adaptor", isLimited: true, category: "Item", defaultLimit: 2, unitMultiplier: 1 },
  { name: "Infrared Heat Therapy Lamp (Paid)", isLimited: true, category: "Item", defaultLimit: 1, unitMultiplier: 1 }
];

export const TARGET_AUTO_UNAVAILABLE_ITEMS = [
  "Iron Box",
  "Kettle",
  "Hair Dryer",
  "Laptop Table",
  "Leg Massager (Paid)",
  "Glasses (Set of 2)",
  "USB 3.0 Cable + Adaptor",
  "Infrared Heat Therapy Lamp (Paid)"
] as const;

export type TargetAutoUnavailableItem = typeof TARGET_AUTO_UNAVAILABLE_ITEMS[number];

export const DEFAULT_INVENTORY_LIMITS: Record<string, number> = {
  "Iron Box": 1,
  "Kettle": 5,
  "Hair Dryer": 2,
  "Laptop Table": 2,
  "Leg Massager (Paid)": 1,
  "Glasses (Set of 2)": 10,
  "USB 3.0 Cable + Adaptor": 2,
  "Infrared Heat Therapy Lamp (Paid)": 1
};

export const DEFAULT_AMENITY_STATUS: Record<string, 'available' | 'out_of_service'> = {
  "Wifi Password (HuesStay123@)": "available",
  "Supervisor Contact Number (8431995152)": "available",
  "Soap Refill": "out_of_service",
  "Shampoo Refill": "out_of_service",
  "Hand wash Refill": "available",
  "Stay Extension": "available",
  "Housekeeping Service (Only Between 9 A.M. and 5 P.M.)": "available",
  "Water Bottle (Paid)": "available",
  "Iron Box": "available",
  "Kettle": "available",
  "Hair Dryer": "available",
  "Laptop Table": "available",
  "Leg Massager (Paid)": "available",
  "Glasses (Set of 2)": "available",
  "USB 3.0 Cable + Adaptor": "available",
  "Infrared Heat Therapy Lamp (Paid)": "available"
};

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

export function getItemUnitConsumption(itemName: string): number {
  if (!itemName) return 1;
  const clean = itemName.toLowerCase().trim();
  if (clean.includes("glasses (set of 2)") || clean.includes("glasses") || clean.includes("glass")) {
    return 2;
  }
  return 1;
}

export function normalizeReturnableName(rawName: string): string {
  const base = extractBaseItemName(rawName).trim();
  const lower = base.toLowerCase();
  if (lower.includes("kettle") || lower.includes("teakettle")) return "Kettle";
  if (lower.includes("iron")) return "Iron Box";
  if (lower.includes("hair dryer") || lower.includes("dryer")) return "Hair Dryer";
  if (lower.includes("laptop")) return "Laptop Table";
  if (lower.includes("massager")) return "Leg Massager (Paid)";
  if (lower.includes("glass")) return "Glasses (Set of 2)";
  if (lower.includes("usb") || lower.includes("cable") || lower.includes("adaptor")) return "USB 3.0 Cable + Adaptor";
  if (lower.includes("infrared") || lower.includes("therapy lamp") || lower.includes("heat therapy")) return "Infrared Heat Therapy Lamp (Paid)";
  return base;
}

export function isTargetAutoUnavailableItem(name: string): boolean {
  if (!name) return false;
  const canonical = normalizeReturnableName(name);
  return (TARGET_AUTO_UNAVAILABLE_ITEMS as readonly string[]).includes(canonical);
}

export function isReturnableItem(name: string): boolean {
  if (!name) return false;
  const clean = extractBaseItemName(name).trim().toLowerCase();

  // Explicit non-returnables (consumables, one-way supplies, and services)
  const nonReturnableKeywords = [
    'water bottle', 'bottle', 'plastic', 'soap', 'shampoo', 
    'hand wash', 'refill', 'wifi', 'extend', 'stay extension', 'supervisor', 'contact', 
    'housekeeping', 'room service', 'tea bag', 'coffee', 'sugar'
  ];
  if (nonReturnableKeywords.some(kw => clean.includes(kw))) {
    return false;
  }

  // Explicit tracked borrowed appliances & durable goods:
  if (
    clean.includes('kettle') || 
    clean.includes('teakettle') ||
    clean.includes('iron') ||
    clean.includes('massager') ||
    clean.includes('laptop table') ||
    clean.includes('glass') ||
    clean.includes('adaptor') ||
    clean.includes('adapter') ||
    clean.includes('cable') ||
    clean.includes('usb') ||
    clean.includes('hair dryer') ||
    clean.includes('dryer') ||
    clean.includes('infrared') ||
    clean.includes('lamp') ||
    clean.includes('heat therapy')
  ) {
    return true;
  }

  const found = COMMON_ITEMS.find(i => i.name.toLowerCase() === clean);
  if (found) {
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
