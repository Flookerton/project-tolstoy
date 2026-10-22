// Tolstoy Home: new tab page logic.
// All content comes from sample-content.js. No network requests are made here.
// The one outward action on this page is the search bar, which hands the words
// to the browser's own search engine, the same way the address bar does.

(function () {
  "use strict";

  // Today's date as an eyebrow, reads "Thursday, October 22, 2026".
  function showDate() {
    var dateEl = document.getElementById("today-date");
    if (!dateEl) {
      return;
    }
    dateEl.textContent = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  // One story a day, chosen by the day of the year so it is steady all day.
  function dailyStory(stories) {
    var now = new Date();
    var startOfYear = Date.UTC(now.getFullYear(), 0, 1);
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var dayOfYear = Math.floor((today - startOfYear) / 86400000);
    return stories[dayOfYear % stories.length];
  }

  // Build one card: the source, the words, then the author.
  function buildCard(item) {
    var card = document.createElement("article");
    card.className = "card";

    var source = document.createElement("p");
    source.className = "card-source";
    source.textContent = item.source;
    card.appendChild(source);

    var words = document.createElement("div");
    words.className = "card-text";
    item.text.split("\n\n").forEach(function (paragraph) {
      var line = document.createElement("p");
      line.textContent = paragraph;
      words.appendChild(line);
    });
    card.appendChild(words);

    var author = document.createElement("p");
    author.className = "card-author";

    var avatar = document.createElement("span");
    avatar.className = "card-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = item.author.charAt(0);

    var name = document.createElement("span");
    name.className = "card-author-name";
    name.textContent = item.author;

    var handle = document.createElement("span");
    handle.className = "card-handle";
    handle.textContent = item.handle;

    author.appendChild(avatar);
    author.appendChild(name);
    author.appendChild(handle);
    card.appendChild(author);

    return card;
  }

  function fill(containerId, items) {
    var container = document.getElementById(containerId);
    if (!container) {
      return;
    }
    items.forEach(function (item) {
      container.appendChild(buildCard(item));
    });
  }

  function showContent() {
    if (typeof SAMPLE_CONTENT === "undefined") {
      return;
    }
    var storySlot = document.getElementById("story-slot");
    if (storySlot && SAMPLE_CONTENT.stories.length) {
      storySlot.appendChild(buildCard(dailyStory(SAMPLE_CONTENT.stories)));
    }
    fill("delights-grid", SAMPLE_CONTENT.delights);
    fill("saved-grid", SAMPLE_CONTENT.saved);
  }

  // The search bar hands the words to the browser's own search engine.
  // Tolstoy sends nothing anywhere: this is the same call the address bar uses.
  function setupSearch() {
    var form = document.getElementById("search-form");
    var input = document.getElementById("search-input");
    if (!form || !input) {
      return;
    }
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (!text) {
        return;
      }
      if (typeof chrome !== "undefined" && chrome.search && chrome.search.query) {
        chrome.search.query({ text: text, disposition: "CURRENT_TAB" });
      }
    });
  }

  // The promises panel, keyboard first: focus moves in, stays in, and returns.
  function setupPromises() {
    var link = document.getElementById("promises-link");
    var overlay = document.getElementById("promises-overlay");
    var panel = overlay ? overlay.querySelector(".promises-panel") : null;
    var closeButton = document.getElementById("close-promises");
    var backdrop = document.getElementById("promises-backdrop");
    var title = document.getElementById("promises-title");
    var lastFocused = null;

    function focusable() {
      if (!panel) {
        return [];
      }
      return Array.prototype.slice.call(
        panel.querySelectorAll("button, [href], [tabindex]:not([tabindex='-1'])")
      );
    }

    function onKeydown(event) {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      var stops = focusable();
      if (!stops.length) {
        return;
      }
      var first = stops[0];
      var last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (stops.indexOf(document.activeElement) === -1) {
        event.preventDefault();
        first.focus();
      }
    }

    function open() {
      lastFocused = document.activeElement;
      overlay.hidden = false;
      if (title) {
        title.focus();
      } else if (closeButton) {
        closeButton.focus();
      }
      document.addEventListener("keydown", onKeydown);
    }

    function close() {
      overlay.hidden = true;
      document.removeEventListener("keydown", onKeydown);
      if (lastFocused) {
        lastFocused.focus();
      }
    }

    if (link) {
      link.addEventListener("click", open);
    }
    if (closeButton) {
      closeButton.addEventListener("click", close);
    }
    if (backdrop) {
      backdrop.addEventListener("click", close);
    }
  }

  function init() {
    showDate();
    showContent();
    setupSearch();
    setupPromises();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
