// youmood browser — main process. Tabs are WebContentsViews under a toolbar window; every YouTube tab
// gets the youmood filter injected via inject/preload.js. Settings and AI cache live in userData.
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, shell, nativeTheme } = require("electron");
const path = require("path");
const store = require("./store");
const ai = require("./ai");

const UI_H = 84;               // tab strip + toolbar
const HOME = "youmood://home";
const isYouTube = (u) => /^https?:\/\/(www\.|m\.)?youtube\.com\//.test(u || "");

let win = null, popup = null;
const tabs = [];               // { id, view, counts }
let active = null, nextId = 1;

function ui(channel, ...args) { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args); }
function tabById(id) { return tabs.find((t) => t.id === id); }
function snapshot(t) {
  const wc = t.view.webContents;
  const url = wc.getURL();
  return { id: t.id, url: url.startsWith("file:") ? HOME : url, title: wc.getTitle() || "new tab", loading: wc.isLoading(),
    canBack: wc.navigationHistory.canGoBack(), canFwd: wc.navigationHistory.canGoForward(), muted: t.muted || 0, yt: isYouTube(url) };
}
function broadcast() { ui("tabs", { tabs: tabs.map(snapshot), active }); }

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  for (const t of tabs) { t.view.setBounds({ x: 0, y: UI_H, width: w, height: Math.max(0, h - UI_H) }); t.view.setVisible(t.id === active); }
}

function newTab(url = HOME, activate = true) {
  const view = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, "inject", "preload.js"), contextIsolation: true, sandbox: false, nodeIntegration: false, spellcheck: false }
  });
  const t = { id: nextId++, view, muted: 0 };
  tabs.push(t);
  win.contentView.addChildView(view);
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url }) => { newTab(url); return { action: "deny" }; });
  for (const ev of ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-start-loading", "did-stop-loading", "did-fail-load"]) wc.on(ev, broadcast);
  wc.on("did-navigate", () => { t.muted = 0; });
  wc.on("focus", () => { if (popup && !popup.isDestroyed()) popup.hide(); });
  wc.on("context-menu", (_e, p) => {
    const items = [];
    if (p.linkURL) items.push({ label: "Open link in new tab", click: () => newTab(p.linkURL, false) }, { type: "separator" });
    items.push({ role: "copy" }, { role: "paste" }, { type: "separator" }, { label: "Back", click: () => wc.navigationHistory.goBack() }, { label: "Reload", click: () => wc.reload() });
    Menu.buildFromTemplate(items).popup();
  });
  if (url === HOME) wc.loadFile(path.join(__dirname, "ui", "home.html")); else wc.loadURL(url);
  if (activate) active = t.id;
  layout(); broadcast();
  return t;
}

function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id); if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  win.contentView.removeChildView(t.view); t.view.webContents.close();
  if (active === id) active = tabs[Math.min(i, tabs.length - 1)]?.id ?? null;
  if (!tabs.length) newTab(); else { layout(); broadcast(); }
}

function normalizeUrl(s) {
  s = s.trim(); if (!s) return HOME;
  if (s === HOME || s === "home") return HOME;
  if (/^[a-z]+:\/\//i.test(s)) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$|:)/i.test(s) || /^localhost(:|\/|$)/.test(s)) return "http" + (s.startsWith("localhost") ? "" : "s") + "://" + s;
  return "https://www.youtube.com/results?search_query=" + encodeURIComponent(s);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 720, minHeight: 480, backgroundColor: "#1a1d22", title: "youmood",
    titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 14 },
    webPreferences: { preload: path.join(__dirname, "ui", "preload-ui.js"), contextIsolation: false, nodeIntegration: false, sandbox: false }
  });
  win.loadFile(path.join(__dirname, "ui", "index.html"));
  win.on("resize", layout);
  win.on("closed", () => { win = null; app.quit(); });
  win.webContents.on("did-finish-load", () => { if (!tabs.length) newTab(); else broadcast(); });
}

