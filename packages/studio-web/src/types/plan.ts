export type PlanStatus =
  | "draft"
  | "active"
  | "in_progress"
  | "hold"
  | "blocked"
  | "completed"
  | "cancelled"
  | "archived"
  | "failed"
  | "error"
  | (string & {});

export type PlanStatusColor =
  | "blue"
  | "yellow"
  | "orange"
  | "green"
  | "red"
  | "gray"
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
  filePath: string;
  project: string | null;
  title: string;
  status: PlanStatus;
  statusColor: PlanStatusColor;
  created: string | null;
  body: string;
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
