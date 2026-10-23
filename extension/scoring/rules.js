// Tolstoy scoring rules: the published rules, as data.
// This file holds no logic on purpose, so anyone can read it and check what
// Tolstoy looks at. The matching and the scoring live in scoring/score.js, and a
// plain-language version of all of this is in docs/scoring-rules.md.
//
// One idea holds all of it together: a post moves only when hostility is aimed
// at a person or a group. Tone markers on their own never move a post at
// Balanced. Several stacked together can.
//
// Every rule is:
//   id        a stable name, used in tests and in the docs
//   category  one of the four categories the design system allows
//   kind      "targeted" (it names who the hostility is aimed at) or
//             "amplifier" (it is only a tone marker)
//   pattern   how to look: a case-insensitive regex, a short word list, or one
//             of the two shape detectors ("shouting", "exclamationRun")
//   weight    0 to 1, how much one match counts toward the score
//   reason    the sentence shown to the person who sees the post moved
//
// The score is 1 - the product of (1 - weight) over every matched rule, so it
// stays between 0 and 1 and two mild matches do not add up to a strong one.
//
// The arithmetic of amplifiers, with a weight of 0.2 each:
//   one           1 - 0.8        = 0.2
//   two           1 - 0.8 * 0.8  = 0.36
//   three         1 - 0.8^3      = 0.488
//   four          1 - 0.8^4      = 0.59
// So at Balanced (0.5) four amplifiers are needed, and at Calm (0.45) three are
// enough. A single targeted rule (0.6 and up) moves a post on its own.
//
// Hard rule, from principle 5: no rule may mention a party, a politician, an
// ideology, a country, a religion, or a political topic. Tolstoy scores how
// something is said, never which view it takes.

