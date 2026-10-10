import React from "react";
import { COMMON_ITEMS, getItemUnitConsumption } from "../../types";
import { cn } from "../../lib/utils";
import toast from "react-hot-toast";
import { Check } from "lucide-react";
import { ITEM_EMOJI_MAP } from "./RequestSuccessScreen";

interface AmenityGridSectionProps {
  deletedItems: string[];
  selectedItems: string[];
  inventory: Record<string, { inUse: number; limit: number }>;
  getInventoryData: (name: string) => { inUse: number; limit: number } | undefined;
  checkIsItemOutOfService: (item: string) => boolean;
  onToggleItem: (item: string) => void;
}

export default function AmenityGridSection({
  deletedItems,
  selectedItems,
  inventory,
  getInventoryData,
  checkIsItemOutOfService,
  onToggleItem
}: AmenityGridSectionProps) {
  const deletedSet = new Set(deletedItems);

  const serviceItems = COMMON_ITEMS.filter(
    i =>
      i.category === "Service" &&
      !deletedSet.has(i.name) &&
      !i.name.toLowerCase().includes("wifi") &&
      !i.name.toLowerCase().includes("supervisor")
  );

  const inventoryItemsList: Array<{ name: string; isLimited: boolean }> = [
    ...COMMON_ITEMS.filter(i => i.category === "Item" && !deletedSet.has(i.name)).map(i => ({
      name: i.name,
      isLimited: !!i.isLimited
    }))
  ];

  Object.keys(inventory).forEach(invName => {
    const lower = invName.toLowerCase().trim();
    if (
      deletedSet.has(invName) ||
      lower === "teakettle" ||
      lower === "glasses" ||
      lower === "water glasses" ||
      lower === "water glass" ||
      lower.includes("(qty:") ||
      lower.includes("qty:")
    ) {
      return;
    }

    if (!inventoryItemsList.some(i => i.name === invName)) {
      inventoryItemsList.push({ name: invName, isLimited: true });
    }
  });

  return (
    <>
      <section>
        <h2 className="text-xl font-serif mb-4 flex items-center">
          Daily Service Requests
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {serviceItems.map((itemObj) => {
            const item = itemObj.name;
            const isSelected = selectedItems.includes(item);
            const isOutOfService = checkIsItemOutOfService(item);
            const isDisabled = isOutOfService;

            return (
              <div
                key={item}
                onClick={() => {
                  if (!isDisabled) {
                    onToggleItem(item);
                  } else {
                    toast.error(`${item} is currently out of service.`);
                  }
                }}
                className={cn(
                  "bg-white border p-5 flex flex-col justify-between text-left transition-all duration-200 min-h-[90px] h-auto rounded-none relative gap-3 select-none",
                  isSelected
                    ? "bg-[#F2EFE9] border-[#A68966] text-[#2D2926] shadow-xs"
                    : "border-[#E5E1DB] text-[#2D2926] hover:bg-[#F2EFE9]",
                  isDisabled ? "opacity-50 cursor-not-allowed hover:bg-white border-[#E5E1DB]" : "cursor-pointer"
                )}
              >
                <div className="flex justify-between items-start w-full gap-2">
                  <span className="font-serif text-base md:text-lg leading-tight">{item}</span>
                  <div
                    className={cn(
                      "w-5 h-5 flex items-center justify-center shrink-0 border rounded-xs mt-0.5 transition-colors",
                      isSelected ? "border-[#A68966] bg-[#A68966]" : "border-[#E5E1DB]",
                      isDisabled && "border-[#E5E1DB] bg-gray-100"
                    )}
                  >
                    {isSelected && <Check className="w-3 h-3 text-white stroke-[3]" />}
                  </div>
                </div>

                {isOutOfService && (
                  <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 uppercase tracking-wider font-semibold rounded-sm inline-block w-fit">
                    Unavailable
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-serif mb-4 flex items-center">
          Inventory Item Requests
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {inventoryItemsList.map((itemObj) => {
            const item = itemObj.name;
            const isSelected = selectedItems.includes(item);
            const inv = getInventoryData(item);
            const neededUnits = getItemUnitConsumption(item);
            const availableUnits = inv ? Math.max(0, inv.limit - inv.inUse) : 10;
            const isOutOfStock = (itemObj.isLimited || inv !== undefined) && inv && availableUnits < neededUnits;
            const isOutOfService = checkIsItemOutOfService(item);
            const isDisabled = isOutOfStock || isOutOfService;
            const emoji = ITEM_EMOJI_MAP[item];

            return (
              <div
                key={item}
                onClick={() => {
                  if (isDisabled) {
                    toast.error(`${item} is currently unavailable.`);
                    return;
                  }
                  onToggleItem(item);
                }}
                className={cn(
                  "bg-white border p-5 flex flex-col justify-between text-left transition-all duration-200 min-h-[90px] h-auto rounded-none relative gap-3 select-none",
                  isSelected
                    ? "bg-[#F2EFE9] border-[#A68966] text-[#2D2926] shadow-xs"
                    : "border-[#E5E1DB] text-[#2D2926] hover:bg-[#F2EFE9]",
                  isDisabled
                    ? "opacity-60 cursor-not-allowed bg-[#FAF9F7] border-dashed border-[#D5D1CB] hover:bg-[#FAF9F7]"
                    : "cursor-pointer"
                )}
              >
                <div className="flex justify-between items-start w-full gap-2">
                  <span className="font-serif text-base md:text-lg leading-tight block">
                    {emoji && <span className="mr-2 text-xl inline-block">{emoji}</span>}
                    {item}
                  </span>
                  <div
                    className={cn(
                      "w-5 h-5 flex items-center justify-center shrink-0 border rounded-xs mt-0.5 transition-colors",
                      isSelected ? "border-[#A68966] bg-[#A68966]" : "border-[#E5E1DB]",
                      isDisabled && "border-[#E5E1DB] bg-gray-100"
                    )}
                  >
                    {isSelected && <Check className="w-3 h-3 text-white stroke-[3]" />}
                  </div>
                </div>

                {isDisabled && (
                  <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 uppercase tracking-wider font-semibold rounded-sm inline-block w-fit">
                    Unavailable
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
