# youmood

**A browser that matches your intentions.** youmood is its own macOS browser (Chromium via
Electron) that mutes what you do not want to see on YouTube, TikTok, news pages and image feeds:
Trump, politics, violence, news, sport, ads, big brands, plus your own words or intentions. Muted cards are blurred with a small "muted · show"
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
`content.js` has three site adapters: YouTube, TikTok and a generic one for everything else
(articles, headlines with links, figures and images with alt text). `rules.js` (instant, offline)
labels every card first. If nothing matched and AI is on, unclear cards are batched (up to 40) to the
chosen backend in `ai.js`, verdicts are cached per card id for 7 days:

- **on device (default, free, scalable)** — `Xenova/multilingual-e5-small` via transformers.js +
  onnxruntime in the main process. Titles are embedded and compared with category prototypes and
  with the user's own intentions ("crypto", "mukbang" …), so custom terms match by meaning.
  Thresholds and a margin over neutral prototypes live at the top of the `LOCAL` block. The model
  (about 110 MB) downloads once into `~/Library/Application Support/youmood/models`.
- **claude** — spawns the `claude` CLI on this mac (your subscription).
- **api key** — any OpenAI-compatible endpoint (NVIDIA NIM, Groq, OpenRouter, Gemini, Ollama,
  custom) or Anthropic. Extra keys in "more keys" rotate on 429/5xx so no single free tier is
  hammered. Shipping one shared key inside the app was rejected on purpose: it would not scale and
  could be extracted.

Rules and AI both label all seven categories; the popup toggles decide which labels mute. The pill
on a muted card never names the category or word.

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
