const message = `kuma smoke ${Date.now()}`;

await page.goto(`${baseUrl}/agent-chat`);

const composer = page.locator('[data-testid="chat-input-1p"]');
const transcriptLocator = page.locator('[data-testid="chat-transcript"]');
await composer.fill(message);
await page.locator('[data-testid="chat-send-1p"]').click();
await page.waitForSelector('[data-testid="chat-transcript"]');
const transcript = await transcriptLocator.textContent();
if (!transcript || !transcript.includes(message)) {
  throw new Error("Agent chat smoke failed to find the sent message in the transcript.");
}

await page.locator('[data-testid="chat-reset"]').click();
const resetTranscript = await transcriptLocator.textContent();
if ((resetTranscript ?? "").trim() !== "No dispatches") {
  throw new Error("Agent chat smoke expected the transcript to reset to `No dispatches`.");
}

if ((await composer.inputValue()) !== "") {
  throw new Error("Agent chat smoke expected the 1P composer to be cleared after reset.");
}

console.log(JSON.stringify({ scenario: "agent-chat", message }, null, 2));
