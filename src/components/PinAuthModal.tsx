import React, { useState } from "react";
import { X, Lock } from "lucide-react";
import toast from "react-hot-toast";

interface PinAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function PinAuthModal({ isOpen, onClose, onSuccess }: PinAuthModalProps) {
  const [pin, setPin] = useState("");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const correctPin = localStorage.getItem("hues_stay_superhost_pin") || "9999";

    if (pin.trim() === correctPin) {
      toast.success("Superhost access granted");
      onSuccess();
      onClose();
      setPin("");
    } else {
      toast.error("Incorrect PIN. Please try again.");
      setPin("");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white p-8 max-w-sm w-full shadow-2xl relative border border-[#E5E1DB]">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-[#8C857D] hover:text-[#2D2926] transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-[#2D2926] text-[#A68966] flex items-center justify-center mx-auto mb-3 shadow-sm">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-serif italic mb-1 text-[#2D2926]">Superhost Access</h2>
          <p className="text-xs text-[#8C857D]">
            Enter your PIN to manage rooms, settings, and full portal controls.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-full p-3.5 text-center text-2xl tracking-[0.5em] bg-[#F9F7F4] border border-[#E5E1DB] focus:outline-none focus:border-[#A68966] text-[#2D2926] font-mono"
              placeholder="••••"
              autoFocus
            />
          </div>

          <button
            type="submit"
            className="w-full py-3.5 bg-[#2D2926] text-white text-xs uppercase tracking-[0.2em] font-medium hover:bg-black transition-colors"
          >
            Unlock Superhost
          </button>
        </form>
      </div>
    </div>
  );
}
