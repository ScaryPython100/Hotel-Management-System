import React, { useState } from "react";
import {
  AmenitySection,
  PAGE_1_DAILY_ITEMS,
  PAGE_2_RETURNABLE_ITEMS,
  PAGE_3_FNB_DEPOSIT_ITEMS,
  PAGE_3_QUICK_FOOD_ITEMS,
  getItemUnitConsumption,
  isReturnableItem,
  normalizeReturnableName,
  extractBaseItemName
} from "../../types";
import { cn } from "../../lib/utils";
import toast from "react-hot-toast";
import { Check, Clock, Plus, Minus, Info, Copy } from "lucide-react";
import { ITEM_EMOJI_MAP } from "./RequestSuccessScreen";
import upiQrImage from "../../assets/huesstay-upi-qr.png";

interface AmenityGridSectionProps {
  activeTab: AmenitySection;
  deletedItems: string[];
  selectedItems: string[];
  inventory: Record<string, { inUse: number; limit: number }>;
  getInventoryData: (name: string) => { inUse: number; limit: number } | undefined;
  checkIsItemOutOfService: (item: string) => boolean;
  onToggleItem: (item: string) => void;
  onUpdateItemString: (oldPattern: string, newString: string | null) => void;
  waitlistCounts?: Record<string, number>;
  amenitiesStatus?: Record<string, 'available' | 'out_of_service'>;
}

