// Tests for the reranker. node --test tests, no dependencies.
//
// The fixture is synthetic and fictional: 21 top-level entries, made of two
// cursors, one promoted entry, one conversation module, 12 calm posts, 4 heated
// posts and one tombstone, modelled on the shape described in
// docs/research-notes.md section 2.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
require(path.join(ROOT, "extension", "scoring", "rules.js"));
require(path.join(ROOT, "extension", "scoring", "rules-slurs.js"));
require(path.join(ROOT, "extension", "scoring", "score.js"));
require(path.join(ROOT, "extension", "adapters", "x", "rerank.js"));

const { rerankTimeline } = globalThis.TolstoyRerank;
const { scorePost } = globalThis.TolstoyScore;
const THRESHOLD = globalThis.TolstoyRules.THRESHOLD;

function fixture() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "home-timeline.json"), "utf8"));
}

function batchOf(json) {
  return json.data.home.home_timeline_urt.instructions.find((i) => i.type === "TimelineAddEntries").entries;
}

function ids(json) {
  return batchOf(json).map((entry) => entry.entryId);
}

function indexOf(json, entryId) {
  return ids(json).indexOf(entryId);
}

// A tiny response with one batch, for the cases the fixture does not cover.
function smallBatch(entries) {
  return {
    data: {
      home: { home_timeline_urt: { instructions: [{ type: "TimelineAddEntries", entries }] } }
    }
  };
}

function post(id, handle, text, sortIndex) {
  return {
    entryId: "tweet-" + id,
    sortIndex: sortIndex,
    content: {
      entryType: "TimelineTimelineItem",
      itemContent: {
        itemType: "TimelineTweet",
        tweet_results: {
          result: {
            __typename: "Tweet",
            rest_id: id,
            core: { user_results: { result: { core: { screen_name: handle } } } },
            legacy: { id_str: id, full_text: text }
          }
        }
      }
    }
  };
}

function cursor(id, type, sortIndex) {
  return {
    entryId: "cursor-" + type.toLowerCase() + "-" + id,
    sortIndex: sortIndex,
    content: { entryType: "TimelineTimelineCursor", cursorType: type, value: "TOKEN-" + type }
  };
}

function module_(id, innerIds, sortIndex) {
  return {
    entryId: "conversationthread-" + id,
    sortIndex: sortIndex,
    content: {
      entryType: "TimelineTimelineModule",
      displayType: "VerticalConversation",
      items: innerIds.map((inner) => ({
        entryId: "conversationthread-" + id + "-tweet-" + inner.id,
        item: {
          itemContent: {
            itemType: "TimelineTweet",
            tweet_results: {
              result: {
                __typename: "Tweet",
                rest_id: inner.id,
                core: { user_results: { result: { core: { screen_name: inner.handle } } } },
                legacy: { id_str: inner.id, full_text: inner.text }
              }
            }
          }
        }
      }))
    }
  };
}

test("the fixture is the shape the research notes describe", () => {
  const json = fixture();
  const entries = batchOf(json);
  assert.strictEqual(entries.length, 21, "21 top-level entries");
  assert.strictEqual(entries.filter((e) => e.entryId.startsWith("tweet-")).length, 17, "17 post entries");
  assert.strictEqual(entries.filter((e) => e.content.entryType === "TimelineTimelineCursor").length, 2, "two cursors");
  assert.strictEqual(entries.filter((e) => e.content.entryType === "TimelineTimelineModule").length, 1, "one module");
  assert.strictEqual(entries.filter((e) => e.entryId.startsWith("promoted-")).length, 1, "one promoted entry");
  assert.ok(entries.every((e) => typeof e.sortIndex === "string"), "every entry carries a sortIndex");
  const descending = entries.map((e) => BigInt(e.sortIndex));
  for (let i = 1; i < descending.length; i += 1) {
    assert.ok(descending[i - 1] > descending[i], "the fixture arrives in descending sortIndex order");
  }
});

test("nothing is lost and nothing is duplicated", () => {
  const before = fixture();
  const result = rerankTimeline(before, scorePost, THRESHOLD);
  const from = ids(before).slice().sort();
  const to = ids(result.json).slice().sort();
  assert.deepStrictEqual(to, from, "the same entry ids come out as went in");
  assert.strictEqual(ids(result.json).length, new Set(ids(result.json)).size, "no duplicates");
});

