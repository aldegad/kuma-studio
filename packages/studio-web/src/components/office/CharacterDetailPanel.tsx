import type { OfficeCharacter } from "../../types/office";
import { KUMA_TEAM } from "../../types/agent";
import { STATE_COLORS, STATE_LABELS_KO } from "../../lib/constants";

interface Props {
  character: OfficeCharacter;
  isNight: boolean;
  onClose: () => void;
}

export function CharacterDetailPanel({ character, isNight, onClose }: Props) {
  const member = KUMA_TEAM.find((m) => m.id === character.id);
  if (!member) return null;

  const stateColor = STATE_COLORS[character.state] ?? STATE_COLORS.idle;
  const stateLabel = STATE_LABELS_KO[character.state] ?? character.state;

  const nodeLabel = member.nodeType === "session" ? "총괄 리더"
    : member.nodeType === "team" ? "팀 리더"
    : "워커";

  const teamColor = member.team === "dev" ? "blue" : member.team === "analytics" ? "orange" : member.team === "strategy" ? "green" : "amber";

  return (
    <div className={`absolute bottom-44 right-4 z-40 w-64 rounded-2xl backdrop-blur-md border shadow-xl overflow-hidden animate-fade-in ${
      isNight ? "bg-indigo-950/80 border-indigo-800/50" : "bg-white/90 border-white/50"
    }`}>
      {/* Header with close */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${
        isNight ? "border-indigo-800/40" : "border-stone-100"
      }`}>
        <div className="flex items-center gap-2">
          <span className="text-2xl">{member.emoji}</span>
          <div>
            <p className={`text-sm font-bold ${isNight ? "text-white" : "text-stone-800"}`}>
              {member.nameKo}
            </p>
            <p className={`text-[10px] ${isNight ? "text-indigo-300" : "text-stone-400"}`}>
              {member.roleKo}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
            isNight ? "bg-indigo-800 text-indigo-300 hover:bg-indigo-700" : "bg-stone-100 text-stone-400 hover:bg-stone-200"
          }`}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2.5">
        {/* State */}
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stateColor }} />
          <span className={`text-xs font-medium ${isNight ? "text-white" : "text-stone-700"}`}>{stateLabel}</span>
          {(character.state === "working" || character.state === "thinking") && (
            <div className="working-progress-bar flex-1 ml-2" />
          )}
        </div>

        {character.task && (character.state === "working" || character.state === "thinking") && (
          <div className={`rounded-lg px-3 py-2 text-[10px] leading-relaxed ${
            isNight ? "bg-blue-500/10 text-blue-200" : "bg-blue-50 text-blue-700"
          }`}>
            작업 중: {character.task}
          </div>
        )}

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-2">
          <InfoItem label="팀" value={member.teamKo} isNight={isNight} />
          <InfoItem label="타입" value={nodeLabel} isNight={isNight} />
          <InfoItem label="동물" value={member.animal} isNight={isNight} />
          {member.model && <InfoItem label="모델" value={member.model.split("-").pop() ?? ""} isNight={isNight} />}
        </div>

        {/* Skills */}
        {member.skills && member.skills.length > 0 && (
          <div>
            <p className={`text-[9px] font-bold uppercase tracking-wider mb-1 ${isNight ? "text-indigo-400" : "text-stone-400"}`}>
              스킬
            </p>
            <div className="flex flex-wrap gap-1">
              {member.skills.map((skill) => (
                <span
                  key={skill}
                  className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${
                    isNight ? "bg-amber-500/20 text-amber-300" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Team badge */}
        <div className={`rounded-lg px-3 py-1.5 text-center text-[10px] font-semibold ${
          isNight ? `bg-${teamColor}-500/10 text-${teamColor}-300` : `bg-${teamColor}-50 text-${teamColor}-700`
        }`}>
          {member.teamKo}
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value, isNight }: { label: string; value: string; isNight: boolean }) {
  return (
    <div>
      <p className={`text-[9px] ${isNight ? "text-indigo-400" : "text-stone-400"}`}>{label}</p>
      <p className={`text-[11px] font-medium ${isNight ? "text-white" : "text-stone-700"}`}>{value}</p>
    </div>
  );
}
