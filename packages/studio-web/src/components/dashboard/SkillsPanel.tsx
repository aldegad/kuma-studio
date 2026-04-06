import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillEntry {
  name: string;
  description: string;
  file: string;
  content: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Simple markdown-ish renderer (headings, bold, code blocks, lists)
// ---------------------------------------------------------------------------

function renderContent(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("### ")) return <p key={i} className="text-[10px] font-bold mt-2 mb-0.5" style={{ color: "var(--t-secondary)" }}>{line.slice(4)}</p>;
    if (line.startsWith("## ")) return <p key={i} className="text-[11px] font-bold mt-2.5 mb-0.5" style={{ color: "var(--t-primary)" }}>{line.slice(3)}</p>;
    if (line.startsWith("# ")) return <p key={i} className="text-xs font-bold mt-3 mb-1" style={{ color: "var(--t-primary)" }}>{line.slice(2)}</p>;
    if (line.startsWith("```")) return <hr key={i} style={{ borderColor: "var(--border-subtle)" }} className="my-1" />;
    if (line.startsWith("- ") || line.startsWith("* ")) return <p key={i} className="text-[10px] pl-2 leading-relaxed" style={{ color: "var(--t-secondary)" }}>{"\u2022 "}{line.slice(2)}</p>;
    if (line.startsWith("|")) return <p key={i} className="text-[9px] font-mono leading-relaxed" style={{ color: "var(--t-muted)" }}>{line}</p>;
    if (line.trim() === "") return <div key={i} className="h-1" />;
    return <p key={i} className="text-[10px] leading-relaxed" style={{ color: "var(--t-secondary)" }}>{line}</p>;
  });
}

