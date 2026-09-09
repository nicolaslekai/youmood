const CATS = self.YOUMOOD_RULES.CATS;
const DESC = { trump: "Trump, MAGA, Mar-a-Lago", politics: "parties, elections, politicians, geopolitics", violence: "shootings, war, fights, crashes",
  news: "news channels, breaking, live coverage", sport: "leagues, matches, highlights", ads: "sponsored slots and promos in the feed", brands: "Apple, Tesla, Nike, McDonald's…" };
const PROVIDERS = {
  nvidia: { url: "https://integrate.api.nvidia.com/v1", model: "meta/llama-3.1-8b-instruct" },
  groq: { url: "https://api.groq.com/openai/v1", model: "llama-3.1-8b-instant" },
  openrouter: { url: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.1-8b-instruct:free" },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash-lite" },
  ollama: { url: "http://127.0.0.1:11434/v1", model: "llama3.2" },
  anthropic: { url: "https://api.anthropic.com", model: "claude-haiku-4-5" },
  custom: { url: "", model: "" }
};
const DEF = { enabled: true, mode: "blur", cats: { trump: true }, custom: [], ai: "off", provider: "nvidia", baseUrl: "", apiKey: "", model: "", moreKeys: "" };
let S;
const $ = (s) => document.querySelector(s);

function save(patch) { Object.assign(S, patch); chrome.storage.sync.set(S); }

function render() {
  $("#enabled").checked = S.enabled;
  const list = $("#cats"); list.innerHTML = "";
  for (const k in CATS) {
    const row = document.createElement("label"); row.className = "item";
    row.innerHTML = `<div><div class="t"></div><div class="d"></div></div><input type="checkbox"><span class="sw"></span>`;
    row.querySelector(".t").textContent = CATS[k].label; row.querySelector(".d").textContent = DESC[k] || "";
    const cb = row.querySelector("input"); cb.checked = !!S.cats[k];
    cb.addEventListener("change", () => save({ cats: { ...S.cats, [k]: cb.checked } }));
    list.appendChild(row);
  }
  $("#custom").value = S.custom.join(", ");
  document.querySelectorAll("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.mode));
  document.querySelectorAll("#ai button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.ai));
  $("#localRow").hidden = S.ai !== "local"; $("#apiRow").hidden = S.ai !== "key"; $("#bridgeRow").hidden = S.ai !== "cli";
  $("#aiBox").style.display = S.ai === "off" ? "none" : "";
  const p = PROVIDERS[S.provider] || PROVIDERS.custom;
  $("#provider").value = S.provider || "nvidia";
  $("#baseUrl").value = S.baseUrl || p.url; $("#baseUrl").readOnly = !["custom", "ollama"].includes(S.provider);
  $("#apiKey").value = S.apiKey || ""; $("#apiKey").placeholder = S.provider === "ollama" ? "no key needed" : "api key";
  $("#model").value = S.model || p.model; $("#moreKeys").value = S.moreKeys || "";
}

chrome.storage.sync.get(DEF, (v) => { S = { ...DEF, ...v }; if (S.ai === "bridge") S.ai = "cli"; if (S.ai === "api") S.ai = "key"; render(); });
$("#enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
$("#custom").addEventListener("change", (e) => save({ custom: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }));
$("#mode").addEventListener("click", (e) => { if (e.target.dataset.v) { save({ mode: e.target.dataset.v }); render(); } });
$("#ai").addEventListener("click", (e) => { if (e.target.dataset.v) { save({ ai: e.target.dataset.v }); render(); } });
$("#provider").addEventListener("change", (e) => { const p = PROVIDERS[e.target.value]; save({ provider: e.target.value, baseUrl: p.url, model: p.model }); render(); });
$("#baseUrl").addEventListener("change", (e) => save({ baseUrl: e.target.value.trim() }));
$("#apiKey").addEventListener("change", (e) => save({ apiKey: e.target.value.trim() }));
$("#model").addEventListener("change", (e) => save({ model: e.target.value.trim() }));
$("#moreKeys").addEventListener("change", (e) => save({ moreKeys: e.target.value }));
$("#test").addEventListener("click", async () => {
  const st = $("#aiStatus"); st.className = "status"; st.textContent = "…";
  const r = await chrome.runtime.sendMessage({ type: "testAI" });
  const v = r && r.verdicts && Object.values(r.verdicts)[0];
  if (r && r.error) { st.className = "status bad"; st.textContent = r.error.slice(0, 70); }
  else { st.className = "status ok"; st.textContent = "ok → " + (v && v.length ? v.join(",") : "no label") + (r.via ? " · " + r.via : ""); }
});
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs[0]) return;
  chrome.tabs.sendMessage(tabs[0].id, { type: "getCount" }, (r) => { if (!chrome.runtime.lastError && r) $("#count").textContent = r.n; });
});
