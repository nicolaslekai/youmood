# youmood

**A browser that matches your intentions.** youmood is its own macOS browser (Chromium via
Electron) that mutes what you do not want to see on YouTube: Trump, politics, violence, news,
sport, ads, big brands, plus your own words. Muted cards are blurred with a small "muted · show"
pill that never names what it hid, or removed entirely.

Landing page: https://nicolaslekai.github.io/youmood/ · Download: GitHub Releases (arm64 DMG)

## Layout
- `youmood-browser/` — the browser. Electron main process, tab strip + toolbar (`ui/`), the
  filter injected into every YouTube tab (`inject/preload.src.js`, bundled by `build-inject.mjs`),
  AI classification in `ai.js`, settings + cache in `store.js`.
- `youmood-extension/` — the original Chrome extension. **Still the source of truth for the
  filter itself**: `rules.js`, `content.js`, `content.css` and the settings popup are copied into
  the browser by `npm run sync`. Edit them here, never in `youmood-browser/ext/`.
- `youmood-bridge/` — local HTTP shim so the *extension* can use the `claude` CLI. The browser
  spawns the CLI directly and does not need it.
- `site/` — landing page (single HTML), deployed to GitHub Pages on every push to `main`.
- `design.md` — design truth (Honey system, pink accent). Read before touching anything visual.
- `renders/` — icon renders and screenshots.

## Run from source
```
cd youmood-browser
npm install
npm start          # syncs the filter from ../youmood-extension, then launches
npm run build      # unsigned arm64 DMG + zip in youmood-browser/dist
```
If `npm install` leaves `node_modules/electron/dist` empty (npm's allow-scripts blocks the
postinstall), run `node node_modules/electron/install.js` or unzip the cached
`~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip` into that dist folder.

## How classification works
`rules.js` (instant, offline) labels every card first. If nothing matched and AI is on, unclear
cards are batched (up to 40) to the chosen backend, verdicts are cached per video id for 7 days.
Backends: `claude` CLI on this mac (your subscription) or an Anthropic API key. Rules and AI both
label all seven categories; the popup toggles decide which labels mute.

## Debugging the browser
`npx electron . --remote-debugging-port=9444` exposes every tab to the Chrome DevTools protocol;
`Alt+Cmd+I` opens dev tools for the current page. The main process logs `[tab] youmood injected`
for every YouTube load. Two gotchas already solved: YouTube enforces Trusted Types, so the filter
builds its pill with DOM calls, never `innerHTML`; and the tab preload runs sandboxed, so it
cannot `require` files, which is why the filter is bundled into `inject/preload.js`.

## Known limits
- In-video ads (pre-roll) are not touched. That is ad-blocker territory.
- YouTube changes its DOM often; selectors live at the top of `content.js`.
- The Trump filter is title/channel based; a video *about* Trump without his name in the title
  only gets caught by the AI layer.
- The DMG is unsigned and not notarized: first start needs right-click → Open.

## Headless test of the extension
Branded Chrome ignores `--load-extension` since v137, so use Chrome for Testing:
```
CH="$HOME/.cache/chrome-for-testing/chrome/mac_arm-153.0.8010.36/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
node tools/test-extension.mjs "$PWD/youmood-extension" /tmp/out.png "https://www.youtube.com/results?search_query=trump+news"
```
