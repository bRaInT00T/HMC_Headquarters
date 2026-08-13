const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { normalize, indexEntry, rank, maxEdits, boundedDistance, wordScore, scoreEntry } =
  require("../../js/player-search");

// A slice of the real draftable list, chosen for the names that actually
// collide at the keyboard on draft night.
const ROSTER = [
  { name: "Ja'Marr Chase", position: "WR", team: "CIN" },
  { name: "Chase Brown", position: "RB", team: "CIN" },
  { name: "A.J. Brown", position: "WR", team: "PHI" },
  { name: "Justin Jefferson", position: "WR", team: "MIN" },
  { name: "Amon-Ra St. Brown", position: "WR", team: "DET" },
  { name: "Tom Brady", position: "QB", team: "TB" },
  { name: "Bijan Robinson", position: "RB", team: "ATL" },
  { name: "Puka Nacua", position: "WR", team: "LAR" }
];

const INDEX = ROSTER.map((entry) => indexEntry(entry, entry.position === "DEF" ? entry.team : ""));
const names = (results) => results.map((r) => r.name);
const search = (q, limit = 5) => names(rank(q, INDEX, limit));

describe("js/player-search module surface", () => {
  test("publishes itself on window for the browser pages", () => {
    globalThis.window = {};
    delete require.cache[require.resolve("../../js/player-search")];
    require("../../js/player-search");

    assert.deepEqual(Object.keys(globalThis.window.PlayerSearch).sort(), ["indexEntry", "normalize", "rank"]);
    delete globalThis.window;
  });
});

describe("js/player-search normalize", () => {
  test("folds accents, case and punctuation into plain words", () => {
    assert.equal(normalize("Ja'Marr Chase"), "ja marr chase");
    assert.equal(normalize("A.J. Brown"), "a j brown");
    assert.equal(normalize("Amon-Ra St. Brown"), "amon ra st brown");
    assert.equal(normalize("José Álvarez"), "jose alvarez");
    assert.equal(normalize("  Puka   Nacua  "), "puka nacua");
  });

  test("treats nothing at all as an empty string", () => {
    assert.equal(normalize(null), "");
    assert.equal(normalize(undefined), "");
    assert.equal(normalize(""), "");
  });
});

describe("js/player-search maxEdits", () => {
  test("gives short words no typo budget at all", () => {
    assert.equal(maxEdits(1), 0);
    assert.equal(maxEdits(3), 0);
  });

  test("scales the budget with word length", () => {
    assert.equal(maxEdits(4), 1);
    assert.equal(maxEdits(7), 1);
    assert.equal(maxEdits(8), 2);
    assert.equal(maxEdits(11), 2);
    assert.equal(maxEdits(12), 3);
    assert.equal(maxEdits(40), 3);
  });
});

describe("js/player-search boundedDistance", () => {
  test("is zero for identical strings", () => {
    assert.equal(boundedDistance("chase", "chase", 2), 0);
  });

  test("counts a substitution, an insertion and a deletion as one edit each", () => {
    assert.equal(boundedDistance("chase", "chose", 2), 1);
    assert.equal(boundedDistance("chas", "chase", 2), 1);
    assert.equal(boundedDistance("chasee", "chase", 2), 1);
  });

  test("counts a swapped pair as one edit, not two", () => {
    assert.equal(boundedDistance("jefferosn", "jefferson", 2), 1);
  });

  test("bails out as soon as the whole row is past the budget", () => {
    assert.equal(boundedDistance("mahomes", "jefferson", 1), 2, "reported as budget + 1");
    assert.equal(boundedDistance("abcdef", "uvwxyz", 2), 3);
  });

  test("rejects on length alone when the strings can't possibly be close", () => {
    assert.equal(boundedDistance("a", "abcdefgh", 2), 3);
  });

  test("handles an empty string on either side", () => {
    assert.equal(boundedDistance("", "ab", 3), 2);
    assert.equal(boundedDistance("ab", "", 3), 2);
    // Past the budget the length check catches it first, either way round.
    assert.equal(boundedDistance("", "abcd", 3), 4, "over budget, so budget + 1");
    assert.equal(boundedDistance("abcd", "", 3), 4);
  });
});

