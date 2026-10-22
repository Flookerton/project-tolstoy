// Tolstoy scorer: applies the published rules to one post's text.
//
// scorePost(text) -> { score, reasons }
//   score   0 to 1, where 1 means every rule matched. It is
//           1 - the product of (1 - weight) over the matched rules, so a single
//           mild rule stays mild and two mild rules do not add up to a strong one.
//   reasons one plain-language line per matched category, in rule order.
//
// This file does the matching only. There is no network call, no model, and no
// storage here: one string in, one number out.
//
// Loaded both as a content script (world: MAIN, after scoring/rules.js) and by
// the Node tests, so it writes to globalThis and to module.exports.

(function (root) {
  "use strict";

  var rules = root.TolstoyRules;
  var RULES = (rules && rules.RULES) || [];

  // A word list matches on whole words only, and allows the plain plural, so
  // "clown" does not fire inside an unrelated longer word but "clowns" does.
  function escapeForRegExp(word) {
    return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function wordHit(text, word) {
    return new RegExp("\\b" + escapeForRegExp(word.toLowerCase()) + "(?:s|es)?\\b").test(text);
  }

  // Mostly capitals. Handles and links are removed first: a shouty message is
  // the thing we look at, not the name someone typed.
  function shouting(text) {
    var body = text.replace(/https?:\/\/\S+/g, " ").replace(/@[A-Za-z0-9_]+/g, " ");
    var letters = body.replace(/[^A-Za-z]/g, "");
    if (letters.length < 12) {
      return false;
    }
    var capitals = body.replace(/[^A-Z]/g, "");
    return capitals.length / letters.length >= 0.7;
  }

  // Three or more exclamation marks in a row.
  function exclamationRun(text) {
    return /!{3,}/.test(text);
  }

  function matches(rule, text) {
    var pattern = rule.pattern || {};
    if (pattern.type === "words") {
      var lower = text.toLowerCase();
      return (pattern.words || []).some(function (word) {
        return wordHit(lower, word);
      });
    }
    if (pattern.type === "regex") {
      return new RegExp(pattern.source, pattern.flags || "").test(text);
    }
    if (pattern.type === "shouting") {
      return shouting(text);
    }
    if (pattern.type === "exclamationRun") {
      return exclamationRun(text);
    }
    return false;
  }

  function scorePost(text) {
    if (typeof text !== "string" || !text.trim()) {
      return { score: 0, reasons: [] };
    }

    var remaining = 1;
    var seen = {};
    var reasons = [];

    RULES.forEach(function (rule) {
      if (!matches(rule, text)) {
        return;
      }
      remaining *= 1 - rule.weight;
      if (!seen[rule.category]) {
        seen[rule.category] = true;
        reasons.push(rule.reason);
      }
    });

    return { score: 1 - remaining, reasons: reasons };
  }

  // The ids of the rules that matched, for the docs and the tests.
  function matchedRules(text) {
    if (typeof text !== "string" || !text.trim()) {
      return [];
    }
    return RULES.filter(function (rule) {
      return matches(rule, text);
    }).map(function (rule) {
      return rule.id;
    });
  }

  var api = {
    scorePost: scorePost,
    matchedRules: matchedRules,
    threshold: (rules && rules.THRESHOLD) || 0.5
  };

  root.TolstoyScore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
