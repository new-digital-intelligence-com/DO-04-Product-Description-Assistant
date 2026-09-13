# DO-04 as a Claude Artifact

A published Claude Artifact that runs DO-04 with no deployment, no server and no connectors.
It is a second surface on the same skill — Claude chat is the other.

```
plugins/…/SKILL.md ──┬─→ Claude chat / Claude Code   (the plugin)
                     └─→ artifact/  this page        (build-artifact.mjs → dist/…html)
```

If the copy comes out wrong, fix `SKILL.md`. This page holds no rule of its own.

## Build

```bash
node artifact/build-artifact.mjs     # → artifact/dist/do-04-console.html
```

It inlines the skill, the voice reference, `config.json` and the 15 sample products into one
self-contained file, and fails rather than shipping a broken page if the skill outgrows
`sample()`'s 65,536-byte prompt cap.

| | bytes |
|---|---|
| SKILL.md + voice-reference.md + config.json | 16,535 |
| Framing allowance | 8,000 |
| Cap | 65,536 |

Plenty of headroom — one product is one call, so nothing accumulates.

`dist/` is git-ignored. Never edit it; the next build overwrites it.

## No connectors

This is the thing to notice. DO-04 calls nothing outside Claude, so the page declares no `mcp`
capability at all:

```js
capabilities: { sample: {}, db: {}, downloads: true }
```

Consequences, all good:

- **Nobody sets anything up.** No Zapier, no per-viewer connector, no org-admin question.
- **Sharing actually works.** Anyone you share it with can use it immediately.
- **No credential exists to leak**, because the page reaches nothing that needs one.

## Publish

From the account that will own it:

```js
Artifact({
  file_path: "artifact/dist/do-04-console.html",
  favicon: "🏷️",
  description: "Turns raw product attributes into grounded selling copy, with every claim traced to an attribute.",
  capabilities: { sample: {}, db: {}, downloads: true }
})
```

The file is authored for the Artifact tool, which supplies the `<!doctype>`, `<html>`, `<head>`
and `<body>` wrapper — that is why it starts at `<title>`. Do not add them.

**Republish to the same URL** (pass the artifact's `url`, or use the same file path in the same
session). A new URL means a new, empty database and the run history is stranded on the old one.

## The one piece of logic the page carries

`lib/validate.ts` is ported into the page. That does **not** break "the skill is the only
implementation", for two reasons:

1. The skill asks for it by name — *"you name the attribute it came from, in a claims map, **and
   a script checks you**."* A model marking its own homework is not a check.
2. Every term, word and limit it tests comes out of `assets/config.json`, which is a **skill
   asset**. Nothing is hardcoded twice. The skill decides what is allowed; the page only decides
   whether the model obeyed.

Checks ported, in the skill's own vocabulary:

| Check | Runs on |
|---|---|
| `empty_field` | every locale |
| `regulated_claim` | English, plus any locale with a term list in the config |
| `claims_missing` · `claim_unbacked` · `claim_value_mismatch` | every locale |
| `orphan_claim` | **master only** — the claims map is never translated |
| `banned_word` | **master only** — the supplied list is English |
| `over_limit` | every locale |

### Nothing is mandatory any more

The gate is gone, on request. `config.json` used to split each category's attributes into
`required` and `optional`, and a record missing a required one was held. Both lists are now
one `attributes` list: **what a category usually carries, as a prompt for whoever fills the
record — not a rule.**

So: every product is writable, every category is writable, and a thin record simply makes
short copy. That is the grounding rule working, not a failure — `SKILL.md` says so directly.

`over_limit` is still new relative to the Next.js app: the app has no length check, and the
skill's translation rules need one, since text expansion is what pushes a translated title
past a channel limit.

## Translation without DeepL

The app translates with DeepL. An artifact has no network, so it cannot. **Claude translates
instead**, and the page re-runs the checks on the result.

