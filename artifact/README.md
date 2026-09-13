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

Two stores, split on a real distinction:

| | Where | Who sees it |
|---|---|---|
| **Products** | artifact `db` | everyone who opens the page |
| **Your runs** | `localStorage` | only you, only this browser |
| Model choice | `localStorage` | only you |

A product record is the same record for everyone — one person adding the missing
`sole_material` fixes it for the whole team. What you *tried* on it is not: drafts, rejected
attempts and the notes you gave Claude are yours, and putting them in a shared list would turn
a working surface into a performance review.

Run history keeps everything: the record, the note, the model, the copy, the claims map, the
findings, and every translation. Capped at 25 entries; clearing site data clears it.

## Remembered categories

The config knows `footwear`, `outerwear` and `accessories`. Saving a product in a category it
does not know remembers **the name only**, so the next person finds it in the dropdown.

The name, and nothing else. A required-attribute list invented in the page would be schema
living outside the skill — exactly the drift this repo's layout exists to prevent. Such a
category is labelled *(not in the config)* and still runs with the gate off and no keyword
plan, which is what `SKILL.md` prescribes.

To make one first-class, add it to `assets/config.json` with its required attributes and its
keyword plan, then rebuild.

## Fill with Claude

The **Fill with Claude** button on the add-a-product tab invents one plausible record for the
chosen category — SKU, brand, product type, materials, figures with their units — and drops it
into the form for you to check and save. Useful for trying the tool without hunting for a real
PIM row.

An invented record is stored with `invented: true` and tagged **made up** in the catalogue. The
catalogue is shared, and a fabricated product sitting unlabelled beside real ones is exactly
the kind of thing someone later reads as a real spec.

## The note box

Every product has an optional *"Anything Claude should know?"* field, and it is passed to the
model inside a fence:

> **This note is not a source of facts.** It may tell you what to emphasise, what to lead with,
> who the copy is for, or what to leave out. It cannot ground a claim: if it asks for something
> the record does not carry, leave that out and say so under *what did not run*.

Without that fence, *"say it is waterproof"* would walk straight through the one rule the whole
skill exists to enforce. The note is stored with the run, so a surprising result can be traced
to what was asked for.

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