(function (root) {
  "use strict";

  // Shown to people as Calm, Balanced and Unfiltered. Unfiltered is above 1, so
  // nothing ever moves.
  var THRESHOLDS = { calm: 0.45, balanced: 0.5, unfiltered: 1.01 };

  // The words people use as insults at a person. Used inside the targeted
  // patterns below, never on their own.
  var INSULTS = "idiots?|morons?|imbeciles?|clowns?|jackasses?|dirtbags?|losers?|scumbags?|fools?|baboons?";

  // One optional describing word is allowed between the article and the insult,
  // so "you are a lazy idiot" counts and "you are a good neighbour" still does
  // not.
  var ADJ = "(?:[a-z]{3,}\\s+)?";

  // The words used to describe people as less than human. Also only inside
  // patterns that name who they are about.
  var LESS_THAN_HUMAN =
    "vermin|parasites?|cockroaches|rats|animals|filth|scum|sub-?humans?|" +
    "a disease|a plague|a cancer|an infestation|a virus";

  // Nouns that are only ever used about people. Safe to pair with a bare
  // "these" or "those".
  var ONLY_ABOUT_PEOPLE = "vermin|parasites?|cockroaches|leeches|filth|scum|sub-?humans?|a disease|a plague|a cancer|an infestation|a virus";

  // Nouns that are also used about real animals, so they only count when the
  // sentence names who they are about: "these people are animals" yes,
  // "these animals need homes" no.
  var ALSO_ANIMALS = "animals|rats|pests|leeches|rodents|insects";

  root.TolstoyRules = {
    // The default temperature, shown to people as "Balanced".
    THRESHOLD: 0.5,
    THRESHOLDS: THRESHOLDS,

    RULES: [
      // ------------------------------------------------------- targeted: name-calling
      // Insults aimed at a person or a group. Each pattern names the target, so
      // "clown" on its own ("the clowns at the circus") never fires.
      {
        id: "name-calling-you-are",
        category: "name-calling",
        kind: "targeted",
        // "you're such an idiot", "you are a moron", "you lot are a bunch of clowns"
        pattern: {
          type: "regex",
          flags: "i",
          source:
            "\\byou(?:'re| are| lot are| all are)\\s+(?:such\\s+|all\\s+|just\\s+|really\\s+)*" +
            "(?:an?\\s+" + ADJ + "|a\\s+(?:bunch|pack|load|group)\\s+of\\s+)?(?:" + INSULTS + ")\\b"
        },
        weight: 0.7,
        reason: "Name-calling"
      },
      {
        id: "name-calling-he-she-they",
        category: "name-calling",
        kind: "targeted",
        // "he's a clown", "she is an idiot", "they are a bunch of morons",
        // "they're all clowns"
        pattern: {
          type: "regex",
          flags: "i",
          source:
            "\\b(?:he|she|they)(?:'s|'re| is| are)\\s+(?:such\\s+|all\\s+|just\\s+|really\\s+|nothing but\\s+)*" +
            "(?:an?\\s+" + ADJ + "|a\\s+(?:bunch|pack|load|group|lot)\\s+of\\s+)?(?:" + INSULTS + ")\\b"
        },
        weight: 0.7,
        reason: "Name-calling"
      },
      {
        id: "name-calling-what-a",
        category: "name-calling",
        kind: "targeted",
        // "what an idiot", "what a clown". The lookahead keeps self-deprecation
        // out: "what an idiot I was to skip sunscreen" is not aimed at anyone.
        pattern: {
          type: "regex",
          flags: "i",
          source: "\\bwhat\\s+(?:an?\\s+" + ADJ + ")?(?:" + INSULTS + ")\\b(?!\\s+I\\b)"
        },
        weight: 0.6,
        reason: "Name-calling"
      },
      {
        id: "name-calling-handle",
        category: "name-calling",
        kind: "targeted",
        // "@someone is a clown", "@someone is such an idiot"
        pattern: {
          type: "regex",
          flags: "i",
          source: "@[A-Za-z0-9_]{2,}\\s+(?:is|are|was|were)\\s+(?:such\\s+)?(?:an?\\s+" + ADJ + "|a\\s+bunch\\s+of\\s+)?(?:" + INSULTS + ")\\b"
        },
        weight: 0.7,
        reason: "Name-calling"
      },
      {
        id: "name-calling-insults-like",
        category: "name-calling",
        kind: "targeted",
        // "idiots like you", "clowns like him", "morons like them"
        pattern: {
          type: "regex",
          flags: "i",
          source: "\\b(?:" + INSULTS + "|" + LESS_THAN_HUMAN + ")\\s+like\\s+(?:you|him|her|them|these|those|people)\\b"
        },
        weight: 0.7,
        reason: "Name-calling"
      },
      {
        id: "name-calling-these-clowns",
        category: "name-calling",
        kind: "targeted",
        // "all of these clowns", "those idiots", "every one of these morons"
        pattern: {
          type: "regex",
          flags: "i",
          source:
            "\\b(?:all\\s+of\\s+|every\\s+(?:one|single one)\\s+of\\s+)?(?:these|those|you)\\s+(?:" + INSULTS + ")\\b" +
            "|\\bevery\\s+(?:one|single one)\\s+of\\s+(?:these|those)\\s+(?:" + INSULTS + ")\\b"
        },
        weight: 0.7,
        reason: "Name-calling"
      },
      {
        id: "name-calling-people-are",
        category: "name-calling",
        kind: "targeted",
        // "these people are idiots", "the people defending them are morons"
        pattern: {
          type: "regex",
          flags: "i",
          source:
            "\\b(?:these|those|you)\\s+(?:people|folks)\\s+(?:are|were)\\s+" +
            "(?:(?:all|just|nothing but)\\s+)?(?:a\\s+bunch\\s+of\\s+)?(?:an?\\s+" + ADJ + ")?(?:" + INSULTS + ")\\b"
        },
        weight: 0.7,
        reason: "Name-calling"
      },
      {
        id: "name-calling-group-are",
        category: "name-calling",
        kind: "targeted",
        // "Cat people are losers", "dog owners are a bunch of morons", "evening
        // runners are clowns". A group has to be named by a people word, so
        // "the shelves are useless" is not this, and "we are idiots" is left
        // alone because Tolstoy does not move people for being hard on
        // themselves.
        pattern: {
          type: "regex",
          flags: "i",
          source:
            "\\b(?:you|they|[a-z]{3,}\\s+(?:people|owners|fans|runners|readers|users|drivers|players|workers|customers|supporters|voters|viewers|listeners))" +
            "\\s+(?:are|were)\\s+(?:(?:all|such|just|nothing but)\\s+)?(?:a\\s+(?:bunch|pack|load|group)\\s+of\\s+)?" +
            "(?:an?\\s+" + ADJ + ")?(?:" + INSULTS + ")\\b"
        },
        weight: 0.7,
        reason: "Name-calling"
      },

      // ----------------------------------------------------- targeted: dehumanizing
      // People spoken about as animals, pests or disease. The target has to be
      // there, so a biology post about parasites, or a shelter post about
      // animals, is not this.
      {
        id: "dehumanizing-these-are",
        category: "dehumanizing",
        kind: "targeted",
        // "these people are vermin", "those people are a plague", "you people
        // are parasites", "people like them are animals"
        pattern: {
          type: "regex",
          flags: "i",
          source:
            "\\b(?:these|those|you)\\s+(?:people|folks)\\s+(?:are|is|were|was)\\s+(?:(?:all|just|nothing but)\\s+)?" +
            "(?:" + ONLY_ABOUT_PEOPLE + "|" + ALSO_ANIMALS + ")\\b" +
            "|\\bpeople like\\s+(?:you|him|her|them|these|those)\\s+(?:are|is|were|was)\\s+(?:(?:all|just|nothing but)\\s+)?" +
            "(?:" + ONLY_ABOUT_PEOPLE + "|" + ALSO_ANIMALS + ")\\b"
        },
        weight: 0.8,
        reason: "Talks about people as less than human"
      },
      {
        id: "dehumanizing-they-are",
        category: "dehumanizing",
        kind: "targeted",
        // "these people are vermin", "they are vermin", "you are a worthless
        // parasite", "he is filth". One describing word is allowed, the same way
        // the name-calling patterns allow one.
        pattern: {
          type: "regex",
          flags: "i",
          source:
            "\\b(?:they|you|he|she|it(?:'s| is))\\s*(?:are|'re|is|were|was)\\s+(?:(?:all|just|nothing but)\\s+)?" +
            "(?:an?\\s+)?(?:[a-z]{3,}\\s+)?(?:" + ONLY_ABOUT_PEOPLE + "|" + ALSO_ANIMALS + ")\\b"
        },
        weight: 0.8,
        reason: "Talks about people as less than human"
      },
      {
        id: "dehumanizing-vermin",
        category: "dehumanizing",
        kind: "targeted",
        // "these vermin", "those cockroaches", "you parasites", "you worthless
        // parasite". No describing word is required, and only one is allowed.
        pattern: {
          type: "regex",
          flags: "i",
          source: "\\b(?:these|those|you)(?:\\s+[a-z]{3,})?\\s+(?:" + ONLY_ABOUT_PEOPLE + ")\\b"
        },
        weight: 0.8,
        reason: "Talks about people as less than human"
      },
      {
        id: "dehumanizing-subhuman",
        category: "dehumanizing",
        kind: "targeted",
        // "subhuman" is a word with no other use, so it may stand alone.
        pattern: { type: "words", words: ["subhuman", "sub-human", "subhumans", "sub-humans", "less than human"] },
        weight: 0.8,
        reason: "Talks about people as less than human"
      },
      {
        id: "dehumanizing-cull",
        category: "dehumanizing",
        kind: "targeted",
        // "cull them", "they should be culled", "wipe them out"
        pattern: {
          type: "regex",
          flags: "i",
          source: "\\b(?:cull|exterminate|wipe out|eradicate)\\s+(?:them|these|those|him|her)\\b|\\bshould be (?:culled|exterminated|wiped out|eradicated)\\b"
        },
        weight: 0.85,
        reason: "Talks about people as less than human"
      },

      // --------------------------------------------------------- targeted: violence
      // Calls to hurt, kill, hang, shoot or execute people. Every pattern names
      // a person or a group, so "hang them this weekend" (a picture frame) and
      // "shoot them a message" are not this.
      {
        id: "violence-should-be",
        category: "violence",
        kind: "targeted",
        // "they should be hanged", "he should be shot", "these people should be
        // killed", "they should all be shot"
        pattern: {
          type: "regex",
          flags: "i",
          source:
            "\\b(?:he|she|they|you|these people|those people|you people)\\s+(?:should|must|need to)\\s+(?:all\\s+)?" +
            "be\\s+(?:killed|shot|hanged|hung|executed|beaten|gassed|burned|erased|wiped out|put down|strung up)\\b"
        },
        weight: 0.9,
        reason: "Calls for harm"
      },
      {
        id: "violence-should-deserve",
        category: "violence",
        kind: "targeted",
        // "they deserve to be shot", "he deserves to be beaten"
        pattern: {
          type: "regex",
          flags: "i",
          source:
            "\\b(?:he|she|they|you|these people|those people|you people)\\s+deserve(?:s)?\\s+to\\s+be\\s+" +
            "(?:killed|shot|hanged|hung|executed|beaten|hurt|strung up)\\b"
        },
        weight: 0.9,
        reason: "Calls for harm"
      },
      {
        id: "violence-kill-them",
        category: "violence",
        kind: "targeted",
        // "kill them all", "shoot them all", "hang them all", "someone should
        // kill him". The bare "hang them" and "shoot them" forms are deliberately
        // not here: a picture frame and a message are not people.
        pattern: {
          type: "regex",
          flags: "i",
          source:
            "\\b(?:someone|somebody)\\s+should\\s+(?:kill|shoot|hang|hurt|punch|stab)\\s+(?:him|her|them|these people|those people)\\b" +
            "|\\b(?:kill|shoot|hang|behead|lynch|stab|gas)\\s+(?:them|him|her|these people|those people)\\s+all\\b"
        },
        weight: 0.9,
        reason: "Calls for harm"
      },
      {
        id: "violence-deserve-to-die",
        category: "violence",
        kind: "targeted",
        // "they deserve to die", "he should die", "I hope you die", "go die",
        // "death to"
        pattern: {
          type: "regex",
          flags: "i",
          source:
            "\\b(?:he|she|they|you|these people|those people)\\s+(?:deserve(?:s)? to (?:die|be hurt|be dead)|should (?:die|be dead))\\b" +
            "|\\b(?:i )?hope\\s+(?:you|he|she|they)\\s+(?:die|get shot|get hurt|get killed)\\b" +
            "|\\b(?:death to|go die|should all die)\\b"
        },
        weight: 0.9,
        reason: "Calls for harm"
      },
      {
        id: "violence-want-them-hurt",
        category: "violence",
        kind: "targeted",
        // "someone needs to smash his face in", "I would love to see them hurt"
        pattern: {
          type: "regex",
          flags: "i",
          source:
            "\\b(?:smash|bash)\\s+(?:his|her|their)\\s+(?:face|head|skull)\\s+in\\b" +
            "|\\b(?:want|would love) to see\\s+(?:him|her|them|these people)\\s+(?:hurt|dead|beaten|shot|gone)\\b"
        },
        weight: 0.85,
        reason: "Calls for harm"
      },

      // --------------------------------------------------------- amplifiers: rage bait
      // Tone markers on their own. 0.2 each, never more: four of them are needed
      // to reach Balanced, and three reach Calm. Nothing here names a target, so
      // none of it can move a post by itself.
      {
        id: "amplifier-shouting",
        category: "rage-bait",
        kind: "amplifier",
        pattern: { type: "shouting" },
        weight: 0.2,
        reason: "Written to make you angry"
      },
      {
        id: "amplifier-exclamations",
        category: "rage-bait",
        kind: "amplifier",
        pattern: { type: "exclamationRun" },
        weight: 0.2,
        reason: "Written to make you angry"
      },
      {
        id: "amplifier-shock-words",
        category: "rage-bait",
        kind: "amplifier",
        // "disgusting", "appalling", "vile", "outrageous" used as a hook
        pattern: {
          type: "words",
          words: ["disgusting", "outrageous", "appalling", "vile", "repulsive", "sickening"]
        },
        weight: 0.2,
        reason: "Written to make you angry"
      },
      {
        id: "amplifier-rage-phrases",
        category: "rage-bait",
        kind: "amplifier",
        // The hook sentences people write to make a post travel.
        pattern: {
          type: "words",
          words: [
            "you won't believe",
            "you wont believe",
            "share before",
            "before it's deleted",
            "before its deleted",
            "nobody is talking about",
            "nobody talks about",
            "look what they did",
            "everyone needs to see"
          ]
        },
        weight: 0.2,
        reason: "Written to make you angry"
      },
      {
        id: "amplifier-caps-hooks",
        category: "rage-bait",
        kind: "amplifier",
        // Case-sensitive on purpose: "the movie destroyed me" is not this.
        pattern: {
          type: "regex",
          flags: "",
          source: "\\b(?:DESTROYED|OBLITERATED|WRECKED|EXPOSED|DESTROYS|HUMILIATED)\\b"
        },
        weight: 0.2,
        reason: "Written to make you angry"
      },
      {
        id: "amplifier-weak-insults",
        category: "rage-bait",
        kind: "amplifier",
        // Untargeted weak insults. "my stupid printer" is not aimed at a person,
        // so it counts 0.2 and moves nothing on its own.
        pattern: {
          type: "words",
          words: ["stupid", "pathetic", "worthless", "clueless", "disgraceful", "brainless", "idiotic"]
        },
        weight: 0.2,
        reason: "Written to make you angry"
      }
    ]
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.TolstoyRules;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
