#!/usr/bin/env node
// youmood-bridge — local HTTP shim so the extension can use the `claude` CLI (your subscription) as classifier.
// Run: node bridge.mjs   (listens on 127.0.0.1:7331). Env: YOUMOOD_MODEL (optional, e.g. "sonnet"), YOUMOOD_PORT.
import http from "node:http";
import { spawn } from "node:child_process";

const PORT = Number(process.env.YOUMOOD_PORT || 7331);
const MODEL = process.env.YOUMOOD_MODEL || "";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, GET, OPTIONS" };

function runClaude(system, userText) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json", "--system-prompt", system, "--tools", ""];
    if (MODEL) args.push("--model", MODEL);
    const child = spawn("claude", args, { env: { ...process.env, CLAUDECODE: "" } });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error((err || out || "claude exited " + code).trim().slice(0, 300)));
      try { const j = JSON.parse(out); resolve(typeof j.result === "string" ? j.result : JSON.stringify(j.result)); }
      catch { resolve(out); }
    });
    child.stdin.end(userText);
  });
}

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
  if (req.method === "GET") { res.writeHead(200, { ...CORS, "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true, model: MODEL || "cli default" })); }
  if (req.method !== "POST" || req.url !== "/classify") { res.writeHead(404, CORS); return res.end(); }
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const { system, items } = JSON.parse(body);
      const text = items.map((it) => `${it.i}: ${it.text}`).join("\n");
      const out = await runClaude(system, text);
      const m = String(out).match(/\[[\s\S]*\]/);
      const arr = m ? JSON.parse(m[0]) : [];
      console.log(new Date().toISOString(), "labeled", items.length, "→", arr.filter((r) => r.c && r.c.length).length, "flagged");
      res.writeHead(200, { ...CORS, "content-type": "application/json" }); res.end(JSON.stringify(arr));
    } catch (e) {
      console.error("error", e.message);
      res.writeHead(500, { ...CORS, "content-type": "application/json" }); res.end(JSON.stringify({ error: e.message }));
    }
  });
}).listen(PORT, "127.0.0.1", () => console.log(`youmood-bridge on http://127.0.0.1:${PORT}  model=${MODEL || "cli default"}`));