// ---------------------------------------------------------------------------
// SkillsPanel — bottom-right floating HUD
// ---------------------------------------------------------------------------

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [plugins, setPlugins] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [fullScreenSkill, setFullScreenSkill] = useState<SkillEntry | null>(null);
  const [editingSkill, setEditingSkill] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

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
  // Handlers
  // -------------------------------------------------------------------------

  const handleDeleteSkill = async (skill: SkillEntry) => {
    if (!window.confirm(`"${skill.name}" 스킬을 삭제할까요?`)) return;
    setDeleting(skill.name);
    try {
      const r = await fetch(`/studio/skills/${encodeURIComponent(skill.name)}`, { method: "DELETE" });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setSkills((prev) => prev.filter((s) => s.name !== skill.name));
      if (expandedSkill === skill.name) setExpandedSkill(null);
      if (fullScreenSkill?.name === skill.name) { setFullScreenSkill(null); setEditingSkill(null); }
    } catch { /* ignore */ }
    setDeleting(null);
  };

  const handleEditSkill = (skill: SkillEntry) => {
    setFullScreenSkill(skill);
    setEditingSkill(skill.name);
    setEditContent(skill.content);
  };

  const handleSaveSkill = async () => {
    if (!fullScreenSkill) return;
    setSaving(true);
    try {
      const r = await fetch("/studio/fs/write", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fullScreenSkill.path, content: editContent }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      const updated = { ...fullScreenSkill, content: editContent, description: editContent.split("\n")[0]?.replace(/^#\s*/, "").trim() || fullScreenSkill.description };
      setSkills((prev) => prev.map((s) => s.name === fullScreenSkill.name ? updated : s));
      setFullScreenSkill(updated);
      setEditingSkill(null);
    } catch { /* ignore */ }
    setSaving(false);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="absolute bottom-16 right-4 z-30 w-80">
      <div className="rounded-2xl backdrop-blur-md shadow-lg overflow-hidden" style={{ background: "var(--panel-bg)", borderWidth: 1, borderColor: "var(--panel-border)" }}>
        {/* Header — always visible, acts as toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center justify-between px-4 py-2.5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">📋</span>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--t-secondary)" }}>
              스킬
            </span>
            {collapsed && (
              <span className="text-[10px] font-medium" style={{ color: "var(--t-faint)" }}>
                {skills.length}개 스킬 · {plugins.length}개 플러그인
              </span>
            )}
          </div>
          <span className="text-xs" style={{ color: "var(--t-faint)" }}>
            {collapsed ? "▼" : "▲"}
          </span>
        </button>

        {/* Expanded content */}
        {!collapsed && (
          <div className="px-3 pb-3 pt-1 space-y-3 max-h-96 overflow-y-auto">
            {/* Skills list */}
            {skills.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider px-1" style={{ color: "var(--t-muted)" }}>
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
                      className="w-full text-left rounded-lg border px-3 py-2 transition-colors"
                      style={{
                        background: expandedSkill === skill.name ? "var(--card-bg-hover)" : "var(--card-bg)",
                        borderColor: expandedSkill === skill.name ? "var(--card-border)" : "var(--border-subtle)",
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold truncate" style={{ color: "var(--t-primary)" }}>
                          {skill.name}
                        </p>
                        <div className="flex items-center gap-1 ml-2 shrink-0">
                          <span className="text-[9px] rounded px-1 py-0.5 cursor-pointer" style={{ color: "var(--t-faint)" }} onClick={(e) => { e.stopPropagation(); handleEditSkill(skill); }}>편집</span>
                          <span className={`text-[9px] rounded px-1 py-0.5 cursor-pointer ${deleting === skill.name ? "opacity-50" : ""}`} style={{ color: "var(--t-faint)" }} onClick={(e) => { e.stopPropagation(); if (deleting !== skill.name) void handleDeleteSkill(skill); }}>{deleting === skill.name ? "..." : "삭제"}</span>
                          <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
                            {expandedSkill === skill.name ? "▲" : "▼"}
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] truncate mt-0.5" style={{ color: "var(--t-muted)" }}>
                        {skill.description}
                      </p>
                    </button>

                    {/* Expanded skill content */}
                    {expandedSkill === skill.name && skill.content && (
                      <div className="mt-1 mx-1 rounded-lg border p-2.5 max-h-52 overflow-y-auto" style={{ background: "var(--card-bg)", borderColor: "var(--border-subtle)" }}>
                        <div className="flex justify-end mb-1">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setFullScreenSkill(skill); }}
                            className="text-[9px] font-medium" style={{ color: "var(--t-muted)" }}
                          >
                            전체 보기
                          </button>
                        </div>
                        {renderContent(skill.content)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Plugins badges */}
            {plugins.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider px-1 mb-1.5" style={{ color: "var(--t-muted)" }}>
                  플러그인
                </p>
                <div className="flex flex-wrap gap-1.5 px-1">
                  {plugins.map((plugin) => (
                    <span
                      key={plugin}
                      className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                      style={{ background: "var(--badge-bg)", color: "var(--badge-text)" }}
                    >
                      {plugin}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {skills.length === 0 && plugins.length === 0 && (
              <p className="text-center text-[10px] py-2" style={{ color: "var(--t-faint)" }}>
                등록된 스킬/플러그인 없음
              </p>
            )}
          </div>
        )}
      </div>

      {/* Full-screen skill viewer */}
      {fullScreenSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setFullScreenSkill(null)}>
          <div className="rounded-2xl backdrop-blur-md shadow-2xl p-6 max-w-2xl max-h-[80vh] overflow-y-auto w-full mx-4" style={{ background: "var(--panel-bg-strong)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold" style={{ color: "var(--t-primary)" }}>{fullScreenSkill.name}</h2>
              <div className="flex items-center gap-2">
                {editingSkill !== fullScreenSkill.name && (
                  <button type="button" onClick={() => handleEditSkill(fullScreenSkill)} className="text-[11px] font-medium" style={{ color: "var(--color-kuma-orange)" }}>편집</button>
                )}
                <button type="button" onClick={() => { setFullScreenSkill(null); setEditingSkill(null); }} className="text-sm" style={{ color: "var(--t-faint)" }}>✕</button>
              </div>
            </div>
            <p className="text-[11px] mb-3" style={{ color: "var(--t-muted)" }}>{fullScreenSkill.description}</p>
            <div className="pt-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              {editingSkill === fullScreenSkill.name ? (
                <div className="space-y-3">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full min-h-[300px] rounded-lg border p-3 font-mono text-[11px] leading-relaxed outline-none resize-y"
                    style={{ background: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--t-primary)" }}
                    spellCheck={false}
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setEditingSkill(null)} className="rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors" style={{ color: "var(--t-muted)" }}>취소</button>
                    <button type="button" onClick={() => void handleSaveSkill()} disabled={saving} className="rounded-lg px-4 py-1.5 text-[11px] font-bold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 transition-colors">{saving ? "저장 중..." : "저장"}</button>
                  </div>
                </div>
              ) : (
                renderContent(fullScreenSkill.content)
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
