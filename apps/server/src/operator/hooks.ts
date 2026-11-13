export type StandingOrderDraft = {
  title: string;
  prompt: string;
  cron?: string | null;
};

/** TASK-122: what the supervisor tools (Hermes) may do to the operator. Set by OperatorService. */
export type OperatorSupervisorHooks = {
  listRuns: (limit: number) => unknown[];
  getRun: (runId: string) => unknown;
  /** Stops the run when it is the active one, or drops it from the queue. */
  stopRun: (runId: string) => { stopped: boolean; message: string };
  newSession: () => void;
  enqueue: (input: { instruction: string; profileId?: string; projectId?: string; priority: string; assignedBy: string }) =>
    { runId: string; status: string; message: string };
  listOrders: () => unknown[];
  upsertOrder: (input: { id?: string; title: string; prompt: string; cron?: string | null; enabled?: boolean }) => { id: string; title: string };
  disableOrder: (id: string) => void;
  /** Sends one Telegram message through the app bot. Returns false when Telegram is off. */
  sendTelegram: (text: string) => Promise<boolean>;
};

export type OperatorToolHooks = {
  supervisor?: OperatorSupervisorHooks;
  saveStandingOrder: (input: StandingOrderDraft) => unknown;
  findSkills: (query: string) => unknown;
  findTools: (query: string) => unknown;
  notifyToolProposal?: (name: string) => void;
};

let hooks: OperatorToolHooks | null = null;

export function setOperatorToolHooks(next: OperatorToolHooks | null): void {
  hooks = next;
}

export function operatorToolHooks(): OperatorToolHooks | null {
  return hooks;
}
