// /api/load.js — Vercel Serverless Function (CommonJS)
// Loads cloud payload for a given address.
// Requires env:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

const { createClient } = require("@supabase/supabase-js");

function json(res, code, obj){
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function cleanAddress(a){
  return String(a || "").trim();
}

module.exports = async (req, res) => {
  try{
    if (req.method !== "GET") {
      return json(res, 405, { ok:false, error:"Method not allowed" });
    }

    const address = cleanAddress(req.query?.address);
    if (!address) return json(res, 400, { ok:false, error:"Missing address" });

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return json(res, 500, { ok:false, error:"Missing Supabase env vars" });

    const supabase = createClient(url, key, { auth: { persistSession:false } });

    const { data, error } = await supabase
      .from("inj_sync")
      .select("payload, updated_at")
      .eq("address", address)
      .maybeSingle();

    if (error) return json(res, 500, { ok:false, error: String(error.message || error) });
    if (!data) return json(res, 200, { ok:true, data:null });

    return json(res, 200, {
      ok:true,
      data: data.payload || null,
      updatedAt: data.updated_at || null
    });
  } catch (e){
    return json(res, 500, { ok:false, error: String(e?.message || e) });
  }
};
