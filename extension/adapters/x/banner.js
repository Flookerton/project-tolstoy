// Tolstoy banner on x.com, ISOLATED world, document_idle, matching
// docs/mockups/mockup-4-calm-feed.png.
//
// A single opaque strip in the small ombre tile colours, near the bottom left:
// the hat tile, "Tolstoy is on", the temperature name (which opens the settings
// page), the count, and a "Show them" pill. "Show them" opens a paper panel
// listing every post that was moved down or softened, with the reason and a link
// back to the post.
//
// Everything lives in a Shadow DOM so X's styles and Tolstoy's cannot clash, and
// the only motion is a gentle fade, which stops under reduced motion.
//
// Message contract, from adapters/x/intercept.js:
//   { source: "tolstoy", type: "counts", checked, moved, mode, temperature }

(function () {
  "use strict";

  var SOURCE = "tolstoy";
  var PANEL_TITLES = { move: "Moved down for tone.", blur: "Softened for tone." };
  var FLAG_LINE = "Flagged for hostile tone, not for its opinion.";

  var DAY = {
    tile: "linear-gradient(160deg, #F8EBD8, #E9CFCB)",
    ink: "#2B2117",
    ink2: "#5A4A38",
    ink3: "#6E5D49",
    paper: "#FAF5EA",
    line: "#E3D6C0",
    accent: "#9C4F24",
    dim: "rgba(43, 33, 23, 0.32)",
    hatBody: "#2B2117",
    hatBand: "#9C4F24"
  };
  var NIGHT = {
    tile: "linear-gradient(160deg, #2B1F21, #241C17)",
    ink: "#F3EBDD",
    ink2: "#D8C8B2",
    ink3: "#B9A68E",
    paper: "#2E241D",
    line: "#43362B",
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
  var mode = "move";
  var temperature = "balanced";
  var host = null;
  var shadow = null;
  var countEl = null;
  var tempButton = null;
  var showButton = null;
  var panelWrap = null;
  var panelRows = null;
  var panelTitle = null;
  var closeButton = null;
  var scoredBy = null;
  var lateEl = null;
  var lateCaught = 0;
  var by = "rules";

  function styles(t) {
    return [
      ":host { all: initial; position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; }",
      "* { box-sizing: border-box; }",
      ".strip {",
      "  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;",
      "  max-width: 560px; min-height: 60px; padding: 12px 16px;",
      "  border: 1px solid rgba(255, 255, 255, 0.35); border-radius: 24px;",
      "  background: " + t.tile + ";",
      "  font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.5;",
      "  color: " + t.ink + ";",
      "  animation: tolstoy-fade 600ms ease-out;",
      "}",
      ".tile { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex: 0 0 auto; }",
      ".tile svg { width: 26px; height: 26px; }",
      ".hat-crown, .hat-brim { fill: " + t.hatBody + "; }",
      ".hat-band { fill: " + t.hatBand + "; }",
      ".on { font-weight: 700; }",
      ".temp { padding: 0; border: 0; background: none; color: " + t.ink2 + "; font: inherit; font-weight: 600; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }",
      ".temp:hover { color: " + t.ink + "; }",
      ".count { color: " + t.ink + "; }",
      ".late { color: " + t.ink3 + "; font-size: 13px; }",
      ".show {",
      "  min-height: 44px; margin-left: auto; padding: 0 20px;",
      "  border: 1px solid " + t.line + "; border-radius: 999px;",
      "  background: " + t.paper + "; color: " + t.ink + ";",
      "  font: inherit; font-weight: 600; cursor: pointer;",
      "}",
      ".show:hover { border-color: " + t.accent + "; }",
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
      ".panel .close { display: block; margin: 16px 0 0; min-height: 44px; padding: 0 20px; border: 1px solid " + t.line + "; border-radius: 999px; background: " + t.paper + "; color: " + t.ink + "; font: inherit; font-weight: 600; cursor: pointer; }",
      ".scored-by { margin: 12px 0 0; color: " + t.ink3 + "; font-size: 14px; }",
      "@keyframes tolstoy-fade { from { opacity: 0; } to { opacity: 1; } }",
      "@media (prefers-reduced-motion: reduce) { .strip, .panel { animation: none; } }"
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

    var style = document.createElement("style");
    style.textContent = styles(currentTheme());
    shadow.appendChild(style);

    var strip = document.createElement("div");
    strip.className = "strip";
    strip.setAttribute("role", "status");
    strip.innerHTML = '<span class="tile" aria-hidden="true">' + HAT + '</span><span class="on">Tolstoy is on</span>';

    tempButton = document.createElement("button");
    tempButton.type = "button";
    tempButton.className = "temp";
    tempButton.title = "Open settings";
    tempButton.addEventListener("click", function () {
      try {
        chrome.runtime.openOptionsPage();
      } catch (error) {
        // Without the panel, the strip still tells the truth.
      }
    });
    strip.appendChild(tempButton);

    countEl = document.createElement("span");
    countEl.className = "count";
    strip.appendChild(countEl);

    // The line the model adds when it flags a post after its batch was shown.
    lateEl = document.createElement("span");
    lateEl.className = "late";
    lateEl.hidden = true;
    strip.appendChild(lateEl);

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
    panelTitle.textContent = PANEL_TITLES.move;

    panelRows = document.createElement("div");
    panelRows.className = "rows";

    closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "close";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", closePanel);

    scoredBy = document.createElement("p");
    scoredBy.className = "scored-by";

    panel.appendChild(panelTitle);
    panel.appendChild(panelRows);
    panel.appendChild(scoredBy);
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
      // Keep the theme the banner was built with.
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

  function temperatureName() {
    if (temperature === "calm") {
      return "Calm";
    }
    if (temperature === "unfiltered") {
      return "Unfiltered";
    }
    return "Balanced";
  }

  function handleText(handle) {
    if (!handle) {
      return "a post";
    }
    return handle.charAt(0) === "@" ? handle : "@" + handle;
  }

  function renderCount() {
    if (!countEl || !tempButton) {
      return;
    }
    tempButton.textContent = temperatureName();

    if (lateEl) {
      if (lateCaught > 0) {
        lateEl.hidden = false;
        lateEl.textContent = lateCaught + " softened after a closer look.";
      } else {
        lateEl.hidden = true;
        lateEl.textContent = "";
      }
    }

    if (mode === "off") {
      countEl.textContent = "Unfiltered. Checked " + checked + (checked === 1 ? " post." : " posts.");
      return;
    }
    if (moved.length) {
      var one = moved.length === 1;
      var what = mode === "blur" ? " softened." : " moved down.";
      countEl.textContent = moved.length + (one ? " heated post" : " heated posts") + what;
      return;
    }
    countEl.textContent = "Checked " + checked + (checked === 1 ? " post. " : " posts. ") + "Nothing moved.";
  }

  function renderRows() {
    if (!panelRows || !panelTitle) {
      return;
    }
    panelTitle.textContent = PANEL_TITLES[mode] || PANEL_TITLES.move;
    if (scoredBy) {
      scoredBy.textContent = by === "rules+model"
        ? "Scored by: rules and the on-device model"
        : "Scored by: rules";
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

      // Never the word "undefined": if a post arrives with no usable reason, it
      // still gets one.
      var reasonLines = (Array.isArray(post.reasons) ? post.reasons : []).filter(function (line) {
        return typeof line === "string" && line;
      });
      if (!reasonLines.length) {
        reasonLines = ["Hostile tone."];
      }
      var reasons = document.createElement("p");
      reasons.className = "reasons";
      reasons.textContent = reasonLines.join(" · ");
      body.appendChild(reasons);

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
    panelWrap.hidden = false;
    panelTitle.focus();
    document.addEventListener("keydown", onKeydown, true);
  }

  function closePanel() {
    if (!panelWrap || panelWrap.hidden) {
      return;
    }
    panelWrap.hidden = true;
    document.removeEventListener("keydown", onKeydown, true);
    if (showButton) {
      showButton.focus();
    }
  }

  function onMessage(event) {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }
    var data = event.data;
    if (!data || data.source !== SOURCE) {
      return;
    }

    // A settings change changes the wording straight away, so the strip never
    // describes a mode Tolstoy is no longer in.
    if (data.type === "settings" && data.settings) {
      temperature = typeof data.settings.temperature === "string" ? data.settings.temperature : temperature;
      mode = temperature === "unfiltered" ? "off" : (data.settings.blur ? "blur" : "move");
      build();
      renderCount();
      if (showButton) {
        showButton.hidden = mode === "off" || !moved.length;
      }
      if (panelWrap && !panelWrap.hidden) {
        renderRows();
      }
      return;
    }

    // The model flagged a post after its batch had already been shown. It was
    // softened where it stood, never moved, so this only adds a line.
    if (data.type === "lateCaught") {
      if (Array.isArray(data.caught) && data.caught.length) {
        lateCaught += data.caught.length;
        renderCount();
      }
      return;
    }

    if (data.type !== "counts") {
      return;
    }

    // A totals answer replaces the counters rather than adding to them, so a
    // banner that loaded after the first batch shows the whole visit exactly once.
    if (data.totals) {
      checked = typeof data.checked === "number" ? data.checked : checked;
      moved = Array.isArray(data.moved) ? data.moved.slice() : moved;
    } else {
      if (typeof data.checked === "number") {
        checked += data.checked;
      }
      if (Array.isArray(data.moved) && data.moved.length) {
        Array.prototype.push.apply(moved, data.moved);
      }
    }
    if (typeof data.mode === "string") {
      mode = data.mode;
    }
    if (typeof data.temperature === "string") {
      temperature = data.temperature;
    }
    if (typeof data.by === "string") {
      by = data.by;
    }

    build();
    renderCount();
    if (showButton) {
      showButton.hidden = mode === "off" || !moved.length;
    }
    if (panelWrap && !panelWrap.hidden) {
      renderRows();
    }
  }

  window.addEventListener("message", onMessage);

  // Built at once, so the strip is there even if the first timeline batch beat
  // this script, and then caught up with the totals Tolstoy has already counted.
  build();
  renderCount();
  try {
    window.postMessage({ source: SOURCE, type: "requestCounts" }, window.location.origin);
  } catch (error) {
    // The next batch will bring the numbers anyway.
  }
})();
