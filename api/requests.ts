export default async function handler(req: any, res: any) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY)?.trim();

  // GET requests from Supabase
  if (req.method === 'GET') {
    if (!supabaseUrl || !supabaseKey) {
      return res.status(200).json({ success: true, requests: [], source: "memory" });
    }

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/guest_requests?select=*&order=created_at.desc`, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });
      if (!response.ok) {
        return res.status(200).json({ success: true, requests: [], source: "fallback" });
      }
      const data = await response.json();
      const mapped = data.map((r: any) => ({
        id: r.id,
        roomId: r.room_id,
        items: Array.isArray(r.items) ? r.items : [],
        customMessage: r.custom_message || "",
        status: r.status || "pending",
        createdAt: Number(r.created_at) || Date.now()
      }));
      return res.status(200).json({ success: true, requests: mapped, source: "supabase" });
    } catch (e: any) {
      return res.status(200).json({ success: true, requests: [], error: e?.message });
    }
  }

  // POST new request to Supabase
  if (req.method === 'POST') {
    const { roomId, items, customMessage, status, createdAt, id: providedId } = req.body;
    const newReq = {
      id: providedId || `srv-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      room_id: String(roomId || "Unknown"),
      items: Array.isArray(items) ? items : [],
      custom_message: customMessage || "",
      status: status || "pending",
      created_at: createdAt || Date.now(),
      updated_at: new Date().toISOString()
    };

    if (supabaseUrl && supabaseKey) {
      try {
        await fetch(`${supabaseUrl}/rest/v1/guest_requests`, {
          method: "POST",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
          },
          body: JSON.stringify(newReq)
        });
      } catch (e) {}
    }

    return res.status(200).json({
      success: true,
      request: {
        id: newReq.id,
        roomId: newReq.room_id,
        items: newReq.items,
        customMessage: newReq.custom_message,
        status: newReq.status,
        createdAt: newReq.created_at
      }
    });
  }

  // PATCH or DELETE
  if (req.method === 'PATCH' || req.method === 'DELETE') {
    const id = req.query?.id || req.body?.id;
    if (!id) return res.status(400).json({ error: "Missing ID" });

    if (supabaseUrl && supabaseKey) {
      if (req.method === 'PATCH') {
        const { status } = req.body;
        await fetch(`${supabaseUrl}/rest/v1/guest_requests?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ status, updated_at: new Date().toISOString() })
        });
      } else {
        await fetch(`${supabaseUrl}/rest/v1/guest_requests?id=eq.${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        });
      }
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
