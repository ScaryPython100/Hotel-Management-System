import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, QrCode, Settings, LogOut, Lock, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { toast, Toaster } from "sonner";
import type { Session } from "@supabase/supabase-js";
import PinAuthModal, { getSuperhostToken, clearSuperhostToken } from "../components/PinAuthModal";
import StaffLogin from "../components/staff/StaffLogin";
import { getClientSupabase } from "../lib/supabaseClient";

export default function StaffLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [role, setRole] = useState<"superhost" | "staff">("staff");
  const [isInitializing, setIsInitializing] = useState(true);
  const [showPinModal, setShowPinModal] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (getSuperhostToken()) {
      setRole("superhost");
    }

    const sb = getClientSupabase();
    if (!sb) {
      setIsInitializing(false);
      return;
    }
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsInitializing(false);
    });
    const { data: listener } = sb.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-[#F9F7F4] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#A68966]" />
      </div>
    );
  }

  if (!session) {
    return <StaffLogin title="Hues Stay Luxury Rooms" />;
  }

  const handleSignOut = async () => {
    clearSuperhostToken();
    setRole("staff");
    await getClientSupabase()?.auth.signOut();
    navigate("/staff");
  };

  const handleSuperhostToggle = () => {
    if (role === "superhost") {
      clearSuperhostToken();
      setRole("staff");
      navigate("/staff");
      toast.success("Returned to Staff View");
    } else {
      setShowPinModal(true);
    }
  };

  const handlePinSuccess = () => {
    setRole("superhost");
  };

  const navItems = [
    { name: "Live Requests", path: "/staff", icon: <LayoutDashboard className="w-5 h-5 mr-3" />, roles: ["superhost", "staff"] },
    { name: "Rooms & QR Codes", path: "/staff/rooms", icon: <QrCode className="w-5 h-5 mr-3" />, roles: ["superhost"] },
    { name: "Service Settings", path: "/staff/settings", icon: <Settings className="w-5 h-5 mr-3" />, roles: ["superhost", "staff"] },
  ];

  const visibleNavItems = navItems.filter(item => item.roles.includes(role));

  return (
    <div className="min-h-screen bg-[#F9F7F4] flex flex-col md:flex-row text-[#2D2926] font-sans">
      <Toaster position="top-right" />
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-[#1A1A1A] text-white flex flex-col shrink-0 md:min-h-screen relative">
        <div className="p-8 border-b border-white/10">
          <h1 className="text-2xl font-serif italic text-white mb-2">Hues Stay Luxury Rooms</h1>
          <p className="text-[10px] font-medium tracking-[0.2em] uppercase text-[#8C857D]">
            {role === "superhost" ? "Superhost Portal" : "Staff Portal"}
          </p>
        </div>

        {/* Navigation */}
        <nav className="p-8 flex-1 space-y-4">
          {visibleNavItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center p-4 transition-colors border ${
                  isActive 
                    ? "bg-white/10 text-white border-white/20" 
                    : "text-[#8C857D] hover:text-white border-transparent hover:bg-white/5"
                }`}
              >
                {item.icon}
                <span className="text-[10px] uppercase tracking-[0.2em] font-medium">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Access Toggle */}
        <div className="p-8 border-t border-white/10 space-y-3">
          <button 
            onClick={handleSuperhostToggle}
            className="flex items-center w-full p-4 text-[#8C857D] hover:text-white transition-colors border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10"
          >
            {role === "superhost" ? (
              <>
                <LogOut className="w-5 h-5 mr-3 text-red-400" />
                <span className="text-[10px] uppercase tracking-[0.2em] font-medium text-red-300">Exit Superhost</span>
              </>
            ) : (
              <>
                <Lock className="w-5 h-5 mr-3 text-[#A68966]" />
                <span className="text-[10px] uppercase tracking-[0.2em] font-medium text-[#A68966]">Superhost Access</span>
              </>
            )}
          </button>
          <button
            onClick={handleSignOut}
            className="flex items-center w-full p-4 text-[#8C857D] hover:text-white transition-colors border border-white/10 hover:border-white/20"
            title={session.user.email || "Sign out"}
          >
            <LogOut className="w-5 h-5 mr-3" />
            <span className="text-[10px] uppercase tracking-[0.2em] font-medium">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        <Outlet context={{ role }} />
      </div>

      {/* Clean PIN Modal */}
      <PinAuthModal
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        onSuccess={handlePinSuccess}
      />
    </div>
  );
}
