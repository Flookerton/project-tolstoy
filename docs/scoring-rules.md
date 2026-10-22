# Tolstoy scoring rules, in plain words

Tolstoy lowers posts that are written to make you angry. It never deletes
anything, and it never looks at which view a post takes. This page explains
every rule, so you can check the work yourself. The rules themselves live in
[`extension/scoring/rules.js`](../extension/scoring/rules.js), and the words
below match that file line for line.

## The four things Tolstoy looks at

| Category | What it catches | What you see |
| --- | --- | --- |
| Name-calling | insults aimed at a person or a group, such as idiot, moron, scum, clown | "Name-calling" |
| Dehumanizing | people described as animals, pests, or disease | "Talks about people as less than human" |
| Violence | calls to hurt, hang, shoot, or get rid of people | "Calls for harm" |
| Rage bait | mostly capitals, runs of exclamation marks, "you won't believe", "DESTROYED" used as a hook | "Written to make you angry" |

That is the whole list. There is no rule about a party, a politician, an
ideology, a country, a religion, or a political question, and there never will
be. If a rule like that were added, it would break the promise the project is
built on.

## The rules

**Name-calling**, weight 0.6 and 0.5. Two word lists. The stronger list is
idiot, moron, imbecile, scum, clown, jackass, dirtbag. The milder list is
stupid, pathetic, loser, garbage human, worthless, clueless. A word matches on
whole words and the plain plural, so "clowns" counts and a longer unrelated word
does not.

**Dehumanizing**, weight 0.75, 0.65 and 0.65. First, the words that are almost
never used about animals in a news sense: vermin, subhuman, parasites,
cockroaches, locusts, "animals who", "a plague of". Second, the same kind of
word when it follows "these" or "those" and is pointed at a group: "these rats",
"those people". Third, phrases that turn a group into a disease: "like a
disease", "spreading like", "infecting", "infestation of", "breed like".
The plural matters here on purpose: a parasite in a biology class is not this.

**Violence**, weight 0.85 and 0.7. The stronger list is aimed at a person or a
group: "should be killed", "should be shot", "should be hanged", "kill them",
"hang them", "shoot them", "death to", "go die", "deserve to die", "get rid of
them". The milder list is "beat him up", "punch her", "smash his face", "run
them over". "This bug is killing me" does not match, because the phrase has to
be aimed at a person.

**Rage bait**, weight 0.5 each. Five rules, all about the shape of a post rather
than its words:

- mostly capitals, measured only when a post has at least 12 letters and at
  least 70 percent of them are capitals, with links and handles removed first;
- three or more exclamation marks in a row;
- the hooks "you won't believe", "share before", "before it's deleted",
  "nobody is talking about", "look what they did", "everyone needs to see";
- the shock words disgusting, outrageous, appalling, vile;
- the shouty words DESTROYED, OBLITERATED, WRECKED and EXPOSED, matched only in
  capitals on purpose, because "the movie destroyed me" is not rage bait.

## How the score is worked out

Each rule that matches has a weight between 0 and 1. The score is

```
score = 1 - (1 - w1) x (1 - w2) x ... for every rule that matched
```

so the score is always between 0 and 1, and two mild matches do not add up to a
strong one. A single strong match is enough: name-calling alone scores 0.6.

The default setting, shown in Tolstoy as **Balanced**, moves a post down when its
score is 0.5 or higher. One mild rule reaches it exactly. Nothing is removed:
moved posts go to the end of the batch they arrived in, and the "Show them" list
names every one of them with the reason.

## What Tolstoy deliberately does not do

- It does not score who wrote a post, only the text of the post.
- It does not use a party, a politician, a country, a religion, or any political
  question as a signal, in either direction.
- It does not send anything anywhere. Scoring happens on your computer, in the
  page, and moved posts are forgotten when you close the tab.
- It does not touch ads. Promoted posts are left exactly where X put them.

## Known limits, stated plainly

These rules are readable on purpose, so they miss things and they can be wrong:

- A calm post can be lowered if it shouts or insults someone, even when it makes
  a fair point. That is a cost of scoring tone.
- A post about actual rats, or a genuinely furious post about a real harm, can
  look like dehumanizing language or rage bait. The "Show them" list exists so
  you can see it and judge.
- Sarcasm and dog whistles are hard for any word list, and this is a word list.
  A local AI scorer comes later and will sit behind these same rules and the
  same promise.
- We only reorder inside the batch of posts X has already sent to the page, so a
  post cannot move from one batch into another.

If you think a rule is wrong, the file is short and public. Open an issue with
the text that was scored wrongly, and we will look at it.
