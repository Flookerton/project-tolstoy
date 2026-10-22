// Tolstoy Home: new tab page logic, matching docs/mockups/mockup-1.
// All content comes from sample-content.js. No network requests are made here.
// The two outward actions are the search bar, which hands the words to the
// browser's own search engine, and the settings buttons, which open the panel.

(function () {
  "use strict";

  var WORDS_PER_MINUTE = 230;

  function text(id, value) {
    var el = document.getElementById(id);
    if (el) {
      el.textContent = value;
    }
  }

  // The date as an eyebrow, without the year: "Thursday, October 22".
  function showDate() {
    text(
      "today-date",
      new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    );
  }

  function readingMinutes(body) {
    var words = body.split(/\s+/).filter(Boolean).length;
    var minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
    return "About " + minutes + (minutes === 1 ? " minute" : " minutes");
  }

  // Today's story: one a day, rotating by day of year.
  function showStory() {
    if (typeof SAMPLE_CONTENT === "undefined" || !SAMPLE_CONTENT.stories.length) {
      return;
    }
    var index = SAMPLE_CONTENT.todaysStoryIndex();
    var story = SAMPLE_CONTENT.stories[index];
    text("story-headline", story.headline);
    text("story-dek", story.dek);
    text("read-time", readingMinutes(story.body));

    var link = document.getElementById("read-slowly");
    if (link) {
      link.setAttribute("href", "../story/story.html?id=" + index);
    }
  }

  function showDelights() {
    var list = document.getElementById("delights-list");
    if (!list || typeof SAMPLE_CONTENT === "undefined") {
      return;
    }
    SAMPLE_CONTENT.delights.forEach(function (line) {
      var item = document.createElement("li");
      item.textContent = line;
      list.appendChild(item);
    });
  }

  function savedCard(item) {
    var card = document.createElement("article");
    card.className = "card";

    var source = document.createElement("p");
    source.className = "card-source";
    source.textContent = "Saved from " + item.site;

    var words = document.createElement("p");
    words.className = "card-text";
    words.textContent = item.text;

    var author = document.createElement("p");
    author.className = "card-author";
    var avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    var who = document.createElement("span");
    who.textContent = item.author;
    author.appendChild(avatar);
    author.appendChild(who);

    card.appendChild(source);
    card.appendChild(words);
    card.appendChild(author);
    return card;
  }

  function showSaved() {
    var grid = document.getElementById("saved-grid");
    if (!grid || typeof SAMPLE_CONTENT === "undefined") {
      return;
    }
    SAMPLE_CONTENT.saved.forEach(function (item) {
      grid.appendChild(savedCard(item));
    });
  }

  // The status pill and the sliders button both open the settings panel.
  function openSettings() {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  }

  function setupSettings() {
    ["weather-pill", "settings-button"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener("click", openSettings);
      }
    });
  }

  // The search bar hands the words to the browser's own search engine, exactly
  // like the address bar. Tolstoy sends nothing anywhere.
  function setupSearch() {
    var form = document.getElementById("search-form");
    var input = document.getElementById("search-input");
    if (!form || !input) {
      return;
    }
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var words = input.value.trim();
      if (!words) {
        return;
      }
      if (typeof chrome !== "undefined" && chrome.search && chrome.search.query) {
        chrome.search.query({ text: words, disposition: "CURRENT_TAB" });
      }
    });
  }

  function init() {
    showDate();
    showStory();
    showDelights();
    showSaved();
    setupSettings();
    setupSearch();
    if (window.TolstoyIcons) {
      window.TolstoyIcons.mount();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
