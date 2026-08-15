import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createAccountingAccount,
  updateAccountingAccountWording,
} from "@/app/reports/actions";

export type AccountingAccountRow = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  report_group: string;
  normal_balance: string;
  description: string | null;
  system_key: string | null;
  is_system: boolean;
  is_active: boolean;
};

const classifications = [
  ["asset:current_asset", "Current asset (cash, bank, receivable)"],
  ["asset:non_current_asset", "Non-current asset (equipment, renovation)"],
  ["liability:current_liability", "Current liability (payable within 12 months)"],
  ["liability:non_current_liability", "Non-current liability (long-term loan)"],
  ["equity:equity", "Equity / owner funds"],
  ["income:revenue", "Revenue / rental income"],
  ["income:other_income", "Other income"],
  ["expense:cost_of_sales", "Cost of sales / direct property cost"],
  ["expense:operating_expense", "Operating expense"],
  ["expense:other_expense", "Other expense"],
] as const;

const fieldClass = "h-10 w-full rounded-md border border-[#d7dde5] bg-white px-3 text-sm";

export function ChartOfAccountsManager({ accounts }: { accounts: AccountingAccountRow[] }) {
  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Chart of Accounts</CardTitle>
          <CardDescription className="mt-1 max-w-3xl">
            Add your own accounts or edit the wording shown in reports. Codes and classifications stay fixed after creation so earlier journals remain accurate.
          </CardDescription>
        </div>
        <details className="group shrink-0 rounded-md border border-[#c18d28] bg-[#fff9ed] p-2 open:w-full sm:open:w-[680px]">
          <summary className="cursor-pointer list-none rounded px-2 py-1 text-sm font-semibold text-[#815b13]">
            + Add new account
          </summary>
          <form action={createAccountingAccount} className="mt-3 grid gap-3 border-t border-[#ead7af] px-2 pt-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-gray-700">
              Account code
              <input className={`${fieldClass} mt-1`} inputMode="numeric" maxLength={6} minLength={4} name="code" pattern="[0-9]{4,6}" placeholder="Example: 5010" required />
            </label>
            <label className="text-xs font-medium text-gray-700">
              Account name
              <input className={`${fieldClass} mt-1`} maxLength={100} name="name" placeholder="Example: Cleaning supplies" required />
            </label>
            <label className="text-xs font-medium text-gray-700 sm:col-span-2">
              Accounting category
              <select className={`${fieldClass} mt-1`} defaultValue="" name="classification" required>
                <option disabled value="">Choose where this account appears</option>
                {classifications.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-gray-700 sm:col-span-2">
              Description / wording note (optional)
              <textarea className="mt-1 min-h-20 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm" maxLength={500} name="description" placeholder="Explain what should be posted to this account." />
            </label>
            <div className="sm:col-span-2 sm:flex sm:justify-end">
              <Button className="w-full sm:w-auto" type="submit">Add account</Button>
            </div>
          </form>
        </details>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          <strong>Safe editing:</strong> “Edit wording” changes only the displayed account name and description. It does not move old transactions or change debit/credit treatment.
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Account wording</TableHead>
              <TableHead>Type / report group</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.id}>
                <TableCell className="font-mono font-semibold">{account.code}</TableCell>
                <TableCell className="min-w-64">
                  <p className="font-medium text-gray-950">{account.name}</p>
                  <p className="mt-1 text-xs text-gray-500">{account.description || "No description added."}</p>
                </TableCell>
                <TableCell className="min-w-48 capitalize">
                  <p>{account.account_type}</p>
                  <p className="mt-1 text-xs text-gray-500">{account.report_group.replaceAll("_", " ")}</p>
                </TableCell>
                <TableCell className="capitalize">{account.normal_balance}</TableCell>
                <TableCell>{account.is_system ? <Badge>DEKEZ mapped</Badge> : <Badge className="bg-gray-100 text-gray-700">Manual</Badge>}</TableCell>
                <TableCell className="min-w-72 text-right align-top">
                  <details className="group inline-block w-full rounded-md border border-[#d7dde5] bg-white p-2 text-left">
                    <summary className="cursor-pointer list-none px-2 py-1 text-center text-sm font-medium text-[#815b13]">Edit wording</summary>
                    <form action={updateAccountingAccountWording} className="mt-2 space-y-2 border-t border-[#d7dde5] px-2 pt-3">
                      <input name="accountId" type="hidden" value={account.id} />
                      <label className="block text-xs font-medium text-gray-700">
                        Account name
                        <input className={`${fieldClass} mt-1`} defaultValue={account.name} maxLength={100} name="name" required />
                      </label>
                      <label className="block text-xs font-medium text-gray-700">
                        Description (optional)
                        <textarea className="mt-1 min-h-20 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm" defaultValue={account.description ?? ""} maxLength={500} name="description" />
                      </label>
                      <Button className="w-full" size="sm" type="submit">Save wording</Button>
                    </form>
                  </details>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!accounts.length ? <p className="py-4 text-sm text-gray-500">No accounts have been created yet. Use “Add new account” above.</p> : null}
      </CardContent>
    </Card>
  );
}
