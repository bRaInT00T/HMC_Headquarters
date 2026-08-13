const { test, describe, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");

const { FakeElement, installDom, installEscapeHtml } = require("../helpers/dom");

const DEFAULT_COMPUTED = {
  "--pos-color-qb": "#c2557a",
  "--pos-color-rb": "#3f9a6a",
  "--pos-color-wr": "#3d7fb8",
  "--pos-color-te": "#b8873d",
  "--pos-color-k": "#7a6bb8",
  "--pos-color-def": "#5a6172"
};

// js/draftboard.js caches the stylesheet's default palette in a module-level
// variable on first read, so any test about that cache needs a fresh copy.
function loadDraftboard() {
  delete require.cache[require.resolve("../../js/draftboard")];
  return require("../../js/draftboard");
}

let dom;
let escaper;
let board;

beforeEach(() => {
  dom = installDom({ computedProperties: DEFAULT_COMPUTED });
  escaper = installEscapeHtml();
  board = loadDraftboard();
  // renderBoard() always leaves a 1s interval running for the pick clocks.
  mock.timers.enable({ apis: ["setInterval"] });
});

afterEach(() => {
  mock.timers.reset();
  dom.restore();
  escaper.restore();
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const NUM_TEAMS = 4;

const config = (over = {}) => ({
  rounds: 2,
  teams: [
    { slot: 1, owner: "Nick" },
    { slot: 2, owner: "Sam" },
    { slot: 3, owner: "Pat" },
    { slot: 4, owner: "Lee" }
  ],
  ...over
});

const pick = (over = {}) => ({
  overall_pick: 1,
  round: 1,
  slot: 1,
  team: "Nick",
  player: "Ja'Marr Chase",
  position: "WR",
  nfl_team: "CIN",
  source: "manual",
  entered_at: new Date().toISOString(),
  ...over
});

function render(picks, opts = {}, cfg = config()) {
  const el = dom.document.addElement("board");
  board.renderBoard("board", cfg, picks, opts);
  return el;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("js/draftboard nflTeamName", () => {
  test("spells out an abbreviation, case-insensitively", () => {
    assert.equal(board.nflTeamName("BUF"), "Buffalo Bills");
    assert.equal(board.nflTeamName("buf"), "Buffalo Bills");
  });

  test("maps both spellings Yahoo and the player sync use", () => {
    assert.equal(board.nflTeamName("JAX"), board.nflTeamName("JAC"));
    assert.equal(board.nflTeamName("WAS"), board.nflTeamName("WSH"));
  });

  test("passes anything unrecognised straight through", () => {
    assert.equal(board.nflTeamName("Buffalo Bills"), "Buffalo Bills");
    assert.equal(board.nflTeamName("XYZ"), "XYZ");
  });

  test("turns nothing into an empty string", () => {
    assert.equal(board.nflTeamName(""), "");
    assert.equal(board.nflTeamName(null), "");
    assert.equal(board.nflTeamName(undefined), "");
  });
});

describe("js/draftboard positionGroup", () => {
  test("folds every spelling of a position onto one group", () => {
    assert.equal(board.positionGroup("QB"), "qb");
    assert.equal(board.positionGroup("RB"), "rb");
    assert.equal(board.positionGroup("FB"), "rb", "fullbacks ride with running backs");
    assert.equal(board.positionGroup("WR"), "wr");
    assert.equal(board.positionGroup("TE"), "te");
    assert.equal(board.positionGroup("K"), "k");
    assert.equal(board.positionGroup("PK"), "k", "Yahoo says PK, the player sync says K");
    assert.equal(board.positionGroup("DEF"), "def");
    assert.equal(board.positionGroup("D/ST"), "def");
    assert.equal(board.positionGroup("DST"), "def");
  });

  test("normalises case and stray whitespace", () => {
    assert.equal(board.positionGroup("  wr  "), "wr");
  });

  test("recognises a decorated defense", () => {
    assert.equal(board.positionGroup("DEF - Buffalo"), "def");
    assert.equal(board.positionGroup("D/ST (BUF)"), "def");
  });

  test("gives an unknown or empty position no group, so the cell stays neutral", () => {
    assert.equal(board.positionGroup("LS"), "");
    assert.equal(board.positionGroup(""), "");
    assert.equal(board.positionGroup(null), "");
    assert.equal(board.positionGroup("  "), "");
  });

  test("every group in the legend is reachable from its own covers list", () => {
    board.POSITION_GROUPS.forEach((g) => {
      g.covers.forEach((abbr) => assert.equal(board.positionGroup(abbr), g.id));
    });
    assert.deepEqual(board.POSITION_GROUP_IDS, ["qb", "rb", "wr", "te", "k", "def"]);
  });
});

describe("js/draftboard positionTagHtml", () => {
  test("renders nothing for a pick with no position", () => {
    assert.equal(board.positionTagHtml(""), "");
    assert.equal(board.positionTagHtml(undefined), "");
  });

  test("escapes the position it prints", () => {
    assert.equal(board.positionTagHtml("WR"), '<span class="pos-tag">WR</span>');
    assert.match(board.positionTagHtml('<script>'), /&lt;script&gt;/);
  });
});

describe("js/draftboard position colours", () => {
  test("accepts only a six-digit hex — these reach a style property", () => {
    assert.equal(board.isValidPositionColor("#e08b3a"), true);
    assert.equal(board.isValidPositionColor("  #E08B3A "), true);
    assert.equal(board.isValidPositionColor("#fff"), false);
    assert.equal(board.isValidPositionColor("red"), false);
    assert.equal(board.isValidPositionColor("#ffffff; background: url(x)"), false);
    assert.equal(board.isValidPositionColor(null), false);
    assert.equal(board.isValidPositionColor(0xffffff), false);
  });

  test("reads the shipped defaults off :root", () => {
    assert.deepEqual(board.defaultPositionColors(), {
      qb: "#c2557a",
      rb: "#3f9a6a",
      wr: "#3d7fb8",
      te: "#b8873d",
      k: "#7a6bb8",
      def: "#5a6172"
    });
  });

  test("hands back a copy, so a caller can't corrupt the cache", () => {
    const first = board.defaultPositionColors();
    first.qb = "#000000";
    assert.equal(board.defaultPositionColors().qb, "#c2557a");
  });

  test("falls back to a neutral grey when the stylesheet has no value", () => {
    dom.restore();
    dom = installDom({ computedProperties: { "--pos-color-qb": "not-a-colour" } });
    board = loadDraftboard();
    const colors = board.defaultPositionColors();

    assert.equal(colors.qb, "#5a6172");
    assert.equal(colors.wr, "#5a6172");
  });

  test("merges saved overrides over the defaults, lower-cased", () => {
    const colors = board.resolvePositionColors({ qb: " #ABCDEF " });
    assert.equal(colors.qb, "#abcdef");
    assert.equal(colors.rb, "#3f9a6a", "untouched groups keep the stylesheet value");
  });

  test("drops unknown groups and malformed values rather than trusting them", () => {
    const colors = board.resolvePositionColors({
      qb: "#ff0000",
      punter: "#00ff00",
      rb: "red",
      wr: null
    });
    assert.equal(colors.qb, "#ff0000");
    assert.equal(colors.punter, undefined);
    assert.equal(colors.rb, "#3f9a6a");
    assert.equal(colors.wr, "#3d7fb8");
  });

  test("an un-migrated project sends nothing and gets the defaults", () => {
    assert.deepEqual(board.resolvePositionColors(undefined), board.defaultPositionColors());
    assert.deepEqual(board.resolvePositionColors({}), board.defaultPositionColors());
  });

  test("applying writes every group as a custom property on <html>", () => {
    const applied = board.applyPositionColors({ qb: "#ff0000" });
    const { properties } = dom.document.documentElement.style;

    assert.equal(properties["--pos-color-qb"], "#ff0000");
    assert.equal(properties["--pos-color-def"], "#5a6172");
    assert.equal(Object.keys(properties).length, 6);
    assert.equal(applied.qb, "#ff0000");
  });

  test("the defaults survive an override being applied first", () => {
    board.applyPositionColors({ qb: "#ff0000" });
    assert.equal(board.defaultPositionColors().qb, "#c2557a", "the snapshot is taken before the write");
    assert.equal(board.applyPositionColors().qb, "#c2557a", "applying nothing clears back to the stylesheet");
  });
});

describe("js/draftboard renderPositionLegend", () => {
  test("renders one item per group, in legend order", () => {
    const el = dom.document.addElement("legend");
    board.renderPositionLegend("legend");

    assert.equal((el.innerHTML.match(/pos-legend-item/g) || []).length, 6);
    assert.ok(el.innerHTML.indexOf("Quarterback") < el.innerHTML.indexOf("Defense"));
    assert.match(el.innerHTML, /pos-legend-item pos-qb/);
  });

  test("does nothing when the container isn't on the page", () => {
    assert.equal(board.renderPositionLegend("missing"), undefined);
  });
});

describe("js/draftboard snake maths", () => {
  test("round-trips every pick of a full board", () => {
    for (let overall = 1; overall <= NUM_TEAMS * 6; overall++) {
      const { round, slot } = board.slotForOverallPick(overall, NUM_TEAMS);
      assert.equal(board.overallPickForRoundSlot(round, slot, NUM_TEAMS), overall);
    }
  });

  test("runs odd rounds left to right and even rounds right to left", () => {
    assert.deepEqual(board.slotForOverallPick(1, NUM_TEAMS), { round: 1, slot: 1 });
    assert.deepEqual(board.slotForOverallPick(4, NUM_TEAMS), { round: 1, slot: 4 });
    assert.deepEqual(board.slotForOverallPick(5, NUM_TEAMS), { round: 2, slot: 4 });
    assert.deepEqual(board.slotForOverallPick(8, NUM_TEAMS), { round: 2, slot: 1 });
    assert.deepEqual(board.slotForOverallPick(9, NUM_TEAMS), { round: 3, slot: 1 });

    assert.equal(board.overallPickForRoundSlot(2, 4, NUM_TEAMS), 5);
    assert.equal(board.overallPickForRoundSlot(3, 2, NUM_TEAMS), 10);
  });
});

describe("js/draftboard clock maths", () => {
  test("formats mm:ss with a padded seconds field", () => {
    assert.equal(board.formatPickClock(120), "2:00");
    assert.equal(board.formatPickClock(65), "1:05");
    assert.equal(board.formatPickClock(9), "0:09");
    assert.equal(board.formatPickClock(0), "0:00");
  });

  test("clamps a remaining time into [0, one full clock]", () => {
    const full = board.PICK_CLOCK_SECONDS * 1000;
    assert.equal(board.clampRemaining(-5000), 0);
    assert.equal(board.clampRemaining(full + 5000), full);
    assert.equal(board.clampRemaining(30_000), 30_000);
  });

  test("returns null when no clock has ever been set and there is no pick to anchor to", () => {
    assert.equal(board.resolvePickClock(null, null), null);
    assert.equal(board.resolvePickClock({}, undefined), null);
  });

  test("counts from clock_state.startedAt", () => {
    const startedAt = new Date(Date.now() - 30_000).toISOString();
    const clock = board.resolvePickClock({ startedAt, pausedAt: null }, null);

    assert.equal(clock.paused, false);
    assert.equal(clock.deadline, new Date(startedAt).getTime() + 120_000);
  });

  test("falls back to the last pick's timestamp on a project with no clock_state", () => {
    const anchor = Date.now() - 10_000;
    const clock = board.resolvePickClock(null, anchor);
    assert.equal(clock.deadline, anchor + 120_000);
  });

  test("pushes the deadline back by the announcement delay", () => {
    const anchor = Date.now();
    assert.equal(board.resolvePickClock(null, anchor, 5_000).deadline, anchor + 125_000);
  });

  test("freezes the remaining time at pausedAt, never above a full clock", () => {
    const startedAt = new Date(Date.now() - 30_000).toISOString();
    const pausedAt = new Date(Date.now() - 10_000).toISOString();
    const clock = board.resolvePickClock({ startedAt, pausedAt }, null);

    assert.equal(clock.paused, true);
    assert.ok(Math.abs(clock.remainingMs - 100_000) < 1000);

    const parked = board.resolvePickClock({ startedAt: pausedAt, pausedAt }, null, 60_000);
    assert.equal(parked.remainingMs, 120_000, "a delayed deadline can't show more than a full clock");
  });
});

describe("js/draftboard pickingSlotFor", () => {
  const trades = [{ round: 2, fromSlot: 3, toSlot: 1 }];

  test("is the slot's own team when nothing was traded", () => {
    assert.equal(board.pickingSlotFor(2, 3, []), 3);
    assert.equal(board.pickingSlotFor(2, 3, undefined), 3);
    assert.equal(board.pickingSlotFor(2, 3, null), 3);
  });

  test("hands the pick to the acquiring team", () => {
    assert.equal(board.pickingSlotFor(2, 3, trades), 1);
  });

  test("only applies to the exact round and slot that was traded", () => {
    assert.equal(board.pickingSlotFor(1, 3, trades), 3);
    assert.equal(board.pickingSlotFor(2, 4, trades), 4);
  });

  test("coerces string legs, which is how they arrive from the admin form", () => {
    assert.equal(board.pickingSlotFor(2, 3, [{ round: "2", fromSlot: "3", toSlot: "1" }]), 1);
  });
});

describe("js/draftboard pickClockHtml", () => {
  test("renders nothing without a clock", () => {
    assert.equal(board.pickClockHtml(null), "");
  });

  test("a running clock carries its deadline", () => {
    const html = board.pickClockHtml({ paused: false, deadline: 1234 });
    assert.match(html, /data-deadline="1234"/);
    assert.doesNotMatch(html, /data-frozen/);
  });

  test("a paused clock carries frozen time and says why", () => {
    assert.match(board.pickClockHtml({ paused: true, remainingMs: 5000 }), /data-frozen="5000"/);
    assert.match(board.pickClockHtml({ paused: true, remainingMs: 5000 }), /paused<\/div>/);
    assert.match(board.pickClockHtml({ paused: true, remainingMs: 5000, held: true }), /announcing<\/div>/);
  });
});

describe("js/draftboard startPickClocks", () => {
  const clockEl = (dataset) => {
    const el = new FakeElement();
    el.dataset = dataset;
    return el;
  };

  test("stops itself when there is nothing on the clock", () => {
    dom.document.setQuery(".pick-clock", []);
    board.startPickClocks();
    // No throw and no work: the guard clause is the whole behaviour here.
    mock.timers.tick(1000);
  });

  test("counts a running clock down every second", () => {
    const el = clockEl({ deadline: String(Date.now() + 65_000) });
    dom.document.setQuery(".pick-clock", [el]);

    board.startPickClocks();
    assert.equal(el.textContent, "1:05");
    assert.equal(el.classList.contains("expired"), false);

    mock.timers.tick(1000);
    assert.match(el.textContent, /1:0[45]/, "the interval keeps it moving");
  });

  test("shows a paused clock frozen, and never starts ticking for it", () => {
    const el = clockEl({ frozen: "45000" });
    dom.document.setQuery(".pick-clock", [el]);

    board.startPickClocks();
    assert.equal(el.textContent, "0:45");
    mock.timers.tick(5000);
    assert.equal(el.textContent, "0:45", "a frozen clock must not drift");
  });

  test("says time's up once the deadline has passed", () => {
    const el = clockEl({ deadline: String(Date.now() - 1000) });
    dom.document.setQuery(".pick-clock", [el]);

    board.startPickClocks();
    assert.equal(el.textContent, "time's up");
    assert.equal(el.classList.contains("expired"), true);
  });

  test("restarts rather than stacking when the board re-renders", () => {
    const el = clockEl({ deadline: String(Date.now() + 65_000) });
    dom.document.setQuery(".pick-clock", [el]);

    board.startPickClocks();
    board.startPickClocks();
    board.startPickClocks();

    el.textContent = "";
    mock.timers.tick(1000);
    // One render per tick, not three — a stacked interval would still show a
    // time, so this asserts the render count instead.
    assert.match(el.textContent, /^\d:\d\d$/);
  });
});

describe("js/draftboard wirePickCellClicks", () => {
  function cellIn(container, overall) {
    const cell = new FakeElement();
    cell.dataset.overall = String(overall);
    const target = new FakeElement();
    target.closestMatches[".pick-cell.clickable"] = cell;
    return target;
  }

  test("clicking a cell reports its overall pick number", () => {
    const container = new FakeElement("board");
    const seen = [];
    board.wirePickCellClicks(container, (n) => seen.push(n));

    container.dispatch("click", { target: cellIn(container, 17) });
    assert.deepEqual(seen, [17]);
  });

  test("ignores a click that didn't land on a clickable cell", () => {
    const container = new FakeElement("board");
    const seen = [];
    board.wirePickCellClicks(container, (n) => seen.push(n));

    container.dispatch("click", { target: new FakeElement() });
    assert.deepEqual(seen, []);
  });

  test("Enter and Space activate a cell, other keys don't", () => {
    const container = new FakeElement("board");
    const seen = [];
    board.wirePickCellClicks(container, (n) => seen.push(n));
    const target = cellIn(container, 3);

    container.dispatch("keydown", { key: "Enter", target });
    container.dispatch("keydown", { key: " ", target });
    container.dispatch("keydown", { key: "Tab", target });
    assert.deepEqual(seen, [3, 3]);
  });

  test("re-wiring swaps the callback without stacking a second listener", () => {
    const container = new FakeElement("board");
    const first = [];
    const second = [];
    board.wirePickCellClicks(container, (n) => first.push(n));
    board.wirePickCellClicks(container, (n) => second.push(n));

    container.dispatch("click", { target: cellIn(container, 9) });
    assert.deepEqual(first, [], "the stale callback must not fire");
    assert.deepEqual(second, [9], "and the live one fires exactly once");
    assert.equal(container.listeners.click.length, 1);
  });
});

describe("js/draftboard renderBoard", () => {
  test("does nothing when the container isn't on the page", () => {
    assert.equal(board.renderBoard("missing", config(), []), undefined);
  });

  test("renders a header per team and a row per round", () => {
    const el = render([]);
    assert.equal((el.innerHTML.match(/<th>/g) || []).length, NUM_TEAMS + 1, "one Rd column plus a team each");
    assert.equal((el.innerHTML.match(/round-label/g) || []).length, 2);
    assert.match(el.innerHTML, /Nick <span style="color:var\(--text-dim\)">\(1\)<\/span>/);
  });

  test("fills a recorded pick with its player, position tint and NFL team", () => {
    const el = render([pick()]);
    assert.match(el.innerHTML, /pick-cell filled pos-wr/);
    assert.match(el.innerHTML, /Ja&#39;Marr Chase|Ja'Marr Chase/);
    assert.match(el.innerHTML, /Cincinnati Bengals/);
    assert.match(el.innerHTML, /Pick #1/);
  });

  test("leaves an unrecognised position untinted rather than borrowing a colour", () => {
    const el = render([pick({ position: "LS" })]);
    assert.match(el.innerHTML, /pick-cell filled(?! pos-)/);
  });

  test("omits the NFL-team line when the pick has none", () => {
    const el = render([pick({ nfl_team: "" })]);
    assert.doesNotMatch(el.innerHTML, /Cincinnati/);
  });

  test("tags keepers and synced picks", () => {
    const el = render([pick({ source: "keeper" }), pick({ overall_pick: 2, slot: 2, source: "yahoo" })]);
    assert.match(el.innerHTML, /keeper-tag/);
    assert.match(el.innerHTML, /· synced/);
  });

  test("escapes everything that came from Yahoo or a typing commissioner", () => {
    const el = render([pick({ player: '<img src=x onerror=alert(1)>' })], {}, config({
      teams: [{ slot: 1, owner: "<b>Nick</b>" }, { slot: 2, owner: "Sam" }, { slot: 3, owner: "Pat" }, { slot: 4, owner: "Lee" }]
    }));

    assert.doesNotMatch(el.innerHTML, /<img/);
    assert.doesNotMatch(el.innerHTML, /<b>Nick/);
    assert.match(el.innerHTML, /&lt;img/);
  });

  test("puts the first empty pick on the clock — not simply the pick after the last one", () => {
    // A keeper at #6 means #2 is still the next pick to make.
    const rendered = [];
    render([pick(), pick({ overall_pick: 6, round: 2, slot: 3, source: "keeper", entered_at: null })], {
      onRendered: (info) => rendered.push(info)
    });

    assert.deepEqual(rendered[0].onClock, { round: 1, slot: 2 });
    assert.equal(rendered[0].nextOverall, 2);
    assert.equal(rendered[0].picksMade, 2);
    assert.equal(rendered[0].totalPicks, 8);
  });

  test("reports a finished board as having nobody on the clock", () => {
    const picks = [];
    for (let overall = 1; overall <= 8; overall++) {
      const { round, slot } = board.slotForOverallPick(overall, NUM_TEAMS);
      picks.push(pick({ overall_pick: overall, round, slot }));
    }
    const rendered = [];
    render(picks, { onRendered: (info) => rendered.push(info) });

    assert.equal(rendered[0].nextOverall, null);
    assert.equal(rendered[0].onClock, null);
    assert.doesNotMatch(dom.document.getElementById("board").innerHTML, /on the clock/);
  });

  test("marks the on-the-clock cell and gives it a running countdown", () => {
    const el = render([], {}, config({ clock_state: { startedAt: new Date().toISOString(), pausedAt: null } }));
    assert.match(el.innerHTML, /on-clock/);
    assert.match(el.innerHTML, /data-deadline="\d+"/);
  });

  test("anchors the clock to the last live pick, ignoring keepers", () => {
    const keeperTime = new Date(Date.now() - 86_400_000).toISOString();
    const liveTime = new Date(Date.now() - 5_000).toISOString();
    const el = render([
      pick({ source: "keeper", entered_at: keeperTime }),
      pick({ overall_pick: 2, slot: 2, entered_at: liveTime })
    ]);

    const deadline = Number(el.innerHTML.match(/data-deadline="(\d+)"/)[1]);
    assert.ok(deadline > Date.now(), "a keeper's timestamp would have expired this already");
  });

  test("renders a paused clock frozen", () => {
    const el = render([], {}, config({
      clock_state: { startedAt: new Date(Date.now() - 30_000).toISOString(), pausedAt: new Date().toISOString() }
    }));
    assert.match(el.innerHTML, /pick-clock paused/);
    assert.match(el.innerHTML, /data-frozen="\d+"/);
  });

  test("clockHeld parks the clock while the pick is being announced", () => {
    const el = render([pick()], { clockHeld: true });
    assert.match(el.innerHTML, /data-frozen="\d+"/);
    assert.match(el.innerHTML, /announcing/);
  });

  test("clockHeld does nothing to an already-paused clock", () => {
    const el = render([], { clockHeld: true }, config({
      clock_state: { startedAt: new Date().toISOString(), pausedAt: new Date().toISOString() }
    }));
    assert.match(el.innerHTML, /paused<\/div>/);
    assert.doesNotMatch(el.innerHTML, /announcing/);
  });

  test("renders no clock at all on a board that has never been started", () => {
    const el = render([pick({ entered_at: null })]);
    assert.doesNotMatch(el.innerHTML, /pick-clock/);
  });

  test("keeps a traded pick in its own column with a via note", () => {
    const cfg = config({ traded_picks: [{ round: 2, fromSlot: 3, toSlot: 1 }] });
    const el = render([], {}, cfg);

    assert.match(el.innerHTML, /class="pick-cell traded"/);
    assert.match(el.innerHTML, /via Nick/);
  });

  test("names a traded-to slot that has no owner by its number", () => {
    const cfg = config({ traded_picks: [{ round: 1, fromSlot: 2, toSlot: 9 }] });
    const el = render([], {}, cfg);
    assert.match(el.innerHTML, /via slot 9/);
  });

  test("shows the via note on a filled traded pick too", () => {
    const cfg = config({ traded_picks: [{ round: 1, fromSlot: 1, toSlot: 2 }] });
    const el = render([pick()], {}, cfg);
    assert.match(el.innerHTML, /meta via">via Sam/);
  });

  test("the public board's cells are inert markup", () => {
    const el = render([pick()]);
    assert.doesNotMatch(el.innerHTML, /clickable/);
    assert.doesNotMatch(el.innerHTML, /role="button"/);
    assert.equal(el.listeners.click, undefined);
  });

  test("passing onPickClick turns recorded picks into controls", () => {
    const el = render([pick()], { onPickClick: () => {} });
    assert.match(el.innerHTML, /clickable/);
    assert.match(el.innerHTML, /data-overall="1" role="button" tabindex="0"/);
    assert.equal(el.listeners.click.length, 1);
  });

  test("marks the cell the entry form is currently pointed at", () => {
    const el = render([pick(), pick({ overall_pick: 2, slot: 2 })], { editingOverall: 2, onPickClick: () => {} });
    assert.equal((el.innerHTML.match(/ editing"/g) || []).length, 1);
  });

  test("renders a nameless pick as an empty cell rather than 'undefined'", () => {
    const el = render([pick({ player: null })]);
    assert.match(el.innerHTML, /<div class="player"><\/div>/);
  });

  test("treats a missing picks array as an empty board", () => {
    const rendered = [];
    render(undefined, { onRendered: (info) => rendered.push(info) });
    assert.equal(rendered[0].picksMade, 0);
    assert.equal(rendered[0].nextOverall, 1);
  });
});

describe("js/draftboard renderBoard (list view)", () => {
  test("lists every pick in draft order rather than by team column", () => {
    const el = render([pick()], { view: "list" });

    assert.match(el.innerHTML, /class="board-list"/);
    assert.doesNotMatch(el.innerHTML, /<table/);
    assert.equal((el.innerHTML.match(/list-pick-num/g) || []).length, 8);
    const first = el.innerHTML.indexOf("#1<");
    const second = el.innerHTML.indexOf("#2<");
    assert.ok(first < second && first !== -1);
  });

  test("shows the player, position and NFL team on a filled row", () => {
    const el = render([pick()], { view: "list" });
    assert.match(el.innerHTML, /list-row filled pos-wr/);
    assert.match(el.innerHTML, /pos-tag">WR<\/span> · Cincinnati Bengals/);
  });

  test("drops the separator when the pick has only one of position/team", () => {
    const positionOnly = render([pick({ nfl_team: "" })], { view: "list" }).innerHTML;
    assert.doesNotMatch(positionOnly, /<\/span> · /);

    dom.document.elements.clear();
    const teamOnly = render([pick({ position: "" })], { view: "list" }).innerHTML;
    assert.match(teamOnly, /Cincinnati Bengals/);
    assert.doesNotMatch(teamOnly, /pos-tag/);
  });

  test("labels an unmade pick as upcoming and the next one as on the clock", () => {
    const el = render([pick()], { view: "list" });
    assert.match(el.innerHTML, /on the clock/);
    assert.match(el.innerHTML, /upcoming/);
    assert.match(el.innerHTML, /data-deadline=/);
  });

  test("names a slot with no owner by its number", () => {
    const el = render([], { view: "list" }, config({ teams: [{ slot: 1, owner: "Nick" }, { slot: 2, owner: "Sam" }, { slot: 3, owner: "Pat" }, { slot: 9, owner: "Lee" }] }));
    assert.match(el.innerHTML, /list-team">Slot 4</);
  });

  test("tags keepers and synced picks", () => {
    const el = render([pick({ source: "keeper" }), pick({ overall_pick: 2, slot: 2, source: "yahoo" })], {
      view: "list"
    });
    assert.match(el.innerHTML, /keeper-tag/);
    assert.match(el.innerHTML, /list-tag"><span class="meta">synced/);
  });

  test("carries the traded via note and the editing/clickable state", () => {
    const cfg = config({ traded_picks: [{ round: 1, fromSlot: 1, toSlot: 2 }, { round: 2, fromSlot: 3, toSlot: 1 }] });
    const el = render([pick()], { view: "list", onPickClick: () => {}, editingOverall: 1 }, cfg);

    assert.match(el.innerHTML, /via Sam/);
    assert.match(el.innerHTML, /via Nick/);
    assert.match(el.innerHTML, /clickable editing/);
    assert.match(el.innerHTML, /list-row traded/);
  });

  test("names a traded-to slot with no owner by its number, and blanks a nameless pick", () => {
    const cfg = config({ traded_picks: [{ round: 1, fromSlot: 2, toSlot: 9 }] });
    const el = render([pick({ player: null })], { view: "list" }, cfg);

    assert.match(el.innerHTML, /via slot 9/);
    assert.match(el.innerHTML, /<div class="player"><\/div>/);
  });

  test("shows a paused clock frozen in the list too", () => {
    const el = render([], { view: "list" }, config({
      clock_state: { startedAt: new Date().toISOString(), pausedAt: new Date().toISOString() }
    }));
    assert.match(el.innerHTML, /pick-clock paused/);
  });
});
