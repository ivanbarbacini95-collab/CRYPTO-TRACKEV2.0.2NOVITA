import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res){
  try{
    const address = String(req.query.address || "").trim().toLowerCase();
    if(!address) return res.status(400).json({ error: "missing address" });

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from("inj_sync")
      .select("address,payload,updated_at")
      .eq("address", address)
      .maybeSingle();

    if(error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || { address, payload: null, updated_at: null });
  }catch(e){
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
