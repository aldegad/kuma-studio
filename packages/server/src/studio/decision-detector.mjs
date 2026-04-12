const FILLER_PATTERN = /^(?:아+|오+|어+|응+|엉+|음+|흠+|ㅋ+|ㅎㅎ+|하하+|lol|ok|ㅇ+)$|^(?:ㅇㅋ|오케이)\s*$/iu;
const QUESTION_ENDING_PATTERN = /(?:\?$|[?？]|(?:할까|갈까|말까|둘까|볼까|할까요|갈까요|말까요|둘까요|볼까요)\s*$)/u;
const APPROVE_PATTERNS = [
  /^(?:ㄱㄱ|ㄱ|ㅇㅋ|오케이|좋아|가자|확정|콜|진행해)$/u,
  /^(?:이걸로|이거로|그걸로|그거로)\s*(?:가|가자|확정|진행해)$/u,
  /^(?:이 방향으로|이 안으로)\s*(?:가|가자|확정)$/u,
];
const REJECT_PATTERNS = [
  /^(?:ㄴㄴ|아냐|아니야|아님|그건 아님|하지 마|그건 말고|삭제)$/u,
  /^(?:이건|그건|저건)\s*(?:아냐|아님|말고)$/u,
];
const HOLD_PATTERNS = [
  /^(?:보류|나중에|일단 냅둬|일단 두자|미뤄|홀드)$/u,
];
const PRIORITY_PATTERNS = [
  /^(?:이거|이게|이걸)\s*(?:먼저|우선)$/u,
  /^.+보다\s+.+먼저$/u,
  /^(?:이게 급함|이거 우선)$/u,
];
const PREFERENCE_PATTERNS = [
  /^(?:앞으로 이렇게|다음부터 이렇게|항상 이렇게|절대 이렇게|기본값은 .+)$/u,
  /^(?:다음부터|앞으로|항상|절대)\s+.+$/u,
];

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeQuestion(text) {
  return QUESTION_ENDING_PATTERN.test(text);
}

function isFiller(text) {
  return FILLER_PATTERN.test(text);
}

function matchAction(text) {
  const taxonomy = [
    ["approve", APPROVE_PATTERNS],
    ["reject", REJECT_PATTERNS],
    ["hold", HOLD_PATTERNS],
    ["priority", PRIORITY_PATTERNS],
    ["preference", PREFERENCE_PATTERNS],
  ];

  for (const [action, patterns] of taxonomy) {
    const matched = patterns.find((pattern) => pattern.test(text));
    if (matched) {
      return { action, keyword: matched.source };
    }
  }

  return null;
}

function matchContextualAction(text) {
  const contextualTaxonomy = [
    ["approve", [/이 방향으로\s*가자/u, /이걸로\s*가자/u, /이걸로\s*가\b/u, /확정/u]],
    ["reject", [/그건\s*말고/u, /하지\s*마/u]],
    ["hold", [/보류/u, /나중에/u, /미뤄/u]],
    ["priority", [/먼저/u, /우선/u]],
    ["preference", [/다음부터/u, /앞으로/u, /항상/u, /절대/u]],
  ];

  for (const [action, patterns] of contextualTaxonomy) {
    const matched = patterns.find((pattern) => pattern.test(text));
    if (matched) {
      return { action, keyword: matched.source };
    }
  }

  return null;
}

function hasExplicitResponseContext(precedingContext) {
  if (!precedingContext) {
    return false;
  }

  if (typeof precedingContext === "string") {
    return /\?$|선택|방향|진행|이걸로|어떻게/u.test(precedingContext);
  }

  if (typeof precedingContext === "object") {
    if (precedingContext.respondingToProposal === true || precedingContext.awaitingDecision === true) {
      return true;
    }
    if (typeof precedingContext.text === "string") {
      return hasExplicitResponseContext(precedingContext.text);
    }
  }

  return false;
}

export function detectDecision({ text, precedingContext = null }) {
  const originalText = normalizeText(text);
  if (!originalText) {
    return null;
  }
  if (originalText.length > 200 && !hasExplicitResponseContext(precedingContext)) {
    return null;
  }
  if (isFiller(originalText)) {
    return null;
  }
  if (looksLikeQuestion(originalText)) {
    return null;
  }

  const matched = matchAction(originalText);
  if (!matched && hasExplicitResponseContext(precedingContext)) {
    const contextual = matchContextualAction(originalText);
    if (contextual) {
      return {
        matched: true,
        action: contextual.action,
        keyword: contextual.keyword,
        original_text: originalText,
      };
    }
  }
  if (!matched) {
    return null;
  }

  return {
    matched: true,
    action: matched.action,
    keyword: matched.keyword,
    original_text: originalText,
  };
}
