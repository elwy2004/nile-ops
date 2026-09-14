import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { saveRate, addRate, archiveRate } from "@/lib/actions";
import { canEditRates } from "@/lib/workflow";
import { money } from "@/lib/format";

type Book = "hotels" | "transfers" | "sights" | "meals" | "services";
type Item = { id: number; book: Book; name: string; rate1: number; rate2: number; rate3: number; archived: boolean };

const BOOKS: { key: Book; title: string; cur: string; cols: string[] }[] = [
  { key: "hotels",    title: "Hotels & cruises", cur: "USD", cols: ["Property", "Per night DBL", "Single supp."] },
  { key: "transfers", title: "Transfers",        cur: "EGP", cols: ["Route", "Hi-Ace 8", "Coaster 16", "Bus"] },
  { key: "sights",    title: "Sightseeing",      cur: "EGP", cols: ["Site", "Per person"] },
  { key: "meals",     title: "Meals & others",   cur: "EGP", cols: ["Item", "Per person"] },
  { key: "services",  title: "Services",         cur: "EGP", cols: ["Service", "Per unit"] },
];

export default async function RatesPage({
  searchParams,
}: { searchParams: Promise<{ denied?: string; saved?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const editable = canEditRates(user.role);

  const items = await q<Item>(
    `SELECT id, book, name, rate1::float8 AS rate1, rate2::float8 AS rate2, rate3::float8 AS rate3, archived
       FROM rate_items ORDER BY book, archived, name`
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Price book</h1>
          <p>
            {editable
              ? "Changes apply to every quote still with sales. Quotes already accepted keep the prices they were sold at."
              : "Read-only. Operations and administrators maintain these rates."}
          </p>
        </div>
      </div>

      {sp.denied && <div className="note bad" style={{ marginBottom: 16 }}>
        <div>Only operations and administrators can change rates.</div></div>}
      {sp.saved && <div className="note" style={{ marginBottom: 16 }}><div>Rate saved.</div></div>}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(380px,1fr))" }}>
        {BOOKS.map(book => {
          const rows = items.filter(i => i.book === book.key);
          const rateCols = book.cols.length - 1;
          return (
            <div className="card" key={book.key}>
              <h2>{book.title}<span className="side">{book.cur} · {rows.length} items</span></h2>
              <div className="tablewrap" style={{ maxHeight: 440, overflowY: "auto" }}>
                <table className="data">
                  <thead>
                    <tr>{book.cols.map(c => <th key={c}>{c}</th>)}{editable && <th />}</tr>
                  </thead>
                  <tbody>
                    {rows.map(item => (
                      <tr key={item.id} style={item.archived ? { opacity: 0.45 } : undefined}>
                        {editable ? (
                          <>
                            <td colSpan={rateCols + 1} style={{ padding: 0 }}>
                              <form action={saveRate} style={{ display: "grid", gridTemplateColumns: `minmax(0,1fr) repeat(${rateCols}, 92px) auto`, gap: 6, alignItems: "center", padding: "6px 14px" }}>
                                <input type="hidden" name="id" value={item.id} />
                                <input className="t" name="name" defaultValue={item.name} style={{ padding: "6px 8px" }} />
                                {[1, 2, 3].slice(0, rateCols).map(n => (
                                  <input key={n} className="t num" type="number" step="0.01" min={0}
                                         name={`rate${n}`}
                                         defaultValue={item[`rate${n}` as "rate1" | "rate2" | "rate3"]}
                                         style={{ padding: "6px 8px" }} />
                                ))}
                                {rateCols < 3 && [...Array(3 - rateCols)].map((_, i) => (
                                  <input key={`h${i}`} type="hidden" name={`rate${rateCols + i + 1}`} value={0} />
                                ))}
                                <button className="btn btn-sm" type="submit">Save</button>
                              </form>
                            </td>
                            <td style={{ padding: "6px 10px" }}>
                              <form action={archiveRate}>
                                <input type="hidden" name="id" value={item.id} />
                                <button className="btn btn-sm btn-stop" type="submit">
                                  {item.archived ? "Restore" : "Retire"}
                                </button>
                              </form>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>{item.name}</td>
                            {[1, 2, 3].slice(0, rateCols).map(n => (
                              <td key={n}>{money(item[`rate${n}` as "rate1" | "rate2" | "rate3"], book.key === "hotels" ? 2 : 0)}</td>
                            ))}
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {editable && (
                <form action={addRate} className="body" style={{ display: "grid", gridTemplateColumns: `minmax(0,1fr) repeat(${rateCols}, 92px) auto`, gap: 6, borderTop: "1px solid var(--line)", background: "var(--surface-2)" }}>
                  <input type="hidden" name="book" value={book.key} />
                  <input className="t" name="name" placeholder={`New ${book.cols[0].toLowerCase()}`} style={{ padding: "6px 8px" }} required />
                  {[1, 2, 3].slice(0, rateCols).map(n => (
                    <input key={n} className="t num" type="number" step="0.01" min={0} name={`rate${n}`}
                           defaultValue={0} style={{ padding: "6px 8px" }} />
                  ))}
                  {rateCols < 3 && [...Array(3 - rateCols)].map((_, i) => (
                    <input key={`h${i}`} type="hidden" name={`rate${rateCols + i + 1}`} value={0} />
                  ))}
                  <button className="btn btn-sm" type="submit">Add</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
