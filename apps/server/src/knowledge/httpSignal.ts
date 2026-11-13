import { AsyncLocalStorage } from "node:async_hooks";
const accountContext = new AsyncLocalStorage<string>();
export function withExternalHttpAccount<T>(accountId: string, run: () => T): T { return accountContext.run(accountId, run); }

export type ExternalHttpNote = {
  provider: string;
  endpoint: string;
  status?: number;
  headers?: Record<string, string>;
  error?: string;
  schemaOk?: boolean;
  category?: string;
  subject?: { type: "account"; id: string };
};

type Observer = (note: ExternalHttpNote) => void;
let observer: Observer | null = null;

export function setExternalHttpObserver(next: Observer | null): void {
  observer = next;
}

export function noteExternalHttp(note: ExternalHttpNote): void {
  try {
    const accountId = accountContext.getStore();
    observer?.(note.subject || !accountId ? note : { ...note, subject: { type: "account", id: accountId } });
  } catch {
    // A detector must not change the result of the call it watches.
  }
}
