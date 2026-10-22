// Tests for the published rules and the scorer.
// Run from the repository root:  node --test tests
// No dependencies: plain Node, no framework.

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

require(path.join(__dirname, "..", "extension", "scoring", "rules.js"));
require(path.join(__dirname, "..", "extension", "scoring", "score.js"));

const rules = globalThis.TolstoyRules;
const scorer = globalThis.TolstoyScore;
const THRESHOLD = rules.THRESHOLD;

function score(text) {
  return scorer.scorePost(text).score;
}

function reasons(text) {
  return scorer.scorePost(text).reasons;
}

test("the rules file is data only, and every rule is complete", () => {
  assert.ok(Array.isArray(rules.RULES), "RULES is an array");
  assert.strictEqual(THRESHOLD, 0.5);
  const ids = new Set();
  for (const rule of rules.RULES) {
    assert.ok(typeof rule.id === "string" && rule.id.length > 0, "rule has an id");
    assert.ok(!ids.has(rule.id), "rule id is unique: " + rule.id);
    ids.add(rule.id);
    assert.ok(
      ["name-calling", "dehumanizing", "violence", "rage-bait"].includes(rule.category),
      "category is one of the four: " + rule.id
    );
    assert.ok(rule.pattern && typeof rule.pattern.type === "string", "rule has a pattern: " + rule.id);
    assert.ok(rule.weight >= 0 && rule.weight <= 1, "weight is 0 to 1: " + rule.id);
    assert.ok(typeof rule.reason === "string" && rule.reason.length > 0, "rule has a reason: " + rule.id);
    // A single rule must be able to reach the threshold on its own, or the rule
    // can never move anything.
    assert.ok(rule.weight >= THRESHOLD, "one match reaches the threshold on its own: " + rule.id);
  }
});

test("the score is 1 minus the product of (1 - weight)", () => {
  // "clowns" (0.6) and "clueless" (0.5) are both name-calling, one category.
  const text = "These clowns are clueless.";
  const expected = 1 - (1 - 0.6) * (1 - 0.5);
  assert.ok(Math.abs(score(text) - expected) < 1e-9, "score is the product form");
  assert.deepStrictEqual(reasons(text), ["Name-calling"], "one line per category, not per rule");
  assert.ok(score(text) <= 1 && score(text) >= 0, "score stays between 0 and 1");
});

test("each category has at least two examples at or above the threshold", () => {
  const examples = {
    "name-calling": [
      "Every one of these morons should be quiet for a minute.",
      "What an idiot. Honestly, what a clown."
    ],
    dehumanizing: [
      "These parasites are spreading through the neighbourhood.",
      "They are vermin and they should be treated as subhuman."
    ],
    violence: [
      "Someone should shoot them and be done with it.",
      "They deserve to be hurt for what they did."
    ],
    "rage-bait": [
      "YOU WILL NOT GUESS WHAT HAPPENED NEXT!!! I AM STILL SHAKING!!!",
      "You won't believe what this person did. Share before it's deleted."
    ]
  };

  for (const category of Object.keys(examples)) {
    for (const text of examples[category]) {
      const result = scorer.scorePost(text);
      assert.ok(result.score >= THRESHOLD, category + " scores at or above the threshold: " + text);
      const categories = rules.RULES.filter((r) => r.category === category).map((r) => r.reason);
      assert.ok(
        result.reasons.some((reason) => categories.includes(reason)),
        category + " reports its own reason: " + text
      );
    }
  }
});

