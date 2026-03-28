const baseUrl = "http://localhost:3000";

await page.goto(`${baseUrl}/shooting`);
await page.locator('[data-testid="shooting-start-button"]').click();

function parseMetric(raw) {
  const matched = String(raw ?? "").match(/-?\d+/);
  return matched ? Number(matched[0]) : 0;
}

const before = {
  shotsFired: parseMetric(await page.locator('[data-testid="shooting-metric-shots-fired"]').textContent()),
  totalInputs: parseMetric(await page.locator('[data-testid="shooting-metric-total-inputs"]').textContent()),
};

await page.keyboard.press("z", { holdMs: 500 });

const canvasRect = await page.locator('[data-testid="shooting-canvas"]').boundingBox();

if (!canvasRect) {
  throw new Error("Shooting smoke failed to resolve the canvas bounds.");
}

await page.mouse.drag(
  {
    x: canvasRect.x + canvasRect.width * 0.5,
    y: canvasRect.y + canvasRect.height * 0.78,
  },
  {
    x: canvasRect.x + canvasRect.width * 0.32,
    y: canvasRect.y + canvasRect.height * 0.62,
  },
  { durationMs: 450, steps: 16 },
);

await page.locator('[data-testid="shooting-metric-total-inputs"]').waitFor();

const after = {
  shotsFired: parseMetric(await page.locator('[data-testid="shooting-metric-shots-fired"]').textContent()),
  totalInputs: parseMetric(await page.locator('[data-testid="shooting-metric-total-inputs"]').textContent()),
};

if (after.shotsFired <= before.shotsFired) {
  throw new Error("Shooting smoke expected shots fired to increase.");
}

if (after.totalInputs <= before.totalInputs) {
  throw new Error("Shooting smoke expected total inputs to increase.");
}

console.log(JSON.stringify({ scenario: "shooting", before, after }, null, 2));
