import React from "react";
import { Toaster } from "react-hot-toast";

interface GuestDetailsFormProps {
  roomNumber: string;
  guestName: string;
  onGuestNameChange: (val: string) => void;
  phoneNumber: string;
  onPhoneNumberChange: (val: string) => void;
  isSubmitting: boolean;
  onBack: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export default function GuestDetailsForm({
  roomNumber,
  guestName,
  onGuestNameChange,
  phoneNumber,
  onPhoneNumberChange,
  isSubmitting,
  onBack,
  onSubmit
}: GuestDetailsFormProps) {
  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col items-center pt-12 px-6">
      <Toaster position="top-center" />
      <div className="max-w-md w-full bg-white border border-[#E5E1DB] p-8 shadow-sm text-center">
        <h2 className="text-3xl font-serif italic mb-2">Guest Details</h2>
        <p className="text-[#8C857D] text-sm mb-6">
          Please provide your details to confirm your request for Room {roomNumber}.
        </p>
        <form onSubmit={onSubmit}>
          <div className="space-y-4 mb-8 text-left">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[#8C857D] font-mono mb-2 font-semibold">Guest Name</label>
              <input
                type="text"
                required
                value={guestName}
                onChange={e => onGuestNameChange(e.target.value)}
                className="w-full border border-[#E5E1DB] p-3 text-sm focus:outline-none focus:border-[#A68966] bg-[#FAF8F5] transition-colors"
                placeholder="Enter your name"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[#8C857D] font-mono mb-2 font-semibold">Phone Number</label>
              <input
                type="tel"
                required
                value={phoneNumber}
                onChange={e => onPhoneNumberChange(e.target.value)}
                className="w-full border border-[#E5E1DB] p-3 text-sm focus:outline-none focus:border-[#A68966] bg-[#FAF8F5] transition-colors"
                placeholder="Enter your phone number"
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onBack}
              className="flex-1 py-4 bg-white text-[#2D2926] border border-[#E5E1DB] font-medium uppercase tracking-[0.2em] text-xs hover:bg-[#F2EFE9] transition-colors cursor-pointer"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-4 bg-[#A68966] text-white font-medium uppercase tracking-[0.2em] text-xs hover:bg-[#8E7455] transition-colors flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
            >
              {isSubmitting ? "Sending..." : "Confirm Request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
