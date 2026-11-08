// Synchronise .github/agents/<n>.agent.md (Copilot) <-> .claude/agents/<n>.md (Claude Code).
// Bidirectionnel : le fichier modifié (selon git) devient la source. Seule la ligne `tools:`
// diffère entre les deux formats.
// Usage : node scripts/sync-agents.mjs [--check]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ghDir = join(root, ".github", "agents");
const clDir = join(root, ".claude", "agents");
const check = process.argv.includes("--check");

const TO_CLAUDE = { view: "Read", grep: "Grep", glob: "Glob", edit: "Edit", create: "Write", bash: "Bash" };
const TO_COPILOT = Object.fromEntries(Object.entries(TO_CLAUDE).map(([k, v]) => [v, k]));

const nl = (s) => s.replace(/\r\n/g, "\n");
const TOOLS_RE = /^tools:.*$/m;

function parseTools(text) {
  const m = text.match(TOOLS_RE);
  if (!m) throw new Error("ligne tools: introuvable");
  return m[0]
    .replace(/^tools:\s*/, "")
    .replace(/[\[\]"]/g, "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
const map = (names, table, label) =>
  names.map((t) => {
    if (!table[t]) throw new Error(`outil ${label} inconnu : "${t}"`);
    return table[t];
  });

const toClaude = (text) =>
  nl(text).replace(TOOLS_RE, `tools: ${map(parseTools(text), TO_CLAUDE, "Copilot").join(", ")}`);
const toCopilot = (text) =>
  nl(text).replace(TOOLS_RE, `tools: [${map(parseTools(text), TO_COPILOT, "Claude").map((t) => `"${t}"`).join(", ")}]`);

const gitChanged = (file) => {
  try {
    return execFileSync("git", ["status", "--porcelain", "--", file], { cwd: root, encoding: "utf8" }).trim() !== "";
  } catch {
    return false;
  }
};
const read = (f) => readFileSync(f, "utf8");
const list = (dir, suffix) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(suffix)).map((f) => f.slice(0, -suffix.length)) : []);

const names = [...new Set([...list(ghDir, ".agent.md"), ...list(clDir, ".md")])].sort();
let drift = 0;
mkdirSync(ghDir, { recursive: true });
mkdirSync(clDir, { recursive: true });

for (const n of names) {
  const gh = join(ghDir, `${n}.agent.md`);
  const cl = join(clDir, `${n}.md`);
  const hasGh = existsSync(gh);
  const hasCl = existsSync(cl);

  let source;
  if (hasGh && !hasCl) source = "gh";
  else if (!hasGh && hasCl) source = "cl";
  else if (toCopilot(read(cl)) === nl(read(gh))) continue;
  else {
    const ghC = gitChanged(gh);
    const clC = gitChanged(cl);
    if (ghC !== clC) source = ghC ? "gh" : "cl";
    else {
      source = statSync(gh).mtimeMs >= statSync(cl).mtimeMs ? "gh" : "cl";
      console.warn(`${n}: les deux côtés diffèrent, le plus récent gagne (${source === "gh" ? "Copilot" : "Claude"})`);
    }
  }

  drift++;
  if (check) {
    console.error(`désynchronisé : ${n}`);
    continue;
  }
  if (source === "gh") writeFileSync(cl, toClaude(read(gh)));
  else writeFileSync(gh, toCopilot(read(cl)));
  console.log(`${n}: ${source === "gh" ? "Copilot -> Claude" : "Claude -> Copilot"}`);
}

if (check && drift) process.exit(1);
