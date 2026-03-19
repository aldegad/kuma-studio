"use client";

import Image from "next/image";
import { MessageCircle, RefreshCcw, Send, Sparkles, Waves } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { KUMA_AGENT_CHAT_ICON_SRC } from "../../lib/kuma-assets";
import { KumaSurfaceFrame } from "../lab/KumaSurfaceFrame";

type PlayerId = "1p" | "2p";

const PLAYER_IDS: PlayerId[] = ["1p", "2p"];

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
    shortLabel: string;
    badge: string;
    tone: VisualTone;
    badgeClassName: string;
    bubbleClassName: string;
    composerClassName: string;
  }
> = {
  "1p": {
    title: "1P Dispatch Bear",
    shortLabel: "1P",
    badge: "Honey Relay",
    tone: "warm",
    badgeClassName: "border-[#efb24e]/30 bg-[#fff1cb] text-[#6e4317]",
    bubbleClassName: "self-start bg-[linear-gradient(180deg,rgba(255,238,202,0.98),rgba(255,248,231,0.96))]",
    composerClassName: "border-[#efb24e]/22 bg-[linear-gradient(180deg,rgba(255,246,225,0.96),rgba(255,238,214,0.94))]",
  },
  "2p": {
    title: "2P Dispatch Bear",
    shortLabel: "2P",
    badge: "Mint Relay",
    tone: "mint",
    badgeClassName: "border-[#69c7ad]/30 bg-[#eafff6] text-[#1d5a49]",
    bubbleClassName: "self-end bg-[linear-gradient(180deg,rgba(231,251,243,0.98),rgba(244,255,250,0.96))]",
    composerClassName: "border-[#69c7ad]/22 bg-[linear-gradient(180deg,rgba(237,255,248,0.96),rgba(226,248,239,0.94))]",
  },
};

function createInitialDrafts(): Record<PlayerId, string> {
  return Object.fromEntries(PLAYER_IDS.map((player) => [player, ""])) as Record<PlayerId, string>;
}

