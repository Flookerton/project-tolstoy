// Tolstoy slur list, kept in its own file on purpose.
//
// ---------------------------------------------------------------------------
// CONTENT NOTE: this file contains slurs. They are here so that a filter can
// recognise them and lower the posts that use them. Listing a word is not an
// endorsement of it, and nothing in this file is ever shown to a person as
// anything other than the reason "Uses a slur".
// ---------------------------------------------------------------------------
//
// Why slurs get their own rule, and their own file:
//
// Every other rule in Tolstoy is aimed at hostility that names a target. A slur
// needs no target pattern, because a slur is hostile whatever it is aimed at,
// including when it is used jokingly or as a quotation. So it is one rule, with
// one weight, one reason, and one list.
//
// A slur is about how something is said, not which side it is on, so this rule
// does not weaken the hard rule in scoring/rules.js: slurs are not a political
// position, and this list names no party, politician, ideology, country,
// religion, or political question.
//
// ORDINARY PROFANITY IS NOT A SLUR. The words people use to swear, such as
// "fucking", "damn", "shit", "crap" or "bastard", are not in this list and never
// move a post on their own. Neither are the general insults that name-calling
// already covers ("idiot", "moron", "clown"), nor gendered insults that are also
// ordinary swearing in common use ("bitch", "whore", "cunt", "slut"): those are
// covered by the name-calling rules when they are aimed at a person, and by the
// on-device model when they are used as a slur against a group.
//
// Sources, and how the two sets were chosen:
//
//   ldnoobw  Terms taken from the List of Dirty, Naughty, Obscene and Otherwise
//            Bad Words (LDNOOBW, originally published by Shutterstock),
//            licensed CC BY 4.0. From that list we kept only the terms that
//            target a person for who they are: race, ethnicity, nationality,
//            religion, sexual orientation, gender identity, or disability.
//            Every sexual, scatological or generic profanity entry was dropped.
//
//   ours     Terms that LDNOOBW does not carry, written for this project. They
//            are the common identity slurs it is missing. We left out the few
//            that have everyday non-slur meanings in ordinary writing ("jap",
//            "nip", "slope", "spook", "mong", "negro"): each of those reads as
//            something else far more often than as a slur in a feed, and moving
//            a person's harmless post is a worse failure than missing one. The
//            on-device model is what covers that gap.
//
// Matching lives in scoring/score.js: whole words only, case-insensitively, with
// the common letter swaps below allowed in place of letters, so "f@ggot",
// "f4ggot" and "f*ggot" are all found. Nothing here is stored, sent, or logged.

(function (root) {
  "use strict";

  // The rule, as the rest of the code reads it.
  var RULE = {
    id: "slur-identity",
    category: "slur",
    kind: "targeted",
    pattern: { type: "slurList" },
    weight: 0.9,
    reason: "Uses a slur"
  };

  // Letters people swap out to slip past a filter, and what stands in for them.
  var SWAPS = {
    a: "a@4",
    b: "b8",
    e: "e3",
    g: "g9",
    i: "i1!|",
    l: "l1|",
    o: "o0",
    s: "s$5",
    t: "t7",
    u: "u(v",
    z: "z2"
  };

  var FROM_LDNOOBW = [
    "beaner",
    "beaners",
    "bulldyke",
    "carpet muncher",
    "carpetmuncher",
    "coon",
    "coons",
    "darkie",
    "fag",
    "faggot",
    "fudge packer",
    "fudgepacker",
    "jigaboo",
    "jiggaboo",
    "jiggerboo",
    "kike",
    "nig nog",
    "nigga",
    "nigger",
    "paki",
    "pakis",
    "pikey",
    "poof",
    "raghead",
    "ragheads",
    "shemale",
    "slanteye",
    "spastic",
    "spic",
    "spics",
    "towelhead",
    "towelheads",
    "tranny",
    "twink",
    "wetback",
    "wetbacks"
  ];

  var OURS = [
    "camel jockey",
    "chink",
    "chinks",
    "dyke",
    "dykes",
    "gook",
    "gooks",
    "greaser",
    "heeb",
    "honky",
    "injun",
    "kraut",
    "redskin",
    "retard",
    "retards",
    "retarded",
    "squaw",
    "tard",
    "trannie",
    "trannies"
  ];

  root.TolstoySlurRules = {
    RULE: RULE,
    SWAPS: SWAPS,
    FROM_LDNOOBW: FROM_LDNOOBW,
    OURS: OURS,
    SLURS: FROM_LDNOOBW.concat(OURS),
    SOURCE: {
      ldnoobw: {
        name: "List of Dirty, Naughty, Obscene and Otherwise Bad Words (LDNOOBW)",
        url: "https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words",
        license: "CC BY 4.0",
        note: "Identity slurs only. Every other entry in that list was dropped."
      },
      ours: {
        name: "Written for this project",
        license: "same as the project",
        note: "Identity slurs LDNOOBW does not carry. Ambiguous ones were left out."
      }
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.TolstoySlurRules;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