test("the original response is left alone", () => {
  const before = fixture();
  const snapshot = JSON.stringify(before);
  rerankTimeline(before, scorePost, THRESHOLD);
  assert.strictEqual(JSON.stringify(before), snapshot, "the input object is not mutated");
});

test("heated posts move after the calm ones, and four of them move", () => {
  const before = fixture();
  const result = rerankTimeline(before, scorePost, THRESHOLD);
  const entries = batchOf(result.json);

  assert.strictEqual(result.moved.length, 4, "four posts moved");
  const movedIds = result.moved.map((m) => m.id).sort();
  assert.deepStrictEqual(movedIds, ["1002", "1005", "1008", "1016"], "the four heated posts");

  for (const moved of result.moved) {
    assert.ok(moved.handle.length > 0, "a moved post carries its handle: " + moved.id);
    assert.ok(moved.text.length > 0 && moved.text.length <= 140, "and the first 140 characters: " + moved.id);
    assert.ok(moved.reasons.length > 0, "and at least one reason: " + moved.id);
  }

  const calm = ["1001", "1003", "1004", "1006", "1007", "1009", "1010", "1011", "1012", "1013", "1014", "1015", "1017"];
  const lastCalm = Math.max(...calm.map((id) => entries.findIndex((e) => e.entryId === "tweet-" + id)));
  const firstHeated = Math.min(...["1002", "1005", "1008", "1016"].map((id) => entries.findIndex((e) => e.entryId === "tweet-" + id)));
  assert.ok(firstHeated > lastCalm, "every heated post sits after every calm post inside the batch");
});

test("cursors and the promoted entry keep their places", () => {
  const before = fixture();
  const beforeIds = ids(before);
  const result = rerankTimeline(before, scorePost, THRESHOLD);
  const afterIds = ids(result.json);

  for (const entryId of ["cursor-top-999900", "cursor-bottom-999901", "promoted-tweet-5555-abcd"]) {
    assert.strictEqual(indexOf(result.json, entryId), beforeIds.indexOf(entryId), entryId + " did not move");
  }
  assert.strictEqual(afterIds[afterIds.length - 1], "cursor-bottom-999901", "the bottom cursor is still last");
  assert.strictEqual(afterIds[0], "cursor-top-999900", "the top cursor is still first");
});

test("the promoted entry is never scored", () => {
  const json = smallBatch([post("2001", "advertiser", "These parasites should be hanged, you won't believe it!!!", "300")]);
  // Make it promoted.
  json.data.home.home_timeline_urt.instructions[0].entries[0].content.itemContent.promotedMetadata = { advertiser_results: {} };
  const result = rerankTimeline(json, scorePost, THRESHOLD);
  assert.strictEqual(result.checked, 0, "nothing was checked");
  assert.deepStrictEqual(result.moved, [], "nothing moved");
});

test("after reranking, sortIndex still descends down the batch", () => {
  const result = rerankTimeline(fixture(), scorePost, THRESHOLD);
  const values = batchOf(result.json).map((entry) => BigInt(entry.sortIndex));
  for (let i = 1; i < values.length; i += 1) {
    assert.ok(values[i - 1] > values[i], "entry " + i + " is not above entry " + (i + 1));
  }
  const before = fixture();
  assert.deepStrictEqual(
    batchOf(result.json).map((e) => e.sortIndex).slice().sort(),
    batchOf(before).map((e) => e.sortIndex).slice().sort(),
    "the same sortIndex values are reused, biggest first"
  );
});

