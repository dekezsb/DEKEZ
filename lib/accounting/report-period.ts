export function reportPeriod(month: string, period = "monthly", from?: string, to?: string, comparison = "previous") {
  const valid = (value?: string) => Boolean(value && /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value));
  if (!valid(month)) throw new Error("Invalid reporting month");
  const index = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
  const date = (value: number, day = 1) => new Date(Date.UTC(Math.floor(value / 12), value % 12, day)).toISOString().slice(0, 10);
  let end = index(month);
  let start = end;
  if (period === "yearly") {
    start = Math.floor(end / 12) * 12;
    end = start + 11;
  } else if (period === "six-months") start = end - 5;
  else if (period === "custom") {
    if (!valid(from) || !valid(to)) throw new Error("Choose a valid start and end month");
    start = index(from!);
    end = index(to!);
    if (start > end) throw new Error("End month must be on or after start month");
  }
  const shift = comparison === "last-year" ? 12 : end - start + 1;
  return {
    startDate: date(start), endDate: date(end + 1, 0),
    priorStartDate: date(start - shift), priorEndDate: date(end - shift + 1, 0),
  };
}
