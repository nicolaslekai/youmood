# youmood

Your feed, your mood. Chrome extension that mutes categories on YouTube: Trump, politics,
violence, news, sport, ads, big brands, plus your own words. Muted cards are blurred
(with a "show" link) or hidden.

## Layout
- `youmood-extension/` — Manifest V3 extension (rules.js, content.js, background.js, popup)
- `youmood-bridge/` — local Node shim that runs `claude -p` on your subscription (port 7331)
- `site/` — landing page (single HTML)
- `design.md` — design truth (Honey system, pink accent)
- `renders/` — icon renders (ComfyUI / Nano Banana)

## Run
1. chrome://extensions → Developer mode → Load unpacked → `youmood-extension`
2. Optional AI: `cd youmood-bridge && node bridge.mjs` (or double-click start.command),
   then popup → AI check → "claude on this mac" → test.
   Env: `YOUMOOD_MODEL=sonnet` to pin a CLI model, `YOUMOOD_PORT` to change the port.
3. Or popup → "api key" → paste an Anthropic key, choose model (default claude-opus-5).

## How classification works
rules.js (instant, offline) → if nothing matched and AI is on, background.js batches up to
40 unclear cards to the bridge or the API, caches verdicts per video id for 7 days in
chrome.storage.local. Rules and AI both label all seven categories; the popup toggles
decide which labels mute.

## Known limits
- In-video ads (pre-roll) are not touched — that is ad-blocker territory.
- YouTube changes its DOM often; selectors live at the top of content.js.
- The Trump filter is title/channel based; a video *about* Trump without his name in
  the title only gets caught by the AI layer.

## Headless test
Branded Chrome ignores `--load-extension` since v137, so use Chrome for Testing:
```
CH="$HOME/.cache/chrome-for-testing/chrome/mac_arm-153.0.8010.36/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
node tools/test-extension.mjs "$PWD/youmood-extension" /tmp/out.png "https://www.youtube.com/results?search_query=trump+news"
# PRESET='{"ai":"bridge","cats":{"sport":true}}' presets the settings before the run
```
Prints card count, muted cards with reason, and writes out.png plus out_popup.png.
