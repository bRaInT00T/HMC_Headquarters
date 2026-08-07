// POST /api/players/sync-page — fetches one page of NFL players from
// balldontlie and upserts them into the nfl_players table, which powers
// admin.html's manual pick-entry autocomplete. Called repeatedly by
// admin.html (paced ~13s apart to stay under balldontlie's free-tier 5
// req/min limit) until the response's nextCursor comes back null.
// Body: { cursor } — omit/null cursor to start from the beginning.
//
// Uses /nfl/v1/players rather than /nfl/v1/players/active — the "active"
// filter endpoint is a paid-tier-only feature (see balldontlie's Account
// Tiers docs) and 401s on a free key. There's no `active` boolean on this
// endpoint either, so "active roster" is approximated by requiring a
// non-null `team` — every sampled record with an assigned team was a
// current player, and unsigned/retired players came back with team: null.
const { supabaseRequest } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "BALLDONTLIE_API_KEY is not set in this project's environment variables." });
    return;
  }

  const cursor = (req.body || {}).cursor;
  const url = new URL("https://api.balldontlie.io/nfl/v1/players");
  url.searchParams.set("per_page", "100");
  if (cursor) url.searchParams.set("cursor", cursor);

  try {
    const apiRes = await fetch(url, { headers: { Authorization: apiKey } });
    if (!apiRes.ok) {
      const retryAfter = apiRes.headers.get("retry-after");
      const err = new Error(`balldontlie API failed: ${apiRes.status} ${await apiRes.text()}`);
      if (apiRes.status === 429) err.retryAfterSeconds = retryAfter ? Number(retryAfter) : null;
      throw err;
    }
    const { data, meta } = await apiRes.json();

    const rows = (data || [])
      .filter((p) => p.team && p.team.abbreviation)
      .map((p) => ({
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        full_name: `${p.first_name} ${p.last_name}`,
        position: p.position_abbreviation || p.position || "",
        team: p.team.abbreviation,
        jersey_number: p.jersey_number || "",
        updated_at: new Date().toISOString()
      }));

    if (rows.length) {
      await supabaseRequest("nfl_players", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: rows
      });
    }

    res.status(200).json({ synced: rows.length, nextCursor: (meta && meta.next_cursor) || null });
  } catch (e) {
    res.status(e.retryAfterSeconds !== undefined ? 429 : 500).json({
      error: e.message,
      retryAfterSeconds: e.retryAfterSeconds
    });
  }
};
