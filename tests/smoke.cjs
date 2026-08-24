const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:4173/";
let browser;

async function storedPieces(page) {
  return page.evaluate(() => {
    const key = "web-graffiti:page:" + window.location.href;
    return JSON.parse(localStorage.getItem(key) || "[]");
  });
}

async function paintStats(page) {
  const pieces = await storedPieces(page);
  return pieces.reduce((stats, piece) => ({
    pieces: stats.pieces + 1,
    samples: stats.samples + (piece.samples?.length || 0),
    fringe: stats.fringe + (piece.fringe?.length || 0),
    erasures: stats.erasures + (piece.erasures?.length || 0),
    legacyParticles: stats.legacyParticles + (piece.particles?.length || 0)
  }), { pieces: 0, samples: 0, fringe: 0, erasures: 0, legacyParticles: 0 });
}

(async () => {
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith("web-graffiti:")) localStorage.removeItem(key);
    }
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.waitForSelector("[data-agentation-toolbar=true]");
  assert.equal(await page.locator("#agentation-root").count(), 1, "Agentation's React host should mount in the development prototype");
  assert.equal(await page.locator("[data-agentation-toolbar=true]").count(), 1, "Agentation's feedback toolbar should render");

  assert.equal(await page.locator("#graffiti-launch").isVisible(), true, "idle trigger should be visible");
  assert.equal(await page.locator("#graffiti-controls").isVisible(), false, "controls should be hidden while browsing");

  await page.locator("#subscribe-button").click();
  await page.locator("#graffiti-launch").click();
  assert.equal(await page.locator("#graffiti-controls").isVisible(), true, "controls should open");

  const websiteIsLocked = await page.locator("#subscribe-button").evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) !== button;
  });
  assert.equal(websiteIsLocked, true, "Graffiti controls or canvas should intercept website interaction in Graffiti Mode");

  await page.mouse.move(390, 360);
  await page.mouse.down();
  await page.mouse.move(650, 360, { steps: 28 });
  await page.waitForTimeout(220);
  await page.mouse.up();
  await page.waitForTimeout(80);

  let pieces = await storedPieces(page);
  assert.equal(pieces.length, 1, "one spray action should create one piece");
  assert.ok(pieces[0].samples.length > 25, "spray action should store a continuous centerline");
  assert.ok(pieces[0].fringe.length > 25, "spray action should add sparse edge speckles");
  assert.equal(pieces[0].particles.length, 0, "new spray actions should not build the paint body from loose particles");
  assert.equal(pieces[0].size, 36, "spray action should preserve the selected thickness");
  assert.notEqual(pieces[0].anchorId, "page-root", "stroke should attach to a content anchor");

  await page.locator("#undo-button").click();
  assert.equal((await storedPieces(page)).length, 0, "undo should remove current-session spray action");
  await page.locator("#redo-button").click();
  assert.equal((await storedPieces(page)).length, 1, "redo should restore current-session spray action");

  await page.locator("#thickness-slider").evaluate((slider) => {
    slider.value = "8";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.mouse.move(390, 440);
  await page.mouse.down();
  await page.mouse.move(650, 440, { steps: 28 });
  await page.mouse.up();

  await page.locator("#thickness-slider").evaluate((slider) => {
    slider.value = "140";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.mouse.move(390, 560);
  await page.mouse.down();
  await page.mouse.move(650, 560, { steps: 28 });
  await page.mouse.up();
  await page.waitForTimeout(80);

  pieces = await storedPieces(page);
  assert.deepEqual(pieces.map((piece) => piece.size), [36, 8, 140], "thin and thick spray sizes should persist independently");
  const paintedStats = await paintStats(page);

  await page.locator("#eraser-tool").click();
  await page.locator("#thickness-slider").evaluate((slider) => {
    slider.value = "24";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.mouse.move(505, 345);
  await page.mouse.down();
  await page.mouse.move(535, 375, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const erasedStats = await paintStats(page);
  assert.ok(erasedStats.erasures > 0, "eraser should add destructive masks to owned spray marks");
  assert.equal(erasedStats.pieces, 3, "small eraser should leave the spray marks intact apart from its local mask");

  await page.waitForTimeout(2300);
  await page.screenshot({ path: path.join(__dirname, "..", "artifacts", "sandbox-active.png"), fullPage: false });

  await page.locator("#custom-color-button").click();
  assert.equal(await page.locator("#color-picker").isVisible(), true, "custom color picker should open above the Palette");
  assert.equal(await page.locator("text=HSL").count(), 0, "custom picker should not expose HSL controls");
  assert.equal(await page.locator("input[type=range]").evaluateAll((inputs) => inputs.some((input) => /opacity|density|alpha/i.test(input.getAttribute("aria-label") || ""))), false);
  await page.locator("#hex-input").fill("#12AB34");
  const customPreview = await page.locator("#custom-color-preview").evaluate((preview) => getComputedStyle(preview).backgroundColor);
  assert.equal(customPreview, "rgb(18, 171, 52)", "HEX input should update the custom color preview");
  await page.locator("#picker-close").click();

  const viewportBeforePan = await page.locator("#site-surface").evaluate((surface) => ({
    transform: surface.style.transform,
    scrollY: window.scrollY
  }));
  await page.mouse.move(720, 500);
  await page.mouse.wheel(0, 180);
  const viewportAfterWheel = await page.locator("#site-surface").evaluate((surface) => ({
    transform: surface.style.transform,
    scrollY: window.scrollY
  }));
  assert.notEqual(viewportAfterWheel.transform, viewportBeforePan.transform, "mouse-wheel scrolling should move the editor canvas vertically");
  assert.equal(viewportAfterWheel.scrollY, viewportBeforePan.scrollY, "editor scrolling should not move the browser window");

  await page.keyboard.down("Space");
  await page.mouse.move(720, 700);
  await page.mouse.down();
  await page.mouse.move(720, 500, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  const viewportAfterPan = await page.locator("#site-surface").evaluate((surface) => ({
    transform: surface.style.transform,
    scrollY: window.scrollY
  }));
  assert.notEqual(viewportAfterPan.transform, viewportAfterWheel.transform, "Space-drag should pan the editor canvas");
  assert.equal(viewportAfterPan.scrollY, viewportBeforePan.scrollY, "canvas panning should not use the browser window scroll");

  const controlsBeforeZoom = await page.locator(".zoom-controls").boundingBox();
  await page.locator("#zoom-in").click();
  await page.waitForTimeout(80);
  assert.equal(await page.locator("#zoom-value").textContent(), "5%", "zoom controls should use the remapped editor zoom percentage");
  const creativeZoom = await page.locator("#site-surface").evaluate((surface) => ({
    transform: surface.style.transform,
    cssZoom: surface.style.zoom
  }));
  const controlsAfterZoom = await page.locator(".zoom-controls").boundingBox();
  assert.match(creativeZoom.transform, /scale\(1\.15\)/, "zoom should transform the editor canvas");
  assert.equal(creativeZoom.cssZoom, "", "zoom should not use the browser-like CSS zoom property");
  assert.equal(controlsAfterZoom.width, controlsBeforeZoom.width, "zoom should keep editor controls at a fixed screen size");
  assert.equal(controlsAfterZoom.height, controlsBeforeZoom.height, "zoom should keep editor control typography and layout fixed");

  await page.locator("#zoom-slider").fill("25");
  await page.waitForTimeout(80);
  assert.equal(await page.locator("#zoom-value").textContent(), "25%", "zoom slider should update the page zoom in five-percent increments");
  assert.equal(await page.locator(".zoom-controls").evaluate((node) => node.classList.contains("show-readout")), true, "zoom slider should show visual percentage feedback");

  const transformBeforeHorizontalScroll = await page.locator("#site-surface").evaluate((surface) => surface.style.transform);
  await page.mouse.move(720, 400);
  await page.mouse.wheel(180, 0);
  const transformAfterHorizontalScroll = await page.locator("#site-surface").evaluate((surface) => surface.style.transform);
  assert.notEqual(transformAfterHorizontalScroll, transformBeforeHorizontalScroll, "trackpad-style horizontal scrolling should move the zoomed canvas left and right");

  await page.locator("#zoom-slider").fill("100");
  await page.waitForTimeout(80);
  assert.equal(await page.locator("#zoom-value").textContent(), "100%", "the top of the remapped control should retain 4× detail magnification");

  await page.locator("#spray-tool").click();
  await page.mouse.move(680, 330);
  await page.mouse.down();
  await page.mouse.move(760, 350, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  assert.equal((await storedPieces(page)).length, 4, "drawing coordinates should stay aligned at maximum canvas zoom");

  await page.locator("#zoom-reset").click();
  await page.waitForTimeout(80);
  assert.equal(await page.locator("#zoom-value").textContent(), "0%", "reset icon should restore the full-size baseline");
  assert.equal(await page.locator("#zoom-reset img").isVisible(), true, "reset zoom should use an icon");
  assert.equal(await page.locator("#zoom-out").isDisabled(), true, "the page should not zoom out below its full-size baseline");
  assert.match(await page.locator("#site-surface").evaluate((surface) => surface.style.transform), /scale\(1\)/, "0% should map to the original full-size page");

  await page.locator("#close-mode").click();
  assert.equal(await page.locator("#graffiti-controls").isVisible(), false, "close control should leave Graffiti Mode");
  assert.equal(await page.locator("#graffiti-launch").isVisible(), true, "idle trigger should return");
  assert.equal(await page.locator("#graffiti-canvas").evaluate((canvas) => getComputedStyle(canvas).pointerEvents), "none");

  await page.waitForTimeout(2300);
  await page.screenshot({ path: path.join(__dirname, "..", "artifacts", "sandbox-drawing.png"), fullPage: false });
  const statsBeforeReload = await paintStats(page);
  await page.reload({ waitUntil: "networkidle" });
  assert.deepEqual(await paintStats(page), statsBeforeReload, "graffiti should persist for the exact URL");

  await page.evaluate(() => { window.location.hash = "alternate-surface"; });
  await page.waitForTimeout(100);
  assert.equal((await paintStats(page)).pieces, 0, "a different exact URL should have a different surface");
  await page.goBack({ waitUntil: "networkidle" });
  assert.deepEqual(await paintStats(page), statsBeforeReload, "returning to the exact URL should restore its graffiti");

  await page.locator("#prototype-toggle").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#reset-prototype").click();
  assert.equal((await paintStats(page)).pieces, 0, "prototype reset should clear graffiti");

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2300);
  await page.screenshot({ path: path.join(__dirname, "..", "artifacts", "sandbox-1280.png"), fullPage: false });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator("#graffiti-launch").click();
  const paletteBounds = await page.locator(".palette").boundingBox();
  assert.ok(paletteBounds && paletteBounds.x >= 0 && paletteBounds.x + paletteBounds.width <= 1024, "Palette should fit a narrow desktop viewport");
  await page.screenshot({ path: path.join(__dirname, "..", "artifacts", "sandbox-active-1024.png"), fullPage: false });
  await page.locator("#close-mode").click();
  assert.equal(errors.length, 0, "browser should not report runtime errors: " + errors.join(" | "));

  console.log(JSON.stringify({
    status: "passed",
    paintedStats,
    erasedStats,
    anchorId: pieces[0].anchorId,
    viewports: ["1440x900", "1280x720", "1024x768"]
  }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser && browser.isConnected()) await browser.close();
});
