const KUMA_ASSET_REV = "20260319c";

function withRev(path: string) {
  return `${path}?v=${KUMA_ASSET_REV}`;
}

export const KUMA_SUDOKU_ICON_SRC = withRev("/kuma-sudoku-icon.png");
export const KUMA_AGENT_CHAT_ICON_SRC = withRev("/agent-chat-icon.png");
export const KUMA_CAFE_ICON_SRC = withRev("/kuma-cafe-icon.png");
export const KUMA_CAFE_BEAR_BARISTA_SRC = withRev("/kuma-cafe-bear-barista.png");
export const KUMA_CAFE_GUEST_RABBIT_SRC = withRev("/kuma-cafe-guest-rabbit.png");
export const KUMA_CAFE_GUEST_CAT_SRC = withRev("/kuma-cafe-guest-cat.png");
export const KUMA_CAFE_GUEST_RACCOON_SRC = withRev("/kuma-cafe-guest-raccoon.png");
export const KUMA_TEST_CONNECT_ICON_SRC = withRev("/kuma-test-connect-icon.png");
export const KUMA_FAVICON_SRC = withRev("/kuma-favicon.png");
