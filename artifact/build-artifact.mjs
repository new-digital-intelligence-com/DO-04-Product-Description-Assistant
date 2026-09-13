/**
 * Bundles the skill and the sample catalogue into one self-contained artifact page.
 *
 * Same doctrine as the GP-01 repo: the skill in plugins/ is the only place the RULES
 * live, and every surface embeds a copy of it at build time. The page never restates a
 * rule — the one piece of logic it does carry, the validator, is a mechanical checker
 * driven entirely by config.json, which is itself a skill asset. The skill decides; the
 * page enforces. That split is the skill's own: "you name the attribute it came from,
 * in a claims map, and a script checks you."
 *
 * Output is git-ignored. Never edit dist/ — edit src/console.html or the skill.
 *
 *   node artifact/build-artifact.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const skillDir = join(root, "plugins", "do-04-product-description", "skills", "do-04-product-description");
const srcFile = join(here, "src", "console.html");
const outFile = join(here, "dist", "do-04-console.html");

/** SKILL.md first, then the two files it tells the model to open every run. */
const FILES = [
  "SKILL.md",
  "references/voice-reference.md",
  "assets/config.json",
];

/**
 * `sample()` caps `input` at 65536 UTF-8 bytes. One product is one call here, so the
 * budget is roomy — but a skill that outgrows it must fail the build, not a run.
 */
const SAMPLE_MAX_PROMPT_BYTES = 65536;
const FRAMING_ALLOWANCE = 8000;

const skill = {};
for (const rel of FILES) {
  try {
    skill[rel] = readFileSync(join(skillDir, rel), "utf8");
  } catch {
    console.warn(`[build-artifact] missing, skipped: ${rel}`);
  }
}

if (!skill["SKILL.md"] || !skill["assets/config.json"]) {
  console.error(
    `[build-artifact] SKILL.md and assets/config.json are both required, under\n  ${skillDir}\n` +
      `  Run this from the repo root, not from artifact/.`,
  );
  process.exit(1);
}

let config;
try {
  config = JSON.parse(skill["assets/config.json"]);
} catch (e) {
  console.error(`[build-artifact] assets/config.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

const skillBytes = Object.values(skill).reduce((n, s) => n + Buffer.byteLength(s, "utf8"), 0);
const budget = SAMPLE_MAX_PROMPT_BYTES - FRAMING_ALLOWANCE;
if (skillBytes > budget) {
  console.error(
    `[build-artifact] the skill is ${skillBytes} bytes; sample() allows ${SAMPLE_MAX_PROMPT_BYTES}\n` +
      `  and the run framing needs about ${FRAMING_ALLOWANCE}, leaving ${budget}.`,
  );
  process.exit(1);
}

/* ---------------------------------------------------------------- catalogue
   The sample products travel with the page so it opens on something real rather
   than an empty form. Blank cells are dropped: an attribute that is absent and one that
   is empty mean the same thing, and carrying empties into the prompt invites the model to
   write around them. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

let catalogue = [];
try {
  const rows = parseCsv(readFileSync(join(root, "data", "input", "products.csv"), "utf8"));
  const head = rows.shift().map((h) => h.trim());
  catalogue = rows.map((r) => {
    const attributes = {};
    head.forEach((key, i) => {
      const v = (r[i] ?? "").trim();
      if (v && key !== "sku" && key !== "category" && key !== "source") attributes[key] = v;
    });
    const get = (k) => (r[head.indexOf(k)] ?? "").trim();
    return { sku: get("sku"), category: get("category"), attributes };
  }).filter((p) => p.sku);
} catch {
  console.warn("[build-artifact] no data/input/products.csv — the catalogue will be empty");
}

/* Locales the config can actually check. Anything else is offerable but honest about
   running with its term list off — which is what the skill demands be stated. */
const checkedLocales = Object.keys(config.regulated_terms_by_locale ?? {});

/** `</script>` inside embedded JSON would close the tag early. */
const embed = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

/* Provenance for the masthead: which plugin and which skill this page was built from.
   A published page is a snapshot, so saying which snapshot is part of saying what it is. */
let source = { marketplace: "", plugin: "do-04-product-description", skill: "do-04-product-description", displayName: "" };
try {
  const pj = JSON.parse(readFileSync(join(root, "plugins", "do-04-product-description", ".claude-plugin", "plugin.json"), "utf8"));
  source.plugin = pj.name || source.plugin;
  source.displayName = pj.displayName || "";
} catch { console.warn("[build-artifact] plugin.json unreadable — masthead falls back to the folder name"); }
try {
  const mj = JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"));
  source.marketplace = mj.name || "";
} catch { /* a marketplace name is nice to have, not required */ }

const skillHash = createHash("sha256")
  .update(FILES.map((rel) => rel + "\0" + (skill[rel] ?? "")).join("\0"))
  .digest("hex").slice(0, 8);

const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z · skill " + skillHash;

const page = readFileSync(srcFile, "utf8")
  .replace('"__SKILL_FILES__"', embed(skill))
  .replace('"__CATALOGUE__"', embed(catalogue))
  .replace('"__CHECKED_LOCALES__"', embed(checkedLocales))
  .replace('"__BUILD_STAMP__"', embed(stamp))
  .replace('"__SOURCE__"', embed(source));

for (const token of ["__SKILL_FILES__", "__CATALOGUE__", "__CHECKED_LOCALES__", "__BUILD_STAMP__", "__SOURCE__"]) {
  if (page.includes(token)) {
    console.error(`[build-artifact] placeholder ${token} was not substituted — check src/console.html`);
    process.exit(1);
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, page, "utf8");

console.log(
  `[build-artifact] dist/do-04-console.html\n` +
    `  skill:     ${Object.keys(skill).length} files, ${skillBytes} bytes (budget ${budget})\n` +
    `  catalogue: ${catalogue.length} sample products\n` +
    `  locales:   ${checkedLocales.length} with a regulated-term list (${checkedLocales.join(", ")})\n` +
    `  page:      ${Buffer.byteLength(page, "utf8")} bytes\n` +
    `  hash:      ${skillHash}`+
    `\n  source:    ${source.marketplace ? source.marketplace + " / " : ""}${source.plugin} / skills/${source.skill}`,
);

console.log(
  `\n[build-artifact] capabilities for the Artifact tool — pass this whole object:\n` +
    JSON.stringify({ sample: {}, db: {}, downloads: true }, null, 2)
      .split("\n").map((l) => "  " + l).join("\n") +
    `\n\n  No mcp: this assistant calls nothing outside Claude, so nobody needs a connector.`,
);
