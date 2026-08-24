# Web Graffiti sandbox

A desktop browser prototype for drawing spray-paint graffiti over a generic editorial website. Agentation is mounted as a development-only feedback layer.

## Run locally

Install dependencies once:

```powershell
pnpm install
```

Start the Vite development server on Windows:

```powershell
.\start-agentation.ps1
```

Then open `http://127.0.0.1:4173/` in Chrome or Edge. Use the Agentation control to pin feedback directly to prototype elements. Agentation remains local by default and is only mounted while running the development server.

If Node.js is installed globally, `pnpm dev` works as an alternative. The PowerShell launcher also detects Codex Desktop's bundled Node runtime.

## Prototype controls

- Open **Graffiti mode** from the bottom-center button.
- Draw with the mouse; choose Spray or Eraser from the bottom Palette.
- Adjust the active tool with the continuous thickness slider.
- Drag the right-side zoom slider, use its +/− controls, or use `Ctrl`/`Cmd` + wheel to zoom the drawing canvas around the cursor. The editor scale runs from 0% (the page's full-size baseline) to 100% (4× magnification), and cannot shrink below 0%. Scroll vertically with the wheel, horizontally with a trackpad or `Shift` + wheel, and pan freely with Space-drag or middle-mouse drag. The circular-arrow icon returns to 0%.
- Undo with `Ctrl`/`Cmd` + `Z`; redo with `Ctrl`/`Cmd` + `Shift` + `Z` or `Ctrl` + `Y`.
- Close Graffiti Mode with the `×` at the end of the Palette or `Esc`.
- Open the upper-left **Prototype** badge to reset locally stored graffiti.

Graffiti is stored in browser local storage for the exact demo URL. Figma is intentionally unchanged.
