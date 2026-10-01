import type { NavigationItem } from "@/lib/auth/roles";

// Run after permission filtering: one entry, without granting either module.
export function consolidateBillNavigation(items: NavigationItem[]): NavigationItem[] {
  const expense = items.find((item) => item.href === "/expenses");
  const utility = items.find((item) => item.href === "/utility-bills");
  const destination = expense ?? utility;
  if (!destination) return items;
  let included = false;
  return items.flatMap((item) => {
    if (item.href !== "/expenses" && item.href !== "/utility-bills") return [item];
    if (included) return [];
    included = true;
    return [{ ...destination, label: "Expense Bills" }];
  });
}

export function navigationItemIsActive(item: NavigationItem, pathname: string): boolean {
  if (item.label === "Expense Bills") {
    return ["/expenses", "/utility-bills"].some((path) =>
      pathname === path || pathname.startsWith(`${path}/`),
    );
  }
  return pathname === item.href ||
    (item.href !== "/dashboard" && pathname.startsWith(item.href));
}