test("a conversation module moves as one unit, scored by its strongest post", () => {
  const json = smallBatch([
    cursor("1", "Top", "400"),
    post("3001", "calm_one", "The bakery leaves day-old bread in a basket by the door.", "399"),
    module_(
      "4000",
      [
        { id: "4001", handle: "calm_two", text: "Our building voted on the color for the stairwell." },
        { id: "4002", handle: "rude_one", text: "You are an idiot and a clown for disagreeing." }
      ],
      "398"
    ),
    post("3002", "calm_three", "Repotted the basil this morning.", "397"),
    cursor("2", "Bottom", "396")
  ]);
  const result = rerankTimeline(json, scorePost, THRESHOLD);
  const entries = batchOf(result.json);

  assert.strictEqual(result.moved.length, 1, "the module counts as one moved post");
  assert.strictEqual(result.moved[0].id, "4002", "the strongest post inside the module is the one described");
  assert.strictEqual(result.moved[0].handle, "rude_one");
  assert.ok(result.moved[0].reasons.includes("Name-calling"));

  const order = entries.map((e) => e.entryId);
  assert.deepStrictEqual(order, [
    "cursor-top-1",
    "tweet-3001",
    "tweet-3002",
    "conversationthread-4000",
    "cursor-bottom-2"
  ], "the module moved past the calm post but not past the cursor");
  assert.strictEqual(result.checked, 4, "every post inside the module is checked");
});

test("the two instructions of the fixture are both left as they were", () => {
  const result = rerankTimeline(fixture(), scorePost, THRESHOLD);
  const instructions = result.json.data.home.home_timeline_urt.instructions;
  assert.deepStrictEqual(instructions[0], { type: "TimelineTerminateTimeline", direction: "Bottom" });
  assert.strictEqual(instructions.length, 2);
});

test("malformed or unknown JSON comes back unchanged", () => {
  const inputs = [
    "not json at all",
    null,
    {},
    { data: null },
    { data: { home: {} } },
    { data: { home: { home_timeline_urt: { instructions: "not an array" } } } },
    { data: { home: { home_timeline_urt: { instructions: [] } } } },
    { data: { home: { home_timeline_urt: { instructions: [{ type: "TimelineAddEntries" }] } } } }
  ];
  for (const input of inputs) {
    const result = rerankTimeline(input, scorePost, THRESHOLD);
    assert.deepStrictEqual(result.json, input, "returned unchanged: " + JSON.stringify(input));
    assert.deepStrictEqual(result.moved, [], "nothing moved: " + JSON.stringify(input));
    assert.strictEqual(result.checked, 0, "nothing checked: " + JSON.stringify(input));
  }
  const text = "not json at all";
  assert.strictEqual(rerankTimeline(text, scorePost, THRESHOLD).json, text, "the same object comes back");
});

test("an unknown entry type is passed through untouched", () => {
  const json = smallBatch([
    post("5001", "calm", "A calm first post.", "600"),
    {
      entryId: "who-to-follow-8000",
      sortIndex: "599",
      content: { entryType: "TimelineTimelineModule", displayType: "Vertical", items: [] }
    },
    post("5002", "rude", "What an idiot.", "598")
  ]);
  const result = rerankTimeline(json, scorePost, THRESHOLD);
  const order = batchOf(result.json).map((e) => e.entryId);
  assert.deepStrictEqual(order, ["tweet-5001", "who-to-follow-8000", "tweet-5002"], "the empty module keeps its place");
  assert.strictEqual(result.moved.length, 1);
});

test("at a threshold above 1 nothing moves", () => {
  const before = fixture();
  const result = rerankTimeline(before, scorePost, 1.01);
  assert.deepStrictEqual(ids(result.json), ids(before), "the order is untouched");
  assert.deepStrictEqual(result.moved, [], "nothing moved");
  assert.ok(result.checked > 0, "posts were still checked");
});

test("the default threshold is Balanced (0.5)", () => {
  const before = fixture();
  const withDefault = rerankTimeline(before, scorePost);
  const explicit = rerankTimeline(fixture(), scorePost, 0.5);
  assert.deepStrictEqual(ids(withDefault.json), ids(explicit.json));
  assert.strictEqual(THRESHOLD, 0.5);
});

