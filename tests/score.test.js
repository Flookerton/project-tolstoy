// Tests for the published rules and the scorer.
//
// Run with `node --test` from the repository root. No dependencies.
//
// The bars these tests hold, from Task 3 Part F:
//   Balanced (0.5): no calm item moves, and at least 85% of heated items move.
//   Calm (0.45):    at most two calm items move, and at least 90% of heated
//                   items move.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const rules = require("../extension/scoring/rules.js");
const score = require("../extension/scoring/score.js");

const evalSet = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "eval-set.json"), "utf8"));

const THRESHOLDS = rules.THRESHOLDS;
const calmItems = evalSet.items.filter((item) => item.label === "calm");
const heatedItems = evalSet.items.filter((item) => item.label === "heated");
const pairCalm = evalSet.pairs.flatMap((pair) => pair.calm.map((text) => ({ text, pair: pair.id })));
const pairHeated = evalSet.pairs.flatMap((pair) => pair.heated.map((text) => ({ text, pair: pair.id })));

const allCalm = calmItems.map((item) => item.text).concat(pairCalm.map((item) => item.text));
const allHeated = heatedItems.map((item) => item.text).concat(pairHeated.map((item) => item.text));

const scoreOf = (text) => score.scorePost(text).score;

// ------------------------------------------------------------------ the bars

test("no calm post moves at Balanced, and the heated posts are caught", () => {
  const calmFlagged = allCalm.filter((text) => scoreOf(text) >= THRESHOLDS.balanced);
  const heatedCaught = allHeated.filter((text) => scoreOf(text) >= THRESHOLDS.balanced);
  const rate = heatedCaught.length / allHeated.length;

  console.log(`  Balanced (${THRESHOLDS.balanced}): calm items flagged ${calmFlagged.length} of ${allCalm.length}`);
  console.log(`  Balanced (${THRESHOLDS.balanced}): heated items caught ${heatedCaught.length} of ${allHeated.length} (${Math.round(rate * 100)}%)`);
  calmFlagged.forEach((text) => console.log("    calm flagged:", scoreOf(text).toFixed(3), text.slice(0, 90)));
  allHeated
    .filter((text) => scoreOf(text) < THRESHOLDS.balanced)
    .forEach((text) => console.log("    heated missed at Balanced:", scoreOf(text).toFixed(3), text.slice(0, 90)));

  assert.strictEqual(calmFlagged.length, 0, "no calm post may move at Balanced");
  assert.ok(rate >= 0.85, `heated catch rate at Balanced was ${Math.round(rate * 100)}%, below 85%`);
});

test("at Calm at most two calm posts move, and nearly every heated post is caught", () => {
  const calmFlagged = allCalm.filter((text) => scoreOf(text) >= THRESHOLDS.calm);
  const heatedCaught = allHeated.filter((text) => scoreOf(text) >= THRESHOLDS.calm);
  const rate = heatedCaught.length / allHeated.length;

  console.log(`  Calm (${THRESHOLDS.calm}): calm items flagged ${calmFlagged.length} of ${allCalm.length}`);
  console.log(`  Calm (${THRESHOLDS.calm}): heated items caught ${heatedCaught.length} of ${allHeated.length} (${Math.round(rate * 100)}%)`);
  calmFlagged.forEach((text) => console.log("    calm flagged:", scoreOf(text).toFixed(3), text.slice(0, 90)));

  assert.ok(calmFlagged.length <= 2, `at most two calm posts may move at Calm, ${calmFlagged.length} did`);
  assert.ok(rate >= 0.9, `heated catch rate at Calm was ${Math.round(rate * 100)}%, below 90%`);
});

test("the evaluation set is big enough to mean something", () => {
  console.log(`  calm ${allCalm.length} items, heated ${allHeated.length} items, ${evalSet.pairs.length} viewpoint pairs`);
  assert.ok(allCalm.length >= 60, `the calm set needs at least 60 items, it has ${allCalm.length}`);
  assert.ok(allHeated.length >= 40, `the heated set needs at least 40 items, it has ${allHeated.length}`);
  assert.ok(evalSet.pairs.length >= 6, `there need to be at least 6 viewpoint pairs, there are ${evalSet.pairs.length}`);
});

// ------------------------------------------------- every category has examples

