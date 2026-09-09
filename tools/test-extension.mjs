// Launch headless Chrome with the youmood extension, open YouTube, report what got muted, screenshot.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createHash } from "node:crypto";
const EXT_ID = [...createHash("sha256").update(process.argv[2]).digest("hex").slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join("");
const CH = process.env.CH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EXT = process.argv[2], OUT = process.argv[3], URL = process.argv[4] || "https://www.youtube.com/";
const prof = fs.mkdtempSync("/tmp/ymprof-");
const chrome = spawn(CH, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1400,1100", "--remote-debugging-port=9333",
  `--user-data-dir=${prof}`, `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, "--lang=en-US", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2500);
const list = await fetch("http://127.0.0.1:9333/json/list").then((r) => r.json());
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send("Page.enable"); await send("Runtime.enable");
if (process.env.PRESET) {
  { await send("Page.navigate",{url:`chrome-extension://${EXT_ID}/popup.html`}); await sleep(1200);
    console.log("preset:", await ev(`chrome.storage.sync.set(${process.env.PRESET}).then(()=>"ok")`)); }
}
await send("Page.navigate", { url: URL });
await sleep(7000);
let url = await ev("location.href"); console.log("url:", url);
if (/consent/.test(url)) {
  // decline non-essential
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/reject all|alle ablehnen/i.test(b.textContent));if(b){b.click();return 'clicked reject'}return 'no reject btn'})()`).then(console.log);
  await sleep(7000); url = await ev("location.href"); console.log("url:", url);
}
await ev(`(()=>{const b=[...document.querySelectorAll('button, tp-yt-paper-button')].find(b=>/^\s*reject all\s*$/i.test(b.textContent));if(b){b.click();return 'rejected'}return 'no dialog'})()`).then(console.log); await sleep(3000);
await ev("window.scrollTo(0,800)"); await sleep(2500); await ev("window.scrollTo(0,0)"); await sleep(1500);
const report = await ev(`(()=>{
  const cards=[...document.querySelectorAll('ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer,yt-lockup-view-model,ytd-ad-slot-renderer')];
  const muted=[...document.querySelectorAll('[data-ym-reason]')].map(e=>e.dataset.ymReason+' :: '+(e.querySelector('#video-title, h3, .yt-lockup-metadata-view-model-wiz__title')?.textContent||'').trim().slice(0,70));
  const sample=cards.slice(0,8).map(e=>(e.querySelector('#video-title, h3, .yt-lockup-metadata-view-model-wiz__title, [title]')?.textContent||e.innerText||'').trim().replace(/\\s+/g,' ').slice(0,70));
  return {ext:document.documentElement.dataset.youmood, cards:cards.length, mutedCount:muted.length, muted, sample, tagCss:!!document.querySelector('.ym-tag')};
})()`);
console.log(JSON.stringify(report, null, 1));
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(OUT, Buffer.from(shot.result.data, "base64")); console.log("shot", OUT);
{ const extId=EXT_ID; await send("Emulation.setDeviceMetricsOverride",{width:320,height:660,deviceScaleFactor:2,mobile:false});
  await send("Page.navigate",{url:`chrome-extension://${extId}/popup.html`}); await sleep(1500);
  const sh2=await send("Page.captureScreenshot",{format:"png"}); fs.writeFileSync(OUT.replace(/\.png$/,"_popup.png"),Buffer.from(sh2.result.data,"base64")); console.log("popup shot"); }
ws.close(); chrome.kill(); try{fs.rmSync(prof,{recursive:true,force:true})}catch{}
