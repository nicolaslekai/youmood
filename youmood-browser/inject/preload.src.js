// SOURCE of the tab preload. `npm run sync` bundles this with content.css, rules.js and content.js from
// ../youmood-extension into inject/preload.js so it runs sandboxed (no fs, no require of local files).
// On YouTube it provides a chrome.* shim and runs the exact filter code the extension ships.
const { ipcRenderer, contextBridge } = require("electron");

const onYouTube = /(^|\.)youtube\.com$/.test(location.hostname);
const log = (...a) => ipcRenderer.send("ym:log", a.map(String).join(" "));

if (onYouTube) {
  const changed = [], msgs = [];
  const chrome = {
    storage: {
      sync: {
        get: (defaults, cb) => ipcRenderer.invoke("ym:settings-get").then((v) => cb({ ...(defaults || {}), ...v })),
        set: (v) => ipcRenderer.invoke("ym:settings-set", v)
      },
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: (f) => changed.push(f) }
    },
    runtime: {
      sendMessage: (msg) => {
        if (msg.type === "classify") return ipcRenderer.invoke("ym:classify", msg.items);
        if (msg.type === "count") { ipcRenderer.send("ym:count", msg.n); return Promise.resolve(); }
        return Promise.resolve();
      },
      onMessage: { addListener: (f) => msgs.push(f) }
    }
  };
  ipcRenderer.on("ym:settings-changed", () => changed.forEach((f) => f({}, "sync")));
  self.chrome = chrome;

  const run = () => {
    try {
      const style = document.createElement("style");
      style.textContent = /*__CSS__*/"";
      (document.head || document.documentElement).appendChild(style);
      /*__RULES__*/
      /*__CONTENT__*/
      log("youmood injected on", location.href);
    } catch (e) { log("youmood inject FAILED:", e.stack || e); }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
}

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("youmood", { open: (u) => ipcRenderer.send("ym:open", u) });
}