test("each category has at least two examples that move a post", () => {
  const categories = ["name-calling", "dehumanizing", "violence", "rage-bait"];
  for (const category of categories) {
    const examples = allHeated.filter((text) => {
      if (scoreOf(text) < THRESHOLDS.balanced) {
        return false;
      }
      return score.matchedRules(text).some((id) => {
        const rule = rules.RULES.find((candidate) => candidate.id === id);
        return rule && rule.category === category;
      });
    });
    console.log(`  ${category}: ${examples.length} heated examples move on this category alone or with others`);
    assert.ok(examples.length >= 2, `the ${category} category needs at least two examples, it has ${examples.length}`);
  }
});

test("every targeted rule has a target and every amplifier is weak", () => {
  const targeted = rules.RULES.filter((rule) => rule.kind === "targeted");
  const amplifiers = rules.RULES.filter((rule) => rule.kind === "amplifier");

  assert.ok(targeted.length >= 8, "there should be a good number of targeted rules");
  assert.ok(amplifiers.length >= 5, "there should be several amplifiers");

  for (const rule of targeted) {
    assert.ok(rule.weight >= 0.6 && rule.weight <= 0.9, `${rule.id} should weigh between 0.6 and 0.9, it weighs ${rule.weight}`);
  }
  for (const rule of amplifiers) {
    assert.strictEqual(rule.weight, 0.2, `${rule.id} is an amplifier, so it must weigh 0.2`);
  }
});

test("the amplifier arithmetic in the rules file is right", () => {
  // One, two, three and four amplifiers, at 0.2 each.
  const expected = { 1: 0.2, 2: 0.36, 3: 0.488, 4: 0.59 };
  for (const [count, value] of Object.entries(expected)) {
    const total = 1 - Math.pow(1 - 0.2, Number(count));
    assert.ok(Math.abs(total - value) < 0.0005, `${count} amplifiers should score ${value}, they score ${total}`);
    console.log(`  ${count} amplifiers -> ${total.toFixed(3)}`);
  }
  const post = "honestly disgusting!!! share before it's deleted!!!";
  const markers = score.matchedRules(post).length;
  console.log(`  "${post.slice(0, 40)}..." matched ${markers} amplifiers and scores ${scoreOf(post).toFixed(3)}`);
  assert.strictEqual(markers, 3, "this post should stack three amplifiers");
  assert.ok(scoreOf(post) < THRESHOLDS.balanced && scoreOf(post) >= THRESHOLDS.calm, "three amplifiers should move only at Calm");
});

// ----------------------------------------------------- viewpoint neutrality

test("viewpoint neutrality: both sides of six issues stay calm, and insulting either side still moves it", () => {
  for (const pair of evalSet.pairs) {
    for (const text of pair.calm) {
      const value = scoreOf(text);
      console.log(`  calm side, ${pair.id}: ${value.toFixed(3)} | ${text.slice(0, 60)}`);
      assert.ok(value < THRESHOLDS.balanced, `a calm post about ${pair.issue} scored ${value.toFixed(3)}`);
    }
    for (const text of pair.heated) {
      const value = scoreOf(text);
      console.log(`  insulting side, ${pair.id}: ${value.toFixed(3)} | ${text.slice(0, 60)}`);
      assert.ok(value >= THRESHOLDS.balanced, `an insulting post about ${pair.issue} scored only ${value.toFixed(3)}`);
    }
  }
});

// ------------------------------------------------------------- lookalikes

test("lookalike words do not trigger", () => {
  const lookalikes = [
    "this bug is killing me",
    "the movie destroyed me (in a good way)",
    "a parasite in biology class",
    "the spider plant is spreading everywhere",
    "I am dying to see the new season",
    "that goal was a killer",
    "we shot the whole wedding on film",
    "hang the washing out before the rain comes",
    "shoot me a text when you land",
    "this workout is brutal, my legs are dead",
    "the printer is a beast today",
    "I could murder a cup of tea",
    "get rid of the old paint tins at the tip",
    "the mosquitoes are out in force tonight"
  ];
  for (const text of lookalikes) {
    const value = scoreOf(text);
    const ids = score.matchedRules(text);
    console.log(`  ${value.toFixed(3)} | ${ids.join(",") || "nothing"} | ${text}`);
    assert.ok(value < THRESHOLDS.balanced, `"${text}" scored ${value.toFixed(3)}`);
  }
});

