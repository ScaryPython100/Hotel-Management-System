import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, QrCode, Settings, LogOut, Lock } from "lucide-react";
import { useState, useEffect } from "react";
import { toast, Toaster } from "sonner";
import PinAuthModal from "../components/PinAuthModal";

export default function StaffLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [role, setRole] = useState<"superhost" | "staff">("staff");
  const [isInitializing, setIsInitializing] = useState(true);
  const [showPinModal, setShowPinModal] = useState(false);

  useEffect(() => {
    const savedRole = localStorage.getItem("staffRole") as "superhost" | "staff" | null;
    if (savedRole === "superhost") {
      setRole("superhost");
    }
    setIsInitializing(false);
  }, []);

  if (isInitializing) return null;

  const handleSuperhostToggle = () => {
    if (role === "superhost") {
      localStorage.removeItem("staffRole");
      setRole("staff");
      navigate("/staff");
      toast.success("Returned to Staff View");
    } else {
      setShowPinModal(true);
    }
  };

  const handlePinSuccess = () => {
    setRole("superhost");
    localStorage.setItem("staffRole", "superhost");
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
        <div className="p-8 border-t border-white/10">
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
