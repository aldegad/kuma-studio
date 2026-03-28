const baseUrl = "http://localhost:3000";
const content = "Line 1\nLine 2";

await page.goto(`${baseUrl}/contenteditable-lab`);

const editor = page.locator('[data-testid="contenteditable-lab-editor"]');
await editor.click();
await editor.fill(content);

const readback = await page.locator('[data-testid="contenteditable-lab-readback"]').textContent();
if (!readback || !readback.includes("Line 1") || !readback.includes("Line 2")) {
  throw new Error("Contenteditable smoke failed to verify the multiline readback.");
}

const lines = await page.locator('[data-testid="contenteditable-lab-lines"]').textContent();
if (lines !== "2") {
  throw new Error(`Contenteditable smoke expected 2 lines, received ${lines ?? "null"}.`);
}

await page.locator('[data-testid="contenteditable-lab-reset"]').click();
const cleared = await page.locator('[data-testid="contenteditable-lab-readback"]').textContent();
if ((cleared ?? "").trim() !== "") {
  throw new Error("Contenteditable smoke expected the plain-text readback to be empty after reset.");
}

console.log(JSON.stringify({ scenario: "contenteditable-lab", lines }, null, 2));
