import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileTreeNode, type FsNode, type GitStatusMap } from "./FileTreeNode";
import { CodeViewer } from "./CodeViewer";
import { ImageViewer } from "./ImageViewer";
import { PdfViewer } from "./PdfViewer";
import { MarkdownBody } from "../dashboard/MarkdownBody";
import { useWsStore } from "../../stores/use-ws-store";

interface FrontmatterMeta {
  title?: string;
  domain?: string;
  tags?: string[];
  created?: string;
  updated?: string;
}

function parseFrontmatter(text: string): { meta: FrontmatterMeta; body: string } {
  const match = text?.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: text ?? "" };
  const meta: FrontmatterMeta = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim() as keyof FrontmatterMeta;
    const raw = line.slice(colonIdx + 1).trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (meta as any)[key] = raw.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (meta as any)[key] = raw;
    }
  }
  return { meta, body: match[2].trim() };
}

interface TocDoc {
  title: string;
  path: string;
  description?: string;
}

interface TocFolder {
  id: string;
  label: string;
  docs: TocDoc[];
  folders: TocFolder[];
}

interface TocSection extends TocFolder {
  /** total leaf doc count (recursive) */
  totalDocs: number;
}

const slug = (s: string) => s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

/** Count leaf docs recursively. */
function countLeafDocs(folder: TocFolder): number {
  return folder.docs.length + folder.folders.reduce((sum, f) => sum + countLeafDocs(f), 0);
}

/**
 * Group a flat list of docs by their path segment at `depth` (0-indexed).
 * Docs shallower than depth+1 segments go into `directDocs`.
 * Returns synthetic folders keyed by segment, plus leftover direct docs.
 */
function groupDocsByPathSegment(docs: TocDoc[], depth: number, parentId: string): { directDocs: TocDoc[]; folders: TocFolder[] } {
  const directDocs: TocDoc[] = [];
  const bySegment = new Map<string, TocDoc[]>();
  for (const doc of docs) {
    const parts = doc.path.split("/");
    // At this depth, folder is parts[depth]; leaf filename is parts[depth+1] or later
    if (parts.length <= depth + 1) {
      directDocs.push(doc);
      continue;
    }
    const segment = parts[depth];
    if (!segment) {
      directDocs.push(doc);
      continue;
    }
    let bucket = bySegment.get(segment);
    if (!bucket) {
      bucket = [];
      bySegment.set(segment, bucket);
    }
    bucket.push(doc);
  }
  // Only promote to folder if 2+ docs share a segment; single-doc "folders" stay direct
  const folders: TocFolder[] = [];
  for (const [segment, bucket] of bySegment) {
    if (bucket.length < 2) {
      directDocs.push(...bucket);
      continue;
    }
    folders.push({
      id: `${parentId}/${segment}`,
      label: segment,
      docs: bucket,
      folders: [],
    });
  }
  folders.sort((a, b) => a.label.localeCompare(b.label));
  return { directDocs, folders };
}

/** Parse ~/.kuma/vault/index.md into a nested section/folder/doc tree. */
function parseIndexMd(content: string): TocSection[] {
  // 1) Parse `##` sections and `###` subsections (docs as flat list under each)
  interface RawSubsection { label: string; docs: TocDoc[] }
  interface RawSection { id: string; label: string; docs: TocDoc[]; subsections: RawSubsection[] }
  const raw: RawSection[] = [];
  let currentSection: RawSection | null = null;
  let currentSub: RawSubsection | null = null;
  for (const line of content.split("\n")) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      currentSection = { id: slug(h2[1]), label: h2[1], docs: [], subsections: [] };
      currentSub = null;
      raw.push(currentSection);
      continue;
    }
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3 && currentSection) {
      currentSub = { label: h3[1], docs: [] };
      currentSection.subsections.push(currentSub);
      continue;
    }
    if (!currentSection) continue;
    const link = line.match(/^-\s+\[(.+?)\]\((.+?)\)(?:\s*[—\-–]\s*(.+))?/);
    if (!link) continue;
    const doc: TocDoc = { title: link[1], path: link[2], description: link[3]?.trim() };
    if (currentSub) currentSub.docs.push(doc);
    else currentSection.docs.push(doc);
  }

  // 2) For each section, convert ### subsections → folders, and auto-group direct docs by path segment
  const sections: TocSection[] = [];
  for (const rawSec of raw) {
    const basePath = rawSec.id; // "projects" / "learnings" / "domains" / ...
    const { directDocs, folders: pathFolders } = groupDocsByPathSegment(rawSec.docs, 1, basePath);
    const subFolders: TocFolder[] = rawSec.subsections.map((sub) => ({
      id: `${rawSec.id}/${slug(sub.label)}`,
      label: sub.label,
      docs: sub.docs,
      folders: [],
    }));
    // Merge path-derived folders with explicit subsections; explicit subsections win on label match
    const mergedByKey = new Map<string, TocFolder>();
    for (const f of [...subFolders, ...pathFolders]) {
      const key = f.label.toLowerCase();
      const existing = mergedByKey.get(key);
      if (existing) {
        // Merge docs, dedupe by path
        const seen = new Set(existing.docs.map((d) => d.path));
        for (const d of f.docs) if (!seen.has(d.path)) existing.docs.push(d);
      } else {
        mergedByKey.set(key, f);
      }
    }
    const folders = Array.from(mergedByKey.values()).sort((a, b) => a.label.localeCompare(b.label));
    const section: TocSection = {
      id: rawSec.id,
      label: rawSec.label,
      docs: directDocs.sort((a, b) => a.title.localeCompare(b.title)),
      folders,
      totalDocs: 0,
    };
    section.totalDocs = countLeafDocs(section);
    sections.push(section);
  }
  return sections;
}

