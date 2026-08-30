import React, { useEffect, useState } from "react";
import { collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Room } from "../types";
import { v4 as uuidv4 } from "uuid";
import { QRCodeSVG } from "qrcode.react";
import toast, { Toaster } from "react-hot-toast";
import { Plus, Trash2, Printer } from "lucide-react";

export default function StaffRooms() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRoomNumber, setNewRoomNumber] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "rooms"), orderBy("roomNumber", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const roomData: Room[] = [];
      snapshot.forEach((doc) => {
        roomData.push({ id: doc.id, ...doc.data() } as Room);
      });
      setRooms(roomData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching rooms:", error);
      toast.error("Failed to load rooms");
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomNumber.trim()) return;

    if (rooms.some(r => r.roomNumber === newRoomNumber.trim())) {
      toast.error("Room already exists");
      return;
    }

    setIsAdding(true);
    try {
      const qrCodeHash = uuidv4();
      await addDoc(collection(db, "rooms"), {
        roomNumber: newRoomNumber.trim(),
        qrCodeHash,
        status: "vacant"
      });
      setNewRoomNumber("");
      toast.success("Room added successfully");
    } catch (error) {
      console.error("Error adding room:", error);
      toast.error("Failed to add room");
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteRoom = async (id: string) => {
    if (!window.confirm("Delete this room and its QR code?")) return;
    try {
      await deleteDoc(doc(db, "rooms", id));
      toast.success("Room deleted");
    } catch (error) {
      console.error("Error deleting room:", error);
      toast.error("Failed to delete room");
    }
  };

  const printQR = (hash: string) => {
    const url = `${window.location.origin}/room/${hash}`;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Print QR Code</title>
          <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .container { text-align: center; border: 1px dashed #ccc; padding: 40px; }
            h1 { font-family: serif; font-style: italic; font-size: 24px; margin-bottom: 20px; }
            p { color: #666; margin-top: 20px; }
          </style>
        </head>
        <body onload="window.print(); window.close();">
          <div class="container">
            <h1>Hues Stay Luxury Rooms</h1>
            <div id="qr-container"></div>
            <p>Scan to request room service</p>
          </div>
          <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script>
        </body>
      </html>
    `);
    // Alternatively, just instruct user to print from browser for now.
    toast.success("Printing not fully mocked, but URL is: " + url);
  };

  return (
    <>
      <Toaster position="top-right" />
      <div className="p-8 md:p-12">
        <div className="max-w-6xl mx-auto">
          <header className="mb-10 flex justify-between items-end border-b border-[#E5E1DB] pb-6">
            <div>
              <h2 className="text-4xl font-serif italic text-[#2D2926]">Rooms & QR Codes</h2>
              <p className="text-sm text-[#8C857D] mt-2 italic">Manage your rooms and generate secure QR codes for guests.</p>
            </div>
          </header>

          <form onSubmit={handleAddRoom} className="mb-12 bg-white p-6 border border-[#E5E1DB] flex gap-4 items-center">
            <div className="flex-1">
              <label className="block text-[10px] uppercase tracking-[0.2em] font-bold text-[#8C857D] mb-2">Add New Room</label>
              <input 
                type="text" 
                value={newRoomNumber}
                onChange={(e) => setNewRoomNumber(e.target.value)}
                placeholder="e.g. 102"
                className="w-full border-b border-[#E5E1DB] py-2 focus:outline-none focus:border-[#A68966] text-[#2D2926]"
              />
            </div>
            <button 
              type="submit" 
              disabled={isAdding || !newRoomNumber.trim()}
              className="mt-6 bg-[#1A1A1A] text-white px-6 py-3 text-[10px] uppercase tracking-[0.2em] font-medium hover:bg-[#333] transition-colors disabled:opacity-50 flex items-center"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Room
            </button>
          </form>

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin h-12 w-12 border-t-2 border-b-2 border-[#A68966]"></div>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {rooms.map((room) => {
                const guestUrl = `${window.location.origin}/room/${room.qrCodeHash}`;
                return (
                  <div key={room.id} className="bg-white border border-[#E5E1DB] p-6 flex flex-col items-center text-center">
                    <h3 className="text-2xl font-serif text-[#2D2926] mb-1">Room {room.roomNumber}</h3>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[#8C857D] mb-6">Secure Hash: {room.qrCodeHash.substring(0,8)}...</p>
                    
                    <div className="bg-white p-4 border border-[#E5E1DB] mb-6">
                      <QRCodeSVG value={guestUrl} size={150} />
                    </div>

                    <div className="w-full flex gap-3 mt-auto">
                      <button 
                        onClick={() => printQR(room.qrCodeHash)}
                        className="flex-1 bg-[#F9F7F4] text-[#2D2926] border border-[#E5E1DB] py-3 text-[10px] uppercase tracking-[0.2em] font-medium hover:bg-[#E5E1DB] transition-colors flex items-center justify-center"
                      >
                        <Printer className="w-3.5 h-3.5 mr-2" />
                        Print QR
                      </button>
                      <button 
                        onClick={() => handleDeleteRoom(room.id!)}
                        className="p-3 text-[#8C857D] border border-[#E5E1DB] hover:text-red-500 hover:bg-[#F9F7F4] transition-colors"
                        title="Delete Room"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    
                    <div className="mt-4 w-full pt-4 border-t border-dashed border-[#E5E1DB]">
                       <a href={guestUrl} target="_blank" rel="noreferrer" className="text-[10px] uppercase tracking-[0.2em] text-[#A68966] font-medium hover:underline flex items-center justify-center">
                         Test Guest View 
                       </a>
                    </div>
                  </div>
                );
              })}
              
              {rooms.length === 0 && (
                <div className="col-span-full py-12 text-center text-[#8C857D] italic border border-dashed border-[#E5E1DB]">
                  No rooms added yet. Add a room to generate its QR code.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
