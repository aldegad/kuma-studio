import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  deleteStudioSkill,
  fetchExtensionsCatalog,
  fetchStudioPlugins,
  fetchStudioSkills,
  writeStudioFile,
} from "../../lib/api";
import type {
  ExtensionsCatalogCategory,
  ExtensionsCatalogEcosystem,
  StudioSkillEntry,
} from "../../types/extensions";
import { ExtensionDetailModal, type ExtensionDetailKind } from "./ExtensionDetailModal";

type DetailTarget =
  | { kind: "skill"; skill: StudioSkillEntry }
  | {
      kind: "catalog";
      ecosystem: ExtensionsCatalogEcosystem;
      category: ExtensionsCatalogCategory;
    }
  | { kind: "plugin"; name: string };

const SECTION_COLORS: Record<string, { dot: string; glow: string }> = {
  skills:   { dot: "#3b82f6", glow: "rgba(59, 130, 246, 0.4)" },
  plugins:  { dot: "#eab308", glow: "rgba(234, 179, 8, 0.4)" },
  catalog:  { dot: "#22c55e", glow: "rgba(34, 197, 94, 0.4)" },
};

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

  // Section expand/collapse (match PlanPanel project-group pattern)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(["skills"]),
  );

  // Detail modal state (single modal for any kind)
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const [skillsResult, pluginsResult, catalogResult] = await Promise.allSettled([
        fetchStudioSkills(),
        fetchStudioPlugins(),
        fetchExtensionsCatalog(),
      ]);

      if (cancelled) return;

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

  // Keep detail target in sync if the underlying skill list changes.
  useEffect(() => {
    if (!detailTarget || detailTarget.kind !== "skill") return;
    const next = skills.find((entry) => entry.name === detailTarget.skill.name);
    if (!next) {
      setDetailTarget(null);
      setEditing(false);
      return;
    }
    if (next !== detailTarget.skill) {
      setDetailTarget({ kind: "skill", skill: next });
    }
  }, [skills, detailTarget]);

  function toggleSection(key: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openDetail(target: DetailTarget) {
    setDetailTarget(target);
    setEditing(false);
    if (target.kind === "skill") {
      setEditContent(target.skill.content);
    }
  }

  function closeDetail() {
    setDetailTarget(null);
    setEditing(false);
  }

  function toggleEditMode() {
    if (!detailTarget || detailTarget.kind !== "skill") return;
    if (editing) {
      setEditing(false);
    } else {
      setEditContent(detailTarget.skill.content);
      setEditing(true);
    }
  }

  async function handleSaveSkill() {
    if (!detailTarget || detailTarget.kind !== "skill") return;
    const target = detailTarget.skill;
    setSaving(true);
    try {
      await writeStudioFile(target.path, editContent);
      const updatedSkill = { ...target, content: editContent };
      setSkills((current) =>
        current.map((skill) =>
          skill.name === target.name ? updatedSkill : skill,
        ),
      );
      setDetailTarget({ kind: "skill", skill: updatedSkill });
      setEditing(false);
      setError(null);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "스킬 저장에 실패했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSkill() {
    if (!detailTarget || detailTarget.kind !== "skill") return;
    const target = detailTarget.skill;
    if (!window.confirm(`"${target.name}" 스킬을 삭제할까요?`)) return;

    setDeleting(true);
    try {
      await deleteStudioSkill(target.name);
      setSkills((current) => current.filter((entry) => entry.name !== target.name));
      closeDetail();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "스킬 삭제에 실패했습니다.",
      );
    } finally {
      setDeleting(false);
    }
  }

  const panelHeadingId = "extensions-panel-title";
  const availableEcosystems = useMemo(
    () => ecosystems.filter((ecosystem) => ecosystem.available),
    [ecosystems],
  );

  // Build detail modal props from the current target.
  const modalProps = (() => {
    if (!detailTarget) return null;
    if (detailTarget.kind === "skill") {
      return {
        kind: "skill" as ExtensionDetailKind,
        title: detailTarget.skill.name,
        subtitle: detailTarget.skill.path,
        body: detailTarget.skill.content,
        editable: true,
      };
    }
    if (detailTarget.kind === "catalog") {
      return {
        kind: "catalog" as ExtensionDetailKind,
        title: detailTarget.category.label,
        subtitle: `${detailTarget.ecosystem.label} · ${detailTarget.ecosystem.sourcePath}`,
        body: detailTarget.category.markdown,
        editable: false,
      };
    }
    return {
      kind: "plugin" as ExtensionDetailKind,
      title: detailTarget.name,
      subtitle: "Claude plugin",
      body: `\`${detailTarget.name}\` 플러그인이 활성화되어 있습니다.`,
      editable: false,
    };
  })();

  return (
    <>
      <section
        aria-labelledby={panelHeadingId}
        className="overflow-hidden rounded-2xl border shadow-lg backdrop-blur-md"
        style={{
          background: "var(--panel-bg)",
          borderColor: "var(--panel-border)",
          color: "var(--t-primary)",
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors"
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "var(--panel-hover)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "transparent";
          }}
        >
          <span
            id={panelHeadingId}
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--t-muted)" }}
          >
            확장 (Extensions){" "}
            {skills.length + plugins.length + catalogSummary.categoryCount > 0
              ? `(${skills.length}·${plugins.length}·${catalogSummary.categoryCount})`
              : ""}
          </span>
          <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
            {collapsed ? "▼" : "▲"}
          </span>
        </button>

        {!collapsed && (
          <div className="space-y-1.5 px-3 pb-3">
            {/* Summary header */}
            <div className="flex items-center justify-between">
              <span className="text-[10px]" style={{ color: "var(--t-muted)" }}>
                라이브 연결
              </span>
              <span className="text-[10px] font-mono" style={{ color: "var(--t-faint)" }}>
                {skills.length} 스킬 · {plugins.length} 플러그인 · {catalogSummary.ecosystemCount}{" "}
                생태계
              </span>
            </div>

            {loading && (
              <p className="text-[10px]" style={{ color: "var(--t-faint)" }} role="status" aria-live="polite">
                확장 데이터를 불러오는 중입니다.
              </p>
            )}

            {error && (
              <p
                className="text-[10px]"
                style={{ color: "var(--toast-error-text)" }}
                role="status"
                aria-live="polite"
              >
                {error}
              </p>
            )}

            {/* Sections */}
            <div
              className="mt-1.5 space-y-0.5 border-t pt-1.5"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              {/* Skills section */}
              <SectionHeader
                sectionKey="skills"
                label="Live Skills"
                count={skills.length}
                color={SECTION_COLORS.skills}
                expanded={expandedSections.has("skills")}
                onToggle={() => toggleSection("skills")}
              />
              {expandedSections.has("skills") && (
                <SectionBody>
                  {skills.length === 0 ? (
                    <EmptyRow label="연결된 스킬이 없습니다." />
                  ) : (
                    skills.map((skill) => (
                      <ExtensionRow
                        key={skill.name}
                        color={SECTION_COLORS.skills}
                        title={skill.name}
                        meta={skill.description || skill.file}
                        onOpen={() => openDetail({ kind: "skill", skill })}
                      />
                    ))
                  )}
                </SectionBody>
              )}

              {/* Plugins section */}
              <SectionHeader
                sectionKey="plugins"
                label="Claude Plugins"
                count={plugins.length}
                color={SECTION_COLORS.plugins}
                expanded={expandedSections.has("plugins")}
                onToggle={() => toggleSection("plugins")}
              />
              {expandedSections.has("plugins") && (
                <SectionBody>
                  {plugins.length === 0 ? (
                    <EmptyRow label="활성 플러그인이 없습니다." />
                  ) : (
                    plugins.map((plugin) => (
                      <ExtensionRow
                        key={plugin}
                        color={SECTION_COLORS.plugins}
                        title={plugin}
                        meta="plugin"
                        onOpen={() => openDetail({ kind: "plugin", name: plugin })}
                      />
                    ))
                  )}
                </SectionBody>
              )}

              {/* Catalog sections: one per ecosystem */}
              {availableEcosystems.length === 0 && ecosystems.length === 0 && !loading && (
                <EmptyRow label="연결된 카탈로그가 없습니다." />
              )}

              {availableEcosystems.map((ecosystem) => {
                const sectionKey = `catalog:${ecosystem.id}`;
                return (
                  <div key={sectionKey}>
                    <SectionHeader
                      sectionKey={sectionKey}
                      label={ecosystem.label}
                      count={ecosystem.categories.length}
                      subtitle={ecosystem.sourcePath}
                      color={SECTION_COLORS.catalog}
                      expanded={expandedSections.has(sectionKey)}
                      onToggle={() => toggleSection(sectionKey)}
                    />
                    {expandedSections.has(sectionKey) && (
                      <SectionBody>
                        {ecosystem.categories.length === 0 ? (
                          <EmptyRow label="섹션이 없습니다." />
                        ) : (
                          ecosystem.categories.map((category) => (
                            <ExtensionRow
                              key={`${ecosystem.id}-${category.id}`}
                              color={SECTION_COLORS.catalog}
                              title={category.label}
                              meta={ecosystem.label}
                              onOpen={() =>
                                openDetail({ kind: "catalog", ecosystem, category })
                              }
                            />
                          ))
                        )}
                      </SectionBody>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {modalProps &&
        createPortal(
          <ExtensionDetailModal
            isOpen={true}
            onClose={closeDetail}
            kind={modalProps.kind}
            title={modalProps.title}
            subtitle={modalProps.subtitle}
            body={modalProps.body}
            editable={modalProps.editable}
            editing={editing}
            saving={saving}
            editContent={editContent}
            onEditToggle={toggleEditMode}
            onEditChange={setEditContent}
            onSave={() => void handleSaveSkill()}
            onDelete={modalProps.editable ? () => void handleDeleteSkill() : undefined}
            deleting={deleting}
          />,
          document.body,
        )}
    </>
  );
}

interface SectionHeaderProps {
  sectionKey: string;
  label: string;
  count: number;
  subtitle?: string;
  color: { dot: string; glow: string };
  expanded: boolean;
  onToggle: () => void;
}

function SectionHeader({
  label,
  count,
  subtitle,
  color,
  expanded,
  onToggle,
}: SectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left transition-colors"
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "var(--panel-hover)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
      }}
    >
      <span className="text-[9px] shrink-0" style={{ color: "var(--t-faint)" }}>
        {expanded ? "▾" : "▸"}
      </span>
      <span
        className="shrink-0 rounded-full"
        style={{
          width: 6,
          height: 6,
          backgroundColor: color.dot,
          boxShadow: `0 0 6px ${color.glow}`,
        }}
      />
      <span
        className="flex-1 truncate text-[10px] font-bold"
        style={{ color: "var(--t-secondary)" }}
      >
        {label}
      </span>
      {subtitle && (
        <span
          className="max-w-[8rem] truncate text-[8px] font-mono"
          style={{ color: "var(--t-faint)" }}
          title={subtitle}
        >
          {subtitle}
        </span>
      )}
      <span className="text-[8px] font-mono shrink-0" style={{ color: "var(--t-faint)" }}>
        {count}
      </span>
    </button>
  );
}

function SectionBody({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="ml-3 space-y-px border-l pl-2"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      {children}
    </div>
  );
}

interface ExtensionRowProps {
  color: { dot: string; glow: string };
  title: string;
  meta?: string;
  onOpen: () => void;
}

function ExtensionRow({ color, title, meta, onOpen }: ExtensionRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left transition-colors"
      style={{ background: `linear-gradient(90deg, ${color.dot}08 0%, transparent 40%)` }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = `linear-gradient(90deg, ${color.dot}18 0%, var(--panel-hover) 40%)`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = `linear-gradient(90deg, ${color.dot}08 0%, transparent 40%)`;
      }}
    >
      <span
        className="shrink-0 rounded-full"
        style={{
          width: 5,
          height: 5,
          backgroundColor: color.dot,
          boxShadow: `0 0 5px ${color.glow}`,
        }}
      />
      <span
        className="flex-1 truncate text-[9px] font-semibold"
        style={{ color: "var(--t-primary)" }}
        title={title}
      >
        {title}
      </span>
      {meta && (
        <span
          className="max-w-[10rem] truncate text-[8px]"
          style={{ color: "var(--t-faint)" }}
          title={meta}
        >
          {meta}
        </span>
      )}
    </button>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div
      className="ml-3 rounded px-2 py-1 text-[9px]"
      style={{ color: "var(--t-faint)" }}
    >
      {label}
    </div>
  );
}
