// Tolstoy background service worker.
//
// Its only job is to open the welcome page once, on the first install, and then
// never again: not on a browser restart, not on an update, not on a reload. It
// holds no state of its own, makes no network request, and asks for no
// permission. The "onInstalled" event tells us why it is running, so nothing has
// to be stored anywhere to remember that the welcome page was already shown.

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason !== "install") {
    return;
  }
  chrome.tabs.create({ url: chrome.runtime.getURL("welcome/welcome.html") });
});
