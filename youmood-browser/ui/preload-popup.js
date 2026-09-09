// chrome.* shim for the settings popup so the extension's popup.js runs untouched.
const { ipcRenderer } = require("electron");
window.chrome = {
  storage: {
    sync: {
      get: (defaults, cb) => ipcRenderer.invoke("ym:settings-get").then((v) => cb({ ...(defaults || {}), ...v })),
      set: (v) => ipcRenderer.invoke("ym:settings-set", v)
    }
  },
  runtime: {
    sendMessage: (msg) => (msg.type === "testAI" ? ipcRenderer.invoke("ym:test") : Promise.resolve()),
    lastError: null
  },
  tabs: {
    query: (_q, cb) => cb([{ id: 1 }]),
    sendMessage: (_id, msg, cb) => { if (msg.type === "getCount") ipcRenderer.invoke("ym:count-get").then((n) => cb({ n })); }
  }
};
ipcRenderer.on("ym:count", (_e, n) => { const el = document.querySelector("#count"); if (el) el.textContent = n; });
ipcRenderer.on("ym:refresh", () => { ipcRenderer.invoke("ym:count-get").then((n) => { const el = document.querySelector("#count"); if (el) el.textContent = n; }); });
ipcRenderer.on("ym:settings-changed", () => {});
window.addEventListener("keydown", (e) => { if (e.key === "Escape") window.close(); });
