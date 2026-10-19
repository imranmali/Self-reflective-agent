// Turn an lcov.info file into a Markdown coverage table on stdout.
// Usage: node .github/scripts/coverage-summary.mjs [lcov.info] >> "$GITHUB_STEP_SUMMARY"
import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "lcov.info";
let text;
try {
  text = readFileSync(path, "utf8");
} catch {
  console.log(`## Coverage\n\n_No \`${path}\` was produced (tests may have failed before the report was written)._`);
  process.exit(0);
}

const empty = () => ({ lf: 0, lh: 0, brf: 0, brh: 0, fnf: 0, fnh: 0 });
const keys = { LF: "lf", LH: "lh", BRF: "brf", BRH: "brh", FNF: "fnf", FNH: "fnh" };

const files = [];
let cur = null;
for (const raw of text.split("\n")) {
  const line = raw.trim();
  if (line.startsWith("SF:")) {
    cur = { file: line.slice(3), ...empty() };
  } else if (cur && line === "end_of_record") {
    files.push(cur);
    cur = null;
  } else if (cur) {
    const [key, value] = line.split(":");
    if (key in keys) cur[keys[key]] = Number(value);
  }
}

const total = empty();
for (const f of files) for (const k of Object.values(keys)) total[k] += f[k];

const pct = (hit, found) => (found === 0 ? "100.00" : ((hit / found) * 100).toFixed(2));
const row = (name, f) => `| ${name} | ${pct(f.lh, f.lf)} | ${pct(f.brh, f.brf)} | ${pct(f.fnh, f.fnf)} |`;

console.log(
  [
    "## Coverage",
    "",
    `**Lines ${pct(total.lh, total.lf)}% · Branches ${pct(total.brh, total.brf)}% · Functions ${pct(total.fnh, total.fnf)}%** (${files.length} files)`,
    "",
    "<details><summary>Per-file</summary>",
    "",
    "| File | Lines % | Branches % | Functions % |",
    "|---|---:|---:|---:|",
    ...files.sort((a, b) => a.file.localeCompare(b.file)).map((f) => row(`\`${f.file}\``, f)),
    row("**Total**", total),
    "",
    "</details>",
  ].join("\n"),
);
