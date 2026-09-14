/* A throwaway Postgres for local development, no install required.

   PGlite is Postgres compiled to WASM; this serves it on a TCP port speaking
   the real wire protocol, so the app connects to it exactly as it will connect
   to Neon in production. Data lives in .devdb/ and is safe to delete.

   npm run dev:db     then    DATABASE_URL=postgres://postgres@localhost:55432/postgres npm run dev */

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = Number(process.env.DEV_DB_PORT || 55432);

async function main() {
  const db = await PGlite.create({ dataDir: ".devdb" });
  const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
  await server.start();

  console.log(`dev database listening on postgres://postgres@localhost:${PORT}/postgres`);
  console.log("data in .devdb/ — delete it to start over. Ctrl+C to stop.");

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      await server.stop();
      await db.close();
      process.exit(0);
    });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
