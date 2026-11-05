export type StandingOrderDraft = {
  title: string;
  prompt: string;
  cron?: string | null;
};

export type OperatorToolHooks = {
  saveStandingOrder: (input: StandingOrderDraft) => unknown;
  findSkills: (query: string) => unknown;
  findTools: (query: string) => unknown;
};

let hooks: OperatorToolHooks | null = null;

export function setOperatorToolHooks(next: OperatorToolHooks | null): void {
  hooks = next;
}

export function operatorToolHooks(): OperatorToolHooks | null {
  return hooks;
}
