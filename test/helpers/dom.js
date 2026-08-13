// The smallest DOM the browser-side modules under test actually touch.
//
// js/countdown.js and js/draftboard.js are the two front-end files with real
// logic in them (snake-draft math, clock resolution, HTML assembly), and all
// of it is reachable through a handful of DOM calls: getElementById,
// querySelectorAll, getComputedStyle, style.setProperty, innerHTML/hidden/
// textContent/dataset/classList, and addEventListener. Faking those keeps the
// project's zero-dependency rule (no jsdom) while still covering the render
// paths rather than only the pure functions.

class FakeClassList {
  constructor() {
    this.tokens = new Set();
  }
  add(...names) {
    names.forEach((n) => this.tokens.add(n));
  }
  remove(...names) {
    names.forEach((n) => this.tokens.delete(n));
  }
  contains(name) {
    return this.tokens.has(name);
  }
  toggle(name, force) {
    const on = force === undefined ? !this.tokens.has(name) : Boolean(force);
    if (on) this.tokens.add(name);
    else this.tokens.delete(name);
    return on;
  }
  get value() {
    return [...this.tokens].join(" ");
  }
}

class FakeStyle {
  constructor() {
    this.properties = {};
  }
  setProperty(name, value) {
    this.properties[name] = value;
  }
  getPropertyValue(name) {
    return this.properties[name] ?? "";
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.innerHTML = "";
    this.textContent = "";
    this.hidden = false;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.style = new FakeStyle();
    this.listeners = {};
    // What closest() should return, keyed by selector. Set by tests that
    // simulate a click on a board cell.
    this.closestMatches = {};
  }
  addEventListener(type, fn) {
    (this.listeners[type] || (this.listeners[type] = [])).push(fn);
  }
  // Fires every listener registered for `type`, the way a real dispatch would.
  dispatch(type, event = {}) {
    const ev = { preventDefault() {}, target: this, ...event };
    (this.listeners[type] || []).forEach((fn) => fn(ev));
    return ev;
  }
  closest(selector) {
    return this.closestMatches[selector] || null;
  }
}

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement("html");
    this.elements = new Map();
    this.queries = new Map();
  }
  getElementById(id) {
    return this.elements.get(id) || null;
  }
  querySelectorAll(selector) {
    return this.queries.get(selector) || [];
  }
  // Registers an element under an id, creating it if needed.
  addElement(id) {
    const el = new FakeElement(id);
    this.elements.set(id, el);
    return el;
  }
  setQuery(selector, elements) {
    this.queries.set(selector, elements);
  }
}

// Installs the fakes as globals and hands back the document plus a restore().
// `computedProperties` seeds what getComputedStyle(<html>) reports, which is
// how js/draftboard.js reads the stylesheet's default position palette.
function installDom({ computedProperties = {} } = {}) {
  const previous = {
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
    window: globalThis.window
  };
  const doc = new FakeDocument();
  const computedStyles = new WeakMap();
  computedStyles.set(doc.documentElement, {
    getPropertyValue: (name) => computedProperties[name] ?? ""
  });

  globalThis.document = doc;
  globalThis.getComputedStyle = (el) =>
    computedStyles.get(el) || { getPropertyValue: () => "" };
  globalThis.window = globalThis.window || {};

  return {
    document: doc,
    restore() {
      globalThis.document = previous.document;
      globalThis.getComputedStyle = previous.getComputedStyle;
      globalThis.window = previous.window;
    }
  };
}

// js/draftboard.js calls escapeHtml(), which the browser gets as a global from
// js/history.js. That one builds a detached <div>; this is the same contract
// without a DOM behind it.
function installEscapeHtml() {
  const previous = globalThis.escapeHtml;
  globalThis.escapeHtml = (str) =>
    String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return {
    restore() {
      globalThis.escapeHtml = previous;
    }
  };
}

module.exports = { FakeElement, FakeClassList, FakeStyle, FakeDocument, installDom, installEscapeHtml };
