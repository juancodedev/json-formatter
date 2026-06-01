# Premium JSON Formatter

A web-based JSON formatting tool with a powerful smart parser, built with [CodeMirror 6](https://codemirror.net/6/) and [Vite](https://vitejs.dev/).

## Features

- **Format JSON** with configurable indentation (2 spaces, 4 spaces, or tabs)
- **Minify JSON** — compact, single-line output
- **Smart Parser** — automatically detects and converts:
  - Standard JSON
  - Python dict literals (including `True`/`False`/`None`, `datetime`, `Decimal`, `u'...'` strings, nested objects)
  - Obfuscated formats (P.A.C.K.E.R., URL-encoded, JavascriptObfuscator, MyObfuscate)
  - Malformed JSON (via `jsonrepair`)
- **Copy to clipboard**
- **Download** formatted JSON as `.json` file
- **Import JSON** from a local file
- **Output formats**: JSON or Python dict
- **Dark/Light theme** with system preference auto-detection
- **Sidebar toggle** for a distraction-free editing experience
- **Preferences** persisted in `localStorage`
- **Keyboard shortcut**: `Ctrl/Cmd + Enter` to format

## Tech Stack

- [CodeMirror 6](https://codemirror.net/6/) — code editor with JSON syntax highlighting, search, and One Dark theme
- [Vite](https://vitejs.dev/) — dev server and build tool
- [js-beautify](https://github.com/beautifier/js-beautify) — advanced formatting
- [jsonrepair](https://github.com/josdejong/jsonrepair) — repair malformed JSON
- Vanilla CSS with CSS custom properties for theming

## Run Locally

```bash
npm install
npm run dev
```

Or simply open `index.html` in a browser (limited functionality without build step).

## Build

```bash
npm run build
npm run preview
```

## Project Structure

```
├── index.html       — Main HTML entry point
├── app.js           — Application logic (editor, formatting, theming)
├── unpackers.js     — Obfuscated code unpackers (P.A.C.K.E.R., etc.)
├── styles.css       — Styles and theme variables
├── favicon.ico      — Favicon
└── package.json     — Dependencies and scripts
```
