import { useDashboardStore } from "../../stores/use-dashboard-store";
import { useTeamStatusStore } from "../../stores/use-team-status-store";
import { useTeamConfigStore } from "../../stores/use-team-config-store";

interface WhiteboardProps {
  position?: { x: number; y: number };
}

function getTaskText(memberId: string, memberStatus: ReturnType<typeof useTeamStatusStore.getState>["memberStatus"]): string {
  const status = memberStatus.get(memberId);
  if (!status) return "";
  if (status.task) return status.task;
  if (status.lastOutputLines.length > 0) return status.lastOutputLines[status.lastOutputLines.length - 1];
  return "";
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function Whiteboard({ position }: WhiteboardProps) {
  const teamMembers = useTeamConfigStore((s) => s.members);
  const memberStatus = useTeamStatusStore((s) => s.memberStatus);
  const commitCount = useDashboardStore((s) => s.gitActivity.totalCommitsToday);

  const today = new Date().toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short" });

  // Derive live member states
  const workingMembers: { id: string; emoji: string; name: string; task: string }[] = [];
  const thinkingMembers: { id: string; emoji: string; name: string; task: string }[] = [];
  let idleCount = 0;

  for (const agent of teamMembers) {
    const status = memberStatus.get(agent.id);
    const state = status?.state ?? "idle";
    const task = getTaskText(agent.id, memberStatus);

    if (state === "working") {
      workingMembers.push({ id: agent.id, emoji: agent.emoji ?? "", name: agent.nameKo, task });
    } else if (state === "thinking") {
      thinkingMembers.push({ id: agent.id, emoji: agent.emoji ?? "", name: agent.nameKo, task });
    } else {
      idleCount++;
    }
  }

  const activeMembers = [...workingMembers, ...thinkingMembers];
  const displayMembers = activeMembers.slice(0, 4);

  return (
    <div
      className={position
        ? "pointer-events-none absolute rounded-lg border-2 p-3 shadow-md"
        : "p-3"}
      style={{
        background: "var(--wb-bg)",
        borderColor: position ? "var(--wb-border)" : undefined,
        ...(position
          ? {
              left: position.x,
              top: position.y,
              width: 230,
              minHeight: 120,
              transform: "translate(-50%, 0)",
            }
          : {
              minHeight: 120,
            }),
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-secondary)" }}>작업 보드</span>
        <span className="text-[9px]" style={{ color: "var(--t-faint)" }}>{today}</span>
      </div>

      {displayMembers.length > 0 ? (
        <div className="space-y-1.5">
          {displayMembers.map((member) => {
            const isWorking = workingMembers.some((m) => m.id === member.id);
            return (
              <div
                key={member.id}
                className="rounded border px-2 py-1.5"
                style={{
                  background: isWorking ? "var(--wb-card-bg)" : "var(--wb-bg)",
                  borderColor: isWorking ? "var(--wb-card-border)" : "var(--border-subtle)",
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] shrink-0">{member.emoji}</span>
                  <span className="text-[10px] font-semibold shrink-0" style={{ color: "var(--t-secondary)" }}>
                    {member.name}
                  </span>
                  <span
                    className="ml-auto shrink-0 rounded-full px-1.5 py-px text-[8px] font-bold"
                    style={{
                      background: isWorking ? "rgba(34, 197, 94, 0.15)" : "rgba(245, 158, 11, 0.15)",
                      color: isWorking ? "rgb(22, 163, 74)" : "rgb(217, 119, 6)",
                    }}
                  >
                    {isWorking ? "작업중" : "생각중"}
                  </span>
                </div>
                {member.task && (
                  <p
                    className="mt-1 text-[9px] leading-tight"
                    style={{ color: "var(--t-muted)" }}
                  >
                    {truncate(member.task, 40)}
                  </p>
                )}
              </div>
            );
          })}
          {activeMembers.length > 4 && (
            <p className="text-center text-[9px]" style={{ color: "var(--t-faint)" }}>
              +{activeMembers.length - 4}명 더 작업 중
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center py-3 gap-1">
          <span className="text-lg opacity-40">💤</span>
          <p className="text-[10px] font-medium" style={{ color: "var(--t-faint)" }}>전원 대기 중</p>
        </div>
      )}

      <div
        className="mt-2 flex items-center justify-between pt-1.5"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold" style={{ color: "var(--t-faint)" }}>
            {teamMembers.length}명
          </span>
          {activeMembers.length > 0 && (
            <span className="text-[9px] font-bold" style={{ color: "rgb(22, 163, 74)" }}>
              ⚡{activeMembers.length}
            </span>
          )}
          {idleCount > 0 && (
            <span className="text-[9px] font-bold" style={{ color: "var(--t-faint)" }}>
              💤{idleCount}
            </span>
          )}
        </div>
        <span className="text-[9px] font-bold uppercase" style={{ color: "var(--t-faint)" }}>
          커밋 {commitCount}건
        </span>
      </div>
    </div>
  );
}
