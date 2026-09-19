import type { Role, Status } from "./workflow";

/* Which stages sit on which desk. A file belongs to exactly one department at
   a time, decided by its status — so it appears on that desk and nowhere else,
   and moves the moment the status moves. */
export const DESK_STATUSES: Record<Role, Status[]> = {
  sales:   ["draft", "quoted"],
  ops:     ["accepted", "confirming"],
  finance: ["ready", "invoiced", "paid"],
  admin:   ["draft", "quoted", "accepted", "confirming", "ready", "invoiced", "paid"],
};

/** What the desk before this one has to finish for a file to arrive. */
export const DESK_ARRIVES_FROM: Record<Role, string | null> = {
  sales: null,
  ops: "a client accepts the quote",
  finance: "operations confirms the last service",
  admin: null,
};

/** What this desk has to finish for the file to leave. */
export const DESK_LEAVES_WHEN: Record<Role, string | null> = {
  sales: "you mark the client as accepted",
  ops: "every service is confirmed",
  finance: "the file is closed",
  admin: null,
};

export type DeskFile = {
  id: number; ref: string; title: string; client_name: string;
  status: Status; pax: number; arrival: string | null; departure: string | null;
  fx: number; updated_at: string;
  sell_usd: number;            // from the frozen snapshot where there is one
  margin_usd: number;
  services_total: number;
  services_open: number;
  next_service: string | null;
  invoiced_usd: number;
  received_usd: number;
  cost_usd: number;
  paid_usd: number;
};
