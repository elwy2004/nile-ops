export function money(n: number, d = 2): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: d, maximumFractionDigits: d,
  });
}

export function shortDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function stamp(d: string | Date): string {
  const x = new Date(d);
  const today = new Date().toDateString() === x.toDateString();
  const time = x.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return today ? `today ${time}` : `${x.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${time}`;
}