const VAULT_SECTIONS_META: Record<string, { accent: string; textClass: string; icon: string }> = {
  domains:          { accent: "#8b5cf6", textClass: "text-violet-400", icon: "🏛" },
  projects:         { accent: "#f59e0b", textClass: "text-amber-400", icon: "📁" },
  learnings:        { accent: "#10b981", textClass: "text-emerald-400", icon: "💡" },
  inbox:            { accent: "#64748b", textClass: "text-slate-400", icon: "📥" },
  "cross-references": { accent: "#0ea5e9", textClass: "text-sky-400", icon: "🔗" },
};
const VAULT_FALLBACK_META = { accent: "#6366f1", textClass: "text-indigo-400", icon: "📄" };

type ViewerFile =
  | { type: "code"; content: string; language: string; path: string }
  | { type: "image"; content: string; mimeType: string; path: string }
  | { type: "pdf"; content: string; mimeType: string; path: string }
  | { type: "binary"; size: number; path: string }
  | { type: "vault"; content: string; title: string; path: string; meta: FrontmatterMeta }
  | null;

interface FileExplorerProps {
  onCollapse?: () => void;
  activeProjectId?: string | null;
  activeProjectName?: string | null;
}

const VAULT_DEPTH_INDENT_PX = 12;

function VaultFixedLink({
  icon, label, hint, path, active, onSelect,
}: {
  icon: string; label: string; hint: string; path: string; active: boolean; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-white/5"
      style={{
        background: active ? "rgba(14,165,233,0.12)" : "transparent",
        borderLeft: active ? "2px solid #0ea5e9" : "2px solid transparent",
      }}
      title={path}
    >
      <span className="text-[11px]">{icon}</span>
      <span className="text-[10px] font-semibold" style={{ color: active ? "#0ea5e9" : "var(--t-secondary)" }}>{label}</span>
      <span className="ml-auto text-[8px]" style={{ color: "var(--t-faint)" }}>{hint}</span>
    </button>
  );
}

function VaultDocRow({
  doc, depth, accent, active, onSelect,
}: {
  doc: TocDoc; depth: number; accent: string; active: boolean; onSelect: () => void;
}) {
  const leftPad = 8 + depth * VAULT_DEPTH_INDENT_PX;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-start gap-1.5 py-1 pr-2 text-left transition-colors hover:bg-white/5"
      style={{
        paddingLeft: leftPad,
        background: active ? `${accent}14` : "transparent",
        borderLeft: active ? `2px solid ${accent}` : "2px solid transparent",
      }}
      title={doc.path}
    >
      <span className="mt-[2px] shrink-0 text-[9px]" style={{ color: active ? accent : "var(--t-faint)" }}>•</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-medium truncate" style={{ color: active ? accent : "var(--t-primary)" }}>
          {doc.title}
        </span>
        {doc.description && (
          <span className="block text-[9px] truncate mt-0.5" style={{ color: "var(--t-faint)" }}>
            {doc.description}
          </span>
        )}
      </span>
    </button>
  );
}