This is not a downgrade in what it claims: the skill already calls any machine translation *"a
draft pending native review"*, and the page says so on every variant. All three of the skill's
translation rules hold:

1. The claims map is not translated — the variant keeps the master's, untouched.
2. Limits are re-checked after translating, and an over-length field is rewritten in the target
   language.
3. Checks that could not run are named on screen and in the exported Markdown.

Locales with a regulated-term list in the config (`de` `fr` `es` `it` `nl`) are offered solid;
others are offered with a dashed border and run with that check off.

## What is shared and what is yours

| | Where | Who sees it |
|---|---|---|
| **Products** | artifact `db` | everyone |
| **Their descriptions**, in every language | on the product, in `db` | everyone |
| **Your activity log** | `localStorage` | only you, this browser |
| Model choice | `localStorage` | only you |

A description belongs to the **product**, not to whoever happened to generate it. Open a
product and the copy is there, with a tab per language — the next person does not regenerate
what a colleague already wrote and paid for.

What stays local is the log of what *you* did: one line per description, with the SKU, the
language, the verdict, the claim count and the model. Click a line and a panel shows the pair
that matters — **the record as it was at that moment**, and the copy that came back. The
product can be edited afterwards, so that snapshot is the only thing that still says what the
copy was written from. Capped at 25.

## Writing, rewriting, translating

A product with no description offers **Get description**. Once it has one, that becomes
**Regenerate description**, and a **Translate** row appears under it: German, French, Spanish,
Italian, Dutch, Arabic, plus a box for any language typed in plain text.

Translating is only offered once an English master exists, because the skill is explicit that
a variant is a translation of an approved master and is never written from scratch in the
target language. Translating from a product row reuses the stored master rather than
regenerating it — the same copy the merchandiser approved.

## Everything happens in the product row

There is no separate run panel. A product opens to three things, in the order someone
actually works in them:

```
Record · 10 attributes          the table
Description                     tabs per language, the copy, downloads
                                ── a run renders here ──
Edit record · Delete            Regenerate description
Translate into  German French Spanish Italian Dutch Arabic [any language…]
```

Click **Get description**, **Regenerate** or a language, and the work appears between the
description and the controls — steps, and Claude's reply streaming into a collapsible box.
When it finishes, the description above refreshes in place and the work area collapses to one
line. Nothing scrolls away, nothing opens elsewhere.

## The wait is narrated

The model call is one opaque step, so the page shows it as one. Everything after it is real
work done in the page, and is reported as it happens:

```
✓ Record read                 10 attributes
✓ Claude writes the copy      1,284 characters · most capable
✓ Fields present              5 bullets, title, long copy, meta
✓ Regulated terms             13 terms checked against the record
✓ Claims traced               6 claims checked against 10 attributes
✓ Claims quoted verbatim      every claim matched against the copy
✓ Banned words                12 terms checked
✕ Lengths                     title 74/70, meta 149/160
✕ Finished with findings      1 finding
```

On a translation the language-specific checks report themselves as off (`–`) rather than
passing silently, which is what the skill requires be said out loud.

## Remembered categories

The config knows `footwear`, `outerwear` and `accessories`. Saving a product in a category it
does not know remembers **the name only**, so the next person finds it in the dropdown.

The name, and nothing else. A required-attribute list invented in the page would be schema
living outside the skill — exactly the drift this repo's layout exists to prevent. Such a
category is labelled *(not in the config)* and still runs with the gate off and no keyword
plan, which is what `SKILL.md` prescribes.

To make one first-class, add it to `assets/config.json` with its required attributes and its
keyword plan, then rebuild.

## Saving to the shared catalogue

Writing copy and *storing a record everyone inherits* are different acts with different
standards, and the page now treats them that way.

| Saving a product | |
|---|---|
| **Known category** | every attribute on the category's list must be filled. Extras welcome, and they stay on the product — they never change the category definition, which lives in the skill |
| **New category** | no list to be complete against, so at least **3 attributes** |

