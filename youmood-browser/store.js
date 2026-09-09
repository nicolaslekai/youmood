// Settings + AI verdict cache as JSON files in userData (~/Library/Application Support/youmood).
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const DEF = { enabled: true, mode: "blur", cats: { trump: true }, custom: [], ai: "off", apiKey: "", model: "claude-opus-5", cliModel: "" };
let settings = null, cache = null, status = { ok: null, msg: "", t: 0 };
const file = (n) => path.join(app.getPath("userData"), n);
function readJson(n, fb) { try { return JSON.parse(fs.readFileSync(file(n), "utf8")); } catch { return fb; } }
function writeJson(n, v) { fs.mkdirSync(app.getPath("userData"), { recursive: true }); fs.writeFileSync(file(n), JSON.stringify(v)); }

module.exports = {
  getSettings() { if (!settings) settings = { ...DEF, ...readJson("settings.json", {}) }; return settings; },
  setSettings(patch) { settings = { ...this.getSettings(), ...patch }; writeJson("settings.json", settings); return settings; },
  cacheGet(ids, ttl) {
    if (!cache) cache = readJson("cache.json", {});
    const out = {}, now = Date.now();
    for (const id of ids) { const v = cache[id]; if (v && now - v.t < ttl) out[id] = v.c; }
    return out;
  },
  cacheSet(map) {
    if (!cache) cache = readJson("cache.json", {});
    const t = Date.now(); for (const id in map) cache[id] = { c: map[id], t };
    clearTimeout(this._w); this._w = setTimeout(() => writeJson("cache.json", cache), 1500);
  },
  setStatus(s) { status = { ...s, t: Date.now() }; },
  getStatus() { return status; }
};
