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

### Two deliberate differences from the Next.js app

**`over_limit` is new.** The app has no length check. The skill's translation rules require one —
*"text expansion routinely pushes a translated title over a channel's character limit"* — so the
page flags it and the translation prompt asks for a rewrite in the target language rather than a
re-translation.

**An unknown category is a warning, not a hold.** `lib/validate.ts` returns `unknown category` from
`gate()`, which disables Generate in the app. `SKILL.md` says the opposite: *"say so in one line and
continue… the gate cannot run and keywords come from the record's own attributes."* The skill is the
source of truth, so the page follows the skill. Three of the bundled sample products are in
categories the config does not know, and they are writable.

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

## Run history

Every finished description is written to the artifact's own database, one document per SKU per
day. Everyone who can open the page sees the same list — no access rules are declared.

If that becomes wrong (product copy is rarely sensitive, but a pre-announcement product might be),
add `db: { rules: [...] }` at publish time. The GP-01 repo's `mcp-manifest.json` carries a worked
example.

## Choosing the model

The page does not pick a model; it asks for a **tier**, and the platform decides which model
serves it. The picker in the status strip offers all three, remembered per viewer in
`localStorage`:

| Tier | |
|---|---|
| `complex` | most capable, thinks longest — the default here, because grounding and a correct claims map is the hard part |
| `default` | balanced, noticeably faster |
| `quick` | fastest, **does not think first** — weaker grounding, more findings |

The tier is recorded on every run and shown beside the verdict, so a batch written on `quick`
is identifiable afterwards rather than being blamed on the skill.

One limitation: the platform serves a nearby cheaper tier when the viewer's plan lacks the one
asked for, and reports that on `modelTierApplied` — which `sample.json()` does not return, only
`sample()` does. So this page shows the tier **requested**, not the one applied. (The GP-01
console uses `sample()` and does surface the difference.)

## Remembered categories

The config knows `footwear`, `outerwear` and `accessories`. When someone writes copy for a
category it does not know, the page saves **the name only** to the artifact's database, so the
next person finds it in the dropdown instead of retyping it.

The name, and nothing else. A required-attribute list invented in the page would be schema
living outside the skill — exactly the drift this repo's layout exists to prevent. A remembered
category is labelled *(not in the config)* and still runs with the gate off and no keyword plan,
which is what `SKILL.md` prescribes.

To make a category first-class, add it to `assets/config.json` with its required attributes and
its keyword plan, then rebuild.

## Keeping it current

The page carries a **build-time copy** of the skill. The plugin updates itself on a push; the
artifact does not update at all until someone rebuilds and republishes.

So after every change to `SKILL.md`, `voice-reference.md` or `config.json`:

```bash
node artifact/build-artifact.mjs     # then republish to the SAME url
```

The build prints a skill hash (`skill 195f2be3`) and the page shows the same hash top-right. Run
the build and compare — a different hash means the published page is stale.
