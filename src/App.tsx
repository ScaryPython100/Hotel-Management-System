/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import GuestView from "./pages/GuestView";
import StaffDashboard from "./pages/StaffDashboard";
import StaffLayout from "./pages/StaffLayout";
import StaffRooms from "./pages/StaffRooms";
import StaffSettings from "./pages/StaffSettings";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Redirect root to staff portal */}
        <Route path="/" element={<Navigate to="/staff" replace />} />
        
        {/* Staff Portal Routes */}
        <Route path="/staff" element={<StaffLayout />}>
           <Route index element={<StaffDashboard />} />
           <Route path="rooms" element={<StaffRooms />} />
           <Route path="settings" element={<StaffSettings />} />
        </Route>
        
        {/* Guest View using secure hash */}
        <Route path="/room/:hash" element={<GuestView />} />
      </Routes>
    </BrowserRouter>
  );
}
