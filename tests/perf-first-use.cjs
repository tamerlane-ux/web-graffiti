const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:4173/";

(async () => {
  const browser = await chromium.launch({ executablePath: edgePath, headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    await page.evaluate(() => {
      window.__perfFrameGaps = [];
      window.__perfLongTasks = [];
      let previousFrame = performance.now();
      const sampleFrame = (timestamp) => {
        window.__perfFrameGaps.push(timestamp - previousFrame);
        previousFrame = timestamp;
        window.requestAnimationFrame(sampleFrame);
      };
      window.requestAnimationFrame(sampleFrame);
      new PerformanceObserver((entries) => {
        window.__perfLongTasks.push(...entries.getEntries().map((entry) => entry.duration));
      }).observe({ type: "longtask", buffered: true });
    });

    // Let the normal page finish its first paint; this measures only the Graffiti Mode transition.
    await page.waitForTimeout(2200);
    await page.evaluate(() => {
      window.__perfFrameGaps = [];
      window.__perfLongTasks = [];
    });

    await page.click("#graffiti-launch");
    await page.mouse.move(320, 300);
    await page.mouse.move(1100, 600, { steps: 6 });
    await page.waitForTimeout(350);

    const entry = await page.evaluate(() => ({
      maxFrameGap: Math.max(...window.__perfFrameGaps),
      longTasks: [...window.__perfLongTasks],
      viewportTransformActive: document.body.classList.contains("graffiti-viewport")
    }));

    console.log(JSON.stringify({ entry }, null, 2));
    assert.ok(entry.maxFrameGap < 400, `Graffiti Mode entry stalled for ${entry.maxFrameGap.toFixed(1)}ms`);
    assert.ok(entry.longTasks.every((duration) => duration < 100), "Graffiti Mode entry produced a blocking long task");
    assert.equal(entry.viewportTransformActive, false, "Viewport transform should stay lazy until zoom or pan");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
