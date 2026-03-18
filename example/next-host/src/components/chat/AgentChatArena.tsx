"use client";

import Image from "next/image";
import { MessageCircle, RefreshCcw, Send } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import { KumaSurfaceFrame } from "../lab/KumaSurfaceFrame";

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
    <KumaSurfaceFrame
      appName="Agent Chat Arena"
      eyebrow="Agent Chat Arena"
      headline={
        <>
          Two agents.
          <br />
          One live room.
        </>
      }
      description="This surface is tuned for side-by-side Agent Picker control. Each lane has its own labeled composer and send action while the transcript gives you direct write-after-read verification."
      pills={[
        "Two independently targetable chat inputs",
        "Shared transcript for write verification",
        "Clear labels and data-testid hooks for automation",
      ]}
      visual={
        <div className="kuma-story-visual-stack">
          <Image src="/agent-chat-icon.png" alt="Agent Chat icon" width={210} height={210} className="kuma-story-icon" priority />
          <div className="kuma-surface-float-card kuma-surface-float-card-mint">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#165546]">Live Room</div>
            <div className="mt-2 text-lg font-black tracking-[-0.05em] text-[#14392f]">{messages.length} messages</div>
            <div className="mt-2 text-sm text-[#2e6556]">{lastSpeaker ? `${PLAYER_COPY[lastSpeaker].title} spoke last` : "Waiting for a turn"}</div>
          </div>
        </div>
      }
      sidekickTitle="A clean proving ground for dual-agent installs"
      sidekickBody="The room is intentionally legible: two strong input lanes, obvious action buttons, and a shared history that makes verification fast."
      sidekickItems={[
        "Use each labeled lane independently so two agents never fight over the same field.",
        "Send a bubble, then read it back from the transcript before moving on.",
        "Reset the room to validate clean-state setup and repeated runs.",
      ]}
    >
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
    </KumaSurfaceFrame>
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
