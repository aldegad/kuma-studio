export type PlanStatus =
  | "draft"
  | "in_progress"
  | "blocked"
  | "completed"
  | "archived"
  | "error"
  | (string & {});

export interface PlanWarning {
  code:
    | "empty-file"
    | "frontmatter-not-closed"
    | "frontmatter-malformed"
    | "read-error";
  message: string;
}

export interface PlanItem {
  text: string;
  checked: boolean;
  commitHash: string | null;
}

export interface PlanSection {
  title: string;
  items: PlanItem[];
}

export interface Plan {
  id: string;
  project: string | null;
  title: string;
  status: PlanStatus;
  created: string | null;
  sections: PlanSection[];
  totalItems: number;
  checkedItems: number;
  completionRate: number;
  warnings: PlanWarning[];
}

export interface PlansSnapshot {
  plans: Plan[];
  totalItems: number;
  checkedItems: number;
  overallCompletionRate: number;
}