test("a batch that cannot be renumbered is left exactly as it was, with nothing reported", () => {
  // One entry carries a numeric sortIndex, so renumber() would fail. A reordered
  // batch that X would not read in the new order is worse than an unchanged one.
  const json = smallBatch([
    cursor("1", "Top", "400"),
    post("5001", "calm_one", "Repotted the basil this morning.", 399),
    post("5002", "rude_one", "You are an idiot and a clown.", "398"),
    cursor("2", "Bottom", "397")
  ]);
  const before = JSON.parse(JSON.stringify(json));
  const result = rerankTimeline(json, scorePost, THRESHOLD);

  assert.deepStrictEqual(result.json, before, "the batch comes back untouched");
  assert.strictEqual(result.checked, 0, "nothing is reported for a batch Tolstoy left alone");
  assert.deepStrictEqual(result.moved, [], "nothing moved");
});

test("a batch with no sortIndex at all is left alone too", () => {
  const json = smallBatch([
    post("5003", "calm_two", "The cat approved of the plan.", undefined),
    post("5004", "rude_two", "You are a moron.", undefined)
  ]);
  const before = JSON.parse(JSON.stringify(json));
  const result = rerankTimeline(json, scorePost, THRESHOLD);
  assert.deepStrictEqual(result.json, before);
  assert.strictEqual(result.checked, 0);
});

// ------------------------------------------------------------------- reply pages
// The TweetDetail fixture: one conversation module holding the post being replied
// to (1990), the focal post (2000), five replies, a promoted entry, plus a bottom
// cursor, a pin entry for the focal post, and a second batch of later replies.

function replyFixture() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "tweet-detail.json"), "utf8"));
}

function instructionsOf(json) {
  return json.data.threaded_conversation_with_injections_v2.instructions;
}

function firstBatch(json) {
  return instructionsOf(json).find((i) => i.type === "TimelineAddEntries").entries;
}

function moduleOf(json) {
  const entry = firstBatch(json).find((e) => e.entryId.indexOf("conversationthread-") === 0);
  return entry.content.items;
}

function idsOf(list) {
  return list.map((entry) => entry.entryId);
}

function positions(list, wanted) {
  return idsOf(list).map((id, index) => (wanted.indexOf(id) === -1 ? null : index)).filter((index) => index !== null);
}

test("the reply fixture is the shape the research notes describe", () => {
  const json = replyFixture();
  assert.strictEqual(instructionsOf(json).length, 3);
  assert.ok(moduleOf(json).length === 8, "the module holds the ancestor, the focal post, five replies and one promoted entry");
  assert.strictEqual(moduleOf(json)[1].entryId, "tweet-2000", "the focal post sits inside the module");
  assert.ok(firstBatch(json).some((e) => e.entryId.indexOf("cursor-bottom") === 0));
  assert.strictEqual(instructionsOf(json)[1].type, "TimelinePinEntry");
  console.log("  module items:", idsOf(moduleOf(json)).join(", "));
});

test("a reply page loses nothing and duplicates nothing", () => {
  const before = replyFixture();
  const result = rerankTimeline(before, scorePost, THRESHOLD);
  const flat = (json) => {
    const out = [];
    for (const instruction of instructionsOf(json)) {
      if (instruction.type === "TimelineAddEntries") {
        for (const entry of instruction.entries) {
          out.push(entry.entryId);
          if (entry.content.items) {
            for (const item of entry.content.items) out.push(item.entryId);
          }
        }
      } else if (instruction.entry) {
        out.push(instruction.entry.entryId);
      }
    }
    return out.sort();
  };
  assert.deepStrictEqual(flat(result.json), flat(before));
});

test("the focal post and the thread above it stay where X put them", () => {
  const result = rerankTimeline(replyFixture(), scorePost, THRESHOLD);
  const items = moduleOf(result.json);
  assert.strictEqual(items[0].entryId, "tweet-1990", "the post being replied to is still first");
  assert.strictEqual(items[1].entryId, "tweet-2000", "the focal post is still second");
  assert.strictEqual(instructionsOf(result.json)[1].type, "TimelinePinEntry");
  assert.strictEqual(instructionsOf(result.json)[1].entry.entryId, "tweet-2000");
});

