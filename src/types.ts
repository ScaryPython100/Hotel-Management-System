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
  // Floor-to-Floor Relay & Smart Waitlist fields:
  isWaitlist?: boolean;
  waitlistForItem?: string;
  queuePosition?: number;
}

export type AmenitySection = 'daily' | 'returnable' | 'fnb';

export interface AmenityItem {
  name: string;
  isLimited?: boolean;
  category: 'Service' | 'Item';
  section: AmenitySection;
  subSection?: 'deposit' | 'food';
  defaultLimit?: number;
  unitMultiplier?: number;
  price?: number;
  deposit?: number;
  badge?: string;
  description?: string;
  options?: string[];
}

export const PAGE_1_DAILY_ITEMS: AmenityItem[] = [
  {
    name: "Extra Person (w/ or w/o Mattress) (₹500/-)",
    category: "Service",
    section: "daily",
    price: 500,
    badge: "₹500/-",
    description: "Additional guest accommodation per night"
  },
  { name: "Shower Gel Refill", category: "Service", section: "daily", description: "Fresh luxury body wash replenish" },
  { name: "Shampoo Refill", category: "Service", section: "daily", description: "Hair shampoo dispenser refill" },
  { name: "Hand Wash Refill", category: "Service", section: "daily", description: "Hand hygiene liquid refill" },
  { name: "First Aid Kit", category: "Service", section: "daily", description: "Bandages, antiseptic & medical essentials" },
  { 
    name: "Housekeeping Service (Only Between 10 A.M. and 4 P.M.)", 
    category: "Service", 
    section: "daily",
    badge: "10 AM - 4 PM",
    description: "Daily room cleaning, dustbin emptying & fresh linens"
  },
  { name: "Toothpaste", category: "Service", section: "daily", description: "Dental care travel toothpaste tube" },
  { name: "Toothbrush", category: "Service", section: "daily", description: "Fresh sealed soft-bristle toothbrush" }
];

export const PAGE_2_RETURNABLE_ITEMS: AmenityItem[] = [
  { name: "Iron Box", isLimited: true, category: "Item", section: "returnable", defaultLimit: 1, unitMultiplier: 1, description: "Steam/dry clothes iron (return after use)" },
  { name: "Kettle", isLimited: true, category: "Item", section: "returnable", defaultLimit: 5, unitMultiplier: 1, description: "Electric water boiler kettle (return after use)" },
  { name: "Hair Dryer", isLimited: true, category: "Item", section: "returnable", defaultLimit: 2, unitMultiplier: 1, description: "High-speed ionic hair dryer (return after use)" },
  { name: "Laptop Table", isLimited: true, category: "Item", section: "returnable", defaultLimit: 2, unitMultiplier: 1, description: "Ergonomic bed/work laptop stand (return after use)" },
  { name: "Hot Pack", isLimited: true, category: "Item", section: "returnable", defaultLimit: 2, unitMultiplier: 1, description: "Electric / gel heating relief pack (return after use)" }
];

export const PAGE_3_FNB_DEPOSIT_ITEMS: AmenityItem[] = [
  { name: "Set of Plates", isLimited: true, category: "Item", section: "fnb", subSection: "deposit", defaultLimit: 10, deposit: 100, badge: "₹100 Deposit", description: "Set of ceramic/steel dining plates" },
  { name: "Set of Cups/Bowls", isLimited: true, category: "Item", section: "fnb", subSection: "deposit", defaultLimit: 10, deposit: 100, badge: "₹100 Deposit", description: "Set of serving cups and bowls" },
  { name: "Set of Glasses", isLimited: true, category: "Item", section: "fnb", subSection: "deposit", defaultLimit: 10, deposit: 100, badge: "₹100 Deposit", description: "Set of clean drinking water glasses" },
  { name: "Empty Water Bottle", isLimited: true, category: "Item", section: "fnb", subSection: "deposit", defaultLimit: 5, deposit: 100, badge: "₹100 Deposit", description: "Reusable empty water refill bottle" },
  { name: "Cooking Oil Dispenser", isLimited: true, category: "Item", section: "fnb", subSection: "deposit", defaultLimit: 5, deposit: 100, badge: "₹100 Deposit", description: "Kitchen cooking oil dispenser bottle" }
];