function openPopup() {
  const [wx, wy] = win.getPosition(); const [ww] = win.getSize();
  if (!popup || popup.isDestroyed()) {
    popup = new BrowserWindow({ width: 320, height: 620, frame: false, resizable: false, show: false, parent: win, backgroundColor: "#1a1d22",
      webPreferences: { preload: path.join(__dirname, "ui", "preload-popup.js"), contextIsolation: false, nodeIntegration: false, sandbox: false } });
    popup.loadFile(path.join(__dirname, "ext", "popup.html"));
    popup.on("blur", () => popup.hide());
  }
  popup.setPosition(wx + ww - 320 - 12, wy + UI_H - 2);
  popup.webContents.send("ym:refresh");
  popup.show(); popup.focus();
}

// ---- IPC from the toolbar UI
ipcMain.on("ui", (_e, msg) => {
  const t = tabById(active); const wc = t && t.view.webContents;
  switch (msg.type) {
    case "go": if (wc) { const u = normalizeUrl(msg.url); u === HOME ? wc.loadFile(path.join(__dirname, "ui", "home.html")) : wc.loadURL(u); } break;
    case "back": wc && wc.navigationHistory.goBack(); break;
    case "forward": wc && wc.navigationHistory.goForward(); break;
    case "reload": wc && wc.reload(); break;
    case "new": newTab(msg.url || HOME); break;
    case "close": closeTab(msg.id ?? active); break;
    case "activate": active = msg.id; layout(); broadcast(); break;
    case "popup": openPopup(); break;
    case "devtools": wc && wc.toggleDevTools(); break;
  }
});
ipcMain.handle("ui:state", () => ({ tabs: tabs.map(snapshot), active }));

// ---- IPC from injected filter and popup (chrome.* shim)
ipcMain.handle("ym:settings-get", () => store.getSettings());
ipcMain.handle("ym:settings-set", (_e, patch) => {
  store.setSettings(patch);
  for (const t of tabs) t.view.webContents.send("ym:settings-changed");
  broadcast();
});
ipcMain.handle("ym:classify", (_e, items) => ai.classify(items));
ipcMain.handle("ym:test", () => ai.classify([{ id: "test-" + Date.now(), text: "Trump rally speech in Ohio · Fox News" }]));
ipcMain.handle("ym:status", () => store.getStatus());
ipcMain.handle("ym:count-get", () => (tabById(active)?.muted) || 0);
ipcMain.on("ym:count", (e, n) => { const t = tabs.find((x) => x.view.webContents.id === e.sender.id); if (t) { t.muted = n; broadcast(); if (popup && popup.isVisible()) popup.webContents.send("ym:count", n); } });
ipcMain.on("ym:open", (_e, url) => { newTab(normalizeUrl(url)); });
ipcMain.on("ym:log", (_e, m) => console.log("[tab]", m));
ipcMain.on("ym:external", (_e, url) => shell.openExternal(url));

// ---- app
app.setName("youmood");
nativeTheme.themeSource = "dark";
app.whenReady().then(() => {
  const tpl = [
    { label: "youmood", submenu: [{ role: "about" }, { type: "separator" }, { label: "Settings…", accelerator: "Cmd+,", click: openPopup }, { type: "separator" }, { role: "hide" }, { role: "quit" }] },
    { label: "File", submenu: [
      { label: "New Tab", accelerator: "Cmd+T", click: () => newTab() },
      { label: "Close Tab", accelerator: "Cmd+W", click: () => closeTab(active) },
      { label: "Open Location", accelerator: "Cmd+L", click: () => ui("focus-url") }] },
    { role: "editMenu" },
    { label: "View", submenu: [
      { label: "Reload", accelerator: "Cmd+R", click: () => tabById(active)?.view.webContents.reload() },
      { label: "Back", accelerator: "Cmd+[", click: () => tabById(active)?.view.webContents.navigationHistory.goBack() },
      { label: "Forward", accelerator: "Cmd+]", click: () => tabById(active)?.view.webContents.navigationHistory.goForward() },
      { label: "Next Tab", accelerator: "Ctrl+Tab", click: () => { const i = tabs.findIndex((t) => t.id === active); active = tabs[(i + 1) % tabs.length].id; layout(); broadcast(); } },
      { type: "separator" },
      { label: "Page Dev Tools", accelerator: "Alt+Cmd+I", click: () => tabById(active)?.view.webContents.toggleDevTools() },
      { label: "Toolbar Dev Tools", click: () => win.webContents.toggleDevTools({ mode: "detach" }) },
      { type: "separator" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
  createWindow();
});
app.on("window-all-closed", () => app.quit());
