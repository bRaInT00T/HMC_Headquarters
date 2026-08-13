// Builders for Yahoo's Fantasy API JSON shape, which is unusual enough that
// hand-writing it in every test would bury what each test is actually about:
// collections are index-keyed objects with a trailing "count", and a record is
// an array of single-key objects rather than one object.

// { "0": a, "1": b, count: 2 }
function collection(items) {
  const node = {};
  items.forEach((item, i) => {
    node[String(i)] = item;
  });
  node.count = items.length;
  return node;
}

// [{team_key: "..."}, {name: "..."}] — one key per element.
function fieldArray(fields) {
  return Object.entries(fields).map(([k, v]) => ({ [k]: v }));
}

function league(payloadKey, node) {
  return { fantasy_content: { league: [{ league_key: "nfl.l.1" }, { [payloadKey]: node }] } };
}

function draftResults(picks) {
  return league("draft_results", collection(picks.map((draft_result) => ({ draft_result }))));
}

function teams(teamList) {
  return league("teams", collection(teamList.map((fields) => ({ team: [fieldArray(fields)] }))));
}

function players(playerList) {
  return league("players", collection(playerList.map((fields) => ({ player: [fieldArray(fields)] }))));
}

module.exports = { collection, fieldArray, league, draftResults, teams, players };
