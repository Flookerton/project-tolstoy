// The Tolstoy panel: the toolbar popup and the settings page, from one file.
//
// Settings live in chrome.storage.local under the single key "tolstoySettings",
// as { temperature, blur }. Nothing else is ever stored: no feed content, no
// counts, no identifiers. Changing a control saves at once, and the page the
// person is looking at picks the change up through chrome.storage.onChanged.

(function () {
  "use strict";

  var STORAGE_KEY = "tolstoySettings";
  var TEMPERATURES = ["calm", "balanced", "unfiltered"];
  var DEFAULTS = { temperature: "balanced", blur: false };

  var HELP_TEXT = {
    calm: "Heated posts move to the bottom. You can always show them.",
    balanced: "Only clearly hostile posts move down. You can always show them.",
    unfiltered: "Tolstoy only counts. Nothing is moved."
  };

  var settings = { temperature: DEFAULTS.temperature, blur: DEFAULTS.blur };
  var options = [];
  var helpEl = null;
  var blurToggle = null;

  function hasStorage() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  function load(done) {
    if (!hasStorage()) {
      done();
      return;
    }
    chrome.storage.local.get(STORAGE_KEY, function (items) {
      var saved = items && items[STORAGE_KEY];
      if (saved && typeof saved === "object") {
        if (TEMPERATURES.indexOf(saved.temperature) !== -1) {
          settings.temperature = saved.temperature;
        }
        settings.blur = !!saved.blur;
      }
      done();
    });
  }

  function save() {
    if (!hasStorage()) {
      return;
    }
    var payload = {};
    payload[STORAGE_KEY] = { temperature: settings.temperature, blur: settings.blur };
    chrome.storage.local.set(payload);
  }

  function render() {
    options.forEach(function (button) {
      var selected = button.getAttribute("data-temperature") === settings.temperature;
      button.setAttribute("aria-checked", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    });
    if (helpEl) {
      helpEl.textContent = HELP_TEXT[settings.temperature] || "";
    }
    if (blurToggle) {
      blurToggle.setAttribute("aria-checked", settings.blur ? "true" : "false");
    }
  }

  function choose(temperature, focus) {
    if (TEMPERATURES.indexOf(temperature) === -1) {
      return;
    }
    settings.temperature = temperature;
    render();
    save();
    if (focus) {
      var selected = options.filter(function (button) {
        return button.getAttribute("data-temperature") === temperature;
      })[0];
      if (selected) {
        selected.focus();
      }
    }
  }

  // A radiogroup: clicking picks, and the arrow keys move between the options,
  // wrapping at the ends, with Home and End for the two extremes.
  function setupTemperature() {
    var group = document.getElementById("temperature");
    if (!group) {
      return;
    }
    options = Array.prototype.slice.call(group.querySelectorAll(".segmented-option"));

    options.forEach(function (button) {
      button.addEventListener("click", function () {
        choose(button.getAttribute("data-temperature"), false);
      });
    });

    group.addEventListener("keydown", function (event) {
      var keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
      if (keys.indexOf(event.key) === -1) {
        return;
      }
      event.preventDefault();
      var current = TEMPERATURES.indexOf(settings.temperature);
      var next = current;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        next = (current - 1 + TEMPERATURES.length) % TEMPERATURES.length;
      } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        next = (current + 1) % TEMPERATURES.length;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = TEMPERATURES.length - 1;
      }
      choose(TEMPERATURES[next], true);
    });
  }

  function setupBlur() {
    blurToggle = document.getElementById("blur-toggle");
    if (!blurToggle) {
      return;
    }
    blurToggle.addEventListener("click", function () {
      settings.blur = !settings.blur;
      render();
      save();
    });
  }

  function init() {
    helpEl = document.getElementById("temperature-help");
    setupTemperature();
    setupBlur();
    if (window.TolstoyIcons) {
      window.TolstoyIcons.mount();
    }
    load(render);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
