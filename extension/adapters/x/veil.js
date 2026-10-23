// Tolstoy blur mode on x.com, ISOLATED world, document_idle.
//
// When the blur setting is on, the adapter does not move anything: each heated
// post is softened in place instead, exactly as in docs/mockups/mockup-4:
// the post sits behind a soft parchment veil with the line
// "Heated post, softened by Tolstoy", the reason, and a "Show anyway" pill.
//
// Posts are found by the status link inside each rendered post, because X
// recycles DOM nodes as you scroll and element ids are not stable. Every pass
// checks that a veil is still on the post it belongs to, and removes it if the
// node has been reused for a different post.
//
// Nothing here reads or sends anything: it uses the list of heated post ids that
// intercept.js already reported, which lives in page memory only.

(function () {
  "use strict";

  var SOURCE = "tolstoy";
  var FLAG_LINE = "Flagged for hostile tone, not for its opinion.";
  var LABEL = "Heated post, softened by Tolstoy";

  var DAY = {
    veil: "rgba(247, 236, 222, 0.55)",
    ink: "#2B2117",
    ink3: "#6E5D49",
    paper: "#FAF5EA",
    line: "#E3D6C0",
    accent: "#9C4F24"
  };
  var NIGHT = {
    veil: "rgba(43, 31, 33, 0.6)",
    ink: "#F3EBDD",
    ink3: "#B9A68E",
    paper: "#2E241D",
    line: "#43362B",
    accent: "#D07A45"
  };

  var mode = "move";
  var reasonsById = {};
  var lateIds = {};
  var revealed = {};
  var observer = null;
  var pending = false;

  function theme() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? NIGHT : DAY;
    } catch (error) {
      return DAY;
    }
  }

  // The posts X renders. Our test page uses the same shape.
  function postElements() {
    return document.querySelectorAll('article[data-testid="tweet"], [data-tolstoy-post]');
  }

  function statusIdOf(element) {
    var link = element.querySelector('a[href*="/status/"]');
    if (!link) {
      return null;
    }
    var match = /\/status\/(\d+)/.exec(link.getAttribute("href") || "");
    return match ? match[1] : null;
  }

  function veilStyles(t) {
    return [
      ":host { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 5;",
      "  background: " + t.veil + "; -webkit-backdrop-filter: blur(7px); backdrop-filter: blur(7px);",
      "  border-radius: 12px; font-family: system-ui, sans-serif; text-align: center; padding: 16px;",
      "  animation: tolstoy-fade 600ms ease-out; }",
      "* { box-sizing: border-box; }",
      ".label { margin: 0; color: " + t.ink + "; font-size: 15px; font-weight: 700; }",
      ".reason { margin: 6px 0 0; color: " + t.ink3 + "; font-size: 14px; }",
      ".show { margin-top: 12px; min-height: 44px; padding: 0 20px; border: 1px solid " + t.line + "; border-radius: 999px;",
      "  background: " + t.paper + "; color: " + t.ink + "; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }",
      ".show:hover { border-color: " + t.accent + "; }",
      ".show:focus-visible { outline: 2px solid " + t.accent + "; outline-offset: 3px; }",
      "@keyframes tolstoy-fade { from { opacity: 0; } to { opacity: 1; } }",
      "@media (prefers-reduced-motion: reduce) { :host { animation: none; } }"
    ].join("\n");
  }

  function makeVeil(id, reasons) {
    var host = document.createElement("div");
    host.setAttribute("data-tolstoy-veil", id);
    var shadow = host.attachShadow({ mode: "open" });

    var style = document.createElement("style");
    style.textContent = veilStyles(theme());
    shadow.appendChild(style);

    var label = document.createElement("p");
    label.className = "label";
    label.textContent = LABEL;

    var reason = document.createElement("p");
    reason.className = "reason";
    reason.textContent = (reasons && reasons.length ? reasons.join(" · ") + ". " : "") + FLAG_LINE;

    var show = document.createElement("button");
    show.type = "button";
    show.className = "show";
    show.textContent = "Show anyway";
    show.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      revealed[id] = true;
      host.remove();
    });

    shadow.appendChild(label);
    shadow.appendChild(reason);
    shadow.appendChild(show);
    return host;
  }

  function ensurePositioned(element) {
    var position = window.getComputedStyle(element).position;
    if (position === "static") {
      element.style.position = "relative";
    }
  }

  function clearAll() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-tolstoy-veil]"), function (veil) {
      veil.remove();
    });
  }

  function pass() {
    pending = false;
    try {
      // In blur mode every flagged post is softened. In move mode the veils are
      // only for posts the model flagged late: those were already on screen, so
      // they are softened where they stand rather than moved.
      var lateCount = Object.keys(lateIds).length;
      if (mode !== "blur" && !lateCount) {
        clearAll();
        return;
      }

      var posts = postElements();
      if (!posts.length) {
        return;
      }

      // A veil belongs to the post that holds its status link. If the node was
      // recycled for another post, the veil comes off.
      Array.prototype.forEach.call(document.querySelectorAll("[data-tolstoy-veil]"), function (veil) {
        var id = veil.getAttribute("data-tolstoy-veil");
        var parent = veil.parentElement;
        if (!parent) {
          veil.remove();
          return;
        }
        if (statusIdOf(parent) !== id) {
          veil.remove();
        }
      });

      Array.prototype.forEach.call(posts, function (element) {
        var id = statusIdOf(element);
        if (!id || !reasonsById[id] || revealed[id]) {
          return;
        }
        if (mode !== "blur" && !lateIds[id]) {
          return;
        }
        if (element.querySelector('[data-tolstoy-veil="' + id + '"]')) {
          return;
        }
        ensurePositioned(element);
        element.appendChild(makeVeil(id, reasonsById[id]));
      });
    } catch (error) {
      // Never break the page: if anything is unfamiliar, soften nothing.
    }
  }

  function schedulePass() {
    if (pending) {
      return;
    }
    pending = true;
    window.setTimeout(pass, 150);
  }

  function startWatching() {
    if (observer) {
      return;
    }
    try {
      observer = new MutationObserver(schedulePass);
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (error) {
      observer = null;
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

    // A settings change reaches the veil directly, so turning blur on softens the
    // posts that are already on screen instead of waiting for the next batch.
    if (data.type === "settings" && data.settings) {
      mode = data.settings.temperature === "unfiltered" ? "off" : (data.settings.blur ? "blur" : "move");
      if (mode === "blur") {
        startWatching();
      }
      schedulePass();
      return;
    }

    // A post the model flagged after its batch was already shown. It is softened
    // where it stands, in move mode as well as blur mode, and never moved.
    if (data.type === "lateCaught") {
      if (data.mode === "off") {
        return;
      }
      if (Array.isArray(data.caught)) {
        data.caught.forEach(function (post) {
          if (post && post.id) {
            reasonsById[post.id] = post.reasons || [];
            lateIds[post.id] = true;
          }
        });
      }
      startWatching();
      schedulePass();
      return;
    }

    if (data.type !== "counts") {
      return;
    }
    if (typeof data.mode === "string") {
      mode = data.mode;
    }
    if (Array.isArray(data.moved)) {
      data.moved.forEach(function (post) {
        if (post && post.id) {
          reasonsById[post.id] = post.reasons || [];
        }
      });
    }
    if (mode === "blur") {
      startWatching();
    }
    schedulePass();
  }

  window.addEventListener("message", onMessage);

  // Ask for what has already been counted, in case the first batch beat this
  // script to the page.
  try {
    window.postMessage({ source: SOURCE, type: "requestCounts" }, window.location.origin);
  } catch (error) {
    // The next batch will bring the list anyway.
  }

  // The setting can also arrive before any batch: watch from the start so a
  // change to blur reaches posts that are already on screen.
  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").addEventListener) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", schedulePass);
    }
  } catch (error) {
    // Theme changes simply keep the veil they were drawn with.
  }

  // Exposed for the browser check only.
  window.__tolstoyVeil = { pass: pass, revealed: revealed, reasonsById: reasonsById, lateIds: lateIds };
})();