The skill is untouched by this: it still writes from whatever a record carries, and a thin
record still makes short copy. This is a rule about the store, not about writing — leaving
holes in a row your colleagues inherit is how a catalogue rots.

**There is no "Save & get description" any more.** Save first; then write the description from
the catalogue, against a record that exists. One button, one meaning.

## Editing and deleting

Every product opens to **Edit** and **Delete**. Both need `db`; both are two-click (the button
arms, then confirms).

Deleting writes a `hidden: true` tombstone rather than only removing a document — the bundled
products live inside the page and cannot be removed from it, so a marker is the only way for a
shared catalogue to lose one. Renaming a SKU during an edit tombstones the old one, or the
rename would leave a duplicate behind.

**The catalogue keeps at least 3 products.** Delete is disabled when it would drop below that,
so nobody empties a shared catalogue for everyone else in a few clicks.

Previous runs are deletable too — they are yours and local, so that one is unguarded.

## Fill with Claude

The **Fill with Claude** button on the add-a-product tab invents one plausible record for the
chosen category. On a brand-new category it reads **Generate new product**, because there is no
record to fill in — it makes one — SKU, brand, product type, materials, figures with their units — and drops it
into the form for you to check and save. Useful for trying the tool without hunting for a real
PIM row.

An invented record is stored with `invented: true` and tagged **made up** in the catalogue. The
catalogue is shared, and a fabricated product sitting unlabelled beside real ones is exactly
the kind of thing someone later reads as a real spec.

## Languages

Quick buttons for the five the config has regulated-term lists for (`de` `fr` `es` `it` `nl`),
two more offered dashed (`ar` `pt` — no term list, so that check runs off), and a **free text
box for any language at all**: type "Arabic", "deutsch", "日本語" or anything else.

A name the page recognises resolves to its code and picks up whatever checks the config has.
One it does not still translates — it just runs with the regulated-term check off and says so,
rather than implying a clean pass. Right-to-left languages render RTL.

## Choosing the model

The page does not pick a model; it asks for a **tier**, and the platform decides which model
serves it. The picker in the status strip offers all three, remembered per viewer:

| Tier | |
|---|---|
| most capable | thinks longest — the default here, because grounding and a correct claims map is the hard part |
| balanced | noticeably faster |
| fastest | **does not think first** — weaker grounding, more findings |

There is no way to name a model (`Opus`, `Sonnet`) from an artifact: `modelTier` takes
`quick` / `default` / `complex` and nothing else. The tier is recorded on every run and shown
beside the verdict, so a batch written on the fastest tier is identifiable afterwards rather
than being blamed on the skill.

### Who pays, and which model actually answered

**The viewer pays.** Every call spends the Claude usage of whoever clicked, from their own
account — not yours, and not the account that published the page. The first call in a view
asks them to allow it.

Which model answered is reported on `modelTierApplied`, and the platform substitutes a
nearby cheaper tier when the viewer's plan lacks the one asked for. `sample.json()` drops
that — it resolves with the parsed value alone — so the page calls `sample()` and parses the
JSON itself (`askJson`), keeping the envelope. When the tier was downgraded the verdict line
says so:

```
PASS · every check that could run, passed · model: balanced — your plan could not serve most capable · 6 claims
```

Without that, a viewer on a smaller plan silently gets weaker copy and the skill takes the
blame. The applied tier is stored with each run, so an old batch can be explained later.

## Keeping it current

The page carries a **build-time copy** of the skill. The plugin updates itself on a push; the
artifact does not update at all until someone rebuilds and republishes.

So after every change to `SKILL.md`, `voice-reference.md` or `config.json`:

```bash
node artifact/build-artifact.mjs     # then republish to the SAME url
```

The build prints a skill hash (`skill 195f2be3`) and the page shows the same hash top-right. Run
the build and compare — a different hash means the published page is stale.
