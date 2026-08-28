# DO-04 · Product Description Assistant

Raw product attributes in, grounded product descriptions out. The skill packaged in
`plugins/do-04-product-description/` is the whole assistant; the app is a thin harness
around it.

## Run it

```bash
npm install
cp .env.example .env.local     # add your Anthropic API key
npm run dev                    # http://localhost:3000
```

`ANTHROPIC_MODEL` is optional — set it if the default model id is not available on your
account. The API's own error is shown in the UI, so a wrong model name says so plainly.

## What it does

**Input folder** — `data/input/products.csv`. One row per product, `sku` and `category`
plus any attribute columns. Press **Generate all** and every ready product is written.

**The gate.** Before anything is written, each record is checked against the category's
mandatory attributes. A record missing one is **held back with a reason and never written
around**. Three of the twelve sample products are held on purpose — that behaviour is the
point of the demo, not a defect.

**Activity.** Every stage streams to the screen as it happens: the gate, the description
being written token by token, the checks, the rewrite if the checks fail.

**The checks.** Six of them, run in code on every description:

| Check | Catches |
|---|---|
| `regulated_claim` | "waterproof", "organic", "recycled" and friends used without the attribute that backs them |
| `claim_unbacked` / `claim_value_mismatch` | a claim citing an attribute the record does not have, or misquoting one |
| `orphan_claim` | a claims map that declares something the copy does not actually say |
| `ungrounded_figure` | any number in the copy that appears in no attribute — the most common and least visible hallucination |
| `over_length` | per-field limits. Over-length copy is held back, never truncated |
| `banned_word` | the client's forbidden terms |

A failing description is **rewritten once** with the findings fed back, then saved with
its verdict either way. The copy gets fixed; the check never gets loosened.

**Output folder** — `data/output/<sku>.json`. Source record, copy, claims map, QA verdict.
The UI reads this folder, so it survives a restart.

**Test your own product.** Fill in the attributes at the bottom of the page. Leave a
required field blank to watch the assistant refuse. A product that passes QA is appended
to `data/input/products.csv` and joins the catalogue above, with its output beside the
rest.

## Translation

Add `DEEPL_API_KEY` to `.env.local` and a **translate to…** dropdown appears on every
English description that passed QA. The list comes live from DeepL, so it only offers
languages your account can actually reach.

What happens on Go: the approved English copy is translated field by field (never as one
blob), the claims map stays in English because traceability points at the product record
and a record has no language, and the result is **re-checked in the target language**.
Figures are compared with separators stripped, so DeepL rendering `10000 mm` as
`10.000 mm` is not reported as a hallucination.

Every locale variant carries a `checks_off` list and the app shows it. Regulated-term
lists exist for DE, FR, ES, IT and NL in `config.json`; in any other language the
regulated-claim check is **off** and the card says so. Banned words and the orphan-claim
check are master-locale only. A pass in a locale is narrower than a pass in English, and
every translated variant is labelled machine-translated, pending native review.

Free-tier DeepL keys end in `:fx` and the client picks the right host automatically.

## The skill is the plugin

The assistant ships as a Claude Code / Cowork plugin, listed in the marketplace at
`.claude-plugin/marketplace.json`:

```
plugins/do-04-product-description/
  .claude-plugin/plugin.json                      plugin manifest
  skills/do-04-product-description/
    SKILL.md                    the system prompt: the grounding rule, the output contract, the traps
    assets/config.json          category schema, limits, regulated terms, banned words, keyword plan
    references/voice-reference.md  the client's own good descriptions — the voice to match
```

Add the marketplace with `/plugin marketplace add <repo>` and install
`do-04-product-description` to get the skill in Claude Code; the web app loads the same
files from disk, so there is one source of truth.

`assets/config.json` drives both the prompt and the checker, so a term added to
`regulated_terms` is enforced on the next run without touching app code. Swap this skill folder
for a client's own and the app is theirs.

## What this is not

Not connected to a PIM, a commerce platform, or a DAM. Files in, files out. The field
mapping to a real store is a separate step — see the DO-04 PoC pipeline for the Shopify
export and the readout.
