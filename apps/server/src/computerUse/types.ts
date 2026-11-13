export const COMPUTER_ACTIONS = ["observe", "navigate", "click", "type"] as const;
export type ComputerAction = (typeof COMPUTER_ACTIONS)[number];

export type ScreenElement = {
  id: string;
  role: "button" | "link" | "tab" | "input";
  label: string;
  /** Changes data when used. Navigation links and tabs never do. */
  sideEffect?: boolean;
  /** Password, OTP, key or card field. Seeing one stops the session. */
  sensitive?: boolean;
};

export type Screen = {
  app: string;
  /** Set when the window shows a web page. Must be allowed like an app. */
  domain?: string;
  title: string;
  text: string[];
  elements: ScreenElement[];
};

export type AdapterCapabilities = {
  apps: string[];
  observation: "accessibility" | "screenshot";
  actions: ComputerAction[];
};

/**
 * One environment the app can drive. The adapter only observes and acts; every scope,
 * credential and confirmation rule lives in the service so all adapters share it.
 */
export interface ComputerUseAdapter {
  id: string;
  label: string;
  capabilities(): AdapterCapabilities;
  observe(app: string, signal?: AbortSignal): Promise<Screen>;
  /** Returns confirmed=false when the adapter cannot tell whether the action took effect. */
  act(app: string, action: { kind: "navigate" | "click" | "type"; elementId: string; text?: string },
    signal?: AbortSignal): Promise<{ confirmed: boolean }>;
}
