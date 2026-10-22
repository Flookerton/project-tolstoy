// The privacy page needs no logic beyond drawing its one lock icon.
// The page is static on purpose: a privacy page that runs code is a worse
// privacy page.

(function () {
  "use strict";
  if (window.TolstoyIcons) {
    window.TolstoyIcons.mount();
  }
})();
