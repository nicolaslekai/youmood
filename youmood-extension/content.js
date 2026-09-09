// youmood content script — scans YouTube cards, applies rules, asks background for AI verdicts, mutes.
(() => {
  const R = self.YOUMOOD_RULES;
  const DEFAULTS = { enabled: true, mode: "blur", cats: { trump: true }, custom: [], ai: "off" };
  let S = { ...DEFAULTS };
  let mutedCount = 0;
  const seen = new WeakMap(); // el -> { id, text }
  const aiVerdicts = new Map(); // videoId -> cats[]
  let pendingAI = new Map(); // videoId -> {el, text}
  let aiTimer = null;

  const CARD_SEL = [
    "ytd-rich-item-renderer", "ytd-video-renderer", "ytd-compact-video-renderer", "ytd-grid-video-renderer",
    "ytd-reel-item-renderer", "ytm-shorts-lockup-view-model", "ytd-playlist-renderer", "ytd-radio-renderer",
    "yt-lockup-view-model", "ytd-ad-slot-renderer", "ytd-promoted-sparkles-web-renderer",
    "ytd-in-feed-ad-layout-renderer", "ytd-promoted-video-renderer", "ytd-compact-promoted-video-renderer",
    "ytm-video-with-context-renderer", "ytm-compact-video-renderer", "ytm-rich-item-renderer"
  ].join(",");
  const AD_SEL = "ytd-ad-slot-renderer,ytd-promoted-sparkles-web-renderer,ytd-in-feed-ad-layout-renderer,ytd-promoted-video-renderer,ytd-compact-promoted-video-renderer,[is-ad],ytd-badge-supported-renderer .badge-style-type-ad,.ytd-ad-slot-renderer";
  const TITLE_SEL = "#video-title, a#video-title-link, h3 a, .yt-lockup-metadata-view-model-wiz__title, .yt-lockup-metadata-view-model__title, .shortsLockupViewModelHostMetadataTitle, .media-item-headline, h3";
  const CHAN_SEL = "#channel-name, ytd-channel-name, .yt-content-metadata-view-model-wiz__metadata-text, .yt-content-metadata-view-model__metadata-text, .ytd-channel-name, .media-item-metadata";

  function load() {
    return new Promise((res) => chrome.storage.sync.get(DEFAULTS, (v) => { S = { ...DEFAULTS, ...v }; res(); }));
  }

  function videoId(el) {
    const a = el.querySelector('a[href*="watch?v="], a[href*="/shorts/"]');
    if (!a) return null;
    const m = a.getAttribute("href").match(/(?:v=|\/shorts\/)([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : null;
  }

  function textOf(el) {
    const t = el.querySelector(TITLE_SEL);
    const c = el.querySelector(CHAN_SEL);
    let title = (t && (t.getAttribute("title") || t.textContent) || "").trim();
    let chan = (c && c.textContent || "").trim().split("\n")[0];
    if (!title) title = (el.innerText || "").split("\n").filter(Boolean).slice(0, 2).join(" ");
    return { title, chan, text: (title + " · " + chan).replace(/\s+/g, " ") };
  }

  function activeCats(hits) {
    return hits.filter((k) => S.cats[k]);
  }

  function mute(el, reason) {
    if (el.dataset.ymReason === reason) return;
    unmute(el);
    el.dataset.ymReason = reason;
    if (S.mode === "hide") { el.classList.add("ym-hidden"); }
    else {
      el.classList.add("ym-muted");
      const tag = document.createElement("div");
      tag.className = "ym-tag";
      // DOM calls, not innerHTML: YouTube enforces Trusted Types and innerHTML throws
      // The pill never names the category: seeing the word is exactly what the user wants gone.
      const s1 = document.createElement("span"); s1.textContent = "muted";
      const show = document.createElement("span"); show.className = "ym-show"; show.textContent = "show";
      show.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); unmute(el); el.dataset.ymForce = "1"; });
      tag.append(s1, show);
      el.prepend(tag);
    }
    mutedCount++; reportCount();
  }

  function unmute(el) {
    if (!el.dataset.ymReason) return;
    delete el.dataset.ymReason;
    el.classList.remove("ym-muted", "ym-hidden");
    el.querySelectorAll(":scope > .ym-tag").forEach((t) => t.remove());
    mutedCount = Math.max(0, mutedCount - 1); reportCount();
  }

  let countT = null;
  function reportCount() {
    clearTimeout(countT);
    countT = setTimeout(() => chrome.runtime.sendMessage({ type: "count", n: mutedCount }).catch?.(() => {}), 200);
  }

  function evaluate(el) {
    if (!S.enabled) { unmute(el); return; }
    if (el.dataset.ymForce) return;
    if (el.parentElement && el.parentElement.closest("[data-ym-reason]")) return; // parent already muted
    const isAd = el.matches(AD_SEL) || !!el.querySelector(AD_SEL);
    const { text } = textOf(el);
    if (!text.trim() && !isAd) return;
    const id = videoId(el);
    let hits = R.classify(text);
    if (isAd) hits.push("ads");
    if (id && aiVerdicts.has(id)) hits = hits.concat(aiVerdicts.get(id));
    hits = [...new Set(hits)];
    const custom = R.customHits(text, S.custom);
    const act = activeCats(hits);
    if (act.length) return mute(el, R.CATS[act[0]].label);
    if (custom.length) return mute(el, "“" + custom[0] + "”");
    unmute(el);
    // undecided by rules → queue for AI if enabled and any category on
    if (S.ai !== "off" && id && !aiVerdicts.has(id) && Object.values(S.cats).some(Boolean)) {
      pendingAI.set(id, { el, text });
      scheduleAI();
    }
  }

  function scheduleAI() {
    clearTimeout(aiTimer);
    aiTimer = setTimeout(flushAI, 600);
  }

  async function flushAI() {
    if (!pendingAI.size) return;
    const batch = [...pendingAI.entries()].slice(0, 40);
    batch.forEach(([id]) => pendingAI.delete(id));
    const items = batch.map(([id, v]) => ({ id, text: v.text }));
    try {
      const res = await chrome.runtime.sendMessage({ type: "classify", items });
      if (res && res.verdicts) {
        for (const id in res.verdicts) aiVerdicts.set(id, res.verdicts[id] || []);
        batch.forEach(([, v]) => evaluate(v.el));
      }
    } catch (e) { /* background asleep or backend off — rules still apply */ }
    if (pendingAI.size) scheduleAI();
  }

  function scan(root) {
    const nodes = root.matches && root.matches(CARD_SEL) ? [root] : [];
    root.querySelectorAll && nodes.push(...root.querySelectorAll(CARD_SEL));
    for (const el of nodes) {
      if (el.closest(".ym-muted") && el.closest(".ym-muted") !== el) continue;
      evaluate(el);
    }
  }

  function rescanAll() {
    document.querySelectorAll("[data-ym-reason]").forEach((el) => unmute(el));
    document.querySelectorAll("[data-ym-force]").forEach((el) => delete el.dataset.ymForce);
    mutedCount = 0;
    scan(document.body);
  }

  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
      if (m.type === "attributes" || m.type === "characterData") {
        const card = (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.(CARD_SEL);
        if (card && !card.dataset.ymForce) evaluate(card);
      }
    }
  });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "sync") return;
    load().then(rescanAll);
  });
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === "getCount") reply({ n: mutedCount });
  });

  document.documentElement.dataset.youmood = "1";
  load().then(() => {
    scan(document.body);
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["title", "href"] });
    // YouTube is an SPA — rescan on navigation
    window.addEventListener("yt-navigate-finish", () => setTimeout(rescanAll, 300));
  });
})();