function VaultFolderRow({
  folder, depth, accent, expanded, setExpanded, selectedPath, onSelect,
}: {
  folder: TocFolder;
  depth: number;
  accent: string;
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  selectedPath: string | null;
  onSelect: (doc: TocDoc) => void | Promise<void>;
}) {
  const isOpen = expanded[folder.id] ?? false;
  const leftPad = 6 + depth * VAULT_DEPTH_INDENT_PX;
  const count = folder.docs.length + folder.folders.length;
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((prev) => ({ ...prev, [folder.id]: !prev[folder.id] }))}
        className="flex w-full items-center gap-1.5 py-1 pr-2 transition-colors hover:bg-white/5"
        style={{ paddingLeft: leftPad }}
        title={folder.label}
      >
        <svg
          width="9" height="9" viewBox="0 0 16 16"
          className={`shrink-0 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
          style={{ color: "var(--t-faint)" }}
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="text-[10px]" style={{ color: accent }}>{isOpen ? "📂" : "📁"}</span>
        <span className="text-[10px] font-semibold truncate" style={{ color: "var(--t-secondary)" }}>{folder.label}</span>
        <span className="ml-auto text-[8px] font-medium tabular-nums" style={{ color: "var(--t-faint)" }}>{count}</span>
      </button>
      {isOpen && (
        <div>
          {folder.folders.map((child) => (
            <VaultFolderRow
              key={child.id}
              folder={child}
              depth={depth + 1}
              accent={accent}
              expanded={expanded}
              setExpanded={setExpanded}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
          {folder.docs.map((doc) => (
            <VaultDocRow
              key={doc.path}
              doc={doc}
              depth={depth + 1}
              accent={accent}
              active={selectedPath === doc.path}
              onSelect={() => { void onSelect(doc); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const KUMA_PORT = Number(import.meta.env.VITE_KUMA_PORT) || 4312;
const BASE_URL = `http://${window.location.hostname}:${KUMA_PORT}`;
const TREE_WIDTH_INITIAL = 260;
const TREE_WIDTH_MIN = 180;
const TREE_WIDTH_MAX = 420;

interface ExplorerRoots {
  workspaceRoot: string;
  systemRoot: string;
  projectRoots: Record<string, string>;
  globalRoots: Partial<Record<"vault" | "claude" | "codex", string>>;
}

interface GlobalSection {
  id: string;
  label: string;
  icon: string;
  color: string;
}

interface FilesystemChangeEvent {
  type: "kuma-studio:event";
  event: {
    kind: "filesystem-change";
    changes: Array<{
      rootId: string;
      rootPath: string;
      eventType: string;
      path: string;
      relativePath: string;
      origin?: string;
      changedAt?: string;
    }>;
  };
}

const GLOBAL_SECTION_DEFS: GlobalSection[] = [
  { id: "vault", label: ".kuma/vault", icon: "V", color: "text-sky-500" },
  { id: "claude", label: ".claude", icon: "C", color: "text-violet-500" },
  { id: "codex", label: ".codex", icon: "X", color: "text-emerald-500" },
];

function inferProjectRoot(explorerRoots: ExplorerRoots | null, activeProjectId: string | null | undefined) {
  if (!explorerRoots) {
    return "";
  }

  if (!activeProjectId) {
    return explorerRoots.workspaceRoot;
  }

  if (activeProjectId === "system") {
    return explorerRoots.systemRoot;
  }

  return explorerRoots.projectRoots[activeProjectId]
    ?? `${explorerRoots.workspaceRoot}/${activeProjectId}`;
}

export function FileExplorer({ onCollapse, activeProjectId = null, activeProjectName = null }: FileExplorerProps) {
  const ws = useWsStore((state) => state.ws);
  const [tree, setTree] = useState<FsNode | null>(null);
  const [explorerRoots, setExplorerRoots] = useState<ExplorerRoots | null>(null);
  const [globalTrees, setGlobalTrees] = useState<Record<string, FsNode | null>>({});
  const [globalExpanded, setGlobalExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [treeWidth, setTreeWidth] = useState(TREE_WIDTH_INITIAL);
  const [viewerFile, setViewerFile] = useState<ViewerFile>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const resizingRef = useRef(false);

  // Sidebar tab state
  const [sidebarTab, setSidebarTab] = useState<"files" | "vault">("files");

  // Vault state
  const [vaultIndexLoaded, setVaultIndexLoaded] = useState(false);
  const [tocSections, setTocSections] = useState<TocSection[]>([]);
  const [vaultSectionExpanded, setVaultSectionExpanded] = useState<Record<string, boolean>>({});

  // Search state
  const [searchQuery, setSearchQuery] = useState("");

  // Git status state
  const [gitStatus, setGitStatus] = useState<GitStatusMap>({});
  const [gitRoot, setGitRoot] = useState<string>("");
  const [refreshToken, setRefreshToken] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadGitStatus = useCallback(async (root: string) => {
    if (!root) return;
    const response = await fetch(`${BASE_URL}/studio/git/status?root=${encodeURIComponent(root)}`);
    const data: { root: string; files: GitStatusMap } = await response.json();
    setGitStatus(data.files);
    setGitRoot(data.root);
  }, []);

  const fetchTreeForRoot = useCallback(async (rootPath: string, depth = 2) => {
    const target = rootPath?.trim();
    if (!target) {
      return null;
    }
    const response = await fetch(`${BASE_URL}/studio/fs/tree?root=${encodeURIComponent(target)}&depth=${depth}`);
    return response.json() as Promise<FsNode>;
  }, []);

  const reloadRootTree = useCallback(async () => {
    const roots = await fetch(`${BASE_URL}/studio/fs/roots`).then((r) => r.json());
    const activeRoot = inferProjectRoot(roots, activeProjectId);
    let data = activeRoot ? await fetchTreeForRoot(activeRoot, 2) : null;
    if (data && "error" in data) {
      const fallbackRoot = roots.workspaceRoot;
      data = fallbackRoot && fallbackRoot !== activeRoot
        ? await fetchTreeForRoot(fallbackRoot, 2)
        : null;
    }
    setExplorerRoots(roots);
    setTree(data);
    setError(null);
    setRefreshToken((current) => current + 1);
    return { roots, tree: data as FsNode };
  }, [activeProjectId, fetchTreeForRoot]);

  const reloadVaultIndex = useCallback(async () => {
    const vaultRoot = explorerRoots?.globalRoots.vault;
    if (!vaultRoot) return;

    const indexPath = `${vaultRoot}/index.md`;
    const response = await fetch(`${BASE_URL}/studio/fs/read?path=${encodeURIComponent(indexPath)}`);
    const data = await response.json();
    if (data.content) {
      const sections = parseIndexMd(data.content);
      setTocSections(sections);
      setVaultSectionExpanded((previous) => {
        const next = { ...previous };
        for (const section of sections) {
          // Sections expand by default (except Cross References — it's meta, keep collapsed)
          if (next[section.id] == null) {
            next[section.id] = section.id !== "cross-references" && section.totalDocs > 0;
          }
        }
        return next;
      });
    } else {
      setTocSections([]);
    }
    setVaultIndexLoaded(true);
  }, [explorerRoots?.globalRoots.vault]);

  // Fetch git status
  useEffect(() => {
    const root = tree?.path || "";
    if (!root) return;
    void loadGitStatus(root).catch(() => {});

    // Refresh every 30s
    const interval = setInterval(() => {
      void loadGitStatus(root).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, [loadGitStatus, tree?.path]);

  // Filter tree by search query
  const filteredTree = useMemo(() => {
    if (!tree || !searchQuery.trim()) return tree;
    const q = searchQuery.toLowerCase();
    function filterNode(node: FsNode): FsNode | null {
      if (node.type === "file") {
        return node.name.toLowerCase().includes(q) ? node : null;
      }
      // Directory: include if any child matches
      const filteredChildren = (node.children ?? [])
        .map(filterNode)
        .filter((n): n is FsNode => n !== null);
      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(q)) {
        return { ...node, children: filteredChildren };
      }
      return null;
    }
    const result = filterNode(tree);
    return result;
  }, [tree, searchQuery]);

  // Git status summary
  const gitChangedCount = Object.keys(gitStatus).length;
  const globalSections = useMemo(
    () => GLOBAL_SECTION_DEFS
      .map((section) => ({
        ...section,
        path: explorerRoots?.globalRoots[section.id as keyof ExplorerRoots["globalRoots"]] ?? "",
      }))
      .filter((section) => section.path),
    [explorerRoots],
  );
  const hasVaultRoot = Boolean(explorerRoots?.globalRoots.vault);

  // Fetch root tree
  useEffect(() => {
    setLoading(true);
    reloadRootTree()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [reloadRootTree]);

  useEffect(() => {
    if (!hasVaultRoot && sidebarTab === "vault") {
      setSidebarTab("files");
    }
  }, [hasVaultRoot, sidebarTab]);

  // Load global config tree on demand
  const loadGlobalTree = useCallback(async (section: GlobalSection & { path: string }, force = false) => {
    if (!section.path || (!force && globalTrees[section.id])) return;
    try {
      const r = await fetch(`${BASE_URL}/studio/fs/tree?root=${encodeURIComponent(section.path)}&depth=2`);
      const data: FsNode = await r.json();
      setGlobalTrees((prev) => ({ ...prev, [section.id]: data }));
    } catch {
      setGlobalTrees((prev) => ({ ...prev, [section.id]: { name: section.label, path: section.path, type: "dir", children: [] } }));
    }
  }, [globalTrees]);

  const toggleGlobalSection = useCallback((section: GlobalSection & { path: string }) => {
    const willExpand = !globalExpanded[section.id];
    setGlobalExpanded((prev) => ({ ...prev, [section.id]: willExpand }));
    if (willExpand) {
      void loadGlobalTree(section);
    }
  }, [globalExpanded, loadGlobalTree]);

  // Load children for lazy expansion
  const handleLoadChildren = useCallback(async (path: string): Promise<FsNode> => {
    const r = await fetch(`${BASE_URL}/studio/fs/tree?root=${encodeURIComponent(path)}&depth=1`);
    return r.json();
  }, []);

  // File select → load content into viewer
  const handleFileSelect = useCallback(async (path: string) => {
    // If clicking the same file, do nothing
    if (viewerFile && "path" in viewerFile && viewerFile.path === path) return;

    setFileLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/studio/fs/read?path=${encodeURIComponent(path)}`);
      const data = await r.json();
      if (data.error) {
        setFileLoading(false);
        return;
      }
      if (data.binary) {
        setViewerFile({ type: "binary", size: data.size, path });
      } else if (data.mimeType === "application/pdf") {
        setViewerFile({ type: "pdf", content: data.content, mimeType: data.mimeType, path });
      } else if (data.mimeType) {
        setViewerFile({ type: "image", content: data.content, mimeType: data.mimeType, path });
      } else {
        setViewerFile({ type: "code", content: data.content, language: data.language || "plaintext", path });
      }
    } catch {
      // ignore
    }
    setFileLoading(false);
  }, [viewerFile]);

  // File delete handler
  const handleFileDelete = useCallback(async (path: string) => {
    const r = await fetch(`${BASE_URL}/studio/fs/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.error || "Delete failed");

    // If the deleted path is the viewed file, or the viewed file sat inside
    // a deleted folder, close the viewer.
    if (viewerFile && "path" in viewerFile) {
      const viewed = viewerFile.path;
      if (viewed === path || viewed.startsWith(`${path}/`)) {
        setViewerFile(null);
      }
    }

    await reloadRootTree();
    await loadGitStatus(tree?.path || "");
  }, [loadGitStatus, reloadRootTree, tree?.path, viewerFile]);

  // Tree panel resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startWidth = treeWidth;

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const newWidth = Math.min(Math.max(startWidth + ev.clientX - startX, TREE_WIDTH_MIN), TREE_WIDTH_MAX);
      setTreeWidth(newWidth);
    };

    const onUp = () => {
      resizingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [treeWidth]);

  // Parse index.md when vault tab is selected
  useEffect(() => {
    if (sidebarTab !== "vault" || vaultIndexLoaded || !explorerRoots?.globalRoots.vault) return;
    reloadVaultIndex().catch(() => setVaultIndexLoaded(true));
  }, [explorerRoots, reloadVaultIndex, vaultIndexLoaded, sidebarTab]);

  useEffect(() => {
    if (!ws) return;

    const scheduleRefresh = (refreshVaultIndex: boolean) => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void reloadRootTree().catch(() => {});
        void loadGitStatus(tree?.path || explorerRoots?.workspaceRoot || "").catch(() => {});
        void Promise.all(
          globalSections
            .filter((section) => globalExpanded[section.id])
            .map((section) => loadGlobalTree(section, true)),
        ).catch(() => {});
        if (refreshVaultIndex) {
          void reloadVaultIndex().catch(() => {});
        }
      }, 100);
    };

    const handleMessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data as string) as FilesystemChangeEvent;
        if (payload.type !== "kuma-studio:event" || payload.event.kind !== "filesystem-change") {
          return;
        }

        const refreshVaultIndex = payload.event.changes.some((change) => change.rootId === "vault");
        scheduleRefresh(refreshVaultIndex);
      } catch {
        // ignore malformed websocket payloads
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      ws.removeEventListener("message", handleMessage);
    };
  }, [
    explorerRoots?.workspaceRoot,
    globalExpanded,
    globalSections,
    loadGitStatus,
    loadGlobalTree,
    reloadRootTree,
    reloadVaultIndex,
    tree?.path,
    ws,
  ]);

  const handleVaultSelect = useCallback(async (doc: TocDoc) => {
    if (!explorerRoots?.globalRoots.vault) return;
    if (viewerFile?.type === "vault" && viewerFile.path === doc.path) return;
    if (viewerFile?.type === "image" && viewerFile.path === doc.path) return;
    if (viewerFile?.type === "pdf" && viewerFile.path === doc.path) return;
    const filePath = `${explorerRoots.globalRoots.vault}/${doc.path}`;
    setFileLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/studio/fs/read?path=${encodeURIComponent(filePath)}`);
      const data = await r.json();
      if (data.mimeType === "application/pdf") {
        setViewerFile({ type: "pdf", content: data.content, mimeType: data.mimeType, path: doc.path });
      } else if (data.mimeType) {
        // Image file from vault TOC
        setViewerFile({ type: "image", content: data.content, mimeType: data.mimeType, path: doc.path });
      } else if (data.content) {
        const { meta, body } = parseFrontmatter(data.content);
        setViewerFile({
          type: "vault",
          content: body,
          title: meta.title || doc.title,
          path: doc.path,
          meta,
        });
      }
    } catch { /* ignore */ }
    setFileLoading(false);
  }, [explorerRoots, viewerFile]);

  // Keyboard: Esc closes viewer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && viewerFile) {
        setViewerFile(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewerFile]);

  const projectName = activeProjectId
    ? activeProjectName ?? activeProjectId
    : "workspace";
  const workspaceRootLabel = tree?.path || inferProjectRoot(explorerRoots, activeProjectId) || explorerRoots?.workspaceRoot || "workspace";
  const hasViewer = viewerFile !== null;
  const effectiveTreeWidth = viewerFile?.type === "pdf" ? Math.min(treeWidth, 220) : treeWidth;

  return (
    <div className="flex h-full">
      {/* ── Left: File tree panel ── */}
      <div
        className={[
          "relative flex h-full flex-col",
          hasViewer
            ? "border-r shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)]"
            : "shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)]",
        ].join(" ")}
        style={{
          background: "var(--ide-bg)",
          borderColor: "var(--card-border)",
          ...(hasViewer
            ? { width: effectiveTreeWidth, minWidth: TREE_WIDTH_MIN, maxWidth: TREE_WIDTH_MAX }
            : { width: TREE_WIDTH_INITIAL, minWidth: TREE_WIDTH_INITIAL, maxWidth: TREE_WIDTH_INITIAL }),
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--card-border)", background: `linear-gradient(to bottom, var(--ide-header-from), var(--ide-header-to))` }}>
          <div className="flex items-center gap-2 min-w-0">
            <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 text-amber-500" fill="currentColor">
              <path d="M2 3.5A1.5 1.5 0 013.5 2h2.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H12.5A1.5 1.5 0 0114 5.5v7a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9z" />
            </svg>
            <div className="min-w-0">
              <h3 className="text-[11px] font-semibold truncate" style={{ color: "var(--t-secondary)" }}>
                {projectName}
              </h3>
              <p className="truncate text-[9px] leading-tight" style={{ color: "var(--t-faint)" }}>{workspaceRootLabel}</p>
            </div>
          </div>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="shrink-0 rounded p-0.5 transition-colors"
              style={{ color: "var(--t-faint)" }}
              title="탐색기 접기"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M11 4L7 8l4 4" />
                <path d="M5 3v10" />
              </svg>
            </button>
          )}
        </div>

        {/* Tab bar: 파일 / Vault */}
        <div className="flex border-b" style={{ borderColor: "var(--card-border)" }}>
          <button
            type="button"
            onClick={() => setSidebarTab("files")}
            className="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
            style={{
              color: sidebarTab === "files" ? "var(--t-primary)" : "var(--t-faint)",
              background: sidebarTab === "files" ? "var(--card-bg)" : "transparent",
              borderBottom: sidebarTab === "files" ? "2px solid var(--t-accent, #f59e0b)" : "2px solid transparent",
            }}
          >
            파일
          </button>
          {hasVaultRoot && (
            <button
              type="button"
              onClick={() => setSidebarTab("vault")}
              className="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
              style={{
                color: sidebarTab === "vault" ? "var(--t-primary)" : "var(--t-faint)",
                background: sidebarTab === "vault" ? "var(--card-bg)" : "transparent",
                borderBottom: sidebarTab === "vault" ? "2px solid #0ea5e9" : "2px solid transparent",
              }}
            >
              Vault
            </button>
          )}
        </div>

        {/* Scrollable tree content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
          {sidebarTab === "files" && (<>
          {/* Search bar */}
          <div className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <div className="relative flex items-center">
              <svg width="12" height="12" viewBox="0 0 16 16" className="absolute left-2 shrink-0" style={{ color: "var(--t-faint)" }} fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="파일 검색..."
                className="w-full rounded py-1 pl-7 pr-2 text-[11px] outline-none transition-colors"
                style={{
                  background: "var(--card-bg)",
                  color: "var(--t-primary)",
                  border: "1px solid var(--border-subtle)",
                }}
                data-panel-no-drag="true"
                spellCheck={false}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-1.5 rounded-full p-0.5 transition-colors hover:bg-white/10"
                  style={{ color: "var(--t-faint)" }}
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Workspace header */}
          <div className="flex items-center gap-1.5 px-3 py-1" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--t-faint)" }}>Explorer</span>
            {gitChangedCount > 0 && (
              <span className="ml-auto rounded-full px-1.5 text-[8px] font-bold tabular-nums" style={{ color: "#f59e0b", background: "rgba(245, 158, 11, 0.12)" }}>
                {gitChangedCount} changed
              </span>
            )}
          </div>

          <div className="py-0.5">
            {loading && (
              <div className="flex items-center gap-2 px-3 py-4">
                <svg width="12" height="12" viewBox="0 0 12 12" className="animate-spin" style={{ color: "var(--t-faint)" }}>
                  <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 14" strokeLinecap="round" />
                </svg>
                <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>Loading...</span>
              </div>
            )}
            {error && (
              <div className="px-3 py-4 text-[10px] text-red-500 flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
                  <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 111.5 0v3.5a.75.75 0 01-1.5 0V5zm.75 6.5a.75.75 0 100-1.5.75.75 0 000 1.5z" />
                </svg>
                {error}
              </div>
            )}
            {(searchQuery ? filteredTree : tree)?.children?.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={0}
                selectedPath={viewerFile && "path" in viewerFile ? viewerFile.path : null}
                onFileSelect={handleFileSelect}
                onLoadChildren={handleLoadChildren}
                onDelete={handleFileDelete}
                gitStatus={gitStatus}
                gitRoot={gitRoot}
                refreshToken={refreshToken}
              />
            ))}
            {searchQuery && (!filteredTree?.children || filteredTree.children.length === 0) && (
              <p className="px-3 py-3 text-[10px] italic" style={{ color: "var(--t-faint)" }}>
                &quot;{searchQuery}&quot; 검색 결과 없음
              </p>
            )}
          </div>

          {/* Global Config sections */}
          {globalSections.map((section) => {
            const isExpanded = globalExpanded[section.id] ?? false;
            const sectionTree = globalTrees[section.id];

            return (
              <div key={section.id}>
                <button
                  type="button"
                  onClick={() => toggleGlobalSection(section)}
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 transition-colors"
                  style={{ borderTop: "1px solid var(--card-border)", background: "var(--card-bg)" }}
                  data-panel-no-drag="true"
                >
                  <svg
                    width="10" height="10" viewBox="0 0 16 16"
                    className={`shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                    style={{ color: "var(--t-faint)" }}
                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                  <span className={`text-[11px] font-bold ${section.color}`}>{section.icon}</span>
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--t-muted)" }}>{section.label}</span>
                  <span className="text-[9px] ml-auto" style={{ color: "var(--t-faint)" }}>~/</span>
                </button>

                {isExpanded && (
                  <div className="py-0.5">
                    {!sectionTree && (
                      <div className="flex items-center gap-2 px-3 py-2">
                        <svg width="10" height="10" viewBox="0 0 12 12" className="animate-spin" style={{ color: "var(--t-faint)" }}>
                          <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 14" strokeLinecap="round" />
                        </svg>
                        <span className="text-[9px]" style={{ color: "var(--t-faint)" }}>Loading...</span>
                      </div>
                    )}
                    {sectionTree?.children?.map((child) => (
                      <FileTreeNode
                        key={child.path}
                        node={child}
                        depth={0}
                        selectedPath={viewerFile && "path" in viewerFile ? viewerFile.path : null}
                        onFileSelect={handleFileSelect}
                        onLoadChildren={handleLoadChildren}
                        onDelete={handleFileDelete}
                        refreshToken={refreshToken}
                      />
                    ))}
                    {sectionTree && (!sectionTree.children || sectionTree.children.length === 0) && (
                      <p className="px-3 py-2 text-[9px] italic" style={{ color: "var(--t-faint)" }}>(empty)</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          </>)}

          {/* ── Vault tab: Wiki-style TOC ── */}
          {sidebarTab === "vault" && (
            <div className="py-1">
              {/* Wiki header */}
              <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <h3 className="text-[12px] font-bold" style={{ color: "var(--t-primary)" }}>Kuma Wiki</h3>
                <p className="text-[9px] mt-0.5 truncate" style={{ color: "var(--t-faint)" }}>~/.kuma/vault</p>
              </div>

              {/* Fixed top links: Schema + Index */}
              <div className="flex flex-col" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <VaultFixedLink
                  icon="📋"
                  label="Schema"
                  hint="운영 규칙"
                  path="schema.md"
                  active={viewerFile?.type === "vault" && viewerFile.path === "schema.md"}
                  onSelect={() => { void handleVaultSelect({ title: "Schema", path: "schema.md" }); }}
                />
                <VaultFixedLink
                  icon="🗂"
                  label="Index"
                  hint="전체 목차"
                  path="index.md"
                  active={viewerFile?.type === "vault" && viewerFile.path === "index.md"}
                  onSelect={() => { void handleVaultSelect({ title: "Index", path: "index.md" }); }}
                />
              </div>

              {!vaultIndexLoaded && (
                <div className="flex items-center gap-2 px-3 py-3">
                  <svg width="10" height="10" viewBox="0 0 12 12" className="animate-spin" style={{ color: "var(--t-faint)" }}>
                    <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 14" strokeLinecap="round" />
                  </svg>
                  <span className="text-[9px]" style={{ color: "var(--t-faint)" }}>index.md 파싱 중...</span>
                </div>
              )}

              {vaultIndexLoaded && tocSections.length === 0 && (
                <p className="px-3 py-3 text-[9px] italic" style={{ color: "var(--t-faint)" }}>(index.md 없음)</p>
              )}

              {vaultIndexLoaded && tocSections.filter((sec) => sec.totalDocs > 0).map((sec) => {
                const meta = VAULT_SECTIONS_META[sec.id] ?? VAULT_FALLBACK_META;
                const isExpanded = vaultSectionExpanded[sec.id] ?? false;
                const selectedPath =
                  viewerFile?.type === "vault" || viewerFile?.type === "image" || viewerFile?.type === "pdf"
                    ? viewerFile.path
                    : null;
                const isMeta = sec.id === "cross-references";

                return (
                  <div key={sec.id} className="mt-0.5">
                    {/* Section header — wiki category */}
                    <button
                      type="button"
                      onClick={() => setVaultSectionExpanded((prev) => ({ ...prev, [sec.id]: !prev[sec.id] }))}
                      className="group flex w-full items-center gap-1.5 py-1.5 pl-3 pr-2 transition-colors hover:bg-white/5"
                      style={{ borderLeft: `3px solid ${meta.accent}`, opacity: isMeta ? 0.75 : 1 }}
                    >
                      <svg
                        width="10" height="10" viewBox="0 0 16 16"
                        className={`shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                        style={{ color: meta.accent }}
                        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                      >
                        <path d="M6 4l4 4-4 4" />
                      </svg>
                      <span className="text-[11px]">{meta.icon}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${meta.textClass}`}>{sec.label}</span>
                      <span className="ml-auto rounded-full px-1.5 text-[8px] font-semibold tabular-nums" style={{ background: `${meta.accent}18`, color: meta.accent }}>{sec.totalDocs}</span>
                    </button>

                    {/* Section body — folders + docs */}
                    {isExpanded && (
                      <div className="pb-1">
                        {sec.folders.map((folder) => (
                          <VaultFolderRow
                            key={folder.id}
                            folder={folder}
                            depth={1}
                            accent={meta.accent}
                            expanded={vaultSectionExpanded}
                            setExpanded={setVaultSectionExpanded}
                            selectedPath={selectedPath}
                            onSelect={handleVaultSelect}
                          />
                        ))}
                        {sec.docs.map((doc) => (
                          <VaultDocRow
                            key={doc.path}
                            doc={doc}
                            depth={1}
                            accent={meta.accent}
                            active={selectedPath === doc.path}
                            onSelect={() => { void handleVaultSelect(doc); }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Last updated footer */}
              {vaultIndexLoaded && tocSections.length > 0 && (
                <div className="px-3 pt-2 pb-1 mt-1" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <span className="text-[8px]" style={{ color: "var(--t-faint)" }}>index.md 기반 목차</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer status bar */}
        {tree && (
          <div className="flex items-center gap-2 px-3 py-1" style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--ide-bg)" }}>
            <span className="text-[9px]" style={{ color: "var(--t-faint)" }}>
              {tree.children?.length ?? 0} items
            </span>
            {gitChangedCount > 0 && (
              <span className="flex items-center gap-1 text-[8px] font-mono" style={{ color: "#f59e0b" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                {gitChangedCount}
              </span>
            )}
          </div>
        )}

        {/* Divider resize handle — only when viewer is open */}
        {hasViewer && (
          <div
            className="absolute right-0 top-0 bottom-0 w-[3px] cursor-col-resize transition-colors hover:bg-amber-400/50 active:bg-amber-500/60 z-10"
            onMouseDown={handleResizeStart}
          />
        )}
      </div>

      {/* ── Right: File viewer panel — only rendered when a file is selected ── */}
      {hasViewer && (
        <div className="relative flex-1 flex flex-col min-w-0" style={{ background: "var(--ide-bg-alt)" }}>
          {fileLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
              <div className="flex items-center gap-2 rounded-lg px-4 py-2 shadow-sm border" style={{ background: "var(--panel-bg-strong)", borderColor: "var(--border-subtle)" }}>
                <svg width="14" height="14" viewBox="0 0 12 12" className="animate-spin text-amber-500">
                  <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 14" strokeLinecap="round" />
                </svg>
                <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>Loading...</span>
              </div>
            </div>
          )}

          {viewerFile?.type === "code" && (
            <CodeViewer
              inline
              content={viewerFile.content}
              language={viewerFile.language}
              filePath={viewerFile.path}
              onClose={() => setViewerFile(null)}
              onSave={(newContent) => setViewerFile({ ...viewerFile, content: newContent })}
            />
          )}

          {viewerFile?.type === "image" && (
            <ImageViewer
              inline
              content={viewerFile.content}
              mimeType={viewerFile.mimeType}
              filePath={viewerFile.path}
              onClose={() => setViewerFile(null)}
            />
          )}

          {viewerFile?.type === "pdf" && (
            <PdfViewer
              inline
              content={viewerFile.content}
              mimeType={viewerFile.mimeType}
              filePath={viewerFile.path}
              onClose={() => setViewerFile(null)}
            />
          )}

          {viewerFile?.type === "binary" && (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-3" style={{ color: "var(--t-faint)" }}>
                <svg width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <rect x="8" y="8" width="32" height="32" rx="4" />
                  <path d="M16 20h4v8h-4zM20 24h4v4h-4zM28 20h4v8h-4zM24 20h4v4h-4z" fill="currentColor" opacity="0.3" />
                </svg>
                <div className="text-center">
                  <p className="text-[12px] font-medium">바이너리 파일</p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--t-faint)" }}>{viewerFile.path.split("/").pop()}</p>
                  <p className="text-[10px]" style={{ color: "var(--t-faint)" }}>{(viewerFile.size / 1024).toFixed(1)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={() => setViewerFile(null)}
                  className="mt-1 rounded px-3 py-1 text-[10px] font-medium transition-colors"
                  style={{ color: "var(--t-muted)", background: "var(--badge-bg)" }}
                >
                  닫기
                </button>
              </div>
            </div>
          )}

          {viewerFile?.type === "vault" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Vault doc header */}
              <div
                className="flex-shrink-0 flex items-start justify-between gap-3 border-b px-4 py-3"
                style={{ borderColor: "var(--card-border)", background: "var(--ide-bg)" }}
              >
                <div className="min-w-0 flex-1">
                  <h2 className="text-[13px] font-bold leading-snug truncate" style={{ color: "var(--t-primary)" }}>
                    {viewerFile.title}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {Array.isArray(viewerFile.meta.tags) && viewerFile.meta.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full px-2 py-0.5 text-[9px] font-medium"
                        style={{ background: "rgba(14,165,233,0.12)", color: "#0ea5e9", border: "1px solid rgba(14,165,233,0.2)" }}
                      >
                        {tag}
                      </span>
                    ))}
                    {viewerFile.meta.created && (
                      <span className="text-[9px]" style={{ color: "var(--t-faint)" }}>{viewerFile.meta.created}</span>
                    )}
                    {viewerFile.path && (
                      <code className="text-[8px]" style={{ color: "var(--t-faint)" }}>{viewerFile.path}</code>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setViewerFile(null)}
                  className="shrink-0 rounded p-1 text-[10px] transition-colors"
                  style={{ color: "var(--t-faint)" }}
                  title="닫기"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
              {/* Vault doc body */}
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {viewerFile.content ? (
                  <MarkdownBody content={viewerFile.content} />
                ) : (
                  <p className="text-[11px] italic" style={{ color: "var(--t-faint)" }}>(내용 없음)</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