describe("js/player-search wordScore", () => {
  test("scores an exact word 1", () => {
    assert.equal(wordScore("chase", "chase"), 1);
  });

  test("scores nothing against an empty word on either side", () => {
    assert.equal(wordScore("", "chase"), 0);
    assert.equal(wordScore("chase", ""), 0);
  });

  test("ranks prefix above substring above typo at equal coverage", () => {
    const prefix = wordScore("chas", "chase");
    const substring = wordScore("hase", "chase");
    const typo = wordScore("chsae", "chase");

    assert.ok(prefix > substring, `${prefix} should beat ${substring}`);
    assert.ok(substring > typo, `${substring} should beat ${typo}`);
    assert.ok(typo > 0);
  });

  test("a thin substring and a one-edit typo land in the same band", () => {
    // Documenting where the tiers actually meet: the substring tier bottoms out
    // at 0.55 and the typo tier tops out around 0.73, so a barely-there
    // substring does not automatically outrank a near-miss spelling. Both are
    // well clear of the 0.5 floor either way, so both still make the dropdown.
    assert.ok(Math.abs(wordScore("has", "chase") - wordScore("chsae", "chase")) < 0.01);
  });

  test("rewards a longer prefix more than a shorter one", () => {
    assert.ok(wordScore("chas", "chase") > wordScore("cha", "chase"));
  });

  test("gives a short word no typo tolerance", () => {
    assert.equal(wordScore("ton", "tom"), 0, "'ton' must not surface Tom Brady");
  });

  test("gives up on a word that is past its typo budget", () => {
    assert.equal(wordScore("mahomes", "jefferson"), 0);
  });
});

describe("js/player-search indexEntry", () => {
  test("indexes a punctuated name under both readings", () => {
    const entry = indexEntry({ name: "Ja'Marr Chase" }, "");
    assert.ok(entry.words.includes("ja"));
    assert.ok(entry.words.includes("marr"));
    assert.ok(entry.words.includes("jamarr"), "'jamarr' typed as one word has to hit too");
    assert.equal(entry.squashed, "jamarrchase");
    assert.equal(entry.surname, "chase");
  });

  test("keeps the original fields and de-duplicates the word list", () => {
    const entry = indexEntry({ name: "Puka Nacua", position: "WR", team: "LAR" }, "");
    assert.equal(entry.position, "WR");
    assert.deepEqual(entry.words, [...new Set(entry.words)]);
  });

  test("folds aliases into the searchable words", () => {
    const entry = indexEntry({ name: "San Francisco 49ers" }, "SF DEF Defense");
    assert.ok(entry.words.includes("sf"));
    assert.ok(entry.words.includes("def"));
  });

  test("survives an entry with no name", () => {
    const entry = indexEntry({ name: "" }, "");
    assert.deepEqual(entry.words, []);
    assert.equal(entry.squashed, "");
    assert.equal(entry.surname, "");
  });
});

describe("js/player-search scoreEntry", () => {
  test("fails outright when a typed word matches nothing", () => {
    const entry = indexEntry({ name: "Justin Jefferson" }, "");
    assert.equal(scoreEntry(["justin", "zzzzzz"], "justinzzzzzz", entry), 0);
  });

  test("adds the surname bonus, so the surname reading wins a tie", () => {
    const chase = indexEntry({ name: "Ja'Marr Chase" }, "");
    const firstNameOnly = indexEntry({ name: "Chase Brown" }, "");
    assert.ok(scoreEntry(["chase"], "chase", chase) > scoreEntry(["chase"], "chase", firstNameOnly));
  });

  test("scores the squashed whole-string reading when the word split doesn't line up", () => {
    const entry = indexEntry({ name: "A.J. Brown" }, "");
    assert.ok(scoreEntry(["ajbrown"], "ajbrown", entry) > 0.5);
  });
});

describe("js/player-search rank", () => {
  test("returns an alphabetical browse for an empty query", () => {
    assert.deepEqual(search("", 3), ["A.J. Brown", "Amon-Ra St. Brown", "Bijan Robinson"]);
    assert.deepEqual(search("   ", 2), ["A.J. Brown", "Amon-Ra St. Brown"]);
  });

  test("respects the limit", () => {
    assert.equal(rank("", INDEX, 2).length, 2);
    assert.equal(rank("brown", INDEX, 1).length, 1);
  });

  test("finds the surname first when a word is both a first and a last name", () => {
    assert.equal(search("chase")[0], "Ja'Marr Chase");
  });

  test("matches a punctuated name typed without its punctuation", () => {
    assert.equal(search("ajbrown")[0], "A.J. Brown");
    assert.equal(search("jamarr chase")[0], "Ja'Marr Chase");
  });

  test("doesn't care what order the words come in", () => {
    assert.equal(search("chase jamarr")[0], "Ja'Marr Chase");
  });

  test("forgives a typo in a long enough name", () => {
    assert.equal(search("jeferson")[0], "Justin Jefferson");
    assert.equal(search("bijna robinson")[0], "Bijan Robinson");
  });

  test("works from a first name or an initial", () => {
    assert.equal(search("justin")[0], "Justin Jefferson");
    assert.ok(search("j chase").includes("Ja'Marr Chase"));
  });

  test("returns nothing when every candidate is below the score floor", () => {
    assert.deepEqual(search("zzzzzzzz"), []);
    assert.deepEqual(search("ton"), [], "a one-edit three-letter word must not surface Tom Brady");
  });

  test("breaks ties alphabetically so the order is stable between keystrokes", () => {
    const results = search("brown");
    assert.deepEqual(results.slice(0, 2), ["A.J. Brown", "Amon-Ra St. Brown"]);
  });
});
