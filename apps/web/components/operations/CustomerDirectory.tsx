"use client";

import { useEffect, useState, type FormEvent } from "react";
import { authRequest, API_URL, useCustomer } from "../../lib/customer-session";
import CustomerOrderHistory from "../customer-order-history";
import CustomerDeliveries from "../customer-deliveries";
import { ManagerSignIn } from "./ManagerSignIn";
import { OperationsShell } from "./OperationsShell";

type Account = { id: string; name: string; email: string; joinedAt: string; orderCount: number; lastOrderAt: string | null };
type DirectoryPage = { customers: Account[]; nextCursor: string | null };
const directoryPath = "/v1/auth/admin/customers";
const displayDate = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "America/Toronto" });

function DirectoryLookup() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [pages, setPages] = useState<string[]>([""]);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Account | null>(null);
  const [result, setResult] = useState<DirectoryPage | null>(null);
  const [message, setMessage] = useState("");
  const cursor = pages[pages.length - 1];
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (cursor) params.set("after", cursor);
    async function load() {
      setResult(null);
      setMessage("");
      setSelected(null);
      try {
        const response = await fetch(`${API_URL}${directoryPath}?${params}`, {
          credentials: "include", cache: "no-store", signal: controller.signal,
        });
        if (response.status === 403) throw new Error("This account does not have manager access.");
        if (response.status === 401) throw new Error("Your session has expired. Sign in again.");
        if (!response.ok) throw new Error("The customer directory is unavailable. Try again.");
        const data: DirectoryPage = await response.json();
        if (!controller.signal.aborted) setResult(data);
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "The customer directory is unavailable.");
      }
    }
    void load();
    return () => controller.abort();
  }, [cursor, search, revision]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPages([""]);
    setSearch(query.trim());
    setRevision(value => value + 1);
  }

  return (
    <div className="directory-workspace">
      <section aria-label="Find customers">
        <form className="directory-search" onSubmit={submit}>
          <label htmlFor="directory-query">Find a customer</label>
          <div><input id="directory-query" type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Name or email" maxLength={120} /><button className="ops-button">Search</button></div>
        </form>
        {message ? <div role="alert"><p>{message}</p><button className="ops-text-button" onClick={() => setRevision(value => value + 1)}>Retry</button></div>
          : !result ? <p role="status">Loading customers…</p>
          : <>
            <ul className="directory-list">
              {result.customers.map(account => (
                <li key={account.id}>
                  <button aria-pressed={selected?.id === account.id} onClick={() => setSelected(account)}>
                    <span><strong>{account.name}</strong><small>{account.email}</small></span>
                    <span>{account.orderCount} {account.orderCount === 1 ? "order" : "orders"}</span>
                  </button>
                </li>
              ))}
            </ul>
            {!result.customers.length && <p role="status">{search ? "No customers match this search." : "No registered customers yet."}</p>}
            {(pages.length > 1 || result.nextCursor) && <nav className="directory-pagination" aria-label="Customer pages">
              <button className="ops-text-button" disabled={pages.length === 1} onClick={() => setPages(list => list.slice(0, -1))}>Previous</button>
              <span>Page {pages.length}</span>
              <button className="ops-text-button" disabled={!result.nextCursor} onClick={() => { if (result.nextCursor) setPages(list => [...list, result.nextCursor!]); }}>Next</button>
            </nav>}
          </>}
      </section>
      {selected && result ? <section className="directory-detail" aria-label="Customer details">
        <h2>{selected.name}</h2>
        <p>{selected.email}</p>
        <dl><div><dt>Joined</dt><dd>{displayDate.format(new Date(selected.joinedAt))}</dd></div>
          <div><dt>Last order</dt><dd>{selected.lastOrderAt ? displayDate.format(new Date(selected.lastOrderAt)) : "No orders yet"}</dd></div></dl>
        <CustomerDeliveries key={selected.id} accountId={selected.id} manager />
        <CustomerOrderHistory accountId={selected.id} endpoint={`${directoryPath}/${selected.id}/orders`} />
      </section> : result && result.customers.length > 0 ? <p className="directory-placeholder">Select a customer to see their orders.</p> : null}
    </div>
  );
}

export default function CustomerDirectory() {
  const user = useCustomer();
  const [error, setError] = useState("");
  return <OperationsShell active="customers">
    <main id="main-content" tabIndex={-1} className="ops-main directory-main">
      <div className="ops-title-row"><h1>Customers</h1>
        {user && <button className="ops-text-button" onClick={async () => {
          try { await authRequest("logout"); setError(""); } catch { setError("Sign-out could not be confirmed. Try again."); }
        }}>Sign out</button>}
      </div>
      {error && <p role="alert">{error}</p>}
      {user ? <DirectoryLookup key={user.id} /> : <ManagerSignIn description="Use your restaurant manager account to look up guest order history." />}
    </main>
  </OperationsShell>;
}
