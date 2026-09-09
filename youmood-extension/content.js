// youmood content script — finds "cards" on any site (YouTube, TikTok, news pages, image feeds),
// applies rules, asks the background/main process for AI verdicts, mutes.
(() => {
  const R = self.YOUMOOD_RULES;
  const DEFAULTS = { enabled: true, mode: "blur", cats: { trump: true }, custom: [], ai: "off", sites: "all" };
  let S = { ...DEFAULTS };
  let mutedCount = 0;
  const aiVerdicts = new Map(); // id -> cats[]
  let pendingAI = new Map(); // id -> {el, text}
  let aiTimer = null;
  const host = location.hostname;

  // ---------- site adapters: how to find a card, its text and a stable id ----------
  const YT = {
    name: "youtube",
    card: [
      "ytd-rich-item-renderer", "ytd-video-renderer", "ytd-compact-video-renderer", "ytd-grid-video-renderer",
      "ytd-reel-item-renderer", "ytm-shorts-lockup-view-model", "ytd-playlist-renderer", "ytd-radio-renderer",
      "yt-lockup-view-model", "ytd-ad-slot-renderer", "ytd-promoted-sparkles-web-renderer",
      "ytd-in-feed-ad-layout-renderer", "ytd-promoted-video-renderer", "ytd-compact-promoted-video-renderer",
      "ytm-video-with-context-renderer", "ytm-compact-video-renderer", "ytm-rich-item-renderer"
    ].join(","),
    ad: "ytd-ad-slot-renderer,ytd-promoted-sparkles-web-renderer,ytd-in-feed-ad-layout-renderer,ytd-promoted-video-renderer,ytd-compact-promoted-video-renderer,[is-ad],ytd-badge-supported-renderer .badge-style-type-ad,.ytd-ad-slot-renderer",
    title: "#video-title, a#video-title-link, h3 a, .yt-lockup-metadata-view-model-wiz__title, .yt-lockup-metadata-view-model__title, .shortsLockupViewModelHostMetadataTitle, .media-item-headline, h3",
    chan: "#channel-name, ytd-channel-name, .yt-content-metadata-view-model-wiz__metadata-text, .yt-content-metadata-view-model__metadata-text, .ytd-channel-name, .media-item-metadata",
    id(el) {
      const a = el.querySelector('a[href*="watch?v="], a[href*="/shorts/"]');
      const m = a && a.getAttribute("href").match(/(?:v=|\/shorts\/)([A-Za-z0-9_-]{6,})/);
      return m ? "yt:" + m[1] : null;
    }
  };
  const TIKTOK = {
    name: "tiktok",
    card: '[data-e2e="recommend-list-item-container"], [data-e2e="search_top-item"], [data-e2e="search_video-item"], [data-e2e="user-post-item"], [data-e2e="explore-item"], [data-e2e="challenge-item"], div[class*="DivItemContainer"]',
    ad: '[data-e2e="ad-label"], [class*="AdLabel"]',
    title: '[data-e2e="explore-card-desc"], [data-e2e="video-desc"], [data-e2e="browse-video-desc"], [data-e2e="search-card-desc"], [data-e2e="new-desc-span"], img[alt]',
    chan: '[data-e2e="explore-card-user-unique-id"], [data-e2e="video-author-uniqueid"], [data-e2e="browse-username"], [data-e2e="search-card-user-unique-id"]',
    id(el) {
      const a = el.querySelector('a[href*="/video/"]');
      const m = a && a.getAttribute("href").match(/\/video\/(\d+)/);
      return m ? "tt:" + m[1] : null;
    }
  };
  // Any other site: headlines with links (news), figures / images with real alt text (image feeds), articles.
  const GENERIC = {
    name: "generic",
    card: "article, [role=article], li, figure, [class*='card' i], [class*='teaser' i], [class*='story' i], [class*='item' i], [class*='post' i], [class*='tile' i], [class*='entry' i]",
    ad: "[class*='sponsored' i], [class*='advert' i], [id*='advert' i], [data-ad], [class*='promo' i]",
    title: "h1, h2, h3, h4, [class*='headline' i], [class*='title' i], img[alt]",
    chan: "[class*='source' i], [class*='byline' i], [class*='author' i], [class*='kicker' i], [class*='label' i]",
    id(el) { const a = el.querySelector("a[href]"); return a ? "url:" + a.href.split("#")[0].slice(0, 200) : null; },
    // a generic candidate only counts as a card if it holds a headline or a captioned image and is not the whole page
    accept(el) {
      if (el.matches("html, body, main, nav, header, footer, aside")) return false;
      const r = el.getBoundingClientRect(); if (r.width > innerWidth * 0.92 && r.height > innerHeight * 0.9) return false;
      if (el.querySelector("article, [role=article]") && !el.matches("article, [role=article]")) return false; // container of cards, not a card
      const h = el.querySelector("h1, h2, h3, h4, [class*='headline' i], [class*='title' i]");
      const img = el.querySelector("img[alt]");
      const ok = (h && h.textContent.trim().length > 8) || (img && img.alt.trim().length > 12);
      return !!ok && el.querySelectorAll("h1, h2, h3, h4").length <= 3;
    }
  };
  const A = /(^|\.)youtube\.com$/.test(host) ? YT : /(^|\.)tiktok\.com$/.test(host) ? TIKTOK : GENERIC;
  const CARD_SEL = A.card, AD_SEL = A.ad, TITLE_SEL = A.title, CHAN_SEL = A.chan;

  function load() {
    return new Promise((res) => chrome.storage.sync.get(DEFAULTS, (v) => { S = { ...DEFAULTS, ...v }; res(); }));
  }

  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  function idOf(el, text) { return A.id(el) || (text ? "tx:" + hash(host + "|" + text) : null); }

  function textOf(el) {
    const t = el.querySelector(TITLE_SEL);
    const c = el.querySelector(CHAN_SEL);
    let title = "";
    if (t) title = (t.tagName === "IMG" ? t.alt : (t.getAttribute("title") || t.textContent) || "").trim();
    if (!title && A === GENERIC) { const img = el.querySelector("img[alt]"); if (img) title = img.alt.trim(); const cap = el.querySelector("figcaption"); if (cap) title += " " + cap.textContent.trim(); }
    let chan = (c && c.textContent || "").trim().split("\n")[0].slice(0, 80);
    if (!title) title = (el.innerText || "").split("\n").filter(Boolean).slice(0, 2).join(" ");
    title = title.slice(0, 300);
    return { title, chan, text: (title + " · " + chan).replace(/\s+/g, " ").trim() };
  }

  function activeCats(hits) { return hits.filter((k) => S.cats[k]); }

  function mute(el, reason) {
    if (el.dataset.ymReason === reason) return;
    unmute(el);
    el.querySelectorAll("[data-ym-reason]").forEach(unmute); // a muted parent covers its children
    el.dataset.ymReason = reason;
    if (S.mode === "hide") { el.classList.add("ym-hidden"); }
    else {
      el.classList.add("ym-muted");
      const tag = document.createElement("div");
      tag.className = "ym-tag";
      // DOM calls, not innerHTML: many sites (YouTube) enforce Trusted Types and innerHTML throws.
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
    if (A.accept && !A.accept(el)) return;
    const isAd = el.matches(AD_SEL) || !!el.querySelector(AD_SEL);
    const { text } = textOf(el);
    if (!text.trim() && !isAd) return;
    const id = idOf(el, text);
    let hits = R.classify(text);
    if (isAd) hits.push("ads");
    if (id && aiVerdicts.has(id)) hits = hits.concat(aiVerdicts.get(id));
    hits = [...new Set(hits)];
    const custom = R.customHits(text, S.custom);
    const act = activeCats(hits);
    if (act.length) return mute(el, R.CATS[act[0]].label);
    const aiCustom = hits.find((h) => String(h).startsWith("custom:") && S.custom.includes(h.slice(7)));
    if (custom.length || aiCustom) return mute(el, "“" + (custom[0] || aiCustom.slice(7)) + "”");
    unmute(el);
    // undecided by rules → queue for AI if enabled and anything is switched on
    if (S.ai !== "off" && id && !aiVerdicts.has(id) && (Object.values(S.cats).some(Boolean) || S.custom.length)) {
      pendingAI.set(id, { el, text });
      scheduleAI();
    }
  }

  function scheduleAI() { clearTimeout(aiTimer); aiTimer = setTimeout(flushAI, 600); }

  async function flushAI() {
    if (!pendingAI.size) return;
    const batch = [...pendingAI.entries()].slice(0, 40);
    batch.forEach(([id]) => pendingAI.delete(id));
    const items = batch.map(([id, v]) => ({ id, text: v.text }));
    try {
      const res = await chrome.runtime.sendMessage({ type: "classify", items, custom: S.custom, host });
      if (res && res.verdicts) {
        for (const id in res.verdicts) aiVerdicts.set(id, res.verdicts[id] || []);
        batch.forEach(([, v]) => evaluate(v.el));
      }
    } catch (e) { /* backend off — rules still apply */ }
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

  let scanT = null; const dirty = new Set();
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.nodeType === 1 && !n.classList?.contains("ym-tag")) dirty.add(n);
      if (m.type === "attributes" || m.type === "characterData") {
        const card = (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.(CARD_SEL);
        if (card && !card.dataset.ymForce) dirty.add(card);
      }
    }
    clearTimeout(scanT); scanT = setTimeout(() => { const d = [...dirty]; dirty.clear(); d.forEach((n) => n.isConnected && scan(n)); }, A === GENERIC ? 150 : 0);
  });

  chrome.storage.onChanged.addListener((ch, area) => { if (area === "sync") load().then(rescanAll); });
  chrome.runtime.onMessage.addListener((msg, _s, reply) => { if (msg.type === "getCount") reply({ n: mutedCount }); });

  document.documentElement.dataset.youmood = A.name;
  load().then(() => {
    scan(document.body);
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["title", "href", "alt"] });
    window.addEventListener("yt-navigate-finish", () => setTimeout(rescanAll, 300)); // YouTube SPA
    let lastUrl = location.href; setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(rescanAll, 400); } }, 800); // other SPAs
  });
})();
