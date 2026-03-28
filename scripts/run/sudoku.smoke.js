await page.goto(`${baseUrl}/sudoku`);

let selectedCell = null;
let selectedValue = null;

for (let row = 1; row <= 9 && !selectedCell; row += 1) {
  for (let col = 1; col <= 9 && !selectedCell; col += 1) {
    const testId = `cell-${row}-${col}`;
    const target = page.locator(`[data-testid="${testId}"]`);
    const before = (await target.textContent()) ?? "";
    if (before.includes("5")) {
      continue;
    }

    await target.click();
    await page.keyboard.press("5");
    const after = (await target.textContent()) ?? "";

    if (after.includes("5") && after !== before) {
      selectedCell = testId;
      selectedValue = after;
    }
  }
}

if (!selectedCell) {
  throw new Error("Sudoku smoke failed to find a writable cell.");
}

console.log(JSON.stringify({ scenario: "sudoku", targetTestId: selectedCell, value: selectedValue }, null, 2));
