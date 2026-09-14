/* Where the Postgres connection string comes from.

   Vercel's storage integrations each name their own variable, so accept the
   common ones rather than forcing one. DATABASE_URL wins when set, which is
   what local development uses. */
const CANDIDATES = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "NILEDB_POSTGRES_URL",
  "NILEDB_URL",
  "POSTGRES_PRISMA_URL",
] as const;

export function connectionString(): string {
  for (const key of CANDIDATES) {
    const v = process.env[key];
    if (v && v.trim() !== "") return v.trim();
  }
  throw new Error(
    `No Postgres connection string. Set one of: ${CANDIDATES.join(", ")}. See README.`
  );
}

/** TLS settings for pg. A connection string that states its own sslmode wins. */
export function sslFor(url: string): { rejectUnauthorized: boolean } | undefined {
  if (/[?&]sslmode=/.test(url)) return undefined;       // let the URL decide
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return undefined;
  return { rejectUnauthorized: false };
}
