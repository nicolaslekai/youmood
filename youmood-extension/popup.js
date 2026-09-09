const CATS = self.YOUMOOD_RULES.CATS;
const DESC = { trump: "Trump, MAGA, Mar-a-Lago", politics: "parties, elections, politicians, geopolitics", violence: "shootings, war, fights, crashes",
  news: "news channels, breaking, live coverage", sport: "leagues, matches, highlights", ads: "sponsored slots and promos in the feed", brands: "Apple, Tesla, Nike, McDonald's…" };
const DEF = { enabled: true, mode: "blur", cats: { trump: true }, custom: [], ai: "off", apiKey: "", model: "claude-opus-5" };
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
  $("#apiRow").hidden = S.ai !== "api"; $("#bridgeRow").hidden = S.ai !== "bridge";
  $("#aiBox").style.display = S.ai === "off" ? "none" : "";
  $("#apiKey").value = S.apiKey || ""; $("#model").value = S.model || "claude-opus-5";
}

chrome.storage.sync.get(DEF, (v) => { S = { ...DEF, ...v }; render(); });
$("#enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
$("#custom").addEventListener("change", (e) => save({ custom: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }));
$("#mode").addEventListener("click", (e) => { if (e.target.dataset.v) { save({ mode: e.target.dataset.v }); render(); } });
$("#ai").addEventListener("click", (e) => { if (e.target.dataset.v) { save({ ai: e.target.dataset.v }); render(); } });
$("#apiKey").addEventListener("change", (e) => save({ apiKey: e.target.value.trim() }));
$("#model").addEventListener("change", (e) => save({ model: e.target.value }));
$("#test").addEventListener("click", async () => {
  const st = $("#aiStatus"); st.className = "status"; st.textContent = "…";
  const r = await chrome.runtime.sendMessage({ type: "testAI" });
  const v = r && r.verdicts && Object.values(r.verdicts)[0];
  if (r && r.error) { st.className = "status bad"; st.textContent = r.error.slice(0, 60); }
  else { st.className = "status ok"; st.textContent = "ok → " + (v && v.length ? v.join(",") : "no label"); }
});
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs[0]) return;
  chrome.tabs.sendMessage(tabs[0].id, { type: "getCount" }, (r) => { if (!chrome.runtime.lastError && r) $("#count").textContent = r.n; });
});
