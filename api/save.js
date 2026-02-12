// /api/save.js — Vercel Serverless Function (CommonJS)
// Saves (and merges) cloud payload for a given address.
// Requires env:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
//
// Body: JSON payload from frontend.
// Optional fields:
// - leader: boolean (if true, overwrite instead of merge)
// - updatedAt: number (client timestamp)

const { createClient } = require("@supabase/supabase-js");

function json(res, code, obj){
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function cleanAddress(a){ return String(a || "").trim(); }
function safeNum(n){ n = Number(n); return Number.isFinite(n) ? n : 0; }

function uniqByKey(arr, keyFn){
  const map = new Map();
  for (const it of (Array.isArray(arr) ? arr : [])){
    try{
      const k = keyFn(it);
      if (k == null) continue;
      if (!map.has(k)) map.set(k, it);
    } catch {}
  }
  return [...map.values()];
}

function mergeArraysByTimes(baseTimes, baseVals, addTimes, addVals){
  const map = new Map();
  const bt = Array.isArray(baseTimes) ? baseTimes : [];
  const bv = Array.isArray(baseVals) ? baseVals : [];
  for (let i=0;i<bt.length;i++){
    const t = safeNum(bt[i]);
    if (!t) continue;
    map.set(t, safeNum(bv[i]));
  }
  const at = Array.isArray(addTimes) ? addTimes : [];
  const av = Array.isArray(addVals) ? addVals : [];
  for (let i=0;i<at.length;i++){
    const t = safeNum(at[i]);
    if (!t) continue;
    if (!map.has(t)) map.set(t, safeNum(av[i]));
  }
  const times = [...map.keys()].sort((a,b)=>a-b);
  const vals = times.map(t => map.get(t));
  return { times, vals };
}

function mergeStake(localStake, remoteStake){
  const a = localStake || {};
  const b = remoteStake || {};
  const al = Array.isArray(a.labels) ? a.labels : [];
  const ad = Array.isArray(a.data) ? a.data : [];
  const am = Array.isArray(a.moves) ? a.moves : [];
  const at = Array.isArray(a.types) ? a.types : [];

  const bl = Array.isArray(b.labels) ? b.labels : [];
  const bd = Array.isArray(b.data) ? b.data : [];
  const bm = Array.isArray(b.moves) ? b.moves : [];
  const bt = Array.isArray(b.types) ? b.types : [];

  const map = new Map();
  for (let i=0;i<al.length;i++){
    const k = String(al[i] ?? "");
    if (!k) continue;
    map.set(k, { d: safeNum(ad[i]), m: safeNum(am[i]), t: String(at[i] ?? "") });
  }
  for (let i=0;i<bl.length;i++){
    const k = String(bl[i] ?? "");
    if (!k) continue;
    if (!map.has(k)){
      map.set(k, { d: safeNum(bd[i]), m: safeNum(bm[i]), t: String(bt[i] ?? "") });
    }
  }
  const labels = [...map.keys()];
  // Keep original ordering by label string; frontend will reorder precisely anyway
  labels.sort();
  return {
    labels,
    data: labels.map(k => map.get(k).d),
    moves: labels.map(k => map.get(k).m),
    types: labels.map(k => map.get(k).t || "Stake update")
  };
}

function mergeWd(localWd, remoteWd){
  const a = localWd || {};
  const b = remoteWd || {};
  const al = Array.isArray(a.labels) ? a.labels : [];
  const av = Array.isArray(a.values) ? a.values : [];
  const at = Array.isArray(a.times) ? a.times : [];

  const bl = Array.isArray(b.labels) ? b.labels : [];
  const bv = Array.isArray(b.values) ? b.values : [];
  const bt = Array.isArray(b.times) ? b.times : [];

  // Use time as primary key when available; else label
  const map = new Map();

  for (let i=0;i<at.length;i++){
    const t = safeNum(at[i]);
    const v = safeNum(av[i]);
    if (!t || !v) continue;
    map.set(t, { t, v, l: String(al[i] ?? "") });
  }
  for (let i=0;i<bt.length;i++){
    const t = safeNum(bt[i]);
    const v = safeNum(bv[i]);
    if (!t || !v) continue;
    if (!map.has(t)) map.set(t, { t, v, l: String(bl[i] ?? "") });
  }
  const times = [...map.keys()].sort((a,b)=>a-b);
  return {
    times,
    values: times.map(t => map.get(t).v),
    labels: times.map(t => map.get(t).l || "")
  };
}

function mergeNW(localNw, remoteNw){
  const a = localNw || {};
  const b = remoteNw || {};
  const mu = mergeArraysByTimes(a.times, a.usd, b.times, b.usd);
  const mi = mergeArraysByTimes(a.times, a.inj, b.times, b.inj);
  // ensure same times array: take union of both
  const timeSet = new Set([...(mu.times||[]), ...(mi.times||[])]);
  const times = [...timeSet].sort((x,y)=>x-y);
  const usdMap = new Map(mu.times.map((t,i)=>[t, mu.vals[i]]));
  const injMap = new Map(mi.times.map((t,i)=>[t, mi.vals[i]]));
  return {
    times,
    usd: times.map(t => safeNum(usdMap.get(t))),
    inj: times.map(t => safeNum(injMap.get(t)))
  };
}

function mergeEvents(localEvents, remoteEvents){
  const a = Array.isArray(localEvents) ? localEvents : [];
  const b = Array.isArray(remoteEvents) ? remoteEvents : [];
  const all = a.concat(b);
  const uniq = uniqByKey(all, (e) => {
    const ts = safeNum(e?.ts || e?.t || e?.time);
    const ty = String(e?.type || "");
    const tx = String(e?.text || e?.msg || "");
    if (!ts) return null;
    return `${ts}|${ty}|${tx}`.slice(0, 500);
  });
  uniq.sort((x,y)=>safeNum(x?.ts||x?.t)-safeNum(y?.ts||y?.t));
  return uniq;
}

module.exports = async (req, res) => {
  try{
    if (req.method !== "POST") {
      return json(res, 405, { ok:false, error:"Method not allowed" });
    }

    const address = cleanAddress(req.query?.address);
    if (!address) return json(res, 400, { ok:false, error:"Missing address" });

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return json(res, 500, { ok:false, error:"Missing Supabase env vars" });

    const supabase = createClient(url, key, { auth: { persistSession:false } });

    let body = req.body;
    // Vercel may pass body as string
    if (typeof body === "string") {
      try{ body = JSON.parse(body); } catch { body = {}; }
    }
    body = body && typeof body === "object" ? body : {};

    const leader = !!body.leader;
    const clientUpdatedAt = safeNum(body.updatedAt);

    // strip helper fields
    const incoming = { ...body };
    delete incoming.leader;
    delete incoming.updatedAt;

    // Load existing
    const { data: existing, error: readErr } = await supabase
      .from("inj_sync")
      .select("payload, updated_at")
      .eq("address", address)
      .maybeSingle();

    if (readErr) return json(res, 500, { ok:false, error: String(readErr.message || readErr) });

    let mergedPayload = incoming;

    if (!leader && existing?.payload){
      const prev = existing.payload || {};
      mergedPayload = {
        ...prev,
        ...incoming,
        stake: mergeStake(incoming.stake, prev.stake),
        wd: mergeWd(incoming.wd, prev.wd),
        nw: mergeNW(incoming.nw, prev.nw),
        events: mergeEvents(incoming.events, prev.events)
      };
    }

    // Upsert
    const { error: upErr } = await supabase
      .from("inj_sync")
      .upsert({
        address,
        payload: mergedPayload,
        updated_at: new Date().toISOString()
      }, { onConflict: "address" });

    if (upErr) return json(res, 500, { ok:false, error: String(upErr.message || upErr) });

    return json(res, 200, { ok:true, leader, clientUpdatedAt });
  } catch (e){
    return json(res, 500, { ok:false, error: String(e?.message || e) });
  }
};
