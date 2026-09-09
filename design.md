# youmood — Design-Wahrheit

Honey-System auf Dunkel, Akzent in dezentem Pink. Ruhig, dicht, werkzeughaft.
Abgeleitet aus der Kimi-Jimmy-Design-Wahrheit (Flächenleiter, ein Akzent, Rot nur
bei Gefahr), Akzent getauscht: Honig → Mood-Pink. Entschieden 09.09.2026.

**Vor jeder UI-Änderung lesen. Nie ein rohes Hex in eine neue Regel.**

## Flächen — eine Leiter

| Token | Wert | Rolle |
|---|---|---|
| `--bg` | `#1a1d22` | App-Hintergrund |
| `--panel` | `#21252b` | Panels, Leisten |
| `--card` | `#262b33` | Karten, Ghost-Buttons |
| `--field` | `#2c323b` | Eingabefelder |
| `--line` | `#333a44` | 1px-Trennung überall |

Eine Komponente sitzt genau eine Stufe über ihrem Container.

## Schrift-Farben

| Token | Wert | Rolle |
|---|---|---|
| `--ink` | `#e8eaed` | Primärtext |
| `--ink2` | `#aeb5bf` | Sekundär |
| `--ink-dim` | `#7c8490` | Labels, Deaktiviertes |

## Akzent — Mood-Pink, dezent

| Token | Wert | Rolle |
|---|---|---|
| `--mood` | `#e58fb0` | der eine Akzent (Text, Icons, aktive Toggles) |
| `--mood-d` | `#d47a9c` | Hover/Pressed auf gefülltem Pink |
| `--mood-dim` | `rgba(229,143,176,.45)` | Rahmen, aktive Kanten |
| `--mood-ghost` | `rgba(229,143,176,.10)` | Flächen-Hauch, Selektion |

Pro Ansicht genau ein gefülltes Pink-Element. Alles andere Ghost.
Pink liegt überwiegend auf Text und Icon, selten als Fläche.

## Status

| Token | Wert | Rolle |
|---|---|---|
| `--ok` | `#46a578` | verbunden, aktiv |
| `--wait` | `#d08a2f` | wartend |
| `--bad` | `#d97070` | nur Hover auf Zerstörendes oder echter Fehler |

## Typografie

- `--disp` Space Grotesk 700, letter-spacing −0.2…−0.3px — Wordmark, Zahlen, h2 (14–26px)
- `--ui` Inter 400/500/600 — alles Bedienbare, 10–13.5px
- `--mono` JetBrains Mono → SF Mono → Menlo — IDs, Modelle, Zähler
- Mikro-Labels: uppercase, letter-spacing .8px, `--ink-dim`, 9–10px

Wordmark: `youmood` klein geschrieben, Space Grotesk 700, das zweite `o` in `--mood`.

## Form & Motion

- Radius 10px Basis, Pills (999px) für Chips/Status/Toggles, 8px für kleine Controls
- Rahmen immer 1px solid `--line`
- Fokus-Ring `0 0 0 3px rgba(229,143,176,.25)`
- Transitions .12s, nur color/background/border/transform/opacity
- Keine Schatten außer Popover `0 8px 24px rgba(0,0,0,.35)`

## Im Feed (Content-Script auf YouTube)

Gemutete Karten: blur 14px + Sättigung 0, darüber eine Pill in `--panel` mit
1px `--line`, Text `--ink2`, Kategorie in `--mood`. Kein Rot. Ein „zeigen"-Link.
