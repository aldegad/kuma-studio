import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillEntry {
  name: string;
  description: string;
  file: string;
  content: string;
}

// ---------------------------------------------------------------------------
// SkillsPanel — bottom-right floating HUD
// ---------------------------------------------------------------------------

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [plugins, setPlugins] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  useEffect(() => {
    fetch("/studio/skills")
      .then((r) => r.json())
      .then((d) => setSkills(d.skills || []))
      .catch(() => {});
    fetch("/studio/plugins")
      .then((r) => r.json())
      .then((d) => setPlugins(d.plugins || []))
      .catch(() => {});
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="absolute bottom-4 right-4 z-30 w-80">
      <div className="rounded-2xl bg-white/75 backdrop-blur-md border border-white/50 shadow-lg overflow-hidden">
        {/* Header — always visible, acts as toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">📋</span>
            <span className="text-xs font-bold text-stone-700 uppercase tracking-wider">
              스킬
            </span>
            {collapsed && (
              <span className="text-[10px] text-stone-400 font-medium">
                {skills.length}개 스킬 · {plugins.length}개 플러그인
              </span>
            )}
          </div>
          <span className="text-stone-400 text-xs">
            {collapsed ? "▲" : "▼"}
          </span>
        </button>

        {/* Expanded content */}
        {!collapsed && (
          <div className="px-3 pb-3 pt-1 space-y-3 max-h-96 overflow-y-auto">
            {/* -------------------------------------------------------------- */}
            {/* Skills list                                                     */}
            {/* -------------------------------------------------------------- */}
            {skills.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider px-1">
                  스킬 목록
                </p>
                {skills.map((skill) => (
                  <div key={skill.name}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSkill((prev) =>
                          prev === skill.name ? null : skill.name,
                        )
                      }
                      className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                        expandedSkill === skill.name
                          ? "bg-amber-50/80 border-amber-200/60"
                          : "bg-white/70 border-stone-100 hover:bg-amber-50/40 hover:border-amber-200/40"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-stone-800 truncate">
                          {skill.name}
                        </p>
                        <span className="text-stone-300 text-[10px] flex-shrink-0 ml-2">
                          {expandedSkill === skill.name ? "▲" : "▼"}
                        </span>
                      </div>
                      <p className="text-[10px] text-stone-500 truncate mt-0.5">
                        {skill.description}
                      </p>
                    </button>

                    {/* Expanded skill content */}
                    {expandedSkill === skill.name && skill.content && (
                      <div className="mt-1 mx-1 rounded-lg bg-stone-50/80 border border-stone-200/50 p-2.5 max-h-48 overflow-y-auto">
                        <pre className="text-[10px] text-stone-600 whitespace-pre-wrap font-mono leading-relaxed">
                          {skill.content}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* -------------------------------------------------------------- */}
            {/* Plugins badges                                                  */}
            {/* -------------------------------------------------------------- */}
            {plugins.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider px-1 mb-1.5">
                  플러그인
                </p>
                <div className="flex flex-wrap gap-1.5 px-1">
                  {plugins.map((plugin) => (
                    <span
                      key={plugin}
                      className="bg-indigo-100 text-indigo-700 text-[10px] font-medium px-2 py-0.5 rounded-full"
                    >
                      {plugin}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {skills.length === 0 && plugins.length === 0 && (
              <p className="text-center text-[10px] text-stone-400 py-2">
                등록된 스킬/플러그인 없음
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
