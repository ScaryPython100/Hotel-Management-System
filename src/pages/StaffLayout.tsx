import { Link, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, QrCode, Settings } from "lucide-react";

export default function StaffLayout() {
  const location = useLocation();

  const navItems = [
    { name: "Live Requests", path: "/staff", icon: <LayoutDashboard className="w-5 h-5 mr-3" /> },
    { name: "Rooms & QR Codes", path: "/staff/rooms", icon: <QrCode className="w-5 h-5 mr-3" /> },
    { name: "Service Settings", path: "/staff/settings", icon: <Settings className="w-5 h-5 mr-3" /> },
  ];

  return (
    <div className="min-h-screen bg-[#F9F7F4] flex flex-col md:flex-row text-[#2D2926] font-sans">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-[#1A1A1A] text-white flex flex-col shrink-0">
        <div className="p-8 border-b border-white/10">
          <h1 className="text-2xl font-serif italic text-white mb-2">Hues Stay Luxury Rooms</h1>
          <p className="text-[10px] font-medium tracking-[0.2em] uppercase text-[#8C857D]">Staff Portal</p>
        </div>
        <nav className="p-8 flex-1 space-y-4">
          {navItems.map((item) => {
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
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
