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
import { Check, Clock, Plus, Minus, Info } from "lucide-react";
import { ITEM_EMOJI_MAP } from "./RequestSuccessScreen";

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

  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({
    "Maggi (₹20)": 1,
    "Eggs (₹10)": 2,
    "Coffee Sachet (₹5 per sachet)": 2,
    "Soft Drinks (₹50)": 1,
    "Toned Milk 200/500 mL (₹30)": 1,
    "Set of Plates": 1,
    "Set of Cups/Bowls": 1,
    "Set of Glasses": 1,
    "Empty Water Bottle": 1,
    "Cooking Oil Dispenser": 1
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
      return qty > 1 ? `Soft Drinks (${flavor}) (₹50) (qty: ${qty})` : `Soft Drinks (${flavor}) (₹50)`;
    }
    if (baseName.includes("Toned Milk")) {
      const is200Out = amenitiesStatus["Toned Milk - 200 mL"] === "out_of_service";
      const is500Out = amenitiesStatus["Toned Milk - 500 mL"] === "out_of_service";
      const size = is200Out && !is500Out ? "500 mL" : (is500Out && !is200Out ? "200 mL" : tonedMilkOption);
      return qty > 1 ? `Toned Milk (${size}) (₹30) (qty: ${qty})` : `Toned Milk (${size}) (₹30)`;
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
        <section className="animate-fadeIn">
          <div className="mb-4">
            <h2 className="text-2xl font-serif italic text-[#2D2926] mb-1">
              Page 1: Daily Service Requests
            </h2>
            <p className="text-xs text-[#8C857D]">
              Complimentary bathroom refills, first aid essentials, and daily housekeeping services.
            </p>
          </div>

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
        </section>
      )}

      {/* PAGE 2: RETURNABLE ITEMS */}
      {activeTab === "returnable" && (
        <section className="animate-fadeIn space-y-4">
          <div>
            <h2 className="text-2xl font-serif italic text-[#2D2926] mb-1">
              Page 2: Returnable Items
            </h2>
            <p className="text-xs text-[#8C857D]">
              Items that are to be returned when finished so fellow guests can use them.
            </p>
          </div>

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
        </section>
      )}

      {/* PAGE 3: F&B ESSENTIALS */}
      {activeTab === "fnb" && (
        <section className="animate-fadeIn space-y-8">
          <div>
            <h2 className="text-2xl font-serif italic text-[#2D2926] mb-1">
              Page 3: F&B Essentials & Quick Meals
            </h2>
            <p className="text-xs text-[#8C857D]">
              Dining utensils, kitchen essentials with refundable deposit, and instant packaged meals.
            </p>
          </div>

          {/* Sub-section A: Kitchen & Dining Essentials */}
          <div className="space-y-4">
            <div className="border-l-2 border-[#A68966] pl-3">
              <h3 className="font-serif text-lg text-[#2D2926]">
                Kitchen & Dining Essentials (Refundable Deposit)
              </h3>
              <p className="text-xs text-[#8C857D]">
                Deposit is ₹100/- for all items. Utensils must be cleaned after use.
              </p>
            </div>

            <div className="bg-[#FAF8F5] border border-[#E5E1DB] p-4 text-xs leading-relaxed text-[#2D2926] shadow-xs">
              <div className="flex items-start gap-2.5">
                <Info className="w-4 h-4 text-[#A68966] shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-[#A68966] uppercase tracking-wider text-[11px] mb-0.5">
                    Refundable Deposit Policy (₹100/- per item)
                  </p>
                  <p className="text-[#8C857D]">
                    A refundable deposit of ₹100/- is collected for each dining utensil. Guests are kindly requested to self-clean items after use. If items are returned uncleaned, cleaning charges will be deducted from the deposit amount.
                  </p>
                </div>
              </div>
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

                    <div className="pt-2 border-t border-[#E5E1DB]/60 flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5">
                        ₹100/- Deposit
                      </span>

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
                Quick Food Items (Direct Purchase)
              </h3>
              <p className="text-xs text-[#8C857D]">
                Snacks, ingredients and beverages delivered fresh to your door.
              </p>
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
                                  formatItemSelectionString("Soft Drinks (₹50)", qty)
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
                                  formatItemSelectionString("Soft Drinks (₹50)", qty)
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
                                  formatItemSelectionString("Toned Milk 200/500 mL (₹30)", qty)
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
                                  formatItemSelectionString("Toned Milk 200/500 mL (₹30)", qty)
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
                      {itemObj.badge && (
                        <span className="text-[10px] font-bold text-[#A68966] bg-[#FAF8F5] border border-[#E5E1DB] px-2 py-0.5">
                          {itemObj.badge}
                        </span>
                      )}

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
        </section>
      )}
    </div>
  );
}
