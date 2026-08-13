const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { FakeElement } = require("../helpers/dom");
const {
  parseDraftDate,
  formatDraftDateForStorage,
  draftDateToPickerValues,
  formatDraftDate,
  startDraftCountdown
} = require("../../js/countdown");

const pad = (n) => String(n).padStart(2, "0");

// parseDraftDate reads a bare "YYYY-MM-DD HH:MM" as *local* time, so the test
// dates have to be built in local time too — toISOString() would shift them by
// the machine's UTC offset and quietly move the assertions.
const localDateText = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const inHours = (h) => localDateText(new Date(Date.now() + h * 3600 * 1000));

describe("js/countdown parseDraftDate", () => {
  test("returns null for anything that isn't a date", () => {
    for (const text of ["", null, undefined, "fourth weekend of August", "  "]) {
      assert.equal(parseDraftDate(text), null);
    }
  });

  test("treats TBD (and TBD-with-prose) as unset", () => {
    assert.equal(parseDraftDate("TBD"), null);
    assert.equal(parseDraftDate("tbd – fourth weekend of August"), null);
  });

  test("parses a bare ISO date as local midnight, not UTC", () => {
    const parsed = parseDraftDate("2026-08-24");
    assert.equal(parsed.hasTime, false);
    assert.equal(parsed.at.getFullYear(), 2026);
    assert.equal(parsed.at.getMonth(), 7);
    assert.equal(parsed.at.getDate(), 24, "UTC parsing would slide this to the 23rd in US zones");
    assert.equal(parsed.at.getHours(), 0);
  });

  test("parses an ISO date with a time, with or without seconds", () => {
    for (const text of ["2026-08-24T19:30", "2026-08-24 19:30", "2026-08-24T19:30:45"]) {
      const parsed = parseDraftDate(text);
      assert.equal(parsed.hasTime, true, text);
      assert.equal(parsed.at.getHours(), 19, text);
      assert.equal(parsed.at.getMinutes(), 30, text);
    }
  });

  test("parses the human form, dropping the 'at'", () => {
    const parsed = parseDraftDate("August 24, 2026 at 7:00 PM");
    assert.equal(parsed.hasTime, true);
    assert.equal(parsed.at.getHours(), 19);
    assert.equal(parsed.at.getDate(), 24);
  });

  test("parses a date-only human form as time-less", () => {
    const parsed = parseDraftDate("August 24, 2026");
    assert.equal(parsed.hasTime, false);
  });

  test("survives the narrow no-break space Intl puts before AM/PM", () => {
    const parsed = parseDraftDate("August 24, 2026 at 7:00 PM");
    assert.equal(parsed.hasTime, true);
    assert.equal(parsed.at.getHours(), 19);
  });

  test("rejects a colon-less time, which JS's own Date parser won't take either", () => {
    assert.equal(parseDraftDate("August 24, 2026 7 PM"), null);
  });

  test("returns null when the text looks like a date but isn't one", () => {
    assert.equal(parseDraftDate("Augustus 44, 2026"), null);
  });
});

describe("js/countdown formatDraftDateForStorage", () => {
  test("writes back plain ASCII that parseDraftDate can read again", () => {
    const stored = formatDraftDateForStorage("2026-08-24", "19:00");
    assert.equal(stored, "August 24, 2026 at 7:00 PM");
    assert.equal(parseDraftDate(stored).at.getHours(), 19);
  });

  test("omits the time when the picker left it empty", () => {
    assert.equal(formatDraftDateForStorage("2026-08-24", ""), "August 24, 2026");
  });

  test("formats midnight and noon on the right side of 12", () => {
    assert.equal(formatDraftDateForStorage("2026-08-24", "00:05"), "August 24, 2026 at 12:05 AM");
    assert.equal(formatDraftDateForStorage("2026-08-24", "12:00"), "August 24, 2026 at 12:00 PM");
  });

  test("returns null when the date doesn't parse", () => {
    assert.equal(formatDraftDateForStorage("", ""), null);
    assert.equal(formatDraftDateForStorage("not-a-date", "19:00"), null);
  });
});

