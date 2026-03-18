"use client";

import Image from "next/image";
import { Bot, MessageCircle, RefreshCcw, Send, Sparkles, Waves } from "lucide-react";
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
    title: "1P Dispatch Bear",
    subtitle: "Primary lane for the first operator riding the live bridge.",
    badge: "Honey Relay",
    accentClassName: "kuma-chat-player-1p",
  },
  "2p": {
    title: "2P Dispatch Bear",
    subtitle: "Second lane for mirrored replies, overlap checks, and handoffs.",
    badge: "Mint Relay",
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
      appName="Kuma Dispatch Chat"
      eyebrow="Kuma Dispatch Chat"
      headline={
        <>
          Two bears.
          <br />
          One relay room.
        </>
      }
      description="This relay room keeps two agents in the same cozy control world as the rest of Kuma Test Lab. Each lane has its own composer, status strip, and clear send action while the transcript stays easy to verify with DOM reads."
      pills={[
        "Two independently targetable courier lanes",
        "Shared transcript for readback verification",
        "Clear test ids for dual-agent automation",
      ]}
      visual={
        <div className="relative flex min-h-[280px] items-center justify-center">
          <div className="absolute inset-4 rounded-[2rem] bg-[radial-gradient(circle_at_top,_rgba(255,241,207,0.96),_rgba(255,214,143,0.32)_46%,_transparent_72%)]" />
          <div className="absolute left-0 top-8 rounded-[1.5rem] border border-white/55 bg-white/75 px-4 py-3 shadow-[0_18px_35px_rgba(109,67,24,0.12)] backdrop-blur">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#7b4a1c]">Relay Count</div>
            <div className="mt-2 text-xl font-black tracking-[-0.05em] text-[#41230a]">{messages.length}</div>
          </div>
          <div className="absolute right-0 top-14 rounded-[1.5rem] border border-[#1e7b65]/16 bg-[#ecfff7] px-4 py-3 shadow-[0_18px_35px_rgba(25,94,78,0.12)]">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#19624f]">Last Voice</div>
            <div className="mt-2 text-sm font-black tracking-[-0.04em] text-[#184536]">
              {lastSpeaker ? PLAYER_COPY[lastSpeaker].title : "Waiting"}
            </div>
          </div>
          <div className="relative overflow-hidden rounded-[2.3rem] border border-white/55 bg-[linear-gradient(180deg,rgba(255,250,240,0.96),rgba(255,235,199,0.96))] p-5 shadow-[0_30px_70px_rgba(109,67,24,0.16)]">
            <div className="absolute inset-x-5 top-4 flex items-center justify-between text-[#8d5825]">
              <Sparkles className="h-4 w-4" />
              <Waves className="h-4 w-4" />
            </div>
            <Image src="/agent-chat-icon.png" alt="Kuma Dispatch Chat icon" width={220} height={220} className="relative z-10 rounded-[2rem]" priority />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <VisualPill label="1P" value={drafts["1p"].trim() ? "Typing" : "Idle"} tone="warm" />
              <VisualPill label="2P" value={drafts["2p"].trim() ? "Typing" : "Idle"} tone="mint" />
            </div>
          </div>
        </div>
      }
      sidekickTitle="A softer room for harder bridge checks"
      sidekickBody="The layout is playful, but every lane still has strong labels, obvious send actions, and a transcript that makes write-after-read verification straightforward."
      sidekickItems={[
        "Use each courier lane independently so two agents never fight over the same composer.",
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
                  Relay Transcript
                </p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.06em] text-[#42220c]">
                  Kuma Dispatch Log
                </h2>
                <p className="mt-3 max-w-[56ch] text-sm leading-7 text-[#78502b]">
                  Every relay lands here with a lane tag and timestamp. It stays roomy enough for screenshots,
                  DOM reads, and dual-agent verification without losing the cozy Kuma tone.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-[1.5rem] bg-[#fff8ea] p-3">
                <StatCard label="Messages" value={String(messages.length)} />
                <StatCard label="Last" value={lastSpeaker ? lastSpeaker.toUpperCase() : "Idle"} />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3 rounded-[1.4rem] border border-[#9a6a38]/12 bg-[linear-gradient(90deg,rgba(255,247,228,0.9),rgba(255,239,212,0.72))] px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ffe4af] text-[#6e4317]">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.24em] text-[#8a5925]">Room Status</div>
                  <div className="mt-1 text-sm font-semibold text-[#543114]">
                    {lastSpeaker ? `${PLAYER_COPY[lastSpeaker].title} spoke most recently.` : "Waiting for the first dispatch."}
                  </div>
                </div>
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
                    className={`kuma-chat-bubble ${message.player === "1p" ? "kuma-chat-bubble-left" : "kuma-chat-bubble-right"} relative overflow-hidden`}
                    data-testid={`chat-message-${index + 1}`}
                  >
                    <div
                      className={`absolute inset-x-0 top-0 h-1 ${
                        message.player === "1p" ? "bg-[#efb24e]" : "bg-[#69c7ad]"
                      }`}
                    />
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
                    The dispatch room is quiet.
                  </p>
                  <p className="mt-2 max-w-[34ch] text-sm leading-7 text-[#77502a]">
                    Use either courier lane to send the first dispatch and confirm the transcript updates.
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
            {copy.badge}
          </h3>
          <p className="mt-3 text-sm leading-7 text-[#6f461f]">{copy.subtitle}</p>
        </div>
        <div className="rounded-full bg-white/70 px-3 py-2 text-[10px] font-black uppercase tracking-[0.28em] text-[#7d4d1d]">
          {player.toUpperCase()}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <StatCard label="Queue" value={draft.trim() ? "Loaded" : "Clear"} />
        <StatCard label="Mode" value={player === "1p" ? "Lead" : "Reply"} />
      </div>

      <label className="mt-6 block">
        <span className="text-sm font-black tracking-[-0.02em] text-[#4d2e11]">
          {player === "1p" ? "1P dispatch" : "2P dispatch"}
        </span>
        <textarea
          className="kuma-chat-input mt-3 min-h-[190px] w-full resize-none rounded-[1.4rem] border border-[#a67745]/18 bg-white/88 p-4 text-sm leading-7 text-[#4f3013] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] outline-none"
          data-testid={player === "1p" ? "chat-input-1p" : "chat-input-2p"}
          placeholder={player === "1p" ? "1P writes the next relay..." : "2P answers from the opposite lane..."}
          value={draft}
          onChange={(event) => onChange(player, event.target.value)}
          onKeyDown={(event) => onKeyDown(event, player)}
        />
      </label>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs leading-6 text-[#7d552a]">Cmd/Ctrl + Enter sends this dispatch.</p>
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

function VisualPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "warm" | "mint";
}) {
  const toneClassName =
    tone === "warm"
      ? "border-[#d49a46]/22 bg-[#fff3d2] text-[#6b4217]"
      : "border-[#67baa2]/22 bg-[#e9fff6] text-[#1d5a49]";

  return (
    <div className={`rounded-[1.15rem] border px-3 py-2 ${toneClassName}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.24em] opacity-70">{label}</div>
      <div className="mt-1 text-sm font-black tracking-[-0.04em]">{value}</div>
    </div>
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
