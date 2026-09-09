// AI classification in the main process. Four backends, same contract as the extension's background.js:
//   local  — free, on device: sentence embeddings (transformers.js + onnxruntime) against category prototypes
//   cli    — spawns the `claude` CLI on this mac (user's subscription)
//   key    — bring your own key: any OpenAI-compatible endpoint (NVIDIA NIM, Groq, OpenRouter, Gemini, Ollama,
//            custom) or Anthropic; several keys rotate on rate limits so nothing racks up anywhere
const { spawn } = require("child_process");
const path = require("path");
const { app } = require("electron");
const store = require("./store");
require("./ext/rules.js"); const rules = globalThis.YOUMOOD_RULES;
const CAT_KEYS = Object.keys(rules.CATS);
const CACHE_TTL = 7 * 24 * 3600 * 1000;

const SYSTEM = `You label content cards (video titles, headlines, image captions). Each item is "title · source". Categories:
trump: about Donald Trump, his family, MAGA, or his administration.
politics: parties, elections, politicians, government policy, geopolitics, war coverage as politics.
violence: real-world violence, weapons, killings, fights, crashes, gore, war footage.
news: news broadcasts, breaking-news style, news channels, current-affairs reporting.
sport: any sport, league, match, athlete, highlights.
ads: sponsored content, product promotion as the main point, commercials.
brands: a major global brand or its product is the main subject (Apple, Tesla, Nike, McDonald's, Samsung, Amazon, Netflix...).
CUSTOM: the user also wants to mute these intentions: {{CUSTOM}}. If an item clearly matches one, add "custom:<intention>".
Return ONLY a JSON array, one object per item in order: {"i":<index>,"c":[<category keys that clearly apply>]}. Empty c when none apply. No prose.`;

const PROVIDERS = {
  nvidia: "https://integrate.api.nvidia.com/v1", groq: "https://api.groq.com/openai/v1", openrouter: "https://openrouter.ai/api/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai", ollama: "http://127.0.0.1:11434/v1", anthropic: "https://api.anthropic.com"
};

function parseArray(text) {
  const m = String(text).match(/\[[\s\S]*\]/);
  if (!m) throw new Error("no JSON array in response");
  return JSON.parse(m[0]);
}
const userText = (items) => items.map((it, i) => `${i}: ${it.text}`).join("\n");
const sysFor = (custom) => SYSTEM.replace("{{CUSTOM}}", (custom || []).length ? custom.join(", ") : "none");

// ---------- cli ----------
function runClaude(system, text, model) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json", "--system-prompt", system, "--tools", ""];
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
    child.stdin.end(text);
  });
}
async function viaCli(items, s, custom) { return { arr: parseArray(await runClaude(sysFor(custom), userText(items), s.cliModel)), via: "claude cli" }; }

// ---------- key: anthropic native or any OpenAI-compatible endpoint, with rotation ----------
const cooldown = new Map(); // endpoint url+key -> until timestamp
function endpoints(s) {
  const list = [];
  const add = (provider, url, key, model) => { url = (url || PROVIDERS[provider] || "").replace(/\/+$/, ""); if (url && (key || provider === "ollama")) list.push({ provider, url, key: key || "", model }); };
  add(s.provider, s.baseUrl, s.apiKey, s.model);
  for (const line of String(s.moreKeys || "").split("\n")) {
    const [p, k, m] = line.trim().split(/\s+/); if (!p) continue;
    add(PROVIDERS[p] ? p : "custom", PROVIDERS[p] ? "" : p, k, m || "");
  }
  return list;
}
async function callAnthropic(ep, system, text) {
  const res = await fetch(ep.url + "/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": ep.key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: ep.model || "claude-haiku-4-5", max_tokens: 4000, system, messages: [{ role: "user", content: text }] })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error?.message || res.statusText); e.status = res.status; throw e; }
  return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}
async function callOpenAI(ep, system, text) {
  const res = await fetch(ep.url + "/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", ...(ep.key ? { authorization: "Bearer " + ep.key } : {}) },
    body: JSON.stringify({ model: ep.model, temperature: 0, max_tokens: 4000, messages: [{ role: "system", content: system }, { role: "user", content: text }] })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error?.message || j.detail || res.statusText); e.status = res.status; throw e; }
  return j.choices?.[0]?.message?.content || "";
}
async function viaKey(items, s, custom) {
  const eps = endpoints(s);
  if (!eps.length) throw new Error("no api key set");
  const system = sysFor(custom), text = userText(items);
  let lastErr = null; const now = Date.now();
  for (const ep of eps) {
    const k = ep.url + "|" + ep.key.slice(-6);
    if ((cooldown.get(k) || 0) > now) continue;
    try {
      const out = ep.provider === "anthropic" ? await callAnthropic(ep, system, text) : await callOpenAI(ep, system, text);
      return { arr: parseArray(out), via: ep.provider + " " + (ep.model || "") };
    } catch (e) {
      lastErr = e;
      if (e.status === 429 || e.status >= 500 || !e.status) cooldown.set(k, Date.now() + (e.status === 429 ? 60000 : 20000)); // rotate
      else throw e; // 401/400: config problem, rotating won't help
    }
  }
  throw lastErr || new Error("all endpoints on cooldown");
}

