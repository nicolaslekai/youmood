// youmood background — AI classification via local bridge (claude CLI, your subscription) or Anthropic API key.
importScripts("rules.js");
const CATS = self.YOUMOOD_RULES.CATS;
const CAT_KEYS = Object.keys(CATS);
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

async function getSettings() {
  return new Promise((r) => chrome.storage.sync.get({ ai: "off", apiKey: "", model: "claude-opus-5", bridgeUrl: "http://127.0.0.1:7331" }, r));
}

async function cacheGet(ids) {
  const keys = ids.map((i) => "v:" + i);
  const got = await chrome.storage.local.get(keys);
  const out = {}; const now = Date.now();
  for (const id of ids) { const v = got["v:" + id]; if (v && now - v.t < CACHE_TTL) out[id] = v.c; }
  return out;
}
async function cacheSet(map) {
  const obj = {}; const t = Date.now();
  for (const id in map) obj["v:" + id] = { c: map[id], t };
  await chrome.storage.local.set(obj);
}

function parseArray(text) {
  const m = String(text).match(/\[[\s\S]*\]/);
  if (!m) throw new Error("no JSON array in response");
  return JSON.parse(m[0]);
}

async function viaApi(items, s) {
  const user = items.map((it, i) => `${i}: ${it.text}`).join("\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": s.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: s.model || "claude-opus-5",
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: user }]
    })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message || res.statusText);
  if (j.stop_reason === "refusal") throw new Error("refused");
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseArray(text);
}

async function viaBridge(items, s) {
  const res = await fetch((s.bridgeUrl || "http://127.0.0.1:7331") + "/classify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: SYSTEM, items: items.map((it, i) => ({ i, text: it.text })) })
  });
  if (!res.ok) throw new Error("bridge " + res.status);
  const j = await res.json();
  return Array.isArray(j) ? j : parseArray(j.result || j.text || "");
}

async function classify(items) {
  const s = await getSettings();
  const ids = items.map((i) => i.id);
  const verdicts = await cacheGet(ids);
  const todo = items.filter((i) => !(i.id in verdicts));
  if (!todo.length || s.ai === "off") return { verdicts };
  let arr;
  try {
    arr = s.ai === "api" ? await viaApi(todo, s) : await viaBridge(todo, s);
  } catch (e) {
    await chrome.storage.local.set({ aiStatus: { ok: false, msg: String(e.message || e), t: Date.now() } });
    return { verdicts, error: String(e.message || e) };
  }
  const fresh = {};
  for (const row of arr) {
    const it = todo[row.i]; if (!it) continue;
    fresh[it.id] = (row.c || []).filter((k) => CAT_KEYS.includes(k));
  }
  for (const it of todo) if (!(it.id in fresh)) fresh[it.id] = [];
  await cacheSet(fresh);
  await chrome.storage.local.set({ aiStatus: { ok: true, msg: `${todo.length} labeled`, t: Date.now() } });
  return { verdicts: { ...verdicts, ...fresh } };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "classify") { classify(msg.items).then(reply).catch((e) => reply({ verdicts: {}, error: String(e) })); return true; }
  if (msg.type === "count" && sender.tab) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.n ? String(msg.n) : "" });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#e58fb0" });
    chrome.action.setBadgeTextColor?.({ tabId: sender.tab.id, color: "#1a1d22" });
  }
  if (msg.type === "testAI") {
    classify([{ id: "test-" + Date.now(), text: "Trump rally speech in Ohio · Fox News" }]).then(reply); return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.sync.get(null);
  if (!("cats" in cur)) await chrome.storage.sync.set({ enabled: true, mode: "blur", cats: { trump: true }, custom: [], ai: "off", model: "claude-opus-5" });
});