describe("js/countdown draftDateToPickerValues", () => {
  test("splits a stored date back into picker values", () => {
    assert.deepEqual(draftDateToPickerValues("August 24, 2026 at 7:05 PM"), {
      date: "2026-08-24",
      time: "19:05"
    });
  });

  test("leaves the time blank when the stored value has none", () => {
    assert.deepEqual(draftDateToPickerValues("August 4, 2026"), { date: "2026-08-04", time: "" });
  });

  test("returns empty values for anything unparseable", () => {
    assert.deepEqual(draftDateToPickerValues("TBD"), { date: "", time: "" });
  });
});

describe("js/countdown formatDraftDate", () => {
  test("includes the time and zone only when there is a time", () => {
    const withTime = formatDraftDate(parseDraftDate("August 24, 2026 at 7:00 PM"));
    const withoutTime = formatDraftDate(parseDraftDate("August 24, 2026"));

    assert.match(withTime, /Monday/);
    assert.match(withTime, /7:00/);
    assert.match(withoutTime, /Monday/);
    assert.doesNotMatch(withoutTime, /:\d\d/);
  });
});

describe("js/countdown startDraftCountdown", () => {
  test("hides the banner when the date isn't set", () => {
    const el = new FakeElement("countdown");
    const stop = startDraftCountdown(el, "TBD");

    assert.equal(el.hidden, true);
    assert.equal(el.innerHTML, "", "an unset date renders nothing at all");
    assert.equal(stop, undefined, "there is no timer to hand back");
  });

  test("renders days/hours/min/sec for a draft that is still far off", (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const el = new FakeElement("countdown");
    const stop = startDraftCountdown(el, inHours(24 * 5 + 3));

    assert.equal(el.hidden, false);
    assert.equal(el.classList.contains("is-imminent"), false);
    assert.match(el.innerHTML, /Draft Day Countdown/);
    assert.match(el.innerHTML, /countdown-num">0[45]<\/span><span class="countdown-unit-label">Days/);
    stop();
  });

  test("says 'Day' rather than 'Days' with one day left", (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const el = new FakeElement("countdown");
    const stop = startDraftCountdown(el, inHours(30));

    assert.match(el.innerHTML, /countdown-unit-label">Day</);
    assert.doesNotMatch(el.innerHTML, /countdown-unit-label">Days</);
    stop();
  });

  test("marks the last day as imminent and keeps ticking", (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const el = new FakeElement("countdown");
    const stop = startDraftCountdown(el, inHours(2));

    assert.equal(el.classList.contains("is-imminent"), true);
    const first = el.innerHTML;
    el.innerHTML = "";
    t.mock.timers.tick(1000);
    assert.notEqual(el.innerHTML, "", "the interval must re-render every second");
    assert.match(el.innerHTML, /Draft Day Countdown/);
    assert.match(first, /countdown-num/);
    stop();
  });

  test("switches to the DRAFT DAY banner once the clock runs out", (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const el = new FakeElement("countdown");
    el.classList.add("is-imminent");
    const stop = startDraftCountdown(el, inHours(-1));

    assert.equal(el.hidden, false);
    assert.equal(el.classList.contains("is-live"), true);
    assert.equal(el.classList.contains("is-imminent"), false);
    assert.match(el.innerHTML, /DRAFT DAY/);
    assert.match(el.innerHTML, /href="draft\.html"/);
    stop();
  });

  test("hides itself — and stops ticking — once the draft is more than a day past", () => {
    const el = new FakeElement("countdown");
    const stop = startDraftCountdown(el, inHours(-48));

    assert.equal(el.hidden, true);
    assert.equal(el.innerHTML, "", "it never renders, so there is nothing left on the page");
    stop();
  });
});