export const PAGE_3_QUICK_FOOD_ITEMS: AmenityItem[] = [
  { name: "Maggi (₹20)", isLimited: true, category: "Item", section: "fnb", subSection: "food", defaultLimit: 20, price: 20, badge: "₹20", description: "Classic 2-minute instant noodles pack" },
  { name: "Eggs (₹10)", isLimited: true, category: "Item", section: "fnb", subSection: "food", defaultLimit: 30, price: 10, badge: "₹10", description: "Fresh farm eggs (price per egg)" },
  { name: "Coffee Sachet (₹5 per sachet)", isLimited: true, category: "Item", section: "fnb", subSection: "food", defaultLimit: 50, price: 5, badge: "₹5 / sachet", description: "Instant rich coffee powder sachet" },
  { 
    name: "Soft Drinks (₹50)", 
    isLimited: true, 
    category: "Item", 
    section: "fnb", 
    subSection: "food", 
    defaultLimit: 20, 
    price: 50, 
    badge: "₹50", 
    description: "Chilled soft drink bottle",
    options: ["Coke", "Pepsi"]
  },
  { 
    name: "Toned Milk 200/500 mL (₹30)", 
    isLimited: true, 
    category: "Item", 
    section: "fnb", 
    subSection: "food", 
    defaultLimit: 15, 
    price: 30, 
    badge: "₹30", 
    description: "Fresh pasteurized toned milk pouch",
    options: ["200 mL", "500 mL"]
  },
  { name: "Masala Box (₹50)", isLimited: true, category: "Item", section: "fnb", subSection: "food", defaultLimit: 5, price: 50, badge: "₹50", description: "Essential cooking spices and seasoning box" }
];

export const COMMON_ITEMS: AmenityItem[] = [
  ...PAGE_1_DAILY_ITEMS,
  ...PAGE_2_RETURNABLE_ITEMS,
  ...PAGE_3_FNB_DEPOSIT_ITEMS,
  ...PAGE_3_QUICK_FOOD_ITEMS
];

export const TARGET_AUTO_UNAVAILABLE_ITEMS = [
  "Iron Box",
  "Kettle",
  "Hair Dryer",
  "Laptop Table",
  "Hot Pack",
  "Set of Plates",
  "Set of Cups/Bowls",
  "Set of Glasses",
  "Empty Water Bottle",
  "Cooking Oil Dispenser",
  "Maggi (₹20)",
  "Eggs (₹10)",
  "Coffee Sachet (₹5 per sachet)",
  "Soft Drinks (₹50)",
  "Toned Milk 200/500 mL (₹30)",
  "Masala Box (₹50)",
  // Backward compatibility:
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
  "Hot Pack": 2,
  "Set of Plates": 10,
  "Set of Cups/Bowls": 10,
  "Set of Glasses": 10,
  "Empty Water Bottle": 5,
  "Cooking Oil Dispenser": 5,
  "Maggi (₹20)": 20,
  "Eggs (₹10)": 30,
  "Coffee Sachet (₹5 per sachet)": 50,
  "Soft Drinks (₹50)": 20,
  "Toned Milk 200/500 mL (₹30)": 15,
  "Masala Box (₹50)": 5,
  "Leg Massager (Paid)": 1,
  "Glasses (Set of 2)": 10,
  "USB 3.0 Cable + Adaptor": 2,
  "Infrared Heat Therapy Lamp (Paid)": 1
};

export const DEFAULT_AMENITY_STATUS: Record<string, 'available' | 'out_of_service'> = {
  "Extra Person (w/ or w/o Mattress) (₹500/-)": "available",
  "Shower Gel Refill": "available",
  "Shampoo Refill": "available",
  "Hand Wash Refill": "available",
  "First Aid Kit": "available",
  "Housekeeping Service (Only Between 10 A.M. and 4 P.M.)": "available",
  "Toothpaste": "available",
  "Toothbrush": "available",
  "Iron Box": "available",
  "Kettle": "available",
  "Hair Dryer": "available",
  "Laptop Table": "available",
  "Hot Pack": "available",
  "Set of Plates": "available",
  "Set of Cups/Bowls": "available",
  "Set of Glasses": "available",
  "Empty Water Bottle": "available",
  "Cooking Oil Dispenser": "available",
  "Maggi (₹20)": "available",
  "Eggs (₹10)": "available",
  "Coffee Sachet (₹5 per sachet)": "available",
  "Soft Drinks (₹50)": "available",
  "Soft Drinks - Coke": "available",
  "Soft Drinks - Pepsi": "available",
  "Toned Milk 200/500 mL (₹30)": "available",
  "Toned Milk - 200 mL": "available",
  "Toned Milk - 500 mL": "available",
  "Masala Box (₹50)": "available"
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
  // Floor-to-Floor Relay history tracking:
  relayedFromRoom?: string;
  relayCount?: number;
}

/**
 * Extracts the floor level from a hotel room number.
 * E.g., Room 304 -> Floor 3, Room 512 -> Floor 5, Room 102 -> Floor 1.
 */
export function extractFloorFromRoom(roomNumber: string): number {
  const digits = String(roomNumber || '').replace(/\D/g, '');
  if (digits.length >= 3) {
    return parseInt(digits.slice(0, digits.length - 2), 10);
  }
  return 1;
}

