// POST /api/yahoo/sync — pulls current draft results from Yahoo and
// upserts them into Supabase (draft_picks). Every insert there fans out
// instantly to draft.html via Supabase Realtime, so this is what makes the
// public board "live" once the league is drafting inside Yahoo itself.
//
// Also backfills draft_config.teams (owner per slot) from round-1 picks,
// so you don't have to hand-enter the draft order once Yahoo has it.
//
// NOTE: Yahoo's Fantasy API JSON envelope is unusual (collections come
// back as {"0": {...}, "1": {...}, "count": N} instead of a plain array —
// see lib/yahoo.js:flattenYahooCollection). This was written against
// Yahoo's documented shape but hasn't been run against a live league yet.
// If it errors, check the Vercel function logs — they include the raw
// error — and it's likely a one-line fix to the field paths below.
const { yahooFetch, flattenYahooCollection } = require("../../lib/yahoo");
const { supabaseRequest } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");

function slotForOverallPick(overallPick, numTeams) {
  const round = Math.ceil(overallPick / numTeams);
  const posInRound = ((overallPick - 1) % numTeams) + 1;
  const slot = round % 2 === 1 ? posInRound : numTeams + 1 - posInRound;
  return { round, slot };
}

// Yahoo often represents a "record" as an array of small single-key
// objects, e.g. [{team_key:"..."}, {name:"..."}, ...] — this flattens
// that into one plain object.
function flattenFieldArray(arr) {
  return Object.assign({}, ...(arr || []).filter(Boolean));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const leagueKey = process.env.YAHOO_LEAGUE_KEY;
  if (!leagueKey) {
    res.status(500).json({ error: "YAHOO_LEAGUE_KEY is not set in this project's environment variables." });
    return;
  }

  try {
    // 1. Draft results: pick number, round, team_key, player_key
    const draftJson = await yahooFetch(`/league/${leagueKey}/draftresults`);
    const draftResultsNode = draftJson.fantasy_content.league[1].draft_results;
    const rawPicks = flattenYahooCollection(draftResultsNode).map((p) => p.draft_result);

    if (!rawPicks.length) {
      res.status(200).json({ synced: 0, message: "Yahoo has no draft picks yet." });
      return;
    }

    // 2. Team names, to label picks and backfill draft order
    const teamsJson = await yahooFetch(`/league/${leagueKey}/teams`);
    const teamNodes = flattenYahooCollection(teamsJson.fantasy_content.league[1].teams).map((t) =>
      flattenFieldArray(t.team[0])
    );
    const teamNameByKey = {};
    teamNodes.forEach((t) => {
      teamNameByKey[t.team_key] = t.name;
    });
    const numTeams = teamNodes.length;

    // 3. Player names/positions/NFL teams, batched (Yahoo caps combined key lookups)
    const playerKeys = [...new Set(rawPicks.map((p) => p.player_key).filter(Boolean))];
    const playerInfoByKey = {};
    for (let i = 0; i < playerKeys.length; i += 25) {
      const batch = playerKeys.slice(i, i + 25);
      const playersJson = await yahooFetch(`/league/${leagueKey}/players;player_keys=${batch.join(",")}`);
      const playerNodes = flattenYahooCollection(playersJson.fantasy_content.league[1].players).map((p) =>
        flattenFieldArray(p.player[0])
      );
      playerNodes.forEach((fields) => {
        playerInfoByKey[fields.player_key] = {
          name: fields.name ? fields.name.full : fields.player_key,
          position: fields.display_position || "",
          nflTeam: fields.editorial_team_abbr || ""
        };
      });
    }

    // 4. Build rows and upsert into Supabase
    const picksToSave = rawPicks.map((p) => {
      const overall = Number(p.pick);
      const { slot } = slotForOverallPick(overall, numTeams);
      const info = playerInfoByKey[p.player_key] || {};
      return {
        overall_pick: overall,
        round: Number(p.round),
        slot,
        team: teamNameByKey[p.team_key] || p.team_key,
        player: info.name || p.player_key,
        position: info.position || "",
        nfl_team: info.nflTeam || "",
        source: "yahoo"
      };
    });

    await supabaseRequest("draft_picks", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: picksToSave
    });

    // 5. Backfill draft order from round-1 picks (merge into existing config)
    const round1 = picksToSave.filter((p) => p.round === 1);
    if (round1.length) {
      const cfgRows = await supabaseRequest("draft_config?id=eq.1&select=teams");
      const currentTeams = (cfgRows && cfgRows[0] && cfgRows[0].teams) || [];
      const merged = currentTeams.map((t) => {
        const found = round1.find((p) => p.slot === t.slot);
        // Spread rather than rebuild: Yahoo only knows the team name here, and
        // rebuilding would drop the hand-entered manager on every sync.
        return found ? { ...t, slot: t.slot, owner: found.team } : t;
      });
      await supabaseRequest("draft_config?id=eq.1", { method: "PATCH", body: { teams: merged } });
    }

    res.status(200).json({ synced: picksToSave.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
