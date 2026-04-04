import { useState } from "react";

const REFERENCE_DATA = [
  {
    title: "설정 시스템 (4단계)",
    rows: [
      { scope: "Managed", path: "서버/plist 관리", share: "조직 전체" },
      { scope: "User", path: "~/.claude/settings.json", share: "본인, 전 프로젝트" },
      { scope: "Project", path: ".claude/settings.json", share: "git 커밋, 팀 공유" },
      { scope: "Local", path: ".claude/settings.local.json", share: "본인만" },
    ],
  },
  {
    title: "스킬 로딩 순서",
    rows: [
      { scope: "Personal", path: "~/.claude/skills/<name>/SKILL.md", share: "글로벌" },
      { scope: "Project", path: ".claude/skills/<name>/SKILL.md", share: "git 포함" },
      { scope: "Plugin", path: "<plugin>/skills/<name>/SKILL.md", share: "네임스페이스" },
    ],
  },
  {
    title: "메모리 구조",
    rows: [
      { scope: "인덱스", path: "~/.claude/projects/<repo>/memory/MEMORY.md", share: "세션마다 자동 로드" },
      { scope: "토픽 파일", path: "~/.claude/projects/<repo>/memory/*.md", share: "온디맨드 로드" },
    ],
    note: "키는 git 레포 루트 기반. 머신 로컬 전용 — 다른 PC 자동 동기화 없음.",
  },
];

const SYNC_ITEMS = [
  { file: "~/.claude/settings.json", desc: "User 설정, MCP 서버", auto: false },
  { file: "~/.claude/CLAUDE.md", desc: "글로벌 지시사항", auto: false },
  { file: "~/.claude/skills/", desc: "개인 스킬", auto: false },
  { file: ".claude/settings.json", desc: "프로젝트 설정", auto: true },
  { file: ".claude/skills/", desc: "프로젝트 스킬", auto: true },
  { file: "~/.claude/projects/*/memory/", desc: "자동 메모리", auto: false },
];

export function ReferencePanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-3 left-44 z-40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-stone-200/60 bg-white/80 px-2.5 py-1.5 text-[10px] font-bold text-stone-500 shadow-sm backdrop-blur-sm transition-all hover:border-stone-300 hover:bg-white hover:text-stone-700 hover:shadow-md"
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 3h12M2 6.5h8M2 10h10M2 13.5h6" />
        </svg>
        참고문서
      </button>

      {open && (
        <div className="absolute bottom-9 left-0 w-[420px] max-h-[70vh] overflow-y-auto rounded-xl border border-stone-200/60 bg-white/95 shadow-lg backdrop-blur-md">
          <div className="border-b border-stone-100 px-4 py-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-stone-800">
                Claude Code 구조 참고문서
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
              >
                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
            <p className="mt-1 text-[9px] text-stone-400">
              출처: code.claude.com/docs — skills, memory, settings
            </p>
          </div>

          <div className="space-y-4 px-4 py-3">
            {REFERENCE_DATA.map((section) => (
              <div key={section.title}>
                <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-500">
                  {section.title}
                </h4>
                <div className="overflow-hidden rounded-lg border border-stone-200/50">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="bg-stone-50/80 text-left text-stone-500">
                        <th className="px-2 py-1.5 font-semibold">스코프</th>
                        <th className="px-2 py-1.5 font-semibold">경로</th>
                        <th className="px-2 py-1.5 font-semibold">공유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row, i) => (
                        <tr
                          key={row.scope}
                          className={i % 2 === 0 ? "bg-white" : "bg-stone-50/40"}
                        >
                          <td className="px-2 py-1.5 font-medium text-stone-700">
                            {row.scope}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-[9px] text-stone-500">
                            {row.path}
                          </td>
                          <td className="px-2 py-1.5 text-stone-600">
                            {row.share}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {section.note && (
                  <p className="mt-1 text-[9px] text-amber-600">
                    {section.note}
                  </p>
                )}
              </div>
            ))}

            <div>
              <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-500">
                다른 PC 재현 시 동기화
              </h4>
              <div className="space-y-1">
                {SYNC_ITEMS.map((item) => (
                  <div
                    key={item.file}
                    className="flex items-center gap-2 rounded-md border border-stone-100 bg-stone-50/40 px-2 py-1.5"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[8px] font-bold ${
                        item.auto
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {item.auto ? "G" : "M"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-[9px] text-stone-600">
                        {item.file}
                      </span>
                      <span className="ml-1.5 text-[9px] text-stone-400">
                        — {item.desc}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[9px] text-stone-400">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-emerald-100 text-[7px] font-bold text-emerald-700">
                  G
                </span>{" "}
                git clone으로 자동 공유{" "}
                <span className="ml-2 inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-amber-100 text-[7px] font-bold text-amber-700">
                  M
                </span>{" "}
                수동 복사 필요
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