function nowLabel() {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

export function AgentChatArena() {
  const [drafts, setDrafts] = useState<Record<PlayerId, string>>(createInitialDrafts);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "seed-1",
      player: "1p",
      text: "Bridge check. 1P is online and ready to type through Kuma Picker.",
      sentAt: nowLabel(),
    },
    {
      id: "seed-2",
      player: "2p",
      text: "2P connected. Let’s use this room to prove both skills and extension installs are healthy.",
      sentAt: nowLabel(),
    },
  ]);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const previousMessageCountRef = useRef(messages.length);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) {
      previousMessageCountRef.current = messages.length;
      return;
    }

    if (messages.length === 0) {
      transcript.scrollTo({ top: 0, behavior: "auto" });
      previousMessageCountRef.current = 0;
      return;
    }

    transcript.scrollTo({
      top: transcript.scrollHeight,
      behavior: previousMessageCountRef.current > 0 ? "smooth" : "auto",
    });
    previousMessageCountRef.current = messages.length;
  }, [messages]);

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
    setDrafts(createInitialDrafts());
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
        "Two independently targetable lanes",
        "Shared transcript for readback verification",
        "Clear test ids for pair chat automation",
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
            <Image
              src={KUMA_AGENT_CHAT_ICON_SRC}
              alt="Kuma Dispatch Chat icon"
              width={220}
              height={220}
              className="relative z-10 rounded-[2rem]"
              priority
            />
            <div className="mt-4 grid grid-cols-2 gap-3">
              {PLAYER_IDS.map((player) => (
                <VisualPill
                  key={player}
                  label={PLAYER_COPY[player].shortLabel}
                  value={drafts[player].trim() ? "Typing" : "Idle"}
                  tone={PLAYER_COPY[player].tone}
                />
              ))}
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
      <section className="relative">
        <div className="sticky top-6 h-[calc(100svh-3rem)]">
          <section className="flex h-full flex-col overflow-hidden rounded-[2.2rem] border border-[#8d6137]/12 bg-[linear-gradient(180deg,rgba(255,252,246,0.98),rgba(255,241,216,0.96))] shadow-[0_32px_80px_rgba(93,57,20,0.12)]">
            <header className="flex items-center justify-between gap-4 border-b border-[#8d6137]/10 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] sm:px-5">
              <div className="min-w-0">
                <h2 className="truncate text-[1.45rem] font-black tracking-[-0.06em] text-[#43230b]">
                  Kuma Dispatch Log
                </h2>
              </div>

              <button
                type="button"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#8d6137]/12 bg-white/78 text-[#6a4318] shadow-[0_12px_28px_rgba(93,57,20,0.12)] transition hover:rotate-[-12deg] hover:bg-white"
                data-testid="chat-reset"
                aria-label="Reset room"
                onClick={resetRoom}
              >
                <RefreshCcw className="h-4 w-4" />
              </button>
            </header>

            <div
              ref={transcriptRef}
              className="kuma-chat-log flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
              data-testid="chat-transcript"
            >
              {messages.length > 0 ? (
                messages.map((message, index) => (
                  <article
                    key={message.id}
                    className={`mb-3 flex items-end gap-2 ${message.player === "1p" ? "justify-start" : "justify-end"}`}
                    data-testid={`chat-message-${index + 1}`}
                  >
                    {message.player === "2p" ? (
                      <span className="shrink-0 text-[10px] font-medium tracking-[0.02em] text-[#8c633d]/70">
                        {message.sentAt}
                      </span>
                    ) : null}

                    <article
                      className={`relative flex max-w-[84%] flex-col overflow-hidden rounded-[1.55rem] border border-[#8d6137]/12 px-4 py-3 shadow-[0_18px_34px_rgba(93,57,20,0.08)] ${PLAYER_COPY[message.player].bubbleClassName}`}
                    >
                      <p className="whitespace-pre-wrap text-sm leading-6 text-[#553114]">{message.text}</p>
                    </article>

                    {message.player === "1p" ? (
                      <span className="shrink-0 text-[10px] font-medium tracking-[0.02em] text-[#8c633d]/70">
                        {message.sentAt}
                      </span>
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="flex flex-1 items-center justify-center">
                  <div className="flex items-center gap-3 rounded-full border border-dashed border-[#8d6137]/18 bg-white/62 px-4 py-3 text-sm font-semibold text-[#7a4f26]">
                    <MessageCircle className="h-4 w-4" />
                    No dispatches
                  </div>
                </div>
              )}
            </div>

            <footer className="border-t border-[#8d6137]/10 bg-[linear-gradient(180deg,rgba(255,248,235,0.9),rgba(255,244,225,0.98))] px-2 pb-[calc(env(safe-area-inset-bottom)+1.2rem)] pt-2.5 backdrop-blur sm:px-3">
              <div className="grid grid-cols-2 gap-2">
                {PLAYER_IDS.map((player) => (
                  <CompactComposer
                    key={player}
                    player={player}
                    draft={drafts[player]}
                    onChange={updateDraft}
                    onSend={sendMessage}
                    onKeyDown={handleComposerKeyDown}
                  />
                ))}
              </div>
            </footer>
          </section>
        </div>
      </section>
    </KumaSurfaceFrame>
  );
}

function CompactComposer({
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
    <div
      className={`flex min-w-0 flex-col gap-1.5 rounded-[1.25rem] border px-2 py-2 shadow-[0_14px_28px_rgba(93,57,20,0.08)] ${copy.composerClassName}`}
    >
      <div className="flex items-center justify-center">
        <span className={`w-fit rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.24em] ${copy.badgeClassName}`}>
          {copy.shortLabel}
        </span>
      </div>

      <div className="flex min-w-0 items-end gap-1.5">
        <textarea
          rows={1}
          className="kuma-chat-input h-10 min-w-0 flex-1 resize-none overflow-hidden rounded-[0.95rem] border border-[#8d6137]/12 bg-white/92 px-2 py-1.5 text-[10px] leading-4 text-[#4f3013] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] outline-none"
          data-testid={`chat-input-${player}`}
          aria-label={`${player.toUpperCase()} dispatch`}
          placeholder={player.toUpperCase()}
          value={draft}
          onChange={(event) => onChange(player, event.target.value)}
          onKeyDown={(event) => onKeyDown(event, player)}
        />

        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#8d6137]/12 bg-white/82 text-[#5d3814] shadow-[0_10px_20px_rgba(93,57,20,0.1)] transition hover:-translate-y-0.5 hover:bg-white"
          data-testid={`chat-send-${player}`}
          aria-label={`Send ${player.toUpperCase()} dispatch`}
          onClick={() => onSend(player)}
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function VisualPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: VisualTone;
}) {
  const toneClassName =
    tone === "warm"
      ? "border-[#d49a46]/22 bg-[#fff3d2] text-[#6b4217]"
      : tone === "mint"
        ? "border-[#67baa2]/22 bg-[#e9fff6] text-[#1d5a49]"
        : tone === "sky"
          ? "border-[#74b5ff]/22 bg-[#ebf4ff] text-[#1f4f7f]"
          : "border-[#e4a2ba]/22 bg-[#fff0f5] text-[#7f3551]";

  return (
    <div className={`rounded-[1.15rem] border px-3 py-2 ${toneClassName}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.24em] opacity-70">{label}</div>
      <div className="mt-1 text-sm font-black tracking-[-0.04em]">{value}</div>
    </div>
  );
}

type VisualTone = "warm" | "mint";
