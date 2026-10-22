// The welcome page: shown once, on install, and reachable afterwards from the
// trust line on Tolstoy Home. Its two buttons go to the calm page and to the
// settings panel. Nothing here makes a network request.

(function () {
  "use strict";

  function openHome() {
    var url = chrome.runtime.getURL("newtab/newtab.html");
    if (chrome.tabs && chrome.tabs.update) {
      chrome.tabs.update({ url: url });
      return;
    }
    window.location.href = url;
  }

  function openSettings() {
    if (chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  }

  function init() {
    var home = document.getElementById("open-home");
    if (home) {
      home.addEventListener("click", openHome);
    }
    var settings = document.getElementById("open-settings");
    if (settings) {
      settings.addEventListener("click", openSettings);
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
