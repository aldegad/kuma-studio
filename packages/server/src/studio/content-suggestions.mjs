import { execGitSync } from "./git-command.mjs";

const TREND_FEEDS = [
  "https://hnrss.org/newest?q=AI",
  "https://www.marktechpost.com/feed/",
];

function trimLines(value, limit) {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function stripXml(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gisu, "$1")
    .replace(/<[^>]+>/gisu, "")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .trim();
}

async function readFeedHeadlines(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "kuma-studio-content-bot/1.0",
      },
    });
    if (!response.ok) {
      return [];
    }

    const xml = await response.text();
    const matches = [...xml.matchAll(/<title>([\s\S]*?)<\/title>/giu)];
    return matches
      .map((match) => stripXml(match[1]))
      .filter(Boolean)
      .filter((title) => !/^rss|atom$/iu.test(title))
      .slice(0, 5);
  } catch {
    return [];
  }
}

function readRecentGitLog(workspaceRoot, project) {
  try {
    const projectPath = workspaceRoot;
    const raw = execGitSync("git log --oneline -8 --no-color", {
      cwd: projectPath,
      encoding: "utf8",
      timeout: 4000,
    });
    return trimLines(raw, 8);
  } catch {
    return [];
  }
}

export async function generateContentDrafts({ project, workspaceRoot }) {
  const gitLines = readRecentGitLog(workspaceRoot, project);
  const trendResults = await Promise.all(TREND_FEEDS.map((feed) => readFeedHeadlines(feed)));
  const trendLines = trendResults.flat().slice(0, 6);
  const timestamp = new Date().toISOString();
  const nextMorning = new Date();

  nextMorning.setHours(nextMorning.getHours() + 12);

  return [
    {
      project,
      type: "text",
      title: `[${project}] 개발 로그 기반 스레드 초안`,
      body: [
        "이번 작업에서 눈에 띄는 변경점을 스레드용 초안으로 정리했습니다.",
        "",
        "핵심 개발 로그",
        ...gitLines.map((line) => `- ${line}`),
        "",
        "추천 포맷",
        "- 문제 -> 수정 -> 검증 -> 다음 단계 순으로 4~5포스트 스레드 구성",
      ].join("\n"),
      status: "draft",
      scheduledFor: nextMorning.toISOString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      project,
      type: "text",
      title: `[${project}] AI 트렌드 요약 초안`,
      body: [
        "외부 AI 트렌드 헤드라인을 모아 스레드 초안으로 정리했습니다.",
        "",
        "트렌드 헤드라인",
        ...trendLines.map((line) => `- ${line}`),
        "",
        "추천 포맷",
        "- 오늘 본 트렌드 3개",
        "- 우리 프로젝트와 연결되는 시사점",
        "- 다음 실험 아이디어",
      ].join("\n"),
      status: "draft",
      scheduledFor: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}
