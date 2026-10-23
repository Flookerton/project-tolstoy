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

  // ------------------------------------------------------------- the model card
  //
  // Three states, and nothing in between: the offer, the download with its
  // progress, and either "On this computer" with a way to remove it, or "Simple
  // rules only" when the model could not be loaded. The rules always keep
  // working, whatever this card says.

  var MODEL_OFFER = "A stronger model catches more hostile posts than the small one that comes with Tolstoy. It is 110 MB and runs on this computer.";
  var MODEL_READY = "The stronger model is on this computer, and it is the one in use.";
  var MODEL_SMALL = "Using the small model that comes with Tolstoy.";
  var MODEL_SIZE = 110 * 1024 * 1024;
  var model = { status: "absent", bytes: 0, files: 0, active: "bundled" };

  function el(id) {
    return document.getElementById(id);
  }

  function humanMb(bytes) {
    return Math.max(0, Math.round(bytes / (1024 * 1024)));
  }

  function renderModel() {
    var text = el("model-text");
    var actions = el("model-actions");
    var progress = el("model-progress");
    var state = el("model-state");
    var track = el("progress-track");
    var fill = el("progress-fill");
    var progressText = el("model-progress-text");
    if (!text || !actions || !progress || !state) {
      return;
    }

    var status = model.status || "absent";
    var downloading = status === "downloading";
    var ready = status === "ready";
    var failed = status === "downloaded" || status === "failed";

    if (downloading) {
      text.textContent = MODEL_OFFER;
      text.hidden = false;
      actions.hidden = true;
      progress.hidden = false;
      state.hidden = true;
      var percent = Math.min(99, Math.round((model.bytes / MODEL_SIZE) * 100));
      if (fill) {
        fill.style.width = percent + "%";
      }
      if (track) {
        track.setAttribute("aria-valuenow", String(percent));
      }
      if (progressText) {
        progressText.textContent = "Downloading… " + humanMb(model.bytes) + " of 110 MB";
      }
      return;
    }

    progress.hidden = true;

    if (ready) {
      text.textContent = MODEL_READY;
      text.hidden = false;
      actions.hidden = true;
      state.hidden = false;
      state.textContent = "";
      var onText = document.createElement("span");
      onText.textContent = "On this computer";
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "link-button";
      remove.id = "model-remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", function () {
        model = { status: "downloading", bytes: 0, files: 0 };
        renderModel();
        chrome.runtime.sendMessage({ source: "tolstoy", type: "modelRemove" }, function () {
          loadModelState();
        });
      });
      state.appendChild(onText);
      state.appendChild(remove);
      return;
    }

    // The offer, and the "simple rules only" line when a download did not take.
    text.textContent = MODEL_OFFER;
    text.hidden = false;
    actions.hidden = false;
    if (failed) {
      state.hidden = false;
      state.textContent = "Simple rules only.";
    } else {
      // Not an empty line: the small model came with Tolstoy, so it is working,
      // and the card should say which model is doing the reading.
      state.hidden = false;
      state.textContent = MODEL_SMALL;
    }
  }

  function loadModelState() {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
      model = { status: "absent", bytes: 0, files: 0 };
      renderModel();
      return;
    }
    chrome.runtime.sendMessage({ source: "tolstoy", type: "modelStatus" }, function (reply) {
      if (chrome.runtime.lastError || !reply) {
        model = { status: "absent", bytes: 0, files: 0, active: "bundled" };
        renderModel();
        return;
      }
      // This card is about the optional stronger model, so its own state is what is
      // shown. The bundled model is always here and the line underneath says so.
      var stronger = reply.stronger && typeof reply.stronger === "object" ? reply.stronger : null;
      model = {
        status: stronger ? stronger.status : (reply.ready ? "ready" : "absent"),
        bytes: (stronger && stronger.bytes) || reply.bytes || 0,
        files: (stronger && stronger.files) || reply.files || 0,
        active: reply.active || "bundled"
      };
      renderModel();
    });
  }

  function setupModel() {
    var download = el("model-download");
    if (download) {
      download.addEventListener("click", function () {
        model = { status: "downloading", bytes: 0, files: 0 };
        renderModel();
        chrome.runtime.sendMessage({ source: "tolstoy", type: "modelDownload" }, function (reply) {
          if (reply && reply.state) {
            model = reply.state;
          }
          loadModelState();
        });
      });
    }

    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function (message) {
        if (!message || message.source !== "tolstoy") {
          return;
        }
        if (message.type === "modelProgress") {
          model.status = "downloading";
          model.bytes = message.bytes || 0;
          renderModel();
        }
        if (message.type === "modelChanged") {
          loadModelState();
        }
      });
    }

    loadModelState();
  }

  function init() {
    helpEl = document.getElementById("temperature-help");
    setupTemperature();
    setupBlur();
    setupModel();
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
