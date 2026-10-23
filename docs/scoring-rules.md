# Tolstoy scoring rules, in plain words

Tolstoy lowers posts that are written to make you angry at a person or a group.
It never deletes anything, and it never looks at which view a post takes. This
page explains every rule, so you can check the work yourself. The rules
themselves live in [`extension/scoring/rules.js`](../extension/scoring/rules.js),
and the words below match that file.

## One idea holds it together

**A post moves only when hostility is aimed at a person or a group.** Tone
markers on their own never move a post at Balanced. Several stacked together can.

That single idea is why "the way this factory treats its workers is appalling"
stays where it is (anger at a situation, nobody insulted), and "you are such an
idiot" moves down (anger at a person).

## Two kinds of rule

| Kind | What it is | Weight | Can it move a post alone? |
| --- | --- | --- | --- |
| Targeted | It names who the hostility is aimed at: you, he, she, they, these people, people like you, an @handle, or a plural insult used as a noun for people | 0.6 to 0.9 | Yes |
| Amplifier | A tone marker with no target: shouting, "!!!" runs, shock words, hook phrases, weak untargeted insults | 0.2 each | No, never |

Every targeted rule names its target inside the pattern itself, so "clown" alone
never fires, while "these clowns" does.

## The four categories

| Category | What it catches | What you see |
| --- | --- | --- |
| Name-calling | insults aimed at a person or a group: idiot, moron, imbecile, clown, jackass, dirtbag, loser, scumbag, fool, baboon | "Name-calling" |
| Dehumanizing | people described as vermin, parasites, cockroaches, leeches, rats, animals, filth, a disease, a plague, or less than human | "Talks about people as less than human" |
| Violence | calls to hurt, kill, shoot, hang, beat, cull or get rid of people | "Calls for harm" |
| Rage bait | tone markers only: mostly capitals, runs of "!!!", "you won't believe", "DESTROYED" used as a hook, "disgusting" used as a hook | "Written to make you angry" |

That is the whole list. There is no rule about a party, a politician, an
ideology, a country, a religion, or a political question, and there never will
be. A test in [`tests/score.test.js`](../tests/score.test.js) checks the rule
file for those words every time the tests run.

## The targeted rules, in full

**Name-calling**, weight 0.6 to 0.7. Each pattern names its target:

