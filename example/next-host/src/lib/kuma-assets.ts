const KUMA_ASSET_REV = "20260318c";

function withRev(path: string) {
  return `${path}?v=${KUMA_ASSET_REV}`;
}

export const KUMA_SUDOKU_ICON_SRC = withRev("/kuma-sudoku-icon.png");
export const KUMA_AGENT_CHAT_ICON_SRC = withRev("/agent-chat-icon.png");
export const KUMA_CAFE_ICON_SRC = withRev("/kuma-cafe-icon.png");
export const KUMA_TEST_CONNECT_ICON_SRC = withRev("/kuma-test-connect-icon.png");
