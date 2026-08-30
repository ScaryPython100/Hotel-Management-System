import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, addDoc, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { COMMON_ITEMS } from "../types";
import { Settings, ShieldAlert, CheckCircle2, Package } from "lucide-react";
import toast from "react-hot-toast";

export default function StaffSettings() {
  const [amenityStatus, setAmenityStatus] = useState<Record<string, 'available' | 'out_of_service'>>({});
  const [inventoryMap, setInventoryMap] = useState<Record<string, { id?: string, limit: number, inUse: number }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const docRef = doc(db, "settings", "amenities");
        const docSnap = await getDoc(docRef);
        
        const init: Record<string, 'available' | 'out_of_service'> = {};
        const dbData = docSnap.exists() ? docSnap.data() : {};
        
        COMMON_ITEMS.forEach(item => {
          init[item.name] = dbData[item.name] || 'available';
        });
        setAmenityStatus(init);

        const invSnapshot = await getDocs(collection(db, "inventory"));
        const currentInventory: Record<string, { id: string, inUse: number, limit: number }> = {};
        invSnapshot.forEach(docSnap => {
          const data = docSnap.data();
          currentInventory[data.name] = { id: docSnap.id, inUse: data.inUse || 0, limit: data.limit || 1 };
        });

        const initialInvMap: Record<string, { id?: string, inUse: number, limit: number }> = {};
        COMMON_ITEMS.filter(i => i.category === 'Item').forEach(item => {
          if (currentInventory[item.name]) {
            initialInvMap[item.name] = currentInventory[item.name];
          } else {
            initialInvMap[item.name] = { inUse: 0, limit: item.defaultLimit || 1 };
          }
        });
        setInventoryMap(initialInvMap);
      } catch (error) {
        console.error("Error fetching settings", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const toggleStatus = (itemName: string) => {
    setAmenityStatus(prev => {
      const current = prev[itemName] || 'available';
      return {
        ...prev,
        [itemName]: current === 'available' ? 'out_of_service' : 'available'
      };
    });
  };

  const handleLimitChange = (itemName: string, newLimit: string) => {
    const val = parseInt(newLimit, 10);
    if (isNaN(val) || val < 0) return;
    setInventoryMap(prev => ({
      ...prev,
      [itemName]: {
        ...prev[itemName],
        limit: val
      }
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, "settings", "amenities"), amenityStatus, { merge: true });

      const itemsToUpdate = COMMON_ITEMS.filter(i => i.category === 'Item');
      for (const item of itemsToUpdate) {
        const invData = inventoryMap[item.name];
        if (invData) {
          if (invData.id) {
            await updateDoc(doc(db, "inventory", invData.id), { limit: invData.limit });
          } else {
            const invQ = query(collection(db, "inventory"), where("name", "==", item.name));
            const invSnap = await getDocs(invQ);
            if (invSnap.empty) {
              const newDoc = await addDoc(collection(db, "inventory"), {
                name: item.name,
                inUse: 0,
                limit: invData.limit
              });
              setInventoryMap(prev => ({
                ...prev,
                [item.name]: { ...prev[item.name], id: newDoc.id }
              }));
            } else {
              await updateDoc(invSnap.docs[0].ref, { limit: invData.limit });
              setInventoryMap(prev => ({
                ...prev,
                [item.name]: { ...prev[item.name], id: invSnap.docs[0].id }
              }));
            }
          }
        }
      }

      toast.success("Settings saved successfully!");
    } catch (error) {
      console.error("Error saving settings", error);
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-[#8C857D]">Loading settings...</div>;

  return (
    <div className="p-8 md:p-12 w-full max-w-4xl">
      <div className="mb-10">
        <h2 className="text-3xl font-serif italic mb-2">Service Settings</h2>
        <p className="text-[#8C857D] text-sm max-w-xl">
          Manage the availability of your hotel amenities. Mark items as "Out of Service" if they are currently unavailable or broken.
        </p>
      </div>

      <div className="bg-white border border-[#E5E1DB] p-8">
        <h3 className="font-serif text-xl mb-6">Amenity Availability</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
          {COMMON_ITEMS.map((item) => {
            const isAvailable = amenityStatus[item.name] !== 'out_of_service';
            
            return (
              <button
                key={item.name}
                onClick={() => toggleStatus(item.name)}
                className={`flex items-center justify-between p-4 border transition-colors ${
                  isAvailable ? "bg-[#F9F7F4] border-[#E5E1DB]" : "bg-red-50 border-red-200"
                }`}
              >
                <div className="text-left">
                  <span className={`font-medium block ${isAvailable ? "text-[#2D2926]" : "text-red-800"}`}>
                    {item.name}
                  </span>
                  <span className={`text-[10px] uppercase tracking-widest ${isAvailable ? "text-[#8C857D]" : "text-red-600"}`}>
                    {item.category}
                  </span>
                </div>
                
                {isAvailable ? (
                  <span className="flex items-center text-xs uppercase tracking-widest text-green-700 font-bold shrink-0">
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Available
                  </span>
                ) : (
                  <span className="flex items-center text-xs uppercase tracking-widest text-red-600 font-bold shrink-0">
                    <ShieldAlert className="w-4 h-4 mr-2" />
                    Unavailable
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <h3 className="font-serif text-xl mb-6">Inventory Stock Limits</h3>
        <p className="text-[#8C857D] text-sm mb-6">
          Set the maximum total quantity of each physical item available to borrow.
        </p>

        <div className="space-y-4 mb-8">
          {COMMON_ITEMS.filter(i => i.category === 'Item').map((item) => {
            const invData = inventoryMap[item.name];
            if (!invData) return null;

            return (
              <div key={item.name} className="flex items-center justify-between p-4 border border-[#E5E1DB] bg-[#F9F7F4]">
                <div className="flex items-center gap-3">
                  <Package className="w-5 h-5 text-[#8C857D]" />
                  <div>
                    <span className="font-medium text-[#2D2926] block">{item.name}</span>
                    <span className="text-[10px] uppercase tracking-widest text-[#8C857D]">
                      {invData.inUse} currently in use
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <label htmlFor={`limit-${item.name}`} className="text-sm text-[#8C857D]">Total Stock:</label>
                  <input
                    id={`limit-${item.name}`}
                    type="number"
                    min="1"
                    value={invData.limit}
                    onChange={(e) => handleLimitChange(item.name, e.target.value)}
                    className="w-20 p-2 border border-[#E5E1DB] bg-white text-center focus:outline-none focus:border-[#A68966]"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-8 py-4 bg-[#A68966] text-white font-medium uppercase tracking-[0.2em] text-xs hover:bg-[#8E7455] transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
