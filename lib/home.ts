import type { Role } from "./workflow";

/* Each desk opens on its own work, not a shared list. */
export const HOME: Record<Role, string> = {
  sales: "/quotes",
  ops: "/operations",
  finance: "/finance",
  admin: "/quotes",
};

export function homeFor(role: Role): string {
  return HOME[role] ?? "/quotes";
}
