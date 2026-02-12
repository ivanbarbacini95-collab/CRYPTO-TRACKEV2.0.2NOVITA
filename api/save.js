import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res){
  try{
    const address = String(req.query.address || "").trim().toLowerCase();
    if(!address) return res.status(400).json({ error: "missing address" });

    const body = req.body || {};
    const payload = body.payload ?? null;
    const leader = !!body.leader;
    const updatedAt = Number(body.updatedAt || Date.now());

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Read existing (to prevent older overwrites when NOT leader)
    const { data: existing, error: readErr } = await supabase
      .from("inj_sync")
      .select("payload,updated_at")
      .eq("address", address)
      .maybeSingle();

    if(readErr) return res.status(500).json({ error: readErr.message });

    const existingTs = existing?.payload?.updatedAt ? Number(existing.payload.updatedAt) : (existing?.updated_at ? Date.parse(existing.updated_at) : 0);
    const accept = leader || !existing || (updatedAt >= existingTs);

    if(!accept){
      return res.status(200).json({ status: "ignored", reason: "older_than_cloud", cloudUpdatedAt: existingTs });
    }

    const toWrite = { ...(payload || {}), updatedAt };

    const { error: upErr } = await supabase
      .from("inj_sync")
      .upsert({ address, payload: toWrite, updated_at: new Date().toISOString() }, { onConflict: "address" });

    if(upErr) return res.status(500).json({ error: upErr.message });

    return res.status(200).json({ status: "ok", accepted: true, leader, updatedAt });
  }catch(e){
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
