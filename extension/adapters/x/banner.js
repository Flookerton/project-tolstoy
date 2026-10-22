// Tolstoy banner on x.com, ISOLATED world, document_idle.
//
// A glass strip near the bottom left that says what happened, and a paper panel
// that lists every post that was moved down and why. Everything lives inside a
// Shadow DOM, so X's styles and Tolstoy's cannot clash.
//
// Message contract, from adapters/x/intercept.js:
//   { source: "tolstoy", type: "counts", checked: n, moved: [{ id, handle, text, reasons }] }
// Messages without that tag, or from another origin, are ignored.
//
// This file makes no network call. The only link it builds is
// https://x.com/<handle>/status/<id>, back to the post itself.

(function () {
  "use strict";

  var SOURCE = "tolstoy";
  var PANEL_TITLE = "Moved down for tone.";
  var FLAG_LINE = "Flagged for hostile tone, not for its opinion.";

  // The design system's palette, written out because a stylesheet link would
  // expose the extension's id to the page. Glass alpha is 0.6: at 0.55 the text
  // in the strip drops to 4.57:1 over X's dark theme, at 0.6 it is 5.34:1.
  var DAY = {
    glass: "rgba(255, 250, 240, 0.6)",
    glassBorder: "rgba(255, 255, 255, 0.7)",
    glassShadow: "0 8px 24px rgba(90, 60, 30, 0.12)",
    paper: "#FAF5EA",
    line: "#E3D6C0",
    ink: "#2B2117",
    ink2: "#5A4A38",
    ink3: "#6E5D49",
    accent: "#9C4F24",
    dim: "rgba(43, 33, 23, 0.32)",
    hatBody: "#2B2117",
    hatBand: "#9C4F24"
  };
  var NIGHT = {
    glass: "rgba(46, 36, 29, 0.6)",
    glassBorder: "rgba(243, 235, 221, 0.16)",
    glassShadow: "0 8px 24px rgba(24, 18, 14, 0.45)",
    paper: "#2E241D",
    line: "#43362B",
    ink: "#F3EBDD",
    ink2: "#D8C8B2",
    ink3: "#B9A68E",
    accent: "#D07A45",
    dim: "rgba(36, 28, 23, 0.55)",
    hatBody: "#F3EBDD",
    hatBand: "#D07A45"
  };

  var HAT =
    '<svg viewBox="14 20 92 72" aria-hidden="true" focusable="false">' +
    '<path class="hat-crown" d="M38 76 L40 34 C40 24 80 24 80 34 L82 76 Z"/>' +
    '<path class="hat-band" d="M38.6 64 L81.4 64 L82 76 L38 76 Z"/>' +
    '<path class="hat-brim" d="M18 78 C18 72 34 74 60 74 C86 74 102 72 102 78 C102 86 86 88 60 88 C34 88 18 86 18 78 Z"/>' +
    "</svg>";

  var checked = 0;
  var moved = [];
  var host = null;
  var shadow = null;
  var countEl = null;
  var showButton = null;
  var panelWrap = null;
  var panelRows = null;
  var closeButton = null;
  var panelTitle = null;
  var lastFocused = null;

  function styles(t) {
    return [
      ":host { all: initial; position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; }",
      "* { box-sizing: border-box; }",
      ".strip {",
      "  display: flex; flex-wrap: wrap; align-items: center; gap: 12px;",
      "  max-width: 560px; min-height: 60px; padding: 12px 16px;",
      "  border: 1px solid " + t.glassBorder + "; border-radius: 16px;",
      "  background: " + t.glass + ";",
      "  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);",
      "  box-shadow: " + t.glassShadow + ";",
      "  font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.5;",
      "  color: " + t.ink + ";",
      "  animation: tolstoy-fade 600ms ease-out;",
      "}",
      ".tile { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex: 0 0 auto; border-radius: 8px; background: linear-gradient(160deg, #F8EBD8, #E9CFCB); }",
      ".tile svg { width: 24px; height: 24px; }",
      ".hat-crown, .hat-brim { fill: " + t.hatBody + "; }",
      ".hat-band { fill: " + t.hatBand + "; }",
      ".on { font-weight: 700; }",
      ".temp { padding: 4px 12px; border: 1px solid " + t.line + "; border-radius: 999px; background: " + t.paper + "; color: " + t.ink2 + "; font-size: 13px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }",
      ".count { color: " + t.ink + "; }",
      ".show, .close {",
      "  min-height: 44px; margin-left: auto; padding: 0 20px;",
      "  border: 1px solid " + t.line + "; border-radius: 999px;",
      "  background: " + t.paper + "; color: " + t.ink + ";",
      "  font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer;",
      "}",
      ".show:hover, .close:hover { border-color: " + t.accent + "; }",
      ".strip button:focus-visible, .panel button:focus-visible, .panel a:focus-visible {",
      "  outline: 2px solid " + t.accent + "; outline-offset: 3px;",
      "}",
      ".panel-wrap { position: fixed; inset: 0; z-index: 2147483000; }",
      ".backdrop { position: absolute; inset: 0; background: " + t.dim + "; }",
      ".panel {",
      "  display: flex; flex-direction: column;",
      "  position: absolute; left: 16px; bottom: 92px; width: min(640px, calc(100vw - 32px));",
      "  max-height: calc(100vh - 108px); overflow: hidden; padding: 24px;",
      "  border: 1px solid " + t.line + "; border-radius: 24px;",
      "  background: " + t.paper + "; color: " + t.ink + ";",
      "  font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.5;",
      "  animation: tolstoy-fade 600ms ease-out;",
      "}",
      ".panel h2 { margin: 0 0 12px; font-family: Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 600; letter-spacing: -0.008em; }",
      ".rows { flex: 1 1 auto; min-height: 0; overflow-y: auto; }",
      ".row { display: flex; gap: 12px; padding: 14px 0; border-top: 1px solid " + t.line + "; }",
      ".dot { flex: 0 0 auto; width: 8px; height: 8px; margin-top: 8px; border-radius: 999px; background: " + t.accent + "; }",
      ".row-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }",
      ".handle { margin: 0; color: " + t.ink2 + "; font-weight: 600; }",
      ".text { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 19px; line-height: 1.45; }",
      ".flag, .reasons, .empty { margin: 0; color: " + t.ink3 + "; }",
      ".open { align-self: flex-start; min-height: 44px; display: inline-flex; align-items: center; color: " + t.accent + "; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }",
      ".open:hover { color: " + t.ink + "; }",
      ".panel .close { margin: 16px 0 0; display: block; }",
      "@keyframes tolstoy-fade { from { opacity: 0; } to { opacity: 1; } }",
      "@media (prefers-reduced-motion: reduce) { .strip, .panel { animation: none; } }",
      "@media (prefers-color-scheme: light) { :root { color-scheme: light; } }",
      "@media (prefers-color-scheme: dark) { :root { color-scheme: dark; } }"
    ].join("\n");
  }

  function currentTheme() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? NIGHT : DAY;
    } catch (error) {
      return DAY;
    }
  }

  function build() {
    if (host) {
      return;
    }
    host = document.createElement("div");
    host.setAttribute("data-tolstoy", "banner");
    shadow = host.attachShadow({ mode: "open" });

    var theme = currentTheme();
    var style = document.createElement("style");
    style.textContent = styles(theme);
    shadow.appendChild(style);

    var strip = document.createElement("div");
    strip.className = "strip";
    strip.setAttribute("role", "status");
    strip.innerHTML =
      '<span class="tile" aria-hidden="true">' + HAT + "</span>" +
      '<span class="on">Tolstoy is on</span>' +
      '<span class="temp">Balanced</span>' +
      '<span class="count"></span>';

    countEl = strip.querySelector(".count");

    showButton = document.createElement("button");
    showButton.type = "button";
    showButton.className = "show";
    showButton.textContent = "Show them";
    showButton.hidden = true;
    showButton.addEventListener("click", openPanel);
    strip.appendChild(showButton);

    shadow.appendChild(strip);

    panelWrap = document.createElement("div");
    panelWrap.className = "panel-wrap";
    panelWrap.hidden = true;

    var backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    backdrop.addEventListener("click", closePanel);

    var panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "tolstoy-panel-title");

    panelTitle = document.createElement("h2");
    panelTitle.id = "tolstoy-panel-title";
    panelTitle.tabIndex = -1;
    panelTitle.textContent = PANEL_TITLE;

    panelRows = document.createElement("div");
    panelRows.className = "rows";

    closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "close";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", closePanel);

    panel.appendChild(panelTitle);
    panel.appendChild(panelRows);
    panel.appendChild(closeButton);

    panelWrap.appendChild(backdrop);
    panelWrap.appendChild(panel);
    shadow.appendChild(panelWrap);

    (document.body || document.documentElement).appendChild(host);

    try {
      if (window.matchMedia) {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", restyle);
      }
    } catch (error) {
      // Older APIs simply keep the theme the banner was built with.
    }
  }

  function restyle() {
    if (!shadow) {
      return;
    }
    var style = shadow.querySelector("style");
    if (style) {
      style.textContent = styles(currentTheme());
    }
  }

  function handleText(handle) {
    if (!handle) {
      return "a post";
    }
    return handle.charAt(0) === "@" ? handle : "@" + handle;
  }

  function renderCount() {
    if (!countEl) {
      return;
    }
    if (moved.length) {
      countEl.textContent = moved.length === 1
        ? "1 heated post moved down."
        : moved.length + " heated posts moved down.";
      return;
    }
    countEl.textContent = "Checked " + checked + (checked === 1 ? " post. " : " posts. ") + "Nothing moved.";
  }

  function renderRows() {
    if (!panelRows) {
      return;
    }
    panelRows.textContent = "";
    if (!moved.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Nothing moved in this visit.";
      panelRows.appendChild(empty);
      return;
    }

    moved.forEach(function (post) {
      var row = document.createElement("div");
      row.className = "row";

      var dot = document.createElement("span");
      dot.className = "dot";
      dot.setAttribute("aria-hidden", "true");

      var body = document.createElement("div");
      body.className = "row-body";

      var handle = document.createElement("p");
      handle.className = "handle";
      handle.textContent = handleText(post.handle);

      var text = document.createElement("p");
      text.className = "text";
      text.textContent = post.text + (post.text.length >= 140 ? "…" : "");

      var flag = document.createElement("p");
      flag.className = "flag";
      flag.textContent = FLAG_LINE;

      body.appendChild(handle);
      body.appendChild(text);
      body.appendChild(flag);

      if (post.reasons && post.reasons.length) {
        var reasons = document.createElement("p");
        reasons.className = "reasons";
        reasons.textContent = post.reasons.join(" · ");
        body.appendChild(reasons);
      }

      if (post.handle && post.id) {
        var link = document.createElement("a");
        link.className = "open";
        link.href = "https://x.com/" + post.handle.replace(/^@/, "") + "/status/" + post.id;
        link.textContent = "Open post";
        body.appendChild(link);
      }

      row.appendChild(dot);
      row.appendChild(body);
      panelRows.appendChild(row);
    });
  }

  function focusable() {
    if (!panelWrap) {
      return [];
    }
    return Array.prototype.slice.call(
      panelWrap.querySelectorAll("button, a[href], [tabindex]:not([tabindex='-1'])")
    );
  }

  // Inside a shadow root, document.activeElement is the host, so ask the shadow
  // root first.
  function activeElement() {
    if (shadow && shadow.activeElement) {
      return shadow.activeElement;
    }
    return document.activeElement;
  }

  function onKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    var stops = focusable();
    if (!stops.length) {
      return;
    }
    var active = activeElement();
    var first = stops[0];
    var last = stops[stops.length - 1];
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (stops.indexOf(active) === -1) {
      event.preventDefault();
      first.focus();
    }
  }

  function openPanel() {
    build();
    renderRows();
    lastFocused = showButton;
    panelWrap.hidden = false;
    if (panelTitle) {
      panelTitle.focus();
    }
    document.addEventListener("keydown", onKeydown, true);
  }

  function closePanel() {
    if (!panelWrap || panelWrap.hidden) {
      return;
    }
    panelWrap.hidden = true;
    document.removeEventListener("keydown", onKeydown, true);
    var target = lastFocused || showButton;
    if (target && typeof target.focus === "function") {
      target.focus();
    }
  }

  function onMessage(event) {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }
    var data = event.data;
    if (!data || data.source !== SOURCE || data.type !== "counts") {
      return;
    }
    if (typeof data.checked === "number") {
      checked += data.checked;
    }
    if (Array.isArray(data.moved) && data.moved.length) {
      Array.prototype.push.apply(moved, data.moved);
    }

    build();
    renderCount();
    if (showButton) {
      showButton.hidden = !moved.length;
    }
    if (!panelWrap.hidden) {
      renderRows();
    }
  }

  window.addEventListener("message", onMessage);
})();
