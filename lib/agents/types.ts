import type { PRDState } from "./prd-state";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type DiscoveryEvent =
  | { type: "delta"; text: string }
  | { type: "state"; state: PRDState }
  | { type: "ready"; state: PRDState }
  | { type: "error"; message: string }
  | { type: "done" };
