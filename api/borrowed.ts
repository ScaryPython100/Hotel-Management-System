export default async function handler(req: any, res: any) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY)?.trim();

  if (!supabaseUrl || !supabaseKey) {
    return res.status(200).json({ success: true, items: [], message: "Supabase not configured" });
  }

  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };

  // GET: Fetch all borrowed items
  if (req.method === 'GET') {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/borrowed_items?select=*&order=created_at.desc`, { headers });
      if (!response.ok) {
        return res.status(200).json({ success: true, items: [] });
      }
      const data = await response.json();
      const mapped = (Array.isArray(data) ? data : []).map((row: any) => ({
        id: row.id,
        roomId: String(row.room_id),
        itemName: row.item_name,
        status: row.status === "returned" ? "returned" : "borrowed",
        createdAt: Number(row.created_at) || Date.now(),
        returnedAt: row.returned_at ? new Date(row.returned_at).getTime() : undefined,
        relayedFromRoom: row.relayed_from_room || undefined,
        relayCount: typeof row.relay_count === "number" ? row.relay_count : undefined
      }));
      return res.status(200).json({ success: true, items: mapped });
    } catch (e: any) {
      return res.status(200).json({ success: true, items: [], error: e?.message });
    }
  }

  // POST: Create new borrowed item or perform Floor-to-Floor Relay
  if (req.method === 'POST') {
    const { action, sourceBorrowedId, sourceRoomId, targetRoomId, itemName, targetRequestId, currentRelayCount, roomId, id: providedId } = req.body || {};

    // Floor-to-Floor Relay Action
    if (action === 'relay' || (sourceRoomId && targetRoomId && itemName)) {
      const now = Date.now();
      const newRelayCount = (Number(currentRelayCount) || 0) + 1;
      const newBorrowedId = `borrowed-${now}-${Math.random().toString(36).substr(2, 6)}`;

      try {
        // 1. Mark source returned
        if (sourceBorrowedId) {
          await fetch(`${supabaseUrl}/rest/v1/borrowed_items?id=eq.${encodeURIComponent(sourceBorrowedId)}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ status: "returned", returned_at: new Date().toISOString() })
          }).catch(() => {});
        }

        // 2. Insert new borrowed item
        const newRecord = {
          id: newBorrowedId,
          room_id: String(targetRoomId),
          item_name: itemName,
          status: "borrowed",
          created_at: now,
          request_id: targetRequestId || null,
          relayed_from_room: String(sourceRoomId),
          relay_count: newRelayCount
        };

        const createRes = await fetch(`${supabaseUrl}/rest/v1/borrowed_items`, {
          method: "POST",
          headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
          body: JSON.stringify(newRecord)
        });

        if (!createRes.ok) {
          // Schema fallback without relay columns
          await fetch(`${supabaseUrl}/rest/v1/borrowed_items`, {
            method: "POST",
            headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
            body: JSON.stringify({
              id: newBorrowedId,
              room_id: String(targetRoomId),
              item_name: itemName,
              status: "borrowed",
              created_at: now
            })
          }).catch(() => {});
        }

        // 3. Complete target request if provided
        if (targetRequestId) {
          await fetch(`${supabaseUrl}/rest/v1/guest_requests?id=eq.${encodeURIComponent(targetRequestId)}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ status: "completed", updated_at: new Date().toISOString() })
          }).catch(() => {});
        }

        return res.status(200).json({ success: true, item: newRecord });
      } catch (e: any) {
        return res.status(500).json({ success: false, error: e?.message });
      }
    }

    // Standard POST new borrowed item
    const newItem = {
      id: providedId || `borrowed-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      room_id: String(roomId || "Unknown"),
      item_name: itemName,
      status: "borrowed",
      created_at: Date.now()
    };

    try {
      await fetch(`${supabaseUrl}/rest/v1/borrowed_items`, {
        method: "POST",
        headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify(newItem)
      });
      return res.status(200).json({ success: true, item: newItem });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e?.message });
    }
  }

  // PATCH / PUT: Mark returned
  if (req.method === 'PATCH' || req.method === 'PUT') {
    const { id, status } = req.body || {};
    const queryId = req.query?.id || id;
    if (!queryId) return res.status(400).json({ error: "Missing id" });

    try {
      await fetch(`${supabaseUrl}/rest/v1/borrowed_items?id=eq.${encodeURIComponent(queryId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: status || "returned",
          returned_at: new Date().toISOString()
        })
      });
      return res.status(200).json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message });
    }
  }

  // DELETE
  if (req.method === 'DELETE') {
    const queryId = req.query?.id;
    if (!queryId) return res.status(400).json({ error: "Missing id" });

    try {
      await fetch(`${supabaseUrl}/rest/v1/borrowed_items?id=eq.${encodeURIComponent(queryId)}`, {
        method: "DELETE",
        headers
      });
      return res.status(200).json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
