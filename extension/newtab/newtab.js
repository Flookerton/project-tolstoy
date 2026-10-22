// Tolstoy Home: new tab page logic
// All content comes from sample-content.js (the SAMPLE_POSTS array).
// No network requests are made. Everything runs locally.

(function () {
  "use strict";

  var root = document.documentElement;

  // Date and greeting
  function setMasthead() {
    var now = new Date();
    var dateEl = document.getElementById("today-date");
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    }

    var hour = now.getHours();
    var greeting = "Good evening";
    if (hour >= 5 && hour < 12) {
      greeting = "Good morning";
    } else if (hour >= 12 && hour < 18) {
      greeting = "Good afternoon";
    }
    var greetEl = document.getElementById("greeting");
    if (greetEl) {
      greetEl.textContent = greeting;
    }
  }

  // Background glow colors shift with time of day
  function setGlowColors() {
    var hour = new Date().getHours();
    var warm, cool, sage;

    if (hour >= 5 && hour < 11) {
      // Morning: warm amber and soft peach
      warm = "#F2C896";
      cool = "#E8B4A0";
      sage = "#D4C5A0";
    } else if (hour >= 11 && hour < 17) {
      // Afternoon: balanced soft blue and sage
      warm = "#E8D5B8";
      cool = "#9DBCE0";
      sage = "#A8C4A0";
    } else if (hour >= 17 && hour < 21) {
      // Evening: deeper blue with warm sunset tint
      warm = "#D4A88C";
      cool = "#8FA8C8";
      sage = "#9DB8A0";
    } else {
      // Night: cool blue and violet
      warm = "#7F9DB8";
      cool = "#6B89B0";
      sage = "#8A9AB5";
    }

    root.style.setProperty("--glow-warm", warm);
    root.style.setProperty("--glow-cool", cool);
    root.style.setProperty("--glow-sage", sage);
  }

  // Build a card element
  function buildCard(post, isLead) {
    var card = document.createElement("article");
    card.className = isLead ? "lead-card-inner" : "card";

    var source = document.createElement("div");
    source.className = "card-source";
    source.textContent = post.source;

    var text = document.createElement("div");
    text.className = "card-text";
    text.textContent = post.text;

    var author = document.createElement("div");
    author.className = "card-author";
    var nameSpan = document.createElement("span");
    nameSpan.textContent = post.author;
    var handleSpan = document.createElement("span");
    handleSpan.className = "card-handle";
    handleSpan.textContent = post.handle;
    author.appendChild(nameSpan);
    author.appendChild(handleSpan);

    var reason = document.createElement("span");
    reason.className = "card-reason";
    reason.textContent = post.reason;

    card.appendChild(source);
    card.appendChild(text);
    card.appendChild(author);
    card.appendChild(reason);

    return card;
  }

  // Render content from SAMPLE_POSTS
  function renderContent() {
    if (typeof SAMPLE_POSTS === "undefined" || !SAMPLE_POSTS.length) {
      return;
    }

    // Lead story: first post
    var leadEl = document.getElementById("lead-card");
    if (leadEl && SAMPLE_POSTS.length > 0) {
      var leadCard = buildCard(SAMPLE_POSTS[0], true);
      leadEl.appendChild(leadCard);
    }

    // Four sections from the remaining posts
    var sections = {};
    var sectionOrder = ["Moving", "Funny", "Curious", "Humane"];
    for (var i = 1; i < SAMPLE_POSTS.length; i++) {
      var post = SAMPLE_POSTS[i];
      if (!sections[post.section]) {
        sections[post.section] = [];
      }
      sections[post.section].push(post);
    }

    var grid = document.getElementById("sections-grid");
    if (!grid) return;

    sectionOrder.forEach(function (sectionName) {
      if (!sections[sectionName]) return;

      var section = document.createElement("section");
      section.className = "feed-section";
      section.setAttribute("aria-label", sectionName);

      var heading = document.createElement("h2");
      heading.className = "section-heading";
      heading.textContent = sectionName;
      section.appendChild(heading);

      sections[sectionName].forEach(function (post) {
        var card = buildCard(post, false);
        section.appendChild(card);
      });

      grid.appendChild(section);
    });
  }

  // Promises panel
  function setupPromises() {
    var link = document.getElementById("promises-link");
    var overlay = document.getElementById("promises-overlay");
    var closeBtn = document.getElementById("close-promises");
    var backdrop = document.getElementById("promises-backdrop");
    var title = document.getElementById("promises-title");
    var lastFocused = null;

    function openPanel() {
      lastFocused = document.activeElement;
      overlay.hidden = false;
      if (title) {
        title.focus();
      } else if (closeBtn) {
        closeBtn.focus();
      }
      document.addEventListener("keydown", onKeydown);
    }

    function closePanel() {
      overlay.hidden = true;
      document.removeEventListener("keydown", onKeydown);
      if (lastFocused) {
        lastFocused.focus();
      }
    }

    function onKeydown(e) {
      if (e.key === "Escape") {
        closePanel();
      }
      // Trap focus inside the panel
      if (e.key === "Tab" && overlay && !overlay.hidden) {
        var focusable = overlay.querySelectorAll("button, [href], [tabindex]:not([tabindex='-1'])");
        if (focusable.length === 0) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    if (link) {
      link.addEventListener("click", openPanel);
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", closePanel);
    }
    if (backdrop) {
      backdrop.addEventListener("click", closePanel);
    }
  }

  // Initialize
  function init() {
    setMasthead();
    setGlowColors();
    renderContent();
    setupPromises();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
