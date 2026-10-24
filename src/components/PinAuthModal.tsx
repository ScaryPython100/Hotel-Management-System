import React, { useState } from "react";
import { X, Lock } from "lucide-react";
import { toast } from "sonner";
import { staffApiFetch } from "../lib/supabaseClient";

const SUPERHOST_TOKEN_KEY = "hues_superhost_token";

/** Proof from the server that the superhost PIN was entered (expires after 12 hours) */
export function getSuperhostToken(): string | null {
  try {
    const token = sessionStorage.getItem(SUPERHOST_TOKEN_KEY);
    const expires = Number(token?.split(".")[0]);
    return token && expires > Date.now() ? token : null;
  } catch {
    return null;
  }
}

export function clearSuperhostToken() {
  try {
    sessionStorage.removeItem(SUPERHOST_TOKEN_KEY);
  } catch {}
}

interface PinAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function PinAuthModal({ isOpen, onClose, onSuccess }: PinAuthModalProps) {
  const [pin, setPin] = useState("");
  const [isChecking, setIsChecking] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsChecking(true);
    try {
      // The PIN is checked on the server (SUPERHOST_PIN), so it is the same on every device
      const res = await staffApiFetch("/api/staff?action=verify-pin", {
        method: "POST",
        body: JSON.stringify({ pin: pin.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.superhostToken) {
        sessionStorage.setItem(SUPERHOST_TOKEN_KEY, data.superhostToken);
        toast.success("Superhost access granted");
        onSuccess();
        onClose();
      } else {
        toast.error(res.status === 403 ? "Incorrect PIN. Please try again." : (data.error || "Could not check the PIN."));
      }
    } catch {
      toast.error("Could not reach the server to check the PIN.");
    } finally {
      setPin("");
      setIsChecking(false);
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
            disabled={isChecking}
            className="w-full py-3.5 bg-[#2D2926] text-white text-xs uppercase tracking-[0.2em] font-medium hover:bg-black transition-colors"
          >
            Unlock Superhost
          </button>
        </form>
      </div>
    </div>
  );
}
