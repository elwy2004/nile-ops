/* Server Components format dates on the server, which runs in UTC — so times
   must name a timezone explicitly or the office sees the wrong clock. */
const TZ = process.env.NEXT_PUBLIC_TIMEZONE || "Africa/Cairo";

export function money(n: number, d = 2): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: d, maximumFractionDigits: d,
  });
}

/** Travel dates are plain calendar dates: format them as written, no zone shift. */
export function shortDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  // A Date from a DATE column sits at local midnight, so read its local parts;
  // toISOString() here would roll the day back east of UTC.
  const iso = typeof d === "string"
    ? d.slice(0, 10)
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

/** Event times: shown in the office timezone, on any server. */
export function stamp(d: string | Date): string {
  const x = new Date(d);
  const day = (t: Date) => t.toLocaleDateString("en-CA", { timeZone: TZ });
  const time = x.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  return day(x) === day(new Date())
    ? `today ${time}`
    : `${x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: TZ })} ${time}`;
}
