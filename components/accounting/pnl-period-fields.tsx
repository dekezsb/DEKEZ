"use client";

import { useState } from "react";

export function PnlPeriodFields({ period, month, from, to, comparison }: {
  period: string; month: string; from?: string; to?: string; comparison: string;
}) {
  const [view, setView] = useState(period);
  const field = "mt-1 h-10 w-full rounded-md border border-[#d7dde5] bg-white px-3 text-sm";
  return <>
    <label className="text-xs font-medium text-gray-600">Period
      <select className={field} name="period" value={view} onChange={(event) => setView(event.target.value)}>
        <option value="monthly">Monthly</option><option value="six-months">Six months</option><option value="yearly">Full year</option><option value="custom">Custom months</option>
      </select>
    </label>
    {view === "custom" ? <>
      <input name="month" type="hidden" value={month} />
      <label className="text-xs font-medium text-gray-600">From month<input className={field} defaultValue={from || month} name="from" type="month" required /></label>
      <label className="text-xs font-medium text-gray-600">To month<input className={field} defaultValue={to || month} name="to" type="month" required /></label>
    </> : <label className="text-xs font-medium text-gray-600">{view === "yearly" ? "Year (any month in that year)" : view === "six-months" ? "Six months ending" : "Reporting month"}<input className={field} defaultValue={month} name="month" type="month" required /></label>}
    <label className="text-xs font-medium text-gray-600">Compare with<select className={field} defaultValue={comparison} name="comparison"><option value="previous">Previous equal-length period</option><option value="last-year">Same period last year</option></select></label>
  </>;
}
