import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

async function startServer() {
  app.use(express.json());

  // Webhook Endpoint for Notifications (Resend Email API)
  app.post("/api/notify", async (req, res) => {
    const { roomNumber, items, customMessage } = req.body;
    
    // Format exactly as requested
    const formattedMessage = `New Room Request:\n\n- Room: ${roomNumber}\n- Items: ${items && items.length > 0 ? items.join(", ") : "None"}\n- Note: ${customMessage || "None"}`;

    console.log(`\n======================================================`);
    console.log(`[RESEND EMAIL] Dispatching Email alert...`);
    console.log(formattedMessage);
    console.log(`======================================================\n`);
    
    const resendApiKey = process.env.RESEND_API_KEY;
    
    if (resendApiKey) {
      try {
        const resendResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: "onboarding@resend.dev",
            to: ["alamuri.kishan@gmail.com"],
            subject: `🛎️ New Request from Room ${roomNumber}`,
            text: formattedMessage
          })
        });
        
        if (!resendResponse.ok) {
          const errorText = await resendResponse.text();
          throw new Error(`Resend API returned status: ${resendResponse.status} - ${errorText}`);
        }
        
        console.log("Successfully triggered Resend Email.");
      } catch (e) {
        console.error("Failed to trigger Resend email:", e);
        return res.status(500).json({ success: false, error: "Failed to trigger notification email" });
      }
    } else {
      console.log("Missing RESEND_API_KEY in .env, skipping external API call.");
    }
    
    res.json({ success: true, message: "Staff notified successfully" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