test("heated replies move to the end of the replies, calm ones keep their order", () => {
  const result = rerankTimeline(replyFixture(), scorePost, THRESHOLD);
  const items = idsOf(moduleOf(result.json));
  // Replies: 2001 calm, 2002 heated, promoted 7777 (untouched), 2003 calm, 2004 heated, 2005 calm
  assert.deepStrictEqual(items.slice(0, 2), ["tweet-1990", "tweet-2000"]);
  const calmPositions = positions(moduleOf(result.json), ["tweet-2001", "tweet-2003", "tweet-2005"]);
  const heatedPositions = positions(moduleOf(result.json), ["tweet-2002", "tweet-2004"]);
  assert.ok(Math.max(...calmPositions) < Math.min(...heatedPositions), "every calm reply comes before every heated reply");
  assert.deepStrictEqual(
    moduleOf(result.json).filter((i) => ["tweet-2002", "tweet-2004"].indexOf(i.entryId) !== -1).map((i) => i.entryId),
    ["tweet-2002", "tweet-2004"],
    "the heated replies keep their relative order"
  );
  console.log("  module after reranking:", items.join(", "));
  console.log("  moved:", result.moved.map((m) => m.id + " " + m.handle + " [" + m.reasons.join(", ") + "]").join(" | "));
});

test("cursors, the promoted entry and the pin entry keep their places", () => {
  const before = replyFixture();
  const result = rerankTimeline(before, scorePost, THRESHOLD);
  const batch = firstBatch(result.json);
  assert.strictEqual(batch[batch.length - 1].entryId, "cursor-bottom-2000", "the bottom cursor is still last");
  const promotedIndex = idsOf(moduleOf(before)).indexOf("promoted-tweet-7777-abcd");
  const promotedIndexAfter = idsOf(moduleOf(result.json)).indexOf("promoted-tweet-7777-abcd");
  assert.strictEqual(promotedIndexAfter, promotedIndex, "the promoted entry is where X put it");
  assert.ok(!result.moved.some((m) => m.id === "7777"), "the promoted entry was never scored");
});

test("sortIndex still descends inside the module and inside the batch", () => {
  const result = rerankTimeline(replyFixture(), scorePost, THRESHOLD);
  const descending = (list) => list.map((e) => e.sortIndex).map(BigInt).every((v, i, all) => i === 0 || all[i - 1] > v);
  assert.ok(descending(moduleOf(result.json)), "module items descend by sortIndex");
  assert.ok(descending(firstBatch(result.json)), "the batch descends by sortIndex");
});

test("a later page of replies is scored too, because the focal post is gone", () => {
  const result = rerankTimeline(replyFixture(), scorePost, THRESHOLD);
  const later = instructionsOf(result.json)[2].entries;
  assert.deepStrictEqual(idsOf(later), ["tweet-3001", "tweet-3002", "cursor-bottom-3000"], "the heated reply moved to the end of that page");
  assert.ok(result.moved.some((m) => m.id === "3002"));
});

test("a reply page with no focal post anywhere is left alone", () => {
  const json = replyFixture();
  const instructions = instructionsOf(json);
  instructions[0].entries[0].entryId = "conversationthread-9999";
  const before = JSON.stringify(json);
  const result = rerankTimeline(JSON.parse(before), scorePost, THRESHOLD);
  const items = moduleOf(result.json).map((i) => i.entryId);
  assert.deepStrictEqual(items, moduleOf(JSON.parse(before)).map((i) => i.entryId), "the module is untouched");
});

test("malformed or unknown reply JSON comes back unchanged", () => {
  const cases = [
    null,
    {},
    { data: {} },
    { data: { threaded_conversation_with_injections_v2: {} } },
    { data: { threaded_conversation_with_injections_v2: { instructions: "no" } } },
    { data: { threaded_conversation_with_injections_v2: { instructions: [{ type: "TimelineAddEntries", entries: [{ entryId: "tweet-1" }] }] } } }
  ];
  for (const value of cases) {
    const result = rerankTimeline(value, scorePost, THRESHOLD);
    assert.deepStrictEqual(result.json, value);
    assert.deepStrictEqual(result.moved, []);
  }
});

test("at a threshold above 1 nothing moves on a reply page either", () => {
  const before = replyFixture();
  const result = rerankTimeline(before, scorePost, 1.01);
  assert.deepStrictEqual(idsOf(moduleOf(result.json)), idsOf(moduleOf(before)));
  assert.deepStrictEqual(result.moved, []);
  assert.ok(result.checked > 0, "replies were still checked");
});
