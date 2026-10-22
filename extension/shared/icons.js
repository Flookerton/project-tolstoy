// Tolstoy icons: flat, simple, 1.5px strokes in ink-2, the same everywhere.
//
// Usage: put <span class="icon" data-icon="search"></span> in the page and call
// TolstoyIcons.mount(). Nothing here is a network request, and every icon is
// aria-hidden because the control around it carries its own label.
//
// Loaded as a plain script before the page script, so it attaches to window.

(function (root) {
  "use strict";

  var OPEN =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">';
  var CLOSE = "</svg>";

  function svg(body, size) {
    if (size) {
      return OPEN.replace(/width="20" height="20"/, 'width="' + size + '" height="' + size + '"') + body + CLOSE;
    }
    return OPEN + body + CLOSE;
  }

  var ICONS = {
    // Search: a magnifier, for the search bar and the search button.
    search: svg('<circle cx="10.5" cy="10.5" r="6.25"/><path d="M15.2 15.2 L20 20"/>'),

    // Sliders: the settings glyph on Tolstoy Home and in the panel header.
    sliders: svg(
      '<path d="M4 8.5 H12"/><path d="M17.5 8.5 H20"/>' +
        '<circle cx="14.75" cy="8.5" r="2.25"/>' +
        '<path d="M4 15.5 H6.5"/><path d="M12 15.5 H20"/>' +
        '<circle cx="9.25" cy="15.5" r="2.25"/>'
    ),

    // Lock: the trust line.
    lock: svg(
      '<rect x="5" y="10.5" width="14" height="9.25" rx="2.5"/>' +
        '<path d="M8.5 10.5 V7.6 a3.5 3.5 0 0 1 7 0 V10.5"/>'
    ),

    // Arrow: a right arrow, for links and the "Other shoes" chip later.
    arrow: svg('<path d="M4.5 12 H18.5"/><path d="M13.5 7 L18.5 12 L13.5 17"/>'),

    // Star: kept for the "small delight" chip that a later task adds.
    star: svg(
      '<path d="M12 4.5 L13.9 9.6 L19.5 10 L15.2 13.4 L16.6 18.8 L12 15.9 L7.4 18.8 ' +
        'L8.8 13.4 L4.5 10 L10.1 9.6 Z"/>'
    )
  };

  // Fills every [data-icon] element inside the given scope (the document by
  // default) with its markup. Elements that already have content are left alone.
  function mount(scope) {
    var searchRoot = scope || document;
    var nodes = searchRoot.querySelectorAll("[data-icon]");
    Array.prototype.forEach.call(nodes, function (node) {
      var name = node.getAttribute("data-icon");
      if (ICONS[name] && !node.firstChild) {
        node.innerHTML = ICONS[name];
      }
    });
  }

  root.TolstoyIcons = { icons: ICONS, mount: mount };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.TolstoyIcons;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
