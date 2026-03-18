"use client";

import { MessageCircle, RefreshCcw, Send, Users } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

type PlayerId = "1p" | "2p";

type ChatMessage = {
  id: string;
  player: PlayerId;
  text: string;
  sentAt: string;
};

const PLAYER_COPY: Record<
  PlayerId,
  {
    title: string;
    subtitle: string;
    badge: string;
    accentClassName: string;
  }
> = {
  "1p": {
    title: "1P Agent",
    subtitle: "Codex, Claude, or any second agent can own this lane.",
    badge: "Amber",
    accentClassName: "kuma-chat-player-1p",
  },
  "2p": {
    title: "2P Agent",
    subtitle: "Use the other lane to test parallel fills and send actions.",
    badge: "Mint",
    accentClassName: "kuma-chat-player-2p",
  },
};

function nowLabel() {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

export function AgentChatArena() {
  const [drafts, setDrafts] = useState<Record<PlayerId, string>>({
    "1p": "",
    "2p": "",
  });
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "seed-1",
      player: "1p",
      text: "Bridge check. 1P is online and ready to type through Agent Picker.",
      sentAt: nowLabel(),
    },
    {
      id: "seed-2",
      player: "2p",
      text: "2P connected. Let’s use this room to prove both skills and extension installs are healthy.",
      sentAt: nowLabel(),
    },
  ]);

  function updateDraft(player: PlayerId, nextValue: string) {
    setDrafts((current) => ({
      ...current,
      [player]: nextValue,
    }));
  }

  function sendMessage(player: PlayerId) {
    const nextText = drafts[player].trim();
    if (!nextText) {
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: `${player}-${Date.now()}-${current.length}`,
        player,
        text: nextText,
        sentAt: nowLabel(),
      },
    ]);
    setDrafts((current) => ({
      ...current,
      [player]: "",
    }));
  }

  function handleComposerKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
    player: PlayerId,
  ) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      sendMessage(player);
    }
  }

  function resetRoom() {
    setMessages([]);
    setDrafts({
      "1p": "",
      "2p": "",
    });
  }

  const lastSpeaker = messages.at(-1)?.player ?? null;

  return (
    <section className="kuma-shell min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-[1380px] flex-col gap-6">
        <section className="kuma-hero overflow-hidden rounded-[2.3rem] p-6 shadow-[0_28px_90px_rgba(88,53,18,0.18)] sm:p-8 lg:p-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_320px]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#855826]/20 bg-white/78 px-4 py-2 text-[11px] font-black uppercase tracking-[0.3em] text-[#7a4a19]">
                <Users className="h-3.5 w-3.5" />
                Agent Chat Arena
              </div>
              <h1 className="mt-5 max-w-[11ch] text-5xl font-black leading-[0.88] tracking-[-0.08em] text-[#41230a] sm:text-6xl lg:text-7xl">
                Two agents.
                <br />
                One live room.
              </h1>
              <p className="mt-5 max-w-[62ch] text-base leading-8 text-[#70451d] sm:text-lg">
                This test surface is built for side-by-side Agent Picker control. Each lane has its
                own labeled composer, send button, and transcript feedback so two agents can prove
                their skill install, extension path, and browser actions without stepping on the
                same field.
              </p>

              <div className="mt-8 flex flex-wrap gap-3 text-sm font-semibold text-[#6f451d]">
                <div className="kuma-pill">Two independently targetable chat inputs</div>
                <div className="kuma-pill">Shared transcript for write verification</div>
                <div className="kuma-pill">Clear labels and `data-testid` hooks for automation</div>
              </div>
            </div>

            <aside className="rounded-[2rem] border border-[#8b6234]/15 bg-[#fff8eb] p-5">
              <div className="grid gap-3">
                <StatCard label="Messages" value={String(messages.length)} />
                <StatCard
                  label="Last Speaker"
                  value={lastSpeaker ? PLAYER_COPY[lastSpeaker].title : "Waiting"}
                />
                <StatCard label="Send Shortcut" value="Cmd/Ctrl + Enter" />
              </div>
              <div className="mt-5 rounded-[1.6rem] bg-[#4f3212] px-5 py-4 text-[#fff6df] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]">
                <p className="text-[11px] uppercase tracking-[0.28em] text-[#f9cf86]">Room Rules</p>
                <ul className="mt-4 space-y-3 text-sm leading-6">
                  <li>Target `1P message` or `2P message` by label before writing.</li>
                  <li>Use the matching send button to append a transcript bubble.</li>
                  <li>Verify the bubble text after every write instead of assuming success.</li>
                </ul>
              </div>
            </aside>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,320px)]">
          <PlayerPanel
            player="1p"
            draft={drafts["1p"]}
            onChange={updateDraft}
            onSend={sendMessage}
            onKeyDown={handleComposerKeyDown}
          />

          <section className="kuma-board-card rounded-[2.2rem] p-5 shadow-[0_30px_90px_rgba(91,58,19,0.14)] sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#8b5a25]">
                  Shared Transcript
                </p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.06em] text-[#42220c]">
                  Bridge Banter Room
                </h2>
                <p className="mt-3 max-w-[56ch] text-sm leading-7 text-[#78502b]">
                  Messages land here in order, with player tags and timestamps. It is meant to be
                  easy to inspect with DOM reads, screenshots, and write-after-read verification.
                </p>
              </div>

              <button type="button" className="kuma-tool" data-testid="chat-reset" onClick={resetRoom}>
                <RefreshCcw className="h-4 w-4" />
                Reset Room
              </button>
            </div>

            <div
              className="kuma-chat-log mt-6 flex min-h-[540px] flex-col gap-3 rounded-[1.8rem] border border-[#8d6137]/15 bg-[#fff9f0] p-4"
              data-testid="chat-transcript"
            >
              {messages.length > 0 ? (
                messages.map((message, index) => (
                  <article
                    key={message.id}
                    className={`kuma-chat-bubble ${message.player === "1p" ? "kuma-chat-bubble-left" : "kuma-chat-bubble-right"}`}
                    data-testid={`chat-message-${index + 1}`}
                  >
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.24em] text-[#8a5a26]">
                      <MessageCircle className="h-3.5 w-3.5" />
                      {PLAYER_COPY[message.player].title}
                      <span className="opacity-55">{message.sentAt}</span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#553114]">
                      {message.text}
                    </p>
                  </article>
                ))
              ) : (
                <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-[#b18452]/30 bg-white/60 px-6 text-center">
                  <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#ffe1a3] text-[#6d4318]">
                    <MessageCircle className="h-6 w-6" />
                  </div>
                  <p className="mt-5 text-lg font-black tracking-[-0.04em] text-[#41230a]">
                    The room is empty.
                  </p>
                  <p className="mt-2 max-w-[34ch] text-sm leading-7 text-[#77502a]">
                    Use either composer to send a first message and confirm the transcript updates.
                  </p>
                </div>
              )}
            </div>
          </section>

          <PlayerPanel
            player="2p"
            draft={drafts["2p"]}
            onChange={updateDraft}
            onSend={sendMessage}
            onKeyDown={handleComposerKeyDown}
          />
        </section>
      </div>
    </section>
  );
}