// ---------- local: sentence embeddings, free, private, scales with every install ----------
const LOCAL = { model: "Xenova/multilingual-e5-small", prefix: "query: ", dtype: "q8", thresholds: { trump: 0.83, politics: 0.83, violence: 0.82, news: 0.83, sport: 0.84, ads: 0.82, brands: 0.85, custom: 0.81 }, margin: 0.03, marginCustom: 0.04 };
// a bare word like "crypto" is too short to embed well: expand each intention into a few phrasings and take the best
const TPL = (w) => [w, `a video about ${w}`, `${w} content`, `everything related to ${w}`];
// neutral prototypes: a label only counts if it beats the most similar neutral one by `margin`
const NEUTRAL = ["a relaxing cooking video", "how to build something at home", "funny animal compilation", "music tutorial for beginners", "travel vlog", "product unboxing", "a documentary about nature", "gaming let's play"];
const PROTO = {
  trump: ["Donald Trump", "Trump speech at a rally", "MAGA supporters and Trump", "the Trump administration", "Trump im Weißen Haus"],
  politics: ["politics and elections", "parliament debates a new law", "the president and the government", "geopolitics, sanctions and war between countries", "political party campaign", "Politiker streiten im Bundestag", "Wahlkampf und Regierung"],
  violence: ["a shooting left people dead", "war footage with explosions and airstrikes", "street fight knockout", "brutal crash compilation", "murder and killing", "Schießerei und Gewalt"],
  news: ["breaking news live coverage", "tonight's news broadcast", "news channel report on current events", "Nachrichten und aktuelle Berichterstattung"],
  sport: ["football match highlights", "NBA basketball game", "athlete wins the championship", "tennis, golf and F1 racing", "Fußball Bundesliga Spielbericht"],
  ads: ["sponsored product promotion", "buy now, special offer, commercial", "advertisement for a product or service", "Werbung und Sponsoring"],
  brands: ["Apple iPhone review", "Tesla electric car", "Nike sneakers launch", "McDonald's burger", "Samsung Galaxy phone", "Amazon, Netflix, Google products"]
};
let localP = null; const protoCache = new Map();
function loadLocal() {
  if (localP) return localP;
  localP = (async () => {
    const tf = await import("@huggingface/transformers");
    tf.env.cacheDir = path.join(app.getPath("userData"), "models");
    tf.env.allowLocalModels = false;
    store.setStatus({ ok: null, msg: "downloading model…" });
    const fe = await tf.pipeline("feature-extraction", LOCAL.model, { dtype: LOCAL.dtype });
    const embed = async (texts) => (await fe(texts.map((t) => LOCAL.prefix + t), { pooling: "mean", normalize: true })).tolist();
    for (const k in PROTO) protoCache.set(k, await embed(PROTO[k]));
    protoCache.set("_neutral", await embed(NEUTRAL));
    return embed;
  })();
  localP.catch(() => { localP = null; });
  return localP;
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
async function viaLocal(items, _s, custom) {
  const embed = await loadLocal();
  const E = await embed(items.map((i) => i.text.slice(0, 300)));
  const cust = (custom || []).filter(Boolean);
  const CE = []; for (const w of cust) CE.push(await embed(TPL(w)));
  const arr = items.map((_, i) => {
    const c = [];
    const base = Math.max(...protoCache.get("_neutral").map((p) => dot(E[i], p)));
    for (const k in PROTO) { const sim = Math.max(...protoCache.get(k).map((p) => dot(E[i], p))); if (sim >= LOCAL.thresholds[k] && sim - base >= LOCAL.margin) c.push(k); }
    cust.forEach((w, j) => { const sim = Math.max(...CE[j].map((p) => dot(E[i], p))); if (sim >= LOCAL.thresholds.custom && sim - base >= LOCAL.marginCustom) c.push("custom:" + w); });
    return { i, c };
  });
  return { arr, via: "on device" };
}

// ---------- entry ----------
async function classify(items, custom) {
  const s = store.getSettings();
  const mode = s.ai === "bridge" ? "cli" : s.ai === "api" ? "key" : s.ai;
  const ids = items.map((i) => i.id);
  const verdicts = store.cacheGet(ids, CACHE_TTL);
  const todo = items.filter((i) => !(i.id in verdicts));
  if (!todo.length || mode === "off") return { verdicts };
  let res;
  try { res = mode === "local" ? await viaLocal(todo, s, custom) : mode === "key" ? await viaKey(todo, s, custom) : await viaCli(todo, s, custom); }
  catch (e) { store.setStatus({ ok: false, msg: String(e.message || e) }); return { verdicts, error: String(e.message || e) }; }
  const fresh = {};
  for (const row of res.arr) { const it = todo[row.i]; if (it) fresh[it.id] = (row.c || []).filter((k) => CAT_KEYS.includes(k) || String(k).startsWith("custom:")); }
  for (const it of todo) if (!(it.id in fresh)) fresh[it.id] = [];
  store.cacheSet(fresh);
  store.setStatus({ ok: true, msg: `${todo.length} labeled via ${res.via}` });
  return { verdicts: { ...verdicts, ...fresh }, via: res.via };
}

module.exports = { classify, loadLocal };