- "you are such an idiot", "you lot are a bunch of clowns" (`you're` and
  `you are` both count, and one describing word is allowed, so "you are a lazy
  idiot" counts too)
- "he is an idiot", "she is a moron", "they are a bunch of morons"
- "what an idiot", "what a clown"
- "@someone is a clown"
- "idiots like you", "clowns like him", "morons like them"
- "all of these clowns", "those idiots", "every one of these morons"
- "these people are idiots", "the people defending them are morons"
- "cat people are losers", "dog owners are a bunch of morons", "evening runners
  are clowns": a group named by a people word. "we are idiots" is left alone on
  purpose, because being hard on yourself is not hostility at someone else

**Dehumanizing**, weight 0.8 to 0.85:

- "these people are vermin", "you people are parasites", "people like them are
  a plague", "they are animals"
- "they are vermin", "you are parasites", "he is filth"
- "these vermin", "those cockroaches", "you parasites"
- "cull them", "exterminate them", "wipe them out"
- "subhuman" stands alone, because the word has no other use

The words that are also used about real animals (animals, rats, pests, leeches)
only count when the sentence names who they are about. "These animals need
homes" is not this. "These people are animals" is.

**Violence**, weight 0.85 to 0.9:

- "they should be hanged", "he should be shot", "these people should be killed",
  "they should all be shot"
- "they deserve to be shot", "he deserves to be beaten"
- "someone should kill him", "kill them all", "hang them all"
- "they deserve to die", "I hope you get hurt", "death to", "go die"
- "smash his face in", "want to see them hurt"

The bare forms are deliberately **not** rules: "hang them", "shoot them", "get
rid of them", "these people" on its own, "animals who", "spreading like",
"infecting", "locusts", "clown" or "stupid" with no target. A picture frame is
not a person, and neither is a message you shoot to a friend.

## The amplifiers, in full

0.2 each, and never more:

- mostly capitals: at least 12 letters and at least 70 percent of them capital,
  with links and handles removed first
- three or more exclamation marks in a row
- the shock words disgusting, outrageous, appalling, vile, repulsive, sickening
- the hook phrases "you won't believe", "share before", "before it's deleted",
  "nobody is talking about", "look what they did", "everyone needs to see"
- the shouty words DESTROYED, OBLITERATED, WRECKED, EXPOSED, matched only in
  capitals on purpose, because "the movie destroyed me" is not rage bait
- the weak insults stupid, pathetic, worthless, clueless, disgraceful,
  brainless, idiotic, which have no target and so count 0.2

You can add these up yourself. With a weight of 0.2 each:

| Amplifiers | Score |
| --- | --- |
| one | 0.2 |
| two | 0.36 |
| three | 0.488 |
| four | 0.59 |

## How the score is worked out

Each rule that matches has a weight between 0 and 1. The score is

```
score = 1 - (1 - w1) x (1 - w2) x ... for every rule that matched
```

so the score is always between 0 and 1, and two mild matches do not add up to a
strong one. One targeted rule is always enough: the weakest of them scores 0.6.

## The three temperatures

| Setting | Threshold | What it means in practice |
| --- | --- | --- |
| Calm | 0.45 | Three stacked tone markers are enough, or any targeted rule. A busier feed. |
| Balanced | 0.5 | The default. Four stacked tone markers, or any targeted rule. |
| Unfiltered | above 1 | Nothing moves and nothing is blurred. The banner still counts what it saw. |

Moved posts go to the end of the batch they arrived in, in the same order they
had, and the "Show them" list names every one of them with its reason. In blur
mode nothing moves at all: each heated post is softened in place, behind a soft
veil, with a "Show anyway" button.

## What Tolstoy deliberately does not do

- It does not score who wrote a post, only the text of the post.
- It does not use a party, a politician, a country, a religion, or any political
  question as a signal, in either direction.
- It does not send anything anywhere. Scoring happens on your computer, in the
  page, and moved posts are forgotten when you close the tab.
- It does not touch ads. Promoted posts are left exactly where X put them, and
  they are never scored.
- If a batch of posts has a shape Tolstoy does not recognise, it hands X exactly
  what X sent. A feed that loads is worth more than a clever rule.

## How the rules are judged

[`tests/fixtures/eval-set.json`](../tests/fixtures/eval-set.json) holds 77 calm
posts and 56 heated posts, all fictional, including six pairs that take opposite
sides of the same everyday question in the same calm tone. The tests hold two
bars: at Balanced, no calm post moves and at least 85 percent of heated posts do;
at Calm, at most two calm posts move and at least 90 percent of heated posts do.
The same file will judge the local AI scorer in a later task.

## Known limits, stated plainly

These rules are readable on purpose, so they miss things and they can be wrong:

- A post that insults someone while making a fair point still moves down. That is
  the cost of scoring tone rather than truth.
- Sarcasm and coded language are hard for any word list, and this is a word list.
- A post about actual vermin, or a genuinely furious post about a real harm, can
  look like dehumanizing language or rage bait. The "Show them" list exists so you
  can see it and judge for yourself.
- Tolstoy only reorders inside the batch of posts X has already sent to the page,
  so a post cannot move from one batch into another.
- A post that arrives before your settings do is scored at Balanced, and
  corrected as soon as the settings arrive.

If you think a rule is wrong, the file is short and public. Open an issue with
the text that was scored wrongly, and we will look at it.

## The slur list, and where it came from

Slurs are the one rule that needs no target pattern: a slur is hostile whatever it is aimed
at. The rule carries weight 0.9 and the reason "Uses a slur", and lives in its own file,
`extension/scoring/rules-slurs.js`, so it can be read, reviewed and shipped apart from the
ordinary rules. That file opens with a content note, because it lists the words themselves.

The list is drawn from two places:

- **[LDNOOBW](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words)**,
  the List of Dirty, Naughty, Obscene and Otherwise Bad Words, licensed **CC BY 4.0**. Only the
  entries that target a person for who they are were kept: race, ethnicity, nationality,
  religion, sexual orientation, gender identity, or disability. Every sexual, scatological or
  generic profanity entry was dropped.
- **Written for this project**, for the identity slurs LDNOOBW is missing. That set is
  published under the same licence as the rest of Tolstoy.

Common letter swaps are matched, so `f@ggot`, `f4ggot` and `f*ggot` are caught alongside the
plain spelling. Ordinary profanity ("fucking", "damn", "shit"), general insults that
name-calling already covers ("idiot", "moron", "clown"), and gendered insults that are also
everyday swearing ("bitch", "whore", "cunt", "slut") are deliberately **not** in this list:
they do not move a post on their own. Aimed at a person, the name-calling rules catch them;
used as a slur against a group, the on-device model does.

This does not weaken the hard rule against political words. A slur says something about how
something is said, not about which side anyone is on, and this list names no party, politician,
ideology, country, religion, or political question.
