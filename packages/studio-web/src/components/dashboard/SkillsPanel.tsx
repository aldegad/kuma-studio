import { useEffect, useMemo, useState } from "react";
import {
  deleteStudioSkill,
  fetchExtensionsCatalog,
  fetchStudioPlugins,
  fetchStudioSkills,
  writeStudioFile,
} from "../../lib/api";
import type { ExtensionsCatalogEcosystem, StudioSkillEntry } from "../../types/extensions";
import { MarkdownBody } from "./MarkdownBody";

function summarizeCatalog(ecosystems: ExtensionsCatalogEcosystem[]) {
  const available = ecosystems.filter((ecosystem) => ecosystem.available);
  const categoryCount = available.reduce(
    (total, ecosystem) => total + ecosystem.categories.length,
    0,
  );

  return {
    ecosystemCount: available.length,
    categoryCount,
  };
}

export function SkillsPanel() {
  const [skills, setSkills] = useState<StudioSkillEntry[]>([]);
  const [plugins, setPlugins] = useState<string[]>([]);
  const [ecosystems, setEcosystems] = useState<ExtensionsCatalogEcosystem[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [fullScreenSkill, setFullScreenSkill] = useState<StudioSkillEntry | null>(null);
  const [editingSkill, setEditingSkill] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const [skillsResult, pluginsResult, catalogResult] = await Promise.allSettled([
        fetchStudioSkills(),
        fetchStudioPlugins(),
        fetchExtensionsCatalog(),
      ]);

      if (cancelled) {
        return;
      }

      const nextErrors: string[] = [];

      if (skillsResult.status === "fulfilled") {
        setSkills(skillsResult.value);
      } else {
        setSkills([]);
        nextErrors.push("로컬 스킬 연결을 복구하지 못했습니다.");
      }

      if (pluginsResult.status === "fulfilled") {
        setPlugins(pluginsResult.value);
      } else {
        setPlugins([]);
        nextErrors.push("플러그인 목록을 불러오지 못했습니다.");
      }

      if (catalogResult.status === "fulfilled") {
        setEcosystems(catalogResult.value.ecosystems);
      } else {
        setEcosystems([]);
        nextErrors.push("확장 카탈로그를 불러오지 못했습니다.");
      }

      setError(nextErrors.length > 0 ? nextErrors.join(" ") : null);
      setLoading(false);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const catalogSummary = useMemo(
    () => summarizeCatalog(ecosystems),
    [ecosystems],
  );

  const handleDeleteSkill = async (skill: StudioSkillEntry) => {
    if (!window.confirm(`"${skill.name}" 스킬을 삭제할까요?`)) {
      return;
    }

    setDeleting(skill.name);
    try {
      await deleteStudioSkill(skill.name);
      setSkills((current) => current.filter((entry) => entry.name !== skill.name));
      if (expandedSkill === skill.name) {
        setExpandedSkill(null);
      }
      if (fullScreenSkill?.name === skill.name) {
        setFullScreenSkill(null);
        setEditingSkill(null);
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "스킬 삭제에 실패했습니다.",
      );
    } finally {
      setDeleting(null);
    }
  };

  const handleEditSkill = (skill: StudioSkillEntry) => {
    setFullScreenSkill(skill);
    setEditingSkill(skill.name);
    setEditContent(skill.content);
  };

  const handleSaveSkill = async () => {
    if (!fullScreenSkill) {
      return;
    }

    setSaving(true);
    try {
      await writeStudioFile(fullScreenSkill.path, editContent);
      const updatedSkill = {
        ...fullScreenSkill,
        content: editContent,
      };
      setSkills((current) =>
        current.map((skill) =>
          skill.name === fullScreenSkill.name ? updatedSkill : skill,
        ),
      );
      setFullScreenSkill(updatedSkill);
      setEditingSkill(null);
      setError(null);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "스킬 저장에 실패했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section
        aria-labelledby="extensions-panel-title"
        className="overflow-hidden rounded-2xl border shadow-lg backdrop-blur-md"
        style={{ background: "var(--panel-bg)", borderColor: "var(--panel-border)", color: "var(--t-primary)" }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors"
          onMouseEnter={(event) => { event.currentTarget.style.background = "var(--panel-hover)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
        >
          <span
            id="extensions-panel-title"
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--t-muted)" }}
          >
            확장 (Extensions)
          </span>
          <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
            {collapsed ? "▼" : "▲"}
          </span>
        </button>

        {!collapsed && (
          <div className="space-y-3 px-3 pb-3 overflow-y-auto" style={{ maxHeight: "calc(100vh - 8rem)" }}>
            <div
              className="rounded-xl border px-3 py-2"
              style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold" style={{ color: "var(--t-primary)" }}>
                  라이브 연결
                </span>
                <span className="text-[10px]" style={{ color: "var(--t-muted)" }}>
                  {skills.length}개 스킬
                </span>
                <span className="text-[10px]" style={{ color: "var(--t-muted)" }}>
                  {plugins.length}개 플러그인
                </span>
                <span className="text-[10px]" style={{ color: "var(--t-muted)" }}>
                  {catalogSummary.ecosystemCount}개 생태계
                </span>
                <span className="text-[10px]" style={{ color: "var(--t-muted)" }}>
                  {catalogSummary.categoryCount}개 카테고리
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed" style={{ color: "var(--t-faint)" }}>
                Claude Code 실시간 스킬/플러그인 연결을 직접 확인하고, 아래에서 Claude Code와 Codex CLI 카탈로그를 함께 볼 수 있습니다.
              </p>
            </div>

            {loading && (
              <p className="text-[10px]" style={{ color: "var(--t-faint)" }} role="status" aria-live="polite">
                확장 데이터를 불러오는 중입니다.
              </p>
            )}

            {error && (
              <p className="text-[10px]" style={{ color: "var(--toast-error-text)" }} role="status" aria-live="polite">
                {error}
              </p>
            )}

            <div className="space-y-2">
              <p className="px-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>
                Claude Live Skills
              </p>
              {skills.length === 0 ? (
                <p className="rounded-lg border px-3 py-2 text-[10px]" style={{ background: "var(--card-bg)", borderColor: "var(--border-subtle)", color: "var(--t-faint)" }}>
                  연결된 스킬이 없습니다.
                </p>
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {skills.map((skill) => (
                    <div
                      key={skill.name}
                      className="rounded-xl border"
                      style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
                    >
                      <div className="flex items-start justify-between gap-2 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => setExpandedSkill((current) => (current === skill.name ? null : skill.name))}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="truncate text-[11px] font-semibold" style={{ color: "var(--t-primary)" }}>
                              {skill.name}
                            </p>
                            <p className="mt-0.5 truncate text-[10px]" style={{ color: "var(--t-muted)" }}>
                              {skill.description || skill.file}
                            </p>
                          </button>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-[9px]" style={{ color: "var(--t-faint)" }}>
                          <button
                            type="button"
                            onClick={() => handleEditSkill(skill)}
                          >
                            편집
                          </button>
                          <button
                            type="button"
                            disabled={deleting === skill.name}
                            onClick={() => {
                              if (deleting !== skill.name) {
                                void handleDeleteSkill(skill);
                              }
                            }}
                          >
                            {deleting === skill.name ? "삭제 중" : "삭제"}
                          </button>
                          <span>{expandedSkill === skill.name ? "▲" : "▼"}</span>
                        </div>
                      </div>

                      {expandedSkill === skill.name && (
                        <div
                          className="border-t px-3 pb-3 pt-2"
                          style={{ borderColor: "var(--border-subtle)" }}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <code className="text-[9px]" style={{ color: "var(--t-faint)" }}>
                              {skill.path}
                            </code>
                            <button
                              type="button"
                              onClick={() => setFullScreenSkill(skill)}
                              className="text-[9px] font-medium"
                              style={{ color: "var(--t-muted)" }}
                            >
                              전체 보기
                            </button>
                          </div>
                          <div className="max-h-48 overflow-y-auto text-[11px]">
                            <MarkdownBody content={skill.content} />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="px-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>
                Claude Plugins
              </p>
              {plugins.length === 0 ? (
                <p className="rounded-lg border px-3 py-2 text-[10px]" style={{ background: "var(--card-bg)", borderColor: "var(--border-subtle)", color: "var(--t-faint)" }}>
                  활성 플러그인이 없습니다.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5 px-1">
                  {plugins.map((plugin) => (
                    <span
                      key={plugin}
                      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ background: "var(--badge-bg)", color: "var(--badge-text)" }}
                    >
                      {plugin}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="px-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>
                Ecosystem Catalog
              </p>
              {ecosystems.length === 0 ? (
                <p className="rounded-lg border px-3 py-2 text-[10px]" style={{ background: "var(--card-bg)", borderColor: "var(--border-subtle)", color: "var(--t-faint)" }}>
                  연결된 카탈로그가 없습니다.
                </p>
              ) : (
                <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                  {ecosystems.map((ecosystem) => (
                    <details
                      key={ecosystem.id}
                      open={ecosystem.available}
                      className="rounded-xl border"
                      style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
                    >
                      <summary className="cursor-pointer list-none px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold" style={{ color: "var(--t-primary)" }}>
                              {ecosystem.label}
                            </p>
                            <p className="truncate text-[9px]" style={{ color: "var(--t-faint)" }}>
                              {ecosystem.sourcePath}
                            </p>
                          </div>
                          <span className="text-[9px]" style={{ color: "var(--t-muted)" }}>
                            {ecosystem.categories.length}개 섹션
                          </span>
                        </div>
                      </summary>

                      <div
                        className="space-y-2 border-t px-3 pb-3 pt-2"
                        style={{ borderColor: "var(--border-subtle)" }}
                      >
                        {!ecosystem.available && (
                          <p className="text-[10px]" style={{ color: "var(--t-faint)" }}>
                            카탈로그 원본을 아직 읽지 못했습니다.
                          </p>
                        )}
                        {ecosystem.categories.map((category) => (
                          <details
                            key={`${ecosystem.id}-${category.id}`}
                            className="rounded-lg border"
                            style={{ background: "var(--panel-bg)", borderColor: "var(--border-subtle)" }}
                          >
                            <summary className="cursor-pointer list-none px-3 py-2 text-[10px] font-semibold" style={{ color: "var(--t-secondary)" }}>
                              {category.label}
                            </summary>
                            <div className="border-t px-3 pb-3 pt-2 text-[11px]" style={{ borderColor: "var(--border-subtle)" }}>
                              <MarkdownBody content={category.markdown} />
                            </div>
                          </details>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {fullScreenSkill && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => {
            setFullScreenSkill(null);
            setEditingSkill(null);
          }}
        >
          <div
            className="mx-4 max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-2xl p-6 shadow-2xl"
            style={{ background: "var(--panel-bg-strong)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-bold" style={{ color: "var(--t-primary)" }}>
                  {fullScreenSkill.name}
                </h2>
                <code className="text-[10px]" style={{ color: "var(--t-faint)" }}>
                  {fullScreenSkill.path}
                </code>
              </div>
              <div className="flex items-center gap-3">
                {editingSkill !== fullScreenSkill.name && (
                  <button
                    type="button"
                    onClick={() => handleEditSkill(fullScreenSkill)}
                    className="text-[11px] font-medium"
                    style={{ color: "var(--color-kuma-orange)" }}
                  >
                    편집
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setFullScreenSkill(null);
                    setEditingSkill(null);
                  }}
                  className="text-sm"
                  style={{ color: "var(--t-faint)" }}
                >
                  ✕
                </button>
              </div>
            </div>

            {editingSkill === fullScreenSkill.name ? (
              <div className="space-y-3">
                <textarea
                  value={editContent}
                  onChange={(event) => setEditContent(event.target.value)}
                  className="min-h-[320px] w-full resize-y rounded-lg border p-3 font-mono text-[11px] leading-relaxed outline-none"
                  style={{ background: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--t-primary)" }}
                  spellCheck={false}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingSkill(null)}
                    className="rounded-lg px-3 py-1.5 text-[11px] font-medium"
                    style={{ color: "var(--t-muted)" }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveSkill()}
                    disabled={saving}
                    className="rounded-lg px-4 py-1.5 text-[11px] font-bold text-white transition-colors disabled:opacity-50"
                    style={{ background: "var(--btn-solid-bg)" }}
                  >
                    {saving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-[11px]">
                <MarkdownBody content={fullScreenSkill.content} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
