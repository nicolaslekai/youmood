// AI classification — same contract as the extension's background.js, but runs in the main process:
// "bridge" (renamed "this mac") spawns the claude CLI directly, "api" calls Anthropic with the user's key.
const { spawn } = require("child_process");
const store = require("./store");
require("./ext/rules.js"); const rules = globalThis.YOUMOOD_RULES;
const CAT_KEYS = Object.keys(rules.CATS);
const CACHE_TTL = 7 * 24 * 3600 * 1000;

const SYSTEM = `You label YouTube video cards. Each item is "title · channel". Categories:
trump: about Donald Trump, his family, MAGA, or his administration.
politics: parties, elections, politicians, government policy, geopolitics, war coverage as politics.
violence: real-world violence, weapons, killings, fights, crashes, gore, war footage.
news: news broadcasts, breaking-news style, news channels, current-affairs reporting.
sport: any sport, league, match, athlete, highlights.
ads: sponsored content, product promotion as the main point, commercials.
brands: a major global brand or its product is the main subject (Apple, Tesla, Nike, McDonald's, Samsung, Amazon, Netflix...).
Return ONLY a JSON array, one object per item in order: {"i":<index>,"c":[<category keys that clearly apply>]}. Empty c when none apply. No prose.`;

function parseArray(text) {
  const m = String(text).match(/\[[\s\S]*\]/);
  if (!m) throw new Error("no JSON array in response");
  return JSON.parse(m[0]);
}

function runClaude(userText, model) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json", "--system-prompt", SYSTEM, "--tools", ""];
    if (model) args.push("--model", model);
    const env = { ...process.env, CLAUDECODE: "", PATH: (process.env.PATH || "") + ":/opt/homebrew/bin:/usr/local/bin:" + process.env.HOME + "/.local/bin" };
    const child = spawn("claude", args, { env });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(e.code === "ENOENT" ? "claude CLI not found on this mac" : e.message)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error((err || out || "claude exited " + code).trim().slice(0, 200)));
      try { const j = JSON.parse(out); resolve(typeof j.result === "string" ? j.result : JSON.stringify(j.result)); } catch { resolve(out); }
    });
    child.stdin.end(userText);
  });
}

async function viaApi(items, s) {
  const user = items.map((it, i) => `${i}: ${it.text}`).join("\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": s.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: s.model || "claude-opus-5", max_tokens: 4000, system: SYSTEM, output_config: { effort: "low" }, messages: [{ role: "user", content: user }] })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message || res.statusText);
  if (j.stop_reason === "refusal") throw new Error("refused");
  return parseArray((j.content || []).filter((b) => b.type === "text").map((b) => b.text).join(""));
}

async function viaCli(items, s) {
  const user = items.map((it, i) => `${i}: ${it.text}`).join("\n");
  return parseArray(await runClaude(user, s.cliModel));
}

async function classify(items) {
  const s = store.getSettings();
  const ids = items.map((i) => i.id);
  const verdicts = store.cacheGet(ids, CACHE_TTL);
  const todo = items.filter((i) => !(i.id in verdicts));
  if (!todo.length || s.ai === "off") return { verdicts };
  let arr;
  try { arr = s.ai === "api" ? await viaApi(todo, s) : await viaCli(todo, s); }
  catch (e) { store.setStatus({ ok: false, msg: String(e.message || e) }); return { verdicts, error: String(e.message || e) }; }
  const fresh = {};
  for (const row of arr) { const it = todo[row.i]; if (it) fresh[it.id] = (row.c || []).filter((k) => CAT_KEYS.includes(k)); }
  for (const it of todo) if (!(it.id in fresh)) fresh[it.id] = [];
  store.cacheSet(fresh);
  store.setStatus({ ok: true, msg: `${todo.length} labeled` });
  return { verdicts: { ...verdicts, ...fresh } };
}

module.exports = { classify };
