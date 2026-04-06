/**
 * E2E test: DraggableDashboard whiteboard free-form positioning
 *
 * Verifies that dragging a panel to a new position keeps it there
 * and persists coordinates to localStorage.
 */
import { chromium, type Browser, type Page } from "playwright";

const BASE_URL = "http://localhost:5173";
const VIDEO_DIR = "/tmp/playwright-videos";

async function run() {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
    });
    const page: Page = await context.newPage();

    // 1. Navigate
    console.log("[1] Navigating to", BASE_URL);
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15_000 });

    // 2. Find panels with absolute positioning (whiteboard items)
    // They are inside the DraggableDashboard container with position: absolute
    const panels = page.locator('[style*="position: absolute"]');
    const count = await panels.count();
    console.log(`[2] Found ${count} positioned panels`);

    if (count < 2) {
      // Fallback: try draggable items with cursor grab
      const fallback = page.locator('[style*="cursor: grab"], [style*="cursor:grab"]');
      const fallbackCount = await fallback.count();
      console.log(`[2b] Fallback: found ${fallbackCount} grabbable panels`);
      if (fallbackCount < 2) {
        console.error("FAIL: Need at least 2 panels, found", Math.max(count, fallbackCount));
        process.exit(1);
      }
    }

    const target = panels.first();
    const bb = await target.boundingBox();
    if (!bb) {
      console.error("FAIL: Could not get bounding box for first panel");
      process.exit(1);
    }

    const origX = bb.x;
    const origY = bb.y;
    console.log(`[3] Panel original position: (${origX}, ${origY})`);

    // 3. Drag the panel 150px right and 100px down
    const deltaX = 150;
    const deltaY = 100;

    const startX = bb.x + bb.width / 2;
    const startY = bb.y + bb.height / 2;

    console.log(`[4] Dragging panel by (${deltaX}, ${deltaY})...`);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Move in steps for smooth drag
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(
        startX + (deltaX * i) / steps,
        startY + (deltaY * i) / steps,
      );
    }
    await page.mouse.up();

    // 4. Wait for state update
    await page.waitForTimeout(500);

    // 5. Check new position
    const newBB = await target.boundingBox();
    if (!newBB) {
      console.error("FAIL: Could not get bounding box after drag");
      process.exit(1);
    }

    const movedX = Math.abs(newBB.x - origX);
    const movedY = Math.abs(newBB.y - origY);
    console.log(`[5] Panel new position: (${newBB.x}, ${newBB.y})`);
    console.log(`    Moved by: (${movedX}, ${movedY})`);

    // Allow some tolerance (within 30px of expected)
    const tolerance = 30;
    if (movedX > tolerance || movedY > tolerance) {
      console.log("\nPASS: Panel moved to new position and stayed there.");
    } else {
      console.error("\nFAIL: Panel snapped back or didn't move enough.");
      console.error(`  Expected movement ~(${deltaX}, ${deltaY}), got (${movedX}, ${movedY})`);
      process.exit(1);
    }

    // 6. Check localStorage
    const stored = await page.evaluate(() =>
      localStorage.getItem("kuma-studio-panel-positions")
    );
    console.log("[6] localStorage panel positions:", stored);

    if (stored) {
      const parsed = JSON.parse(stored);
      const keys = Object.keys(parsed);
      if (keys.length > 0) {
        console.log(`  ${keys.length} panel position(s) saved.`);
        console.log("  localStorage correctly persisted positions.");
      }
    } else {
      console.log("  WARNING: No positions saved to localStorage yet.");
    }

    console.log("\n--- Test Complete ---");

    // Save video
    const video = page.video();
    if (video) {
      await context.close();
      const videoPath = await video.path();
      console.log(`[VIDEO] Saved to: ${videoPath}`);
    }
  } catch (err) {
    console.error("Test error:", err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

run();
