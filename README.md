# Hues Stay Room Service 🏨

A modern, streamlined web application for hotel room service and inventory management. This platform allows guests to seamlessly request daily amenities, housekeeping, and special items directly from their mobile devices, while providing the hotel staff with a real-time dashboard to manage and fulfill these requests.

## 🌟 Key Features

- **Guest Portal:** Mobile-first interface for guests to browse and request daily services (e.g., room cleaning, towel refills) and inventory items (e.g., Kettles, Irons, Hair Dryers).
- **Staff Dashboard:** Real-time request monitoring for hotel staff. Includes instant alerts and visual indicators for pending and completed requests.
- **Smart Inventory Management:** 
  - Tracks item availability based on fixed inventory limits.
  - Features an **auto-depletion system**: Once all units of a specific item (e.g., a Leg Massager) are in use by guests, it automatically marks the item as "Unavailable" across all rooms.
  - Automatically restores availability once the staff marks an item return as completed.
- **Service Settings Panel:** Allows management to manually toggle the availability of specific items and services on the fly.
- **QR Code Integration:** Easily generate and print QR codes linking to specific room URLs.

## 💻 Tech Stack

- **Frontend:** React 19, TypeScript, TailwindCSS v4, React Router, Lucide React (Icons), Framer Motion
- **Backend/API:** Express.js, Vercel Serverless Functions
- **Database & Auth:** Supabase, Firebase
- **Deployment:** Vercel (Optimized with Vercel Analytics)
- **Tooling:** Vite, ESBuild

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- npm or yarn
- Supabase Project & Firebase Project (for environment variables)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ScaryPython100/Hotel-Management-System.git
   cd Hotel-Management-System
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Setup:**
   Create a `.env` file in the root of the project and populate it with your Supabase and Firebase keys (see `.env.example` if available).
   ```env
   VITE_SUPABASE_URL="your_supabase_url"
   VITE_SUPABASE_ANON_KEY="your_supabase_anon_key"
   # Add other relevant keys for Firebase and Resend/Emails here
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```
   The application will start, usually accessible at `http://localhost:5173`.

### Build & Production

To build the project for production (compiling both the React frontend and the Express backend):
```bash
npm run build
```
To run the built version locally:
```bash
npm run start
```

## 📋 Architecture Notes

- **`src/pages/`**: Contains the core views (`GuestView`, `StaffDashboard`, `StaffSettings`).
- **`src/lib/`**: Contains database client configurations (`supabaseClient.ts`, etc.).
- **`server.ts`**: Express backend for handling local/custom server operations and background syncing.
- **`api/requests.ts`**: Vercel Serverless Function entry point, optimized for edge network handling.

## 🤝 Contribution & Usage

This project was built tailored to the operational requirements of Hues Stay. If adapting for another hotel, ensure you review `src/types.ts` (`COMMON_ITEMS` and `TARGET_AUTO_UNAVAILABLE_ITEMS`) to adjust the catalog and default inventory limits.
