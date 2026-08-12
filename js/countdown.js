// Draft-day countdown. `draft_config.draft_date` is a free-text column (it
// starts life as "TBD – fourth weekend of August") and the draft board renders
// it verbatim, so admin.html's date/time pickers write a human-readable string
// back into it via formatDraftDateForStorage(). The countdown only appears once
// that text parses as a real date — "TBD" or prose leaves the banner hidden.

// Returns { at: Date, hasTime: boolean } or null if the text isn't a date.
function parseDraftDate(text) {
  if (!text) return null;
  // "August 24, 2026 at 7:00 PM" is the natural way to write this, but Date()
  // chokes on the "at" — drop it before parsing. Intl-formatted times can also
  // carry a narrow no-break space before AM/PM, which Date() won't take.
  const s = String(text).replace(/[  ]/g, " ").trim().replace(/\s+at\s+/i, " ");
  if (!s || /^tbd\b/i.test(s)) return null;

  // A bare ISO date ("2026-08-24") is parsed as UTC midnight by JS, which
  // shows up as the previous evening in US time zones — rebuild it as local.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2})?)?$/);
  if (iso) {
    const [, y, mo, d, h, mi] = iso;
    return { at: new Date(+y, +mo - 1, +d, +(h || 0), +(mi || 0)), hasTime: h !== undefined };
  }

  const at = new Date(s);
  if (isNaN(at.getTime())) return null;
  return { at, hasTime: /\d\s*:\s*\d|\d\s*(am|pm)\b/i.test(s) };
}

// The inverse of parseDraftDate, for admin.html's pickers: a "YYYY-MM-DD" date
// plus an optional "HH:MM" time become the string stored in draft_date. Times
// are assembled by hand rather than via Intl so the result is plain ASCII that
// parseDraftDate() can read straight back.
function formatDraftDateForStorage(dateValue, timeValue) {
  const parsed = parseDraftDate(timeValue ? `${dateValue} ${timeValue}` : dateValue);
  if (!parsed) return null;
  const { at } = parsed;
  const day = at.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  if (!timeValue) return day;
  const hours = at.getHours();
  const clock = `${hours % 12 || 12}:${String(at.getMinutes()).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  return `${day} at ${clock}`;
}

// Splits a stored draft_date back into { date: "YYYY-MM-DD", time: "HH:MM" }
// values the pickers accept ({ date: "", time: "" } when it isn't a real date).
function draftDateToPickerValues(text) {
  const parsed = parseDraftDate(text);
  if (!parsed) return { date: "", time: "" };
  const { at, hasTime } = parsed;
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: hasTime ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : ""
  };
}

function formatDraftDate({ at, hasTime }) {
  const opts = { weekday: "long", month: "long", day: "numeric", year: "numeric" };
  if (hasTime) {
    opts.hour = "numeric";
    opts.minute = "2-digit";
    opts.timeZoneName = "short";
  }
  return at.toLocaleString(undefined, opts);
}

// Renders (and keeps ticking) the countdown into `el`. Hides `el` entirely when
// the date isn't set, isn't parseable, or is more than a day in the past.
function startDraftCountdown(el, draftDateText) {
  const parsed = parseDraftDate(draftDateText);
  if (!parsed) {
    el.hidden = true;
    return;
  }

  const target = parsed.at.getTime();
  let timer = null;
  const unit = (value, label) =>
    `<div class="countdown-unit"><span class="countdown-num">${String(value).padStart(2, "0")}</span><span class="countdown-unit-label">${label}</span></div>`;

  function tick() {
    const remaining = target - Date.now();

    // Keep the "it's happening" banner up through draft day itself, then let it
    // disappear on its own rather than counting up forever.
    if (remaining <= 0) {
      if (remaining < -24 * 3600 * 1000) {
        el.hidden = true;
        clearInterval(timer);
        return;
      }
      el.hidden = false;
      el.classList.remove("is-imminent");
      el.classList.add("is-live");
      el.innerHTML = `
        <p class="countdown-label">It's here</p>
        <p class="countdown-live">DRAFT DAY</p>
        <p class="countdown-date">${formatDraftDate(parsed)}</p>
        <a class="btn countdown-cta" href="draft.html">Watch the Live Board</a>
      `;
      return;
    }

    const totalSeconds = Math.floor(remaining / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    el.hidden = false;
    el.classList.toggle("is-imminent", remaining < 24 * 3600 * 1000);
    el.innerHTML = `
      <p class="countdown-label">Draft Day Countdown</p>
      <div class="countdown-units">
        ${unit(days, days === 1 ? "Day" : "Days")}
        ${unit(hours, "Hours")}
        ${unit(minutes, "Min")}
        ${unit(seconds, "Sec")}
      </div>
      <p class="countdown-date">${formatDraftDate(parsed)}</p>
    `;
  }

  tick();
  if (!el.hidden) timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}

// Browser pages load this with a <script> tag and use the globals above. The
// serverless side needs parseDraftDate() too — the "has the draft already
// started?" guard on resetting the board has to hold on the server, not just in
// the admin UI — so export it when there's a module system to export into.
// `module` is undefined in the browser, which skips this entirely.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseDraftDate, formatDraftDateForStorage, draftDateToPickerValues };
}
