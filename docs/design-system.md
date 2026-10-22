# Tolstoy Design System

Version 1.0 · October 22, 2026

This file describes the complete visual and verbal style of Tolstoy. Any agent building a Tolstoy page, mockup, icon, deck, or marketing visual should follow it exactly. Where this file is silent, choose the calmer, plainer option.

## What Tolstoy is

Tolstoy is a free, open-source browser extension that uses an AI running on the user's own computer to make social media calmer. It lowers hostile and rage-bait posts (never deletes them), and replaces the browser's new tab page with **Tolstoy Home**, a personal page of the best things the user follows. Its promise: "Feel better after you scroll." Nothing about a user's feed ever leaves their computer.

The design must have the same effect as the product: **calming, warm, trustworthy, and quietly futuristic.** Think parchment and lamplight, not neon.

Inspirations (for spirit, never to copy): Daylight Computer (warm paper tones, low blue light), mymind (ombre shading), Are.na (frosted glass, honest voice).

## Six principles

1. **Paper first.** Warm parchment backgrounds and sepia ink. Never pure white (#FFFFFF), never pure black (#000000), almost no blue.
2. **One quiet glow.** A single soft amber "sun" glow and an ombre that fades into the page. A gradient must never stop in a hard line.
3. **Glass only where something sits behind it.** Frosted panels float over the ombre or the glow. On flat parchment, use solid paper cards instead.
4. **Hairlines, not shadows.** Cards get a 1px warm border and no shadow. Only floating glass gets a shadow.
5. **Nothing blinks.** Motion is slow and breathing-paced (4 to 6 seconds per cycle), and always optional.
6. **Plain, kind words.** Short sentences, no hype, no em dashes.

## Color

| Token | Hex | Use |
| --- | --- | --- |
| ground | #F3EBDD | Page background |
| paper | #FAF5EA | Cards and raised surfaces |
| paper-sunk | #EFE4D2 | Quiet side panels |
| placeholder | #E6D6BF | Image placeholders, avatars |
| line | #E3D6C0 | Card borders, dividers |
| line-strong | #E0D1B9 | Dividers on paper-sunk |
| ink | #2B2117 | Text, logo, primary buttons |
| ink-2 | #5A4A38 | Secondary text |
| ink-3 | #6E5D49 | Meta text, captions, eyebrows; the lightest color allowed for text |
| accent | #9C4F24 | Rust: hat band, eyebrows, focus rings, toggles that are on |
| accent-hover | #5E2D14 | Link hover |
| calm | #7F8F6E | Sage: "mostly calm" status, connection |
| warm | #D9A65B | Amber: humor in the feed weather report |
| heated | #B4643A | Heated posts in the feed weather report |
| toggle-off | #D8CBB5 | Toggle track when off |

Alternate accents, offered only as a user option: olive #7A6A2E, sage #5F6E5A, plum #8A5A6A.

**Night mode:** background #241C17 with an ombre toward #2B1F21, text #F3EBDD, accent #D07A45.

**Contrast:** every text color must reach at least 4.5:1 against its background.

## Gradients and glass

**Hero ombre** (always ends in the ground color, so there is no seam):

```css
background:
  radial-gradient(640px 420px at 88% -10%, rgba(232,168,108,0.32), rgba(232,168,108,0) 70%),
  linear-gradient(180deg, #F6E6D2 0%, #F1DCCB 48%, #F3EBDD 100%);
```

**Small ombre tile** (icons, the extension panel):

```css
background: linear-gradient(160deg, #F8EBD8, #E9CFCB);
```

**Glass panel:**

```css
background: rgba(255, 250, 240, 0.55);   /* 0.5 to 0.6 */
backdrop-filter: blur(16px);              /* 16 to 18px */
-webkit-backdrop-filter: blur(16px);
border: 1px solid rgba(255, 255, 255, 0.7);
/* Shadow only on the single main floating element, such as the search bar: */
box-shadow: 0 8px 24px rgba(90, 60, 30, 0.08);
```

Never put a gradient inside a card or image placeholder. Placeholders are flat placeholder color with a short bracketed label such as [Photo].

## Typography

- **Reading and display:** Newsreader (Google Fonts, optical sizes 6 to 72), weights 400 and 500.
- **Interface:** Nunito, weights 400, 600, and 700.

```html
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
```

| Role | Font | Size | Details |
| --- | --- | --- | --- |
| Display (hero quote) | Newsreader 400 | 32 to 48px | line-height 1.18, letter-spacing -0.012em, text-wrap: balance |
| Section heading | Newsreader 500 | 28px | letter-spacing -0.008em |
| Panel heading | Newsreader 500 | 22px | |
| Reading text (posts, stories) | Newsreader 400 | 19px | line-height 1.45 |
| Body | Nunito 400 | 16px | line-height 1.6 |
| Small and meta | Nunito 400 or 600 | 14px | ink-3 |
| Eyebrow | Nunito 700 | 13px | uppercase, letter-spacing 0.14em, accent or ink-3 |

**Rule:** serif for anything people read slowly (quotes, stories, posts). Sans for anything people operate (buttons, labels, settings). Use no sizes outside this table.

## Shape and spacing

- **Corner radius:** 24px for large containers, 16px for cards, 999px for pills and buttons. No other values.
- **Spacing scale:** 4, 8, 12, 16, 24, 32, 48, 64px. Sections sit 64px apart; cards 16 to 24px apart.
- **Width:** content maxes out at 1120px with 24px side padding. Every layout wraps to one column on a phone.
- **No boxes inside boxes.** A list inside a panel uses hairline dividers and a small accent dot, not inner cards.

## Components

- **Primary button:** ink background, paper text, pill shape, at least 44px tall, Nunito 600.
- **Secondary button:** glass or paper pill with a line border.
- **Status pill:** glass pill with an 8px colored dot (calm, warm, or heated) and a short label. It links to settings.
- **Card:** paper, 1px line border, 16px radius, 24px padding, no shadow. Order inside: the source (meta text, top), the words (serif, fills the space), the author (bottom, with a 24px round avatar). Every card in a row uses the same structure.
- **Heated post in a feed:** the post blurred behind a soft parchment veil (rgba(247,236,222,0.55)), a bold one-line label ("Heated post, softened by Tolstoy"), a one-line reason ("Flagged for hostile tone, not for its opinion."), and a "Show anyway" button. Never hide anything without a way back.
- **Banner on a social site:** glass strip with the hat icon tile, "Tolstoy is on," the current temperature, a count ("6 heated posts moved down."), and a "Show them" pill.
- **Toggle:** 44 by 26px track; accent when on, toggle-off when off; paper knob with a faint shadow.
- **Segmented control (temperature):** pill track in #EADCC6; the selected option is an ink pill with paper text.
- **Focus ring** on every link, button, and input: `outline: 2px solid #9C4F24; outline-offset: 3px`.
- **Trust line:** small lock icon plus a sentence like "Nothing left this computer," in ink-3, at the foot of key screens.

## Logo: the hat on the T

The mark is a tall-crowned hat with a rust band, a nod to the hats Tolstoy wore. In the full logo it sits on the T of the wordmark.

**Hat icon** (viewBox `0 0 120 120`, flat fills only, no highlights, outlines, or strokes):

```html
<svg viewBox="0 0 120 120" aria-hidden="true">
  <path d="M38 76 L40 34 C40 24 80 24 80 34 L82 76 Z" fill="#2B2117"/>
  <path d="M38.6 64 L81.4 64 L82 76 L38 76 Z" fill="#9C4F24"/>
  <path d="M18 78 C18 72 34 74 60 74 C86 74 102 72 102 78 C102 86 86 88 60 88 C34 88 18 86 18 78 Z" fill="#2B2117"/>
</svg>
```

**Wordmark with the hat on the T** (Newsreader 500):

```html
<span style="font-family: 'Newsreader', Georgia, serif; font-weight: 500; line-height: 1; padding-top: 0.45em; color: #2B2117">
  <span style="position: relative; display: inline-block; margin-right: -0.06em">T<svg viewBox="14 20 92 72" style="position: absolute; left: 50%; bottom: calc(100% - 0.13em); width: 0.72em; height: auto; overflow: visible; transform: translateX(-50%)" aria-hidden="true"><path d="M38 76 L40 34 C40 24 80 24 80 34 L82 76 Z" fill="#2B2117"/><path d="M38.6 64 L81.4 64 L82 76 L38 76 Z" fill="#9C4F24"/><path d="M18 78 C18 72 34 74 60 74 C86 74 102 72 102 78 C102 86 86 88 60 88 C34 88 18 86 18 78 Z" fill="#2B2117"/></svg></span>olstoy
</span>
```

**Logo rules:**

- The hat sits straight (no tilt), seated 0.13em into the T, and 0.72em wide.
- Keep `margin-right: -0.06em` on the T. Wrapping the letter breaks the font's built-in T-to-o spacing, and this restores it.
- Leave clear space above the wordmark equal to the hat's height (about 0.45em).
- **Minimum size:** 24px for the wordmark. Below that, use the hat icon alone.
- **App and toolbar icon:** the hat on the small ombre tile (rounded square, about 28% corner radius). The large app icon may add a frosted-glass circle behind the hat.
- **On light backgrounds:** ink hat with rust band. **At night:** parchment hat (#F3EBDD) with a #D07A45 band.
- Never tilt, stretch, outline, shadow, or recolor the hat in other hues.
- For production, export the lockup as one outlined SVG so it never depends on the font loading.

## Voice

- Calm, warm, and plain. Examples: "Feel better after you scroll." "You're caught up. Go see someone." "Read slowly."
- Explain, never scold. Always say why something was lowered: its tone, not its opinion.
- No em dashes, no hype, no exclamation-heavy copy, no invented statistics. Use bracketed placeholders such as [YOUR PRICE] for unknown facts.
- Tagline (adapted, credit it as such): "Art is what keeps us from being strangers and enemies to one another." Credit line: "Adapted from Leo Tolstoy, What Is Art?"

## Key screens (reference)

1. **Tolstoy Home (new tab):** ombre hero with the wordmark at top left, status pill and settings button at top right, the date eyebrow, the tagline, and a glass search bar. Below: today's story (one per day), small delights, saved posts from across sites, and the closing line "You're caught up. Go see someone."
2. **Extension panel (380 by 640):** ombre background, wordmark, temperature control (Calm, Balanced, Unfiltered), feed weather bar, toggles, and the trust line.
3. **Calm feed on a social site:** the host site stays neutral; only Tolstoy's elements wear the Tolstoy style.
4. **Welcome page:** the promise, three glass promise cards (Nothing leaves, Nothing deleted, Tone not opinion), a plain explanation of the browser's install warning, and two buttons.

## Checklist before shipping any screen

- [ ] Only ground, paper, and paper-sunk surfaces; no pure white or black
- [ ] Every gradient ends in the ground color; no hard seams
- [ ] Glass appears only over the ombre or the glow
- [ ] Corner radii are 24, 16, or 999 only; no shadows on cards
- [ ] Type uses only the sizes in the table; serif for reading, sans for controls
- [ ] Cards in a row share one structure
- [ ] Focus rings are visible; touch targets are at least 44px; text contrast is at least 4.5:1
- [ ] Wordmark is 24px or larger, with the kerning fix and clear space; hat icon alone below that
- [ ] Copy is plain, kind, and free of em dashes
