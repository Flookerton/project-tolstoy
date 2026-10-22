// Tolstoy scoring rules: the published rules, as data.
// This file holds no logic on purpose, so anyone can read it and check what
// Tolstoy looks at. The matching and the scoring live in scoring/score.js, and a
// plain-language version of all of this is in docs/scoring-rules.md.
//
// Every rule is:
//   id        a stable name, used in tests and in the docs
//   category  one of the four categories the design system allows
//   pattern   how to look: a case-insensitive regex, a short word list, or one
//             of the two shape detectors ("shouting", "exclamationRun")
//   weight    0 to 1, how much one match counts toward the score
//   reason    the sentence shown to the person who sees the post moved
//
// The score is 1 - the product of (1 - weight) over every matched rule, so it
// stays between 0 and 1 and two mild matches do not add up to a strong one.
//
// Hard rule, from principle 5: no rule may mention a party, a politician, an
// ideology, a country, a religion, or a political topic. Tolstoy scores how
// something is said, never which view it takes.

(function (root) {
  "use strict";

  root.TolstoyRules = {
    // The default temperature. Shown to people as "Balanced".
    THRESHOLD: 0.5,

    RULES: [
      // ---------------------------------------------------------------- name-calling
      // Insults aimed at a person or a group. Plural and group forms matter
      // here, because "you are an idiot" is aimed at someone.
      {
        id: "name-calling-common",
        category: "name-calling",
        pattern: {
          type: "words",
          words: ["idiot", "moron", "imbecile", "scum", "clown", "jackass", "dirtbag"]
        },
        weight: 0.6,
        reason: "Name-calling"
      },
      {
        id: "name-calling-weak",
        category: "name-calling",
        pattern: {
          type: "words",
          words: ["stupid", "pathetic", "loser", "garbage human", "worthless", "clueless"]
        },
        weight: 0.5,
        reason: "Name-calling"
      },

      // -------------------------------------------------------------- dehumanizing
      // People described as animals, pests or disease. The plural and the group
      // form only: a parasite in a biology class is not this.
      {
        id: "dehumanizing-plural",
        category: "dehumanizing",
        pattern: {
          type: "words",
          words: [
            "vermin",
            "subhuman",
            "sub-humans",
            "parasites",
            "cockroaches",
            "locusts",
            "animals who",
            "a plague of"
          ]
        },
        weight: 0.75,
        reason: "Talks about people as less than human"
      },
      {
        id: "dehumanizing-these-those",
        category: "dehumanizing",
        pattern: {
          type: "regex",
          flags: "i",
          source: "\\b(?:these|those)\\s+(?:rats|pests|leeches|animals|people)\\b"
        },
        weight: 0.65,
        reason: "Talks about people as less than human"
      },
      {
        id: "dehumanizing-disease",
        category: "dehumanizing",
        pattern: {
          type: "regex",
          flags: "i",
          source: "\\b(?:like a disease|spreading like|infecting|infestation of|breed like)\\b"
        },
        weight: 0.65,
        reason: "Talks about people as less than human"
      },

      // ------------------------------------------------------------------- violence
      // Calls to hurt, kill, hang, shoot, or get rid of people. Aimed at a
      // person or a group, never at a thing.
      {
        id: "violence-harm",
        category: "violence",
        pattern: {
          type: "regex",
          flags: "i",
          source:
            "\\b(?:should be (?:killed|shot|hanged|beaten|erased|wiped out)|kill (?:them|him|her|these people)|hang (?:them|him|her)|shoot (?:them|him|her)|death to|go die|deserve to (?:die|be hurt|be killed)|get rid of (?:them|him|her|these people))\\b"
        },
        weight: 0.85,
        reason: "Calls for harm"
      },
      {
        id: "violence-threat",
        category: "violence",
        pattern: {
          type: "regex",
          flags: "i",
          source: "\\b(?:beat (?:him|her|them) up|punch (?:him|her|them)|smash (?:his|her|their) face|run (?:him|her|them) over)\\b"
        },
        weight: 0.7,
        reason: "Calls for harm"
      },

      // ----------------------------------------------------------------- rage bait
      // Written to make you angry, not to say anything. The shouting detector
      // only fires on a message that is mostly capitals, and the hook word here
      // is case-sensitive on purpose: "the movie destroyed me" is not this.
      {
        id: "rage-bait-shouting",
        category: "rage-bait",
        pattern: { type: "shouting" },
        weight: 0.5,
        reason: "Written to make you angry"
      },
      {
        id: "rage-bait-exclamations",
        category: "rage-bait",
        pattern: { type: "exclamationRun" },
        weight: 0.5,
        reason: "Written to make you angry"
      },
      {
        id: "rage-bait-phrases",
        category: "rage-bait",
        pattern: {
          type: "words",
          words: [
            "you won't believe",
            "you wont believe",
            "share before",
            "before it's deleted",
            "nobody is talking about",
            "look what they did",
            "everyone needs to see"
          ]
        },
        weight: 0.5,
        reason: "Written to make you angry"
      },
      {
        id: "rage-bait-shock-words",
        category: "rage-bait",
        pattern: {
          type: "regex",
          flags: "i",
          source: "\\b(?:disgusting|outrageous|appalling|vile)\\b"
        },
        weight: 0.5,
        reason: "Written to make you angry"
      },
      {
        id: "rage-bait-caps-hook",
        category: "rage-bait",
        pattern: {
          type: "regex",
          flags: "",
          source: "\\b(?:DESTROYED|OBLITERATED|WRECKED|EXPOSED)\\b"
        },
        weight: 0.5,
        reason: "Written to make you angry"
      }
    ]
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.TolstoyRules;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
