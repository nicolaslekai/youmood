const { ipcRenderer } = require("electron");
window.ym = {
  send: (msg) => ipcRenderer.send("ui", msg),
  state: () => ipcRenderer.invoke("ui:state"),
  onTabs: (f) => ipcRenderer.on("tabs", (_e, s) => f(s)),
  onFocusUrl: (f) => ipcRenderer.on("focus-url", () => f())
};
