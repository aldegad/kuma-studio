const baseUrl = "http://localhost:3000";
const drinkName = `Kuma Signature ${Date.now()}`;

await page.goto(`${baseUrl}/cafe-control-room`);

await page.locator('[data-testid="open-seasonal-dialog"]').click();
await page.locator('[data-testid="save-seasonal-drink"]').waitFor();

await page.getByLabel("Drink Name").fill(drinkName);
await page.locator('[data-testid="save-seasonal-drink"]').click();
await page.locator('[data-testid="cafe-toast"]').waitFor();

const toastAfterSave = await page.locator('[data-testid="cafe-toast"]').textContent();
if (!toastAfterSave || !toastAfterSave.includes(drinkName)) {
  throw new Error("Cafe smoke failed to verify the recipe-save toast.");
}

await page.locator('[data-testid="cafe-tab-delivery"]').click();
await page.locator('[data-testid="prepare-receipts"]').waitFor();

await page.locator('[data-testid="prepare-receipts"]').click();
await page.locator('[data-testid="cafe-toast"]').waitFor();

const toastAfterPrepare = await page.locator('[data-testid="cafe-toast"]').textContent();
if (!toastAfterPrepare || !toastAfterPrepare.includes("Receipts CSV is ready to download.")) {
  throw new Error("Cafe smoke failed to verify the receipts toast.");
}

console.log(JSON.stringify({ scenario: "cafe-control-room", drinkName }, null, 2));
