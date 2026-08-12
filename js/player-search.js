// Fuzzy name matching for admin.html's player autocompletes (manual pick entry,
// keepers, and the board's inline editor).
//
// The draft board gets typed into live, at speed, by someone half-listening to
// the room — so "jamar chase", "aj brown", "chase jamarr" and "jeferson" all
// have to land on the right player. A substring match (what a SQL `ilike
// '%q%'` gives you) lands on none of them, so matching happens here instead,
// over the whole draftable player list held in memory by the caller.
//
// Scoring is deliberately conservative: every word you type has to match
// something, short words have no typo budget at all, and the whole list is
// ~2,000 names, so ranking every one of them on every keystroke costs a
// couple of milliseconds.
(function () {
  // A match has to clear this to make the dropdown at all. Roughly: a solid
  // substring hit is 0.6+, a prefix 0.75+, a one-typo word 0.7+.
  const MIN_SCORE = 0.5;

  // Ranking nudge for matching the surname rather than a first name — when
  // "chase" could mean Ja'Marr Chase or Chase Brown, the surname is the one
  // people mean more often.
  const SURNAME_BONUS = 0.03;

  // Fold a name down to the letters someone would actually type: accents
  // stripped, case dropped, and every punctuation mark turned into a word
  // break, so "A.J.", "Ja'Marr" and "Smith-Schuster" all come apart into
  // plain words.
  function normalize(str) {
    return String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  // Typo budget by word length. Under four characters the budget is zero: one
  // edit away from "tom" sits "ton", "tim", "top" and "toe", and a dropdown
  // that shows all of them has stopped being a dropdown.
  function maxEdits(len) {
    if (len <= 3) return 0;
    if (len <= 7) return 1;
    if (len <= 11) return 2;
    return 3;
  }

  // Optimal string alignment distance — Levenshtein plus adjacent
  // transposition, so a fumbled "jefferosn" costs one edit rather than two.
  // Bounded: every cell in a row can only grow from here, so once the whole
  // row is past the budget we stop and report a miss.
  function boundedDistance(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const n = a.length;
    const m = b.length;
    if (!n) return m > max ? max + 1 : m;
    if (!m) return n > max ? max + 1 : n;

    let twoBack = null;
    let oneBack = Array.from({ length: m + 1 }, (_, j) => j);
    for (let i = 1; i <= n; i++) {
      const row = new Array(m + 1);
      row[0] = i;
      let rowMin = i;
      for (let j = 1; j <= m; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(oneBack[j] + 1, row[j - 1] + 1, oneBack[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          v = Math.min(v, twoBack[j - 2] + 1);
        }
        row[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      twoBack = oneBack;
      oneBack = row;
    }
    return oneBack[m];
  }

  // How well one typed word matches one indexed word, 0 (no match) to 1.
  // The tiers are ordered by how much of the target the typed word accounts
  // for, so "chas" beats "cha" beats "c" on the way to "chase", and a typo
  // never outranks something you spelled right.
  function wordScore(q, t) {
    if (!q || !t) return 0;
    if (q === t) return 1;
    const coverage = q.length / t.length;
    if (t.startsWith(q)) return 0.75 + 0.2 * coverage;
    if (t.includes(q)) return 0.55 + 0.15 * coverage;
    const budget = maxEdits(q.length);
    if (!budget) return 0;
    const dist = boundedDistance(q, t, budget);
    if (dist > budget) return 0;
    return 0.8 * (1 - dist / Math.max(q.length, t.length));
  }

  // Two passes, best one wins:
  //
  // 1. Whole string, punctuation squeezed out — this is what catches "ajbrown"
  //    for "A.J. Brown" and "jamarrchase" for "Ja'Marr Chase", where the typed
  //    word boundaries don't line up with the name's.
  // 2. Word by word, each typed word claiming its own best unclaimed word of
  //    the name — this is what makes order not matter ("chase jamarr"),
  //    partial names work ("just jeff") and initials work ("j chase"), while
  //    still rejecting anything with a word that matched nothing.
  function scoreEntry(queryWords, querySquashed, entry) {
    const whole = wordScore(querySquashed, entry.squashed);

    let total = 0;
    let matchedSurname = false;
    const claimed = new Array(entry.words.length).fill(false);
    for (const q of queryWords) {
      let bestValue = 0;
      let bestIndex = -1;
      for (let i = 0; i < entry.words.length; i++) {
        if (claimed[i]) continue;
        const value = wordScore(q, entry.words[i]);
        if (value > bestValue) {
          bestValue = value;
          bestIndex = i;
        }
      }
      if (bestIndex < 0) {
        total = 0; // a typed word matched nothing — the word pass fails outright
        break;
      }
      claimed[bestIndex] = true;
      if (entry.words[bestIndex] === entry.surname) matchedSurname = true;
      total += bestValue;
    }
    const byWord = total ? total / queryWords.length : 0;

    const best = Math.max(whole, byWord);
    return best && matchedSurname ? best + SURNAME_BONUS : best;
  }

  // Pre-computes everything scoring needs, so a keystroke only pays for the
  // comparison. `aliases` is extra searchable text that isn't part of the
  // displayed name (the "SF" that should find the San Francisco defense).
  //
  // A name is indexed under both readings of its punctuation, because people
  // type it both ways: "Ja'Marr" is a two-word "ja marr" to anyone spelling it
  // out and a one-word "jamarr" to everyone else, and "A.J." is "a j" or "aj".
  // Neither reading can match the other by edit distance — the lengths are too
  // far apart — so both go in the index.
  function indexEntry(entry, aliases) {
    const split = normalize(entry.name);
    const joined = normalize(String(entry.name || "").replace(/['’.\-]/g, ""));
    const joinedWords = joined ? joined.split(" ") : [];
    const words = (split ? split.split(" ") : [])
      .concat(joinedWords, normalize(aliases).split(" ").filter(Boolean));
    return Object.assign({}, entry, {
      words: words.filter((w, i) => words.indexOf(w) === i),
      squashed: split.replace(/ /g, ""),
      surname: joinedWords.length ? joinedWords[joinedWords.length - 1] : ""
    });
  }

  function byName(a, b) {
    return a.name.localeCompare(b.name);
  }

  // Ranks indexed entries against a raw typed query, best first. An empty
  // query is a browse rather than a search, so it comes back alphabetical —
  // which is what the position/NFL-team filters lean on.
  function rank(query, entries, limit) {
    const norm = normalize(query);
    if (!norm) return entries.slice().sort(byName).slice(0, limit);

    const queryWords = norm.split(" ");
    const querySquashed = norm.replace(/ /g, "");
    const scored = [];
    for (const entry of entries) {
      const score = scoreEntry(queryWords, querySquashed, entry);
      if (score >= MIN_SCORE) scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score || byName(a.entry, b.entry));
    return scored.slice(0, limit).map((s) => s.entry);
  }

  window.PlayerSearch = { normalize, indexEntry, rank };
})();