// Six pairs of posts that take opposite sides of the same question, written in
// the same calm tone. Both halves must stay below the threshold. Then the same
// six pairs rewritten with insults: both halves must go above it.
const PAIRS = [
  {
    issue: "the new bike lane",
    calm: [
      "The new bike lane on our street is a good idea. It added three minutes to my drive and I would rather have the safer crossing.",
      "The new bike lane on our street is a mistake. Traffic now backs up to the light and I would rather the money went to the crossing by the school."
    ],
    heated: [
      "Only an idiot would oppose the bike lane. The people arguing against it are pathetic.",
      "Only a moron would support the bike lane. The people arguing for it are clueless."
    ]
  },
  {
    issue: "what time school starts",
    calm: [
      "I think school should start later. The evidence about sleep is worth taking seriously, and I say that as a parent who drives.",
      "I think school should start earlier. Families here need the afternoon, and I say that as a parent who drives."
    ],
    heated: [
      "Anyone who wants school to start earlier is a jackass.",
      "Anyone who wants school to start later is scum."
    ]
  },
  {
    issue: "whether the pool stays open",
    calm: [
      "The city should keep the pool open. My kids learned to swim there and it is the only one within walking distance.",
      "The city should close the pool. It costs more to run than it brings in, and the roof needs that money."
    ],
    heated: [
      "The people who want to close the pool are worthless.",
      "The people who want to keep the pool are stupid and greedy."
    ]
  },
  {
    issue: "the proposed rent rules",
    calm: [
      "The proposed rent rules would help the families on my block stay. Three of them left in a year.",
      "The proposed rent rules would hurt the small landlords on my block. Two of them sold to bigger companies."
    ],
    heated: [
      "Everyone defending landlords here is a dirtbag.",
      "Everyone pushing rent rules here is a loser and an imbecile."
    ]
  },
  {
    issue: "dogs in the east field",
    calm: [
      "Dogs should be allowed off the lead in the east field. It is fenced, and it is empty most mornings.",
      "Dogs should stay on the lead in the east field. Ground nesting birds are there and it is not empty in spring."
    ],
    heated: [
      "The dog owners who want the field are idiots.",
      "The people who want to ban dogs from the field are morons."
    ]
  },
  {
    issue: "library hours on Sunday",
    calm: [
      "The library should open on Sundays. It is the one quiet place left that does not cost anything.",
      "The library should stay closed on Sundays. The staff need the day and the numbers do not support it."
    ],
    heated: [
      "Anyone who votes against Sunday hours is a clown.",
      "Anyone who wants Sunday hours is an imbecile."
    ]
  }
];

test("viewpoint neutrality: opposite sides in a calm tone both stay below the threshold", () => {
  assert.ok(PAIRS.length >= 6, "at least six pairs");
  for (const pair of PAIRS) {
    for (const text of pair.calm) {
      const result = scorer.scorePost(text);
      assert.ok(result.score < THRESHOLD, "calm side stays below the threshold (" + pair.issue + "): " + result.score);
      assert.deepStrictEqual(result.reasons, [], "no reason is reported for a calm post (" + pair.issue + ")");
    }
  }
});

test("viewpoint neutrality: the same six pairs with insults both go above the threshold", () => {
  for (const pair of PAIRS) {
    for (const text of pair.heated) {
      const result = scorer.scorePost(text);
      assert.ok(result.score >= THRESHOLD, "insulting side crosses the threshold (" + pair.issue + "): " + result.score);
      assert.ok(result.reasons.includes("Name-calling"), "and the reason is about tone, not the question");
    }
  }
});

test("lookalike words do not trigger", () => {
  const lookalikes = [
    "This bug is killing me. Three restarts and it still crashes on save.",
    "The movie destroyed me (in a good way). I sat in the car afterwards for ten minutes.",
    "A parasite in biology class is usually much smaller than the drawing in the textbook.",
    "The rats in the alley behind the shop have learned how to open the bin."
  ];
  for (const text of lookalikes) {
    const result = scorer.scorePost(text);
    assert.deepStrictEqual(result.reasons, [], "no reason for: " + text);
    assert.ok(result.score < THRESHOLD, "stays below the threshold: " + text);
  }
});

test("empty and non-string input scores zero", () => {
  assert.deepStrictEqual(scorer.scorePost(""), { score: 0, reasons: [] });
  assert.deepStrictEqual(scorer.scorePost("   "), { score: 0, reasons: [] });
  assert.deepStrictEqual(scorer.scorePost(null), { score: 0, reasons: [] });
  assert.deepStrictEqual(scorer.scorePost(undefined), { score: 0, reasons: [] });
});
