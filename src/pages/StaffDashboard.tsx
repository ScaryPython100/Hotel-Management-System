import React, { useEffect, useState } from "react";
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc, where, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { RoomRequest, BorrowedItem } from "../types";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Clock, Trash2, BedDouble, AlertCircle, Package } from "lucide-react";
import toast, { Toaster } from "react-hot-toast";

export default function StaffDashboard() {
  const [requests, setRequests] = useState<RoomRequest[]>([]);
  const [borrowedItems, setBorrowedItems] = useState<BorrowedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'requests' | 'borrowed'>('requests');

  useEffect(() => {
    const q = query(collection(db, "requests"), orderBy("createdAt", "desc"));
    
    const unsubscribeReqs = onSnapshot(q, (snapshot) => {
      const reqs: RoomRequest[] = [];
      snapshot.forEach((doc) => {
        reqs.push({ id: doc.id, ...doc.data() } as RoomRequest);
      });
      setRequests(reqs);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching requests:", error);
      toast.error("Failed to load requests");
      setLoading(false);
    });

    const bq = query(collection(db, "borrowed_items"), orderBy("createdAt", "desc"));
    const unsubscribeBorrowed = onSnapshot(bq, (snapshot) => {
      const items: BorrowedItem[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as BorrowedItem);
      });
      setBorrowedItems(items);
    }, (error) => {
      console.error("Error fetching borrowed items:", error);
    });

    return () => {
      unsubscribeReqs();
      unsubscribeBorrowed();
    };
  }, []);

  const handleMarkCompleted = async (id: string) => {
    try {
      await updateDoc(doc(db, "requests", id), {
        status: "completed"
      });
      toast.success("Request marked as completed");
    } catch (error) {
      console.error("Error updating request:", error);
      toast.error("Failed to update status");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this request?")) return;
    try {
      await deleteDoc(doc(db, "requests", id));
      toast.success("Request deleted");
    } catch (error) {
      console.error("Error deleting request:", error);
      toast.error("Failed to delete request");
    }
  };

  const handleMarkReturned = async (borrowedId: string, itemName: string) => {
    try {
      // 1. Mark item as returned
      await updateDoc(doc(db, "borrowed_items", borrowedId), {
        status: "returned",
        returnedAt: Date.now()
      });

      // 2. Decrement inventory inUse
      const invQ = query(collection(db, "inventory"), where("name", "==", itemName));
      const invSnap = await getDocs(invQ);
      if (!invSnap.empty) {
        const invDoc = invSnap.docs[0];
        const currentInUse = invDoc.data().inUse || 0;
        await updateDoc(invDoc.ref, {
          inUse: Math.max(0, currentInUse - 1)
        });
      }

      toast.success(`${itemName} marked as returned`);
    } catch (error) {
      console.error("Error returning item:", error);
      toast.error("Failed to mark as returned");
    }
  };

  const pendingRequests = requests.filter(r => r.status === "pending");
  const completedRequests = requests.filter(r => r.status === "completed");
  const activeBorrowed = borrowedItems.filter(b => b.status === "borrowed");

  return (
    <>
      <Toaster position="top-right" />
      <div className="p-8 md:p-12">
        <div className="max-w-6xl mx-auto">
          <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h2 className="text-4xl font-serif italic text-[#2D2926]">Live Dashboard</h2>
              <p className="text-sm text-[#8C857D] mt-2 italic">Manage incoming room service requests and inventory in real-time.</p>
            </div>
            
            <div className="flex border border-[#E5E1DB] bg-white p-1">
              <button 
                onClick={() => setActiveTab('requests')}
                className={`px-6 py-2.5 text-xs font-medium tracking-widest uppercase transition-colors ${activeTab === 'requests' ? 'bg-[#A68966] text-white' : 'text-[#8C857D] hover:text-[#2D2926]'}`}
              >
                Requests {pendingRequests.length > 0 && `(${pendingRequests.length})`}
              </button>
              <button 
                onClick={() => setActiveTab('borrowed')}
                className={`px-6 py-2.5 text-xs font-medium tracking-widest uppercase transition-colors ${activeTab === 'borrowed' ? 'bg-[#A68966] text-white' : 'text-[#8C857D] hover:text-[#2D2926]'}`}
              >
                Borrowed Items {activeBorrowed.length > 0 && `(${activeBorrowed.length})`}
              </button>
            </div>
          </header>

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin h-12 w-12 border-t-2 border-b-2 border-[#A68966]"></div>
            </div>
          ) : (
            <div className="space-y-12">
              {activeTab === 'requests' && (
                <>
                  {/* Pending Section */}
                  <section>
                    <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-[#8C857D] mb-6 flex items-center">
                      <AlertCircle className="w-4 h-4 mr-2 text-[#A68966]" />
                      Needs Attention ({pendingRequests.length})
                    </h3>
                    
                    {pendingRequests.length === 0 ? (
                      <div className="bg-white border border-dashed border-[#E5E1DB] p-12 text-center">
                        <CheckCircle2 className="w-10 h-10 text-[#E5E1DB] mx-auto mb-4" />
                        <p className="text-sm italic text-[#8C857D]">No pending requests right now. Great job!</p>
                      </div>
                    ) : (
                      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                        {pendingRequests.map(req => (
                          <RequestCard 
                            key={req.id} 
                            request={req} 
                            onComplete={() => handleMarkCompleted(req.id!)}
                            onDelete={() => handleDelete(req.id!)}
                          />
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Completed Section */}
                  {completedRequests.length > 0 && (
                    <section>
                      <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-[#8C857D] mb-6 flex items-center">
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Recently Completed
                      </h3>
                      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 opacity-70">
                        {completedRequests.slice(0, 9).map(req => (
                          <RequestCard 
                            key={req.id} 
                            request={req} 
                            onDelete={() => handleDelete(req.id!)}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}

              {activeTab === 'borrowed' && (
                <section>
                  <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-[#8C857D] mb-6 flex items-center">
                    <Package className="w-4 h-4 mr-2 text-[#A68966]" />
                    Items Currently In Rooms ({activeBorrowed.length})
                  </h3>
                  
                  {activeBorrowed.length === 0 ? (
                    <div className="bg-white border border-dashed border-[#E5E1DB] p-12 text-center">
                      <CheckCircle2 className="w-10 h-10 text-[#E5E1DB] mx-auto mb-4" />
                      <p className="text-sm italic text-[#8C857D]">No limited items are currently borrowed.</p>
                    </div>
                  ) : (
                    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                      {activeBorrowed.map(item => (
                        <div key={item.id} className="bg-white p-6 border border-[#E5E1DB] flex flex-col relative">
                          <div className="absolute top-0 left-0 w-full h-[2px] bg-[#A68966]"></div>
                          
                          <div className="flex justify-between items-start pb-4 border-b border-dashed border-[#E5E1DB] mb-6">
                            <div className="flex items-center text-[#2D2926] font-serif text-xl">
                              <BedDouble className="w-5 h-5 mr-3 text-[#A68966]" />
                              Room {item.roomId}
                            </div>
                            <div className="flex items-center text-[10px] uppercase tracking-widest text-[#8C857D] font-medium">
                              <Clock className="w-3 h-3 mr-1.5" />
                              {formatDistanceToNow(item.createdAt, { addSuffix: true })}
                            </div>
                          </div>
                          
                          <div className="flex-1">
                            <h4 className="text-[10px] uppercase tracking-[0.2em] text-[#8C857D] font-bold mb-3">Item Borrowed</h4>
                            <p className="text-[#2D2926] font-medium">{item.itemName}</p>
                          </div>
                          
                          <div className="mt-8 pt-6 border-t border-dashed border-[#E5E1DB]">
                            <button 
                              onClick={() => handleMarkReturned(item.id!, item.itemName)}
                              className="w-full bg-[#A68966] text-white py-3 text-[10px] uppercase tracking-[0.2em] font-medium hover:bg-[#8E7455] transition-colors flex items-center justify-center"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 mr-2" />
                              Mark as Returned
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function RequestCard({ request, onComplete, onDelete }: { request: RoomRequest, onComplete?: () => void, onDelete: () => void }) {
  const isPending = request.status === 'pending';
  
  return (
    <div className={`bg-white p-6 border ${isPending ? 'border-[#A68966]' : 'border-[#E5E1DB]'} flex flex-col h-full relative`}>
      {isPending && <div className="absolute top-0 left-0 w-full h-[2px] bg-[#A68966]"></div>}
      
      <div className="flex justify-between items-start pb-4 border-b border-dashed border-[#E5E1DB] mb-6">
        <div className="flex items-center text-[#2D2926] font-serif text-xl">
          <BedDouble className="w-5 h-5 mr-3 text-[#A68966]" />
          Room {request.roomId}
        </div>
        <div className="flex items-center text-[10px] uppercase tracking-widest text-[#8C857D] font-medium">
          <Clock className="w-3 h-3 mr-1.5" />
          {formatDistanceToNow(request.createdAt, { addSuffix: true })}
        </div>
      </div>

      <div className="flex-1 space-y-6">
        {request.items && request.items.length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-[0.2em] text-[#8C857D] font-bold mb-3">Requested Items</h4>
            <div className="flex flex-wrap gap-2">
              {request.items.map((item, idx) => (
                <span key={idx} className="bg-[#F9F7F4] border border-[#E5E1DB] text-[#2D2926] px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest">
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}

        {request.customMessage && (
          <div>
            <h4 className="text-[10px] uppercase tracking-[0.2em] text-[#8C857D] font-bold mb-3">Message</h4>
            <p className="text-[#2D2926] text-sm bg-[#F9F7F4] p-4 border border-[#E5E1DB] italic">
              "{request.customMessage}"
            </p>
          </div>
        )}
      </div>

      <div className="mt-8 flex gap-3 pt-6 border-t border-dashed border-[#E5E1DB]">
        {isPending && (
          <button 
            onClick={onComplete}
            className="flex-1 bg-[#A68966] text-white py-3 text-[10px] uppercase tracking-[0.2em] font-medium hover:bg-[#8E7455] transition-colors flex items-center justify-center"
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-2" />
            Mark Done
          </button>
        )}
        <button 
          onClick={onDelete}
          className={`p-3 text-[#8C857D] hover:text-red-500 hover:bg-[#F9F7F4] border border-transparent hover:border-[#E5E1DB] transition-colors ${!isPending ? 'w-full flex items-center justify-center border border-[#E5E1DB]' : ''}`}
          title="Delete request"
        >
          <Trash2 className="w-4 h-4" />
          {!isPending && <span className="ml-2 text-[10px] uppercase tracking-[0.2em] font-medium">Delete</span>}
        </button>
      </div>
    </div>
  );
}
