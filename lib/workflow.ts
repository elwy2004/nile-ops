/* The quote lifecycle. Every transition names the role allowed to make it, so
   the gates between sales, operations and finance are enforced in one place
   rather than scattered through the UI. */

export type Status =
  | "draft" | "quoted" | "accepted" | "confirming" | "ready"
  | "invoiced" | "paid" | "closed" | "lost" | "cancelled";

export type Role = "sales" | "ops" | "finance" | "admin";

export const STATUS_LABEL: Record<Status, string> = {
  draft: "Draft",
  quoted: "Sent to client",
  accepted: "Client accepted",
  confirming: "Operations confirming",
  ready: "Ready to invoice",
  invoiced: "Invoiced",
  paid: "Paid",
  closed: "Closed",
  lost: "Lost",
  cancelled: "Cancelled",
};

/** Which desk owns the quote at each stage — drives the "my work" filters. */
export const STATUS_DESK: Record<Status, Role | null> = {
  draft: "sales", quoted: "sales", accepted: "ops", confirming: "ops",
  ready: "finance", invoiced: "finance", paid: "finance",
  closed: null, lost: null, cancelled: null,
};

export type Transition = {
  to: Status;
  label: string;
  roles: Role[];
  /** Freeze the price book into the quote as it crosses this transition. */
  freezes?: boolean;
  /** Reopen for editing — clears the frozen snapshot. */
  thaws?: boolean;
  tone?: "go" | "warn" | "stop";
  hint?: string;
};

export const TRANSITIONS: Record<Status, Transition[]> = {
  draft: [
    { to: "quoted", label: "Send to client", roles: ["sales", "admin"], tone: "go" },
    { to: "cancelled", label: "Cancel", roles: ["sales", "admin"], tone: "stop" },
  ],
  quoted: [
    { to: "accepted", label: "Client accepted", roles: ["sales", "admin"], freezes: true, tone: "go",
      hint: "Locks the rates and exchange rate this deal was sold at, then hands it to operations." },
    { to: "draft", label: "Revise", roles: ["sales", "admin"], tone: "warn" },
    { to: "lost", label: "Mark lost", roles: ["sales", "admin"], tone: "stop" },
  ],
  accepted: [
    { to: "confirming", label: "Start confirming", roles: ["ops", "admin"], tone: "go" },
    { to: "quoted", label: "Send back to sales", roles: ["ops", "admin"], thaws: true, tone: "warn",
      hint: "Unlocks prices so sales can requote." },
    { to: "cancelled", label: "Cancel", roles: ["ops", "admin"], tone: "stop" },
  ],
  confirming: [
    { to: "ready", label: "All services confirmed", roles: ["ops", "admin"], tone: "go",
      hint: "Hands the file to finance for invoicing." },
    { to: "accepted", label: "Back to accepted", roles: ["ops", "admin"], tone: "warn" },
    { to: "cancelled", label: "Cancel", roles: ["ops", "admin"], tone: "stop" },
  ],
  ready: [
    { to: "invoiced", label: "Invoice issued", roles: ["finance", "admin"], tone: "go" },
    { to: "confirming", label: "Back to operations", roles: ["finance", "admin"], tone: "warn" },
    { to: "cancelled", label: "Cancel", roles: ["finance", "admin"], tone: "stop" },
  ],
  invoiced: [
    { to: "paid", label: "Payment received", roles: ["finance", "admin"], tone: "go" },
    { to: "ready", label: "Withdraw invoice", roles: ["finance", "admin"], tone: "warn" },
  ],
  paid: [
    { to: "closed", label: "Close file", roles: ["finance", "admin"], tone: "go" },
  ],
  closed: [],
  lost: [{ to: "draft", label: "Reopen", roles: ["sales", "admin"], thaws: true, tone: "warn" }],
  cancelled: [{ to: "draft", label: "Reopen", roles: ["sales", "admin"], thaws: true, tone: "warn" }],
};

export function allowedTransitions(status: Status, role: Role): Transition[] {
  return (TRANSITIONS[status] ?? []).filter(t => t.roles.includes(role));
}

export function canTransition(status: Status, to: Status, role: Role): Transition | null {
  return allowedTransitions(status, role).find(t => t.to === to) ?? null;
}

/** Quote terms and lines are only editable while sales still holds the file. */
export function canEditQuote(status: Status, role: Role): boolean {
  if (role === "admin") return status !== "closed";
  return role === "sales" && (status === "draft" || status === "quoted");
}

/** Only ops and admin maintain the price book; nobody edits it from a quote. */
export function canEditRates(role: Role): boolean {
  return role === "ops" || role === "admin";
}

/** Margin is commercial information — ops doesn't need it to book hotels. */
export function canSeeMargin(role: Role): boolean {
  return role === "sales" || role === "finance" || role === "admin";
}
