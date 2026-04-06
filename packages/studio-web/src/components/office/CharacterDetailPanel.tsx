import type { OfficeCharacter } from "../../types/office";
import { KUMA_TEAM } from "../../types/agent";
import { STATE_COLORS, STATE_LABELS_KO, formatModelName, modelBadgeClass, getSkillDisplayName, formatEffort, effortColorClass, contextBarColor } from "../../lib/constants";
import { useTeamStatusStore } from "../../stores/use-team-status-store";

interface Props {
  character: OfficeCharacter;
  isNight: boolean;
  onClose: () => void;
}

export function CharacterDetailPanel({ character, onClose }: Props) {
  const member = KUMA_TEAM.find((m) => m.id === character.id);
  const liveModelInfo = useTeamStatusStore((s) => s.memberStatus.get(character.id)?.modelInfo ?? null);
  if (!member) return null;

  const stateColor = STATE_COLORS[character.state] ?? STATE_COLORS.idle;
  const stateLabel = STATE_LABELS_KO[character.state] ?? character.state;

  const nodeLabel = member.nodeType === "session" ? "총괄 리더"
    : member.nodeType === "team" ? "팀 리더"
    : "워커";

  // Resolve model display from live data or static team.json
  const liveModel = liveModelInfo?.model ? formatModelName(liveModelInfo.model) : null;
  const displayModel = liveModel ?? formatModelName(member.model) ?? member.model;
  const badgeModel = liveModelInfo?.model ?? member.model;
  const effort = formatEffort(liveModelInfo?.effort);
  const effortCls = effortColorClass(liveModelInfo?.effort);
  const contextPct = liveModelInfo?.contextRemaining;

  return (
    <div
      className="absolute bottom-44 right-4 z-40 w-64 rounded-2xl backdrop-blur-md border shadow-xl overflow-hidden animate-fade-in"
      style={{ background: "var(--panel-bg-strong)", borderColor: "var(--panel-border)" }}
    >
      {/* Header with close */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center gap-2">
          <span className="text-2xl">{member.emoji}</span>
          <div>
            <p className="text-sm font-bold" style={{ color: "var(--t-primary)" }}>
              {member.nameKo}
            </p>
            <p className="text-[10px]" style={{ color: "var(--t-muted)" }}>
              {member.roleKo}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
          style={{ background: "var(--card-bg)", color: "var(--t-faint)" }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2.5">
        {/* State */}
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stateColor }} />
          <span className="text-xs font-medium" style={{ color: "var(--t-primary)" }}>{stateLabel}</span>
          {(character.state === "working" || character.state === "thinking") && (
            <div className="working-progress-bar flex-1 ml-2" />
          )}
        </div>

        {character.task && (character.state === "working" || character.state === "thinking") && (
          <div className="rounded-lg px-3 py-2 text-[10px] leading-relaxed bg-blue-500/10 text-blue-400" style={{ color: undefined }}>
            작업 중: {character.task}
          </div>
        )}

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-2">
          <InfoItem label="팀" value={member.teamKo} />
          <InfoItem label="타입" value={nodeLabel} />
          <InfoItem label="동물" value={member.animal} />
        </div>

        {/* Model info — RPG stat block style */}
        {displayModel && (
          <div className="rounded-lg px-3 py-2" style={{ background: "var(--card-bg)" }}>
            <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--t-faint)" }}>
              모델 정보
            </p>
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${modelBadgeClass(badgeModel)}`}>
                {displayModel}
              </span>
              {effort && (
                <span className={`text-[10px] font-bold ${effortCls}`}>
                  {effort}
                </span>
              )}
              {liveModelInfo?.speed && (
                <span className="text-[10px] text-amber-400 font-medium">⚡ fast</span>
              )}
            </div>
            {contextPct != null && (
              <div className="flex items-center gap-2">
                <span className="text-[9px]" style={{ color: "var(--t-faint)" }}>컨텍스트</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.15)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${contextPct}%`,
                      backgroundColor: contextBarColor(contextPct),
                    }}
                  />
                </div>
                <span className={`text-[10px] font-bold ${contextPct <= 20 ? "text-red-400" : ""}`} style={contextPct > 20 ? { color: "var(--t-secondary)" } : undefined}>
                  {contextPct}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* Skills */}
        {member.skills && member.skills.length > 0 && (
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--t-faint)" }}>
              스킬
            </p>
            <div className="flex flex-wrap gap-1">
              {member.skills.map((skill) => (
                <span
                  key={skill}
                  title={skill}
                  className="rounded-full px-2 py-0.5 text-[9px] font-medium"
                  style={{ background: "var(--badge-bg)", color: "var(--badge-text)" }}
                >
                  {getSkillDisplayName(skill)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Team badge */}
        <div
          className="rounded-lg px-3 py-1.5 text-center text-[10px] font-semibold"
          style={{ background: "var(--card-bg)", color: "var(--t-secondary)" }}
        >
          {member.teamKo}
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px]" style={{ color: "var(--t-faint)" }}>{label}</p>
      <p className="text-[11px] font-medium" style={{ color: "var(--t-primary)" }}>{value}</p>
    </div>
  );
}