// --------------------------------------------------- the Task 3 review list

test("the fifteen posts from the Task 3 review do not move", () => {
  // The orchestrator's table listed fifteen posts and called them seventeen.
  // Every row of that table is here.
  const review = [
    "I love these people so much, best team ever",
    "News of the bake sale is spreading like wildfire",
    "Got new frames for the photos, going to hang them this weekend",
    "Ants in the kitchen again, how do I get rid of them?",
    "Shoot them a message if you want to join the hike",
    "Took the kids to see the clowns at the circus",
    "My stupid printer jammed again",
    "I felt so stupid forgetting my own birthday",
    "Rescued animals who need homes: meet Biscuit",
    "The way this factory treats its workers is appalling",
    "Animal cruelty is disgusting. Please adopt, do not shop.",
    "Locusts are fascinating insects, here is a thread",
    "HAPPY BIRTHDAY GRANDMA, WE LOVE YOU",
    "We won the championship!!!",
    "The virus is infecting cells faster than expected, new study"
  ];
  for (const text of review) {
    const value = scoreOf(text);
    console.log(`  ${value.toFixed(3)} | ${text.slice(0, 80)}`);
    assert.ok(value < THRESHOLDS.balanced, `"${text}" scored ${value.toFixed(3)}`);
  }
});

// ------------------------------------------------------------- plain sense

test("an ordinary post scores nothing", () => {
  const ordinary = [
    "Took the long way home past the community garden.",
    "The cat approved of the plan.",
    "Read slowly.",
    ""
  ];
  for (const text of ordinary) {
    assert.strictEqual(scoreOf(text), 0, `"${text}" should score 0`);
  }
});

test("the reasons are plain sentences, one per category", () => {
  const result = score.scorePost("You are such an idiot and these people are vermin");
  assert.ok(result.score >= THRESHOLDS.balanced);
  assert.deepStrictEqual(result.reasons, ["Name-calling", "Talks about people as less than human"]);
});

// ------------------------------------------------------ no political wording

test("no rule mentions a party, a politician, an ideology, a country, a religion or a political topic", () => {
  // Comments are allowed to name the thing the rules must never name, so only
  // the code itself is scanned.
  const source = fs
    .readFileSync(path.join(__dirname, "..", "extension", "scoring", "rules.js"), "utf8")
    .replace(/^\s*\/\/.*$/gm, "");
  const banned = [
    "democrat", "republican", "labour", "tory", "gop", "liberal", "conservative", "leftist",
    "left-wing", "right-wing", "marxist", "fascist", "socialist", "communist", "anarchist",
    "biden", "trump", "harris", "putin", "election", "senator", "parliament", "congress",
    "immigration", "immigrant", "migrant", "brexit", "referendum",
    "religion", "religious", "church", "mosque", "synagogue", "temple", "muslim", "christian",
    "jewish", "hindu", "islam", "buddhist", "atheist", "clergy", "priest", "imam", "rabbi",
    "abortion", "vaccine", "vaccination", "climate", "global warming", "pandemic",
    "israel", "palestine", "ukraine", "russia", "china", "america", "britain", "india",
    "westminster", "white house", "kremlin"
  ];
  const lower = source.toLowerCase();
  // Word boundaries, so "tory" does not fire inside "history" or "story".
  const found = banned.filter((word) => new RegExp("\\b" + word.replace(/[-\s]/g, "[-\\s]") + "\\b").test(lower));
  console.log(`  checked ${banned.length} words against extension/scoring/rules.js, found: ${found.length ? found.join(", ") : "none"}`);
  assert.deepStrictEqual(found, [], `rules.js mentions political wording: ${found.join(", ")}`);
});

test("an anti-audience post and a pro-audience post on the same topic score the same", () => {
  // The scorer looks at tone, never at the view. Same shape, opposite views.
  const forOne = "These people are idiots for supporting the plan.";
  const againstOne = "These people are idiots for opposing the plan.";
  assert.strictEqual(scoreOf(forOne), scoreOf(againstOne));
  console.log(`  both score ${scoreOf(forOne).toFixed(3)}: the shape is scored, not the side`);
});