export default function AmenityGridSection({
  activeTab,
  deletedItems,
  selectedItems,
  inventory,
  getInventoryData,
  checkIsItemOutOfService,
  onToggleItem,
  onUpdateItemString,
  waitlistCounts = {},
  amenitiesStatus = {}
}: AmenityGridSectionProps) {
  const deletedSet = new Set(deletedItems);

  const [softDrinkOption, setSoftDrinkOption] = useState<"Coke" | "Pepsi">("Coke");
  const [tonedMilkOption, setTonedMilkOption] = useState<"200 mL" | "500 mL">("200 mL");
  const [copiedUpi, setCopiedUpi] = useState(false);

  const handleCopyUpi = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText("huesstay@okicici").catch(() => {});
    setCopiedUpi(true);
    toast.success("UPI ID copied: huesstay@okicici");
    setTimeout(() => setCopiedUpi(false), 2000);
  };

  const renderPaymentQrSection = () => (
    <div className="bg-white border border-[#E5E1DB] p-4 text-center shadow-xs mt-6">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#A68966] mb-2.5">
        Payment QR Code
      </div>
      <div className="flex flex-col items-center justify-center">
        <img
          src={upiQrImage}
          alt="Hues Stay UPI QR Code"
          className="w-48 sm:w-52 h-auto object-contain rounded-md border border-[#E5E1DB]"
        />
        <button
          type="button"
          onClick={handleCopyUpi}
          className="mt-2.5 text-[11px] font-medium text-[#8C857D] hover:text-[#2D2926] inline-flex items-center gap-1 cursor-pointer transition-colors"
        >
          {copiedUpi ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5 text-[#A68966]" />}
          <span>{copiedUpi ? "UPI ID Copied!" : "Copy UPI ID: huesstay@okicici"}</span>
        </button>
      </div>
    </div>
  );

  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({
    "Maggi": 1,
    "Eggs": 2,
    "Coffee Sachet": 2,
    "Soft Drinks (300mL)": 1,
    "Toned Milk": 1,
    "Masala Box": 1,
    "Set of Plates": 1,
    "Set of Cups/Bowls": 1,
    "Set of Glasses": 1,
    "Empty Water Bottle": 1,
    "Cooking Oil Dispenser": 1,
    // Backward compatibility:
    "Maggi (₹20)": 1,
    "Eggs (₹10)": 2,
    "Coffee Sachet (₹5 per sachet)": 2,
    "Soft Drinks (₹50)": 1,
    "Toned Milk 200/500 mL (₹30)": 1,
    "Masala Box (₹50)": 1
  });

  const getQty = (baseName: string) => itemQuantities[baseName] || 1;

  const changeQty = (baseName: string, delta: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const current = getQty(baseName);
    const next = Math.max(1, Math.min(10, current + delta));
    setItemQuantities(prev => ({ ...prev, [baseName]: next }));

    // If already selected, update the selectedItems array immediately
    const existing = selectedItems.find(s => {
      const lower = s.toLowerCase();
      const baseLower = baseName.toLowerCase();
      return lower.includes(baseLower) || baseLower.includes(extractBaseItemName(s).toLowerCase());
    });
    if (existing) {
      const updatedString = formatItemSelectionString(baseName, next);
      onUpdateItemString(existing, updatedString);
    }
  };

  const formatItemSelectionString = (baseName: string, qty: number): string => {
    if (baseName.includes("Extra Person")) {
      return "Extra Person (w/ or w/o Mattress) (₹500/-)";
    }
    if (baseName.includes("Soft Drinks")) {
      const isCokeOut = amenitiesStatus["Soft Drinks - Coke"] === "out_of_service";
      const isPepsiOut = amenitiesStatus["Soft Drinks - Pepsi"] === "out_of_service";
      const flavor = isCokeOut && !isPepsiOut ? "Pepsi" : (isPepsiOut && !isCokeOut ? "Coke" : softDrinkOption);
      return qty > 1 ? `Soft Drinks (300mL) (${flavor}) (₹50 Per Can) (qty: ${qty})` : `Soft Drinks (300mL) (${flavor}) (₹50 Per Can)`;
    }
    if (baseName.includes("Toned Milk")) {
      const is200Out = amenitiesStatus["Toned Milk - 200 mL"] === "out_of_service";
      const is500Out = amenitiesStatus["Toned Milk - 500 mL"] === "out_of_service";
      const size = is200Out && !is500Out ? "500 mL" : (is500Out && !is200Out ? "200 mL" : tonedMilkOption);
      const price = size === "500 mL" ? 40 : 20;
      return qty > 1 ? `Toned Milk (${size}) (₹${price}) (qty: ${qty})` : `Toned Milk (${size}) (₹${price})`;
    }
    if (baseName === "Maggi") {
      return qty > 1 ? `Maggi (₹20 Per Pack) (qty: ${qty})` : `Maggi (₹20 Per Pack)`;
    }
    if (baseName === "Eggs") {
      return qty > 1 ? `Eggs (₹10 Per Egg) (qty: ${qty})` : `Eggs (₹10 Per Egg)`;
    }
    if (baseName === "Coffee Sachet") {
      return qty > 1 ? `Coffee Sachet (₹5 / sachet) (qty: ${qty})` : `Coffee Sachet (₹5 / sachet)`;
    }
    if (baseName === "Masala Box") {
      return qty > 1 ? `Masala Box (₹50) (qty: ${qty})` : `Masala Box (₹50)`;
    }
    if (qty > 1) {
      return `${baseName} (qty: ${qty})`;
    }
    return baseName;
  };

  const isSelected = (baseName: string): boolean => {
    return selectedItems.some(s => {
      const sLower = s.toLowerCase();
      const bLower = baseName.toLowerCase();
      if (bLower.includes("extra person") && sLower.includes("extra person")) return true;
      if (bLower.includes("soft drink") && sLower.includes("soft drink")) return true;
      if (bLower.includes("toned milk") && sLower.includes("toned milk")) return true;
      if (bLower.includes("maggi") && sLower.includes("maggi")) return true;
      if (bLower.includes("egg") && sLower.includes("egg")) return true;
      if (bLower.includes("coffee") && sLower.includes("coffee")) return true;
      return sLower === bLower || sLower.startsWith(bLower) || extractBaseItemName(s).toLowerCase() === bLower;
    });
  };

  const handleItemClick = (baseName: string, isWaitlistActive: boolean, isDisabled: boolean) => {
    if (isDisabled) {
      toast.error(`${baseName} is currently unavailable.`);
      return;
    }

    const currentlySelected = isSelected(baseName);

    if (currentlySelected) {
      // Deselect: remove from selectedItems
      const existing = selectedItems.find(s => {
        const sLower = s.toLowerCase();
        const bLower = baseName.toLowerCase();
        return sLower.includes(bLower) || bLower.includes(extractBaseItemName(s).toLowerCase());
      });
      if (existing) {
        onUpdateItemString(existing, null);
      } else {
        onToggleItem(baseName);
      }
    } else {
      // Select
      if (isWaitlistActive) {
        toast(`Reserving ${baseName} next in line. Housekeeping will relay it directly!`, {
          icon: "⏳",
          duration: 3500
        });
      }
      const qty = getQty(baseName);
      const formatted = formatItemSelectionString(baseName, qty);
      onToggleItem(formatted);
    }
  };

  // 1. PAGE 1: DAILY SERVICES
  const page1Items = PAGE_1_DAILY_ITEMS.filter(i => !deletedSet.has(i.name));

  // 2. PAGE 2: RETURNABLE ITEMS (Strictly the 5 shared appliances)
  const page2Items = PAGE_2_RETURNABLE_ITEMS.filter(i => !deletedSet.has(i.name));

  // 3. PAGE 3: F&B ITEMS
  const fnbDepositItems = PAGE_3_FNB_DEPOSIT_ITEMS.filter(i => !deletedSet.has(i.name));
  const fnbQuickFoodItems = PAGE_3_QUICK_FOOD_ITEMS.filter(i => !deletedSet.has(i.name));

  return (
    <div className="space-y-6">
      {/* PAGE 1: DAILY SERVICES */}
      {activeTab === "daily" && (
        <section className="animate-fadeIn space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {page1Items.map((itemObj) => {
              const item = itemObj.name;
              const selected = isSelected(item);
              const isOutOfService = checkIsItemOutOfService(item);
              const isDisabled = isOutOfService;
              const emoji = ITEM_EMOJI_MAP[item] || "✨";
              const isExtraPerson = item.includes("Extra Person");

              return (
                <div
                  key={item}
                  onClick={() => handleItemClick(item, false, isDisabled)}
                  className={cn(
                    "bg-white border p-5 flex flex-col justify-between text-left transition-all duration-200 min-h-[110px] rounded-none relative gap-3 select-none shadow-xs",
                    selected
                      ? "bg-[#F2EFE9] border-[#A68966] text-[#2D2926]"
                      : "border-[#E5E1DB] text-[#2D2926] hover:bg-[#F2EFE9]",
                    isDisabled ? "opacity-50 cursor-not-allowed hover:bg-white border-[#E5E1DB]" : "cursor-pointer"
                  )}
                >
                  <div className="flex justify-between items-start w-full gap-2">
                    <div>
                      <span className="font-serif text-base md:text-lg leading-tight flex items-center gap-2">
                        <span className="text-xl">{emoji}</span>
                        <span>{item}</span>
                      </span>
                      {itemObj.description && (
                        <p className="text-[11px] text-[#8C857D] mt-1 line-clamp-2">
                          {itemObj.description}
                        </p>
                      )}
                    </div>
                    <div
                      className={cn(
                        "w-5 h-5 flex items-center justify-center shrink-0 border rounded-xs mt-0.5 transition-colors",
                        selected ? "border-[#A68966] bg-[#A68966]" : "border-[#E5E1DB]",
                        isDisabled && "border-[#E5E1DB] bg-gray-100"
                      )}
                    >
                      {selected && <Check className="w-3 h-3 text-white stroke-[3]" />}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {itemObj.badge && (
                      <span className="text-[10px] font-semibold text-[#A68966] bg-[#FAF8F5] border border-[#E5E1DB] px-2 py-0.5">
                        {itemObj.badge}
                      </span>
                    )}
                    {isOutOfService && (
                      <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 uppercase tracking-wider font-semibold rounded-sm">
                        Unavailable
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {renderPaymentQrSection()}
        </section>
      )}

      {/* PAGE 2: RETURNABLE ITEMS */}
      {activeTab === "returnable" && (
        <section className="animate-fadeIn space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {page2Items.map((itemObj) => {
              const item = itemObj.name;
              const selected = isSelected(item);
              const inv = getInventoryData(item);
              const neededUnits = getItemUnitConsumption(item);
              const availableUnits = inv ? Math.max(0, inv.limit - inv.inUse) : 10;
              const isOutOfStock = (itemObj.isLimited || inv !== undefined) && inv && availableUnits < neededUnits;
              const isOutOfService = checkIsItemOutOfService(item);
              const isReturnable = isReturnableItem(item);
              const canonicalName = normalizeReturnableName(item);
              const isManualOutOfService =
                amenitiesStatus[item] === 'out_of_service' ||
                amenitiesStatus[canonicalName] === 'out_of_service';

              const isWaitlistActive = isReturnable && isOutOfStock && !isManualOutOfService;
              const isDisabled = !isWaitlistActive && (isOutOfStock || isOutOfService);
              const queueDepth = waitlistCounts[canonicalName] || 0;
              const emoji = ITEM_EMOJI_MAP[item] || "📦";

              return (
                <div
                  key={item}
                  onClick={() => handleItemClick(item, isWaitlistActive, isDisabled)}
                  className={cn(
                    "bg-white border p-5 flex flex-col justify-between text-left transition-all duration-200 min-h-[110px] rounded-none relative gap-3 select-none shadow-xs",
                    isWaitlistActive && selected
                      ? "bg-amber-50/80 border-amber-400 text-[#2D2926]"
                      : selected
                      ? "bg-[#F2EFE9] border-[#A68966] text-[#2D2926]"
                      : isWaitlistActive
                      ? "border-amber-200 bg-amber-50/30 text-[#2D2926] hover:bg-amber-50/60"
                      : "border-[#E5E1DB] text-[#2D2926] hover:bg-[#F2EFE9]",
                    isDisabled
                      ? "opacity-60 cursor-not-allowed bg-[#FAF9F7] border-dashed border-[#D5D1CB] hover:bg-[#FAF9F7]"
                      : "cursor-pointer"
                  )}
                >
                  <div className="flex justify-between items-start w-full gap-2">
                    <div>
                      <span className="font-serif text-base md:text-lg leading-tight flex items-center gap-2">
                        <span className="text-xl">{emoji}</span>
                        <span>{item}</span>
                      </span>
                      {itemObj.description && (
                        <p className="text-[11px] text-[#8C857D] mt-1 line-clamp-2">
                          {itemObj.description}
                        </p>
                      )}
                    </div>
                    <div
                      className={cn(
                        "w-5 h-5 flex items-center justify-center shrink-0 border rounded-xs mt-0.5 transition-colors",
                        isWaitlistActive && selected
                          ? "border-amber-600 bg-amber-600"
                          : selected
                          ? "border-[#A68966] bg-[#A68966]"
                          : isWaitlistActive
                          ? "border-amber-300 bg-white"
                          : "border-[#E5E1DB]",
                        isDisabled && "border-[#E5E1DB] bg-gray-100"
                      )}
                    >
                      {selected && <Check className="w-3 h-3 text-white stroke-[3]" />}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {isWaitlistActive ? (
                      <span className="text-[10px] text-amber-900 bg-amber-100/90 border border-amber-300 px-2 py-0.5 uppercase tracking-wider font-semibold rounded-sm inline-flex items-center gap-1 w-fit">
                        <Clock className="w-3 h-3 text-amber-700" />
                        <span>
                          {selected
                            ? (queueDepth === 0 ? "Next in Queue" : `No. ${queueDepth + 1} in Queue`)
                            : `Item is in Use • ${queueDepth === 0 ? "Next in Queue" : `No. ${queueDepth + 1} in Queue`}`}
                        </span>
                      </span>
                    ) : isDisabled ? (
                      <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 uppercase tracking-wider font-semibold rounded-sm inline-block w-fit">
                        Unavailable
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {renderPaymentQrSection()}
        </section>
      )}

      {/* PAGE 3: F&B ESSENTIALS */}
      {activeTab === "fnb" && (
        <section className="animate-fadeIn space-y-6">
          {/* Sub-section A: Kitchen & Dining Essentials */}
          <div className="space-y-4">
            <div className="border-l-2 border-[#A68966] pl-3">
              <h3 className="font-serif text-lg text-[#2D2926]">
                Kitchen & Dining Essentials
              </h3>
              <p className="text-xs text-[#8C857D] font-medium mt-0.5">
                * ₹100 refundable deposit per utensil (self-cleaning required)
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {fnbDepositItems.map((itemObj) => {
                const item = itemObj.name;
                const selected = isSelected(item);
                const isOutOfService = checkIsItemOutOfService(item);
                const isDisabled = isOutOfService;
                const qty = getQty(item);
                const emoji = ITEM_EMOJI_MAP[item] || "🍽️";

                return (
                  <div
                    key={item}
                    onClick={() => handleItemClick(item, false, isDisabled)}
                    className={cn(
                      "bg-white border p-5 flex flex-col justify-between text-left transition-all duration-200 min-h-[120px] rounded-none relative gap-3 select-none shadow-xs",
                      selected
                        ? "bg-[#F2EFE9] border-[#A68966] text-[#2D2926]"
                        : "border-[#E5E1DB] text-[#2D2926] hover:bg-[#F2EFE9]",
                      isDisabled ? "opacity-50 cursor-not-allowed hover:bg-white border-[#E5E1DB]" : "cursor-pointer"
                    )}
                  >
                    <div className="flex justify-between items-start w-full gap-2">
                      <div>
                        <span className="font-serif text-base md:text-lg leading-tight flex items-center gap-2">
                          <span className="text-xl">{emoji}</span>
                          <span>{item}</span>
                        </span>
                        {itemObj.description && (
                          <p className="text-[11px] text-[#8C857D] mt-1">
                            {itemObj.description}
                          </p>
                        )}
                      </div>
                      <div
                        className={cn(
                          "w-5 h-5 flex items-center justify-center shrink-0 border rounded-xs mt-0.5 transition-colors",
                          selected ? "border-[#A68966] bg-[#A68966]" : "border-[#E5E1DB]",
                          isDisabled && "border-[#E5E1DB] bg-gray-100"
                        )}
                      >
                        {selected && <Check className="w-3 h-3 text-white stroke-[3]" />}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[#E5E1DB]/60 flex items-center justify-end">
                      {/* Quantity Stepper */}
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1.5 bg-white border border-[#E5E1DB] px-1 py-0.5"
                      >
                        <button
                          type="button"
                          onClick={(e) => changeQty(item, -1, e)}
                          className="w-5 h-5 flex items-center justify-center text-[#8C857D] hover:text-[#2D2926] cursor-pointer"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs font-mono font-semibold px-1 text-[#2D2926]">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => changeQty(item, 1, e)}
                          className="w-5 h-5 flex items-center justify-center text-[#8C857D] hover:text-[#2D2926] cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sub-section B: Quick Food Items */}
          <div className="space-y-4 pt-4 border-t border-[#E5E1DB]">
            <div className="border-l-2 border-[#A68966] pl-3">
              <h3 className="font-serif text-lg text-[#2D2926]">
                Quick Food Items
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {fnbQuickFoodItems.map((itemObj) => {
                const item = itemObj.name;
                const selected = isSelected(item);
                const isSoftDrink = item.includes("Soft Drinks");
                const isTonedMilk = item.includes("Toned Milk");

                const isCokeOut = isSoftDrink && amenitiesStatus["Soft Drinks - Coke"] === "out_of_service";
                const isPepsiOut = isSoftDrink && amenitiesStatus["Soft Drinks - Pepsi"] === "out_of_service";
                const isAllSoftDrinksOut = isSoftDrink && isCokeOut && isPepsiOut;

                const is200Out = isTonedMilk && amenitiesStatus["Toned Milk - 200 mL"] === "out_of_service";
                const is500Out = isTonedMilk && amenitiesStatus["Toned Milk - 500 mL"] === "out_of_service";
                const isAllMilkOut = isTonedMilk && is200Out && is500Out;

                const isOutOfService = checkIsItemOutOfService(item) || isAllSoftDrinksOut || isAllMilkOut;
                const isDisabled = isOutOfService;
                const qty = getQty(item);
                const emoji = ITEM_EMOJI_MAP[item] || "🍜";

                const activeSoftDrinkFlavor = isCokeOut && !isPepsiOut ? "Pepsi" : (isPepsiOut && !isCokeOut ? "Coke" : softDrinkOption);
                const activeTonedMilkSize = is200Out && !is500Out ? "500 mL" : (is500Out && !is200Out ? "200 mL" : tonedMilkOption);

                return (
                  <div
                    key={item}
                    onClick={() => handleItemClick(item, false, isDisabled)}
                    className={cn(
                      "bg-white border p-5 flex flex-col justify-between text-left transition-all duration-200 min-h-[120px] rounded-none relative gap-3 select-none shadow-xs",
                      selected
                        ? "bg-[#F2EFE9] border-[#A68966] text-[#2D2926]"
                        : "border-[#E5E1DB] text-[#2D2926] hover:bg-[#F2EFE9]",
                      isDisabled ? "opacity-50 cursor-not-allowed hover:bg-white border-[#E5E1DB]" : "cursor-pointer"
                    )}
                  >
                    <div className="flex justify-between items-start w-full gap-2">
                      <div>
                        <span className="font-serif text-base md:text-lg leading-tight flex items-center gap-2">
                          <span className="text-xl">{emoji}</span>
                          <span>{item}</span>
                        </span>
                        {itemObj.description && (
                          <p className="text-[11px] text-[#8C857D] mt-1">
                            {itemObj.description}
                          </p>
                        )}
                      </div>
                      <div
                        className={cn(
                          "w-5 h-5 flex items-center justify-center shrink-0 border rounded-xs mt-0.5 transition-colors",
                          selected ? "border-[#A68966] bg-[#A68966]" : "border-[#E5E1DB]",
                          isDisabled && "border-[#E5E1DB] bg-gray-100"
                        )}
                      >
                        {selected && <Check className="w-3 h-3 text-white stroke-[3]" />}
                      </div>
                    </div>

                    {/* Dropdown / Toggle for Soft Drinks (Coke / Pepsi) */}
                    {isSoftDrink && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 pt-2 border-t border-[#E5E1DB]/60"
                      >
                        <span className="text-[11px] text-[#8C857D] font-medium">Flavor:</span>
                        <div className="flex border border-[#E5E1DB] bg-white p-0.5">
                          <button
                            type="button"
                            disabled={isCokeOut}
                            onClick={() => {
                              if (isCokeOut) return;
                              setSoftDrinkOption("Coke");
                              if (selected) {
                                onUpdateItemString(
                                  selectedItems.find(s => s.toLowerCase().includes("soft drink")) || "",
                                  formatItemSelectionString("Soft Drinks (300mL)", qty)
                                );
                              }
                            }}
                            className={cn(
                              "px-2 py-0.5 text-[11px] font-semibold transition-colors",
                              isCokeOut
                                ? "opacity-40 cursor-not-allowed line-through text-gray-400"
                                : activeSoftDrinkFlavor === "Coke"
                                ? "bg-[#2D2926] text-white"
                                : "text-[#8C857D] hover:text-[#2D2926]"
                            )}
                          >
                            Coke {isCokeOut ? "(Out)" : ""}
                          </button>
                          <button
                            type="button"
                            disabled={isPepsiOut}
                            onClick={() => {
                              if (isPepsiOut) return;
                              setSoftDrinkOption("Pepsi");
                              if (selected) {
                                onUpdateItemString(
                                  selectedItems.find(s => s.toLowerCase().includes("soft drink")) || "",
                                  formatItemSelectionString("Soft Drinks (300mL)", qty)
                                );
                              }
                            }}
                            className={cn(
                              "px-2 py-0.5 text-[11px] font-semibold transition-colors",
                              isPepsiOut
                                ? "opacity-40 cursor-not-allowed line-through text-gray-400"
                                : activeSoftDrinkFlavor === "Pepsi"
                                ? "bg-[#2D2926] text-white"
                                : "text-[#8C857D] hover:text-[#2D2926]"
                            )}
                          >
                            Pepsi {isPepsiOut ? "(Out)" : ""}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Dropdown / Toggle for Toned Milk (200 mL / 500 mL) */}
                    {isTonedMilk && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 pt-2 border-t border-[#E5E1DB]/60"
                      >
                        <span className="text-[11px] text-[#8C857D] font-medium">Size:</span>
                        <div className="flex border border-[#E5E1DB] bg-white p-0.5">
                          <button
                            type="button"
                            disabled={is200Out}
                            onClick={() => {
                              if (is200Out) return;
                              setTonedMilkOption("200 mL");
                              if (selected) {
                                onUpdateItemString(
                                  selectedItems.find(s => s.toLowerCase().includes("toned milk")) || "",
                                  formatItemSelectionString("Toned Milk", qty)
                                );
                              }
                            }}
                            className={cn(
                              "px-2 py-0.5 text-[11px] font-semibold transition-colors",
                              is200Out
                                ? "opacity-40 cursor-not-allowed line-through text-gray-400"
                                : activeTonedMilkSize === "200 mL"
                                ? "bg-[#2D2926] text-white"
                                : "text-[#8C857D] hover:text-[#2D2926]"
                            )}
                          >
                            200 mL {is200Out ? "(Out)" : ""}
                          </button>
                          <button
                            type="button"
                            disabled={is500Out}
                            onClick={() => {
                              if (is500Out) return;
                              setTonedMilkOption("500 mL");
                              if (selected) {
                                onUpdateItemString(
                                  selectedItems.find(s => s.toLowerCase().includes("toned milk")) || "",
                                  formatItemSelectionString("Toned Milk", qty)
                                );
                              }
                            }}
                            className={cn(
                              "px-2 py-0.5 text-[11px] font-semibold transition-colors",
                              is500Out
                                ? "opacity-40 cursor-not-allowed line-through text-gray-400"
                                : activeTonedMilkSize === "500 mL"
                                ? "bg-[#2D2926] text-white"
                                : "text-[#8C857D] hover:text-[#2D2926]"
                            )}
                          >
                            500 mL {is500Out ? "(Out)" : ""}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="pt-2 border-t border-[#E5E1DB]/60 flex items-center justify-between">
                      {(() => {
                        let badgeText = itemObj.badge;
                        if (isTonedMilk) {
                          badgeText = activeTonedMilkSize === "500 mL" ? "₹40 (500mL)" : "₹20 (200mL)";
                        }
                        return badgeText ? (
                          <span className="text-[11px] font-bold text-[#8E7455] bg-[#F7F4EF] border border-[#D9D0C3] px-2.5 py-1 rounded-xs shadow-2xs">
                            {badgeText}
                          </span>
                        ) : null;
                      })()}

                      {/* Quantity Stepper for food items */}
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1.5 bg-white border border-[#E5E1DB] px-1 py-0.5"
                      >
                        <button
                          type="button"
                          onClick={(e) => changeQty(item, -1, e)}
                          className="w-5 h-5 flex items-center justify-center text-[#8C857D] hover:text-[#2D2926] cursor-pointer"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs font-mono font-semibold px-1 text-[#2D2926]">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => changeQty(item, 1, e)}
                          className="w-5 h-5 flex items-center justify-center text-[#8C857D] hover:text-[#2D2926] cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {renderPaymentQrSection()}
        </section>
      )}
    </div>
  );
}
