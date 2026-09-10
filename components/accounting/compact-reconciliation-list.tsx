"use client";

import { Children, useState, type ReactNode } from "react";

export function CompactReconciliationList({ children, searchTerms }: { children: ReactNode; searchTerms: string[] }) {
  const [query, setQuery] = useState("");
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const visible = searchTerms.map((text) => terms.every((term) => text.toLowerCase().includes(term)));
  return <section className="space-y-2">
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-white p-3 shadow-sm">
      <label className="flex-1 text-xs font-medium">Find a transaction<input className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search description, reference, date or amount" /></label>
      <span className="text-xs text-gray-600" aria-live="polite">{visible.filter(Boolean).length} / {searchTerms.length} transactions</span>
      {query ? <button type="button" className="text-sm text-blue-700" onClick={() => setQuery("")}>Clear</button> : null}
      <p className="w-full text-xs text-gray-600">All transactions on one page. Click a row to reconcile; click it again to close. Only one transaction opens at a time.</p>
    </div>
    {Children.map(children, (child, index) => <div hidden={!visible[index]}>{child}</div>)}
    {!visible.some(Boolean) ? <p className="p-3 text-sm text-gray-600">No matching transactions. Clear the search to show all.</p> : null}
  </section>;
}
