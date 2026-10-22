// The story reading page: shows the story named in ?id=, or today's story.
// One a day, so there is nothing to navigate to and nothing to recommend.

(function () {
  "use strict";

  function text(id, value) {
    var el = document.getElementById(id);
    if (el) {
      el.textContent = value;
    }
  }

  function requestedIndex(total) {
    var match = /[?&]id=(\d+)/.exec(window.location.search);
    if (!match) {
      return typeof SAMPLE_CONTENT.todaysStoryIndex === "function" ? SAMPLE_CONTENT.todaysStoryIndex() : 0;
    }
    var index = parseInt(match[1], 10);
    if (isNaN(index) || index < 0 || index >= total) {
      return 0;
    }
    return index;
  }

  function init() {
    if (typeof SAMPLE_CONTENT === "undefined" || !SAMPLE_CONTENT.stories.length) {
      return;
    }
    var stories = SAMPLE_CONTENT.stories;
    var story = stories[requestedIndex(stories.length)];

    document.title = story.headline + " · Tolstoy";

    var eyebrow = document.querySelector(".story-eyebrow");
    text("story-headline", story.headline);
    text("story-dek", story.dek);
    text("story-teller", story.teller);
    if (eyebrow) {
      eyebrow.setAttribute("aria-hidden", "false");
    }

    var body = document.getElementById("story-body");
    if (body) {
      story.body.split("\n\n").forEach(function (paragraph) {
        var p = document.createElement("p");
        p.textContent = paragraph;
        body.appendChild(p);
      });
    }

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
