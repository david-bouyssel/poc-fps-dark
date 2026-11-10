// Synchronise .github/agents/<n>.agent.md (Copilot) <-> .claude/agents/<n>.md (Claude Code).
// Bidirectionnel : le fichier modifié (selon git) devient la source. Seules les lignes
// `tools:`, `model:` et `effort:`/`reasoning-effort:` diffèrent entre les deux formats.
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

// Modèles : alias Claude Code <-> nom affiché par Copilot (liste des noms :
// https://docs.github.com/en/copilot/reference/ai-models/supported-models).
// Mettre à jour les noms Copilot à chaque nouvelle version de modèle.
const MODEL_TO_COPILOT = { opus: "Claude Opus 5.5", sonnet: "Claude Sonnet 5.5", haiku: "Claude Haiku 5.5" };
const MODEL_RE = /^model:.*$/m;
const unquote = (s) => s.trim().replace(/^["']|["']$/g, "");
// Accepte un alias (`opus`), un ID (`claude-opus-5-5`) ou un nom affiché (`Claude Opus 5.5`).
const modelFamily = (value, label) => {
  const family = Object.keys(MODEL_TO_COPILOT).find((f) => value.toLowerCase().includes(f));
  if (!family) throw new Error(`modèle ${label} inconnu : "${value}"`);
  return family;
};
const convertModel = (text, toCopilot) =>
  text.replace(MODEL_RE, (line) => {
    const value = unquote(line.replace(/^model:/, ""));
    if (value === "inherit") return line;
    const family = modelFamily(value, toCopilot ? "Claude" : "Copilot");
    return toCopilot ? `model: "${MODEL_TO_COPILOT[family]}"` : `model: ${family}`;
  });
// Effort : `effort:` côté Claude Code, `reasoning-effort:` côté Copilot (même valeur).
const convertEffort = (text, toCopilot) =>
  toCopilot ? text.replace(/^effort:/m, "reasoning-effort:") : text.replace(/^reasoning-effort:/m, "effort:");

const toClaude = (text) =>
  convertEffort(
    convertModel(nl(text).replace(TOOLS_RE, `tools: ${map(parseTools(text), TO_CLAUDE, "Copilot").join(", ")}`), false),
    false,
  );
const toCopilot = (text) =>
  convertEffort(
    convertModel(
      nl(text).replace(TOOLS_RE, `tools: [${map(parseTools(text), TO_COPILOT, "Claude").map((t) => `"${t}"`).join(", ")}]`),
      true,
    ),
    true,
  );

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