export function getFloorOrdinal(floor: number): string {
  if (floor === 1) return "1st";
  if (floor === 2) return "2nd";
  if (floor === 3) return "3rd";
  return `${floor}th`;
}

export function getFloorRelayBadge(sourceRoom: string, targetRoom: string): {
  isSameFloor: boolean;
  badgeText: string;
  deltaFloors: number;
  sourceFloor: number;
  targetFloor: number;
} {
  const sourceFloor = extractFloorFromRoom(sourceRoom);
  const targetFloor = extractFloorFromRoom(targetRoom);
  const isSameFloor = sourceFloor === targetFloor;
  const deltaFloors = targetFloor - sourceFloor;

  if (isSameFloor) {
    return {
      isSameFloor: true,
      badgeText: `Same Floor (${getFloorOrdinal(sourceFloor)} Floor)`,
      deltaFloors: 0,
      sourceFloor,
      targetFloor
    };
  }

  const sign = deltaFloors > 0 ? `+${deltaFloors}` : `${deltaFloors}`;
  const floorWord = Math.abs(deltaFloors) === 1 ? 'Floor' : 'Floors';
  return {
    isSameFloor: false,
    badgeText: `${getFloorOrdinal(sourceFloor)} Floor → ${getFloorOrdinal(targetFloor)} Floor (${sign} ${floorWord})`,
    deltaFloors,
    sourceFloor,
    targetFloor
  };
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
  if (lower.includes("hot pack") || lower.includes("pack")) return "Hot Pack";
  if (lower.includes("plate")) return "Set of Plates";
  if (lower.includes("cup") || lower.includes("bowl")) return "Set of Cups/Bowls";
  if (lower.includes("glass")) return "Set of Glasses";
  if (lower.includes("empty water bottle") || (lower.includes("bottle") && lower.includes("empty"))) return "Empty Water Bottle";
  if (lower.includes("oil dispenser") || lower.includes("cooking oil")) return "Cooking Oil Dispenser";
  if (lower.includes("massager")) return "Leg Massager (Paid)";
  if (lower.includes("usb") || lower.includes("cable") || lower.includes("adaptor")) return "USB 3.0 Cable + Adaptor";
  if (lower.includes("infrared") || lower.includes("therapy lamp") || lower.includes("heat therapy")) return "Infrared Heat Therapy Lamp (Paid)";
  if (lower.includes("maggi")) return "Maggi (₹20)";
  if (lower.includes("egg")) return "Eggs (₹10)";
  if (lower.includes("coffee")) return "Coffee Sachet (₹5 per sachet)";
  if (lower.includes("soft drink") || lower.includes("coke") || lower.includes("pepsi")) return "Soft Drinks (₹50)";
  if (lower.includes("toned milk") || lower.includes("milk")) return "Toned Milk 200/500 mL (₹30)";
  if (lower.includes("masala")) return "Masala Box (₹50)";
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
    'extra person', 'mattress', 'gel', 'shampoo', 'hand wash', 'soap', 'first aid',
    'housekeeping', 'toothpaste', 'toothbrush', 'maggi', 'egg', 'coffee', 'soft drink',
    'pepsi', 'coke', 'toned milk', 'milk', 'masala', 'wifi', 'extend', 'stay extension', 'checkout', 'contact'
  ];
  if (nonReturnableKeywords.some(kw => clean.includes(kw))) {
    return false;
  }

  // Explicit tracked borrowed appliances & durable goods (Page 2 & Page 3 Deposit returnables):
  if (
    clean.includes('kettle') || 
    clean.includes('teakettle') ||
    clean.includes('iron') ||
    clean.includes('hair dryer') ||
    clean.includes('dryer') ||
    clean.includes('laptop table') ||
    clean.includes('laptop') ||
    clean.includes('hot pack') ||
    clean.includes('pack') ||
    clean.includes('plate') ||
    clean.includes('cup') ||
    clean.includes('bowl') ||
    clean.includes('glass') ||
    clean.includes('oil dispenser') ||
    clean.includes('massager') ||
    clean.includes('adaptor') ||
    clean.includes('adapter') ||
    clean.includes('cable') ||
    clean.includes('usb') ||
    clean.includes('infrared') ||
    clean.includes('lamp') ||
    clean.includes('heat therapy')
  ) {
    return true;
  }

  if (clean.includes('bottle') && clean.includes('empty')) {
    return true;
  }

  const found = COMMON_ITEMS.find(i => i.name.toLowerCase() === clean);
  if (found) {
    return found.category === 'Item' || found.section === 'returnable' || found.section === 'fnb';
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