function PlayerPanel({
  player,
  draft,
  onChange,
  onSend,
  onKeyDown,
}: {
  player: PlayerId;
  draft: string;
  onChange: (player: PlayerId, nextValue: string) => void;
  onSend: (player: PlayerId) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, player: PlayerId) => void;
}) {
  const copy = PLAYER_COPY[player];

  return (
    <aside className={`rounded-[2rem] border border-[#91612f]/15 bg-[#fff9f0] p-5 shadow-[0_24px_72px_rgba(89,58,19,0.12)] ${copy.accentClassName}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#8e5d2b]">
            {copy.title}
          </p>
          <h3 className="mt-2 text-2xl font-black tracking-[-0.06em] text-[#46270c]">
            {copy.badge} lane
          </h3>
          <p className="mt-3 text-sm leading-7 text-[#6f461f]">{copy.subtitle}</p>
        </div>
        <div className="rounded-full bg-white/70 px-3 py-2 text-[10px] font-black uppercase tracking-[0.28em] text-[#7d4d1d]">
          {copy.title}
        </div>
      </div>

      <label className="mt-6 block">
        <span className="text-sm font-black tracking-[-0.02em] text-[#4d2e11]">
          {player === "1p" ? "1P message" : "2P message"}
        </span>
        <textarea
          className="kuma-chat-input mt-3 min-h-[190px] w-full resize-none rounded-[1.4rem] border border-[#a67745]/18 bg-white/88 p-4 text-sm leading-7 text-[#4f3013] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] outline-none"
          data-testid={player === "1p" ? "chat-input-1p" : "chat-input-2p"}
          placeholder={player === "1p" ? "1P writes here..." : "2P writes here..."}
          value={draft}
          onChange={(event) => onChange(player, event.target.value)}
          onKeyDown={(event) => onKeyDown(event, player)}
        />
      </label>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs leading-6 text-[#7d552a]">Cmd/Ctrl + Enter also sends this lane.</p>
        <button
          type="button"
          className="kuma-tool min-w-[132px]"
          data-testid={player === "1p" ? "chat-send-1p" : "chat-send-2p"}
          onClick={() => onSend(player)}
        >
          <Send className="h-4 w-4" />
          Send
        </button>
      </div>
    </aside>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] bg-white/78 px-4 py-3">
      <div className="text-[10px] font-black uppercase tracking-[0.25em] text-[#8a5b27]">{label}</div>
      <div className="mt-2 text-lg font-black tracking-[-0.05em] text-[#49290f]">{value}</div>
    </div>
  );
}
