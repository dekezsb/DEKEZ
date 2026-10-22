import type { SupabaseClient } from "@supabase/supabase-js";
import { allReportRows } from "./report-data";
type Settlement = { amount: number; date: string; source: string };
export function claimBalanceAt(amount: number, settlements: Settlement[], date: string) {
  const reimbursed = settlements.filter(item => item.date <= date).reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
  return Math.max(0, Math.round(amount * 100) - reimbursed) / 100;
}
const one = <T>(value: T | T[] | null): T | null => Array.isArray(value) ? value[0] ?? null : value;
// Existing operational AP only. Reimbursements never become a second expense.
export async function getClaimPayables(db: SupabaseClient, companyId: string, asOf: string) {
  const {data: expenses,error: expenseError} = await allReportRows(db.from("expenses")
    .select("id,company_id,expense_date,amount,description,supplier,property_id,paid_by")
    .eq("company_id",companyId).eq("funding_source","staff_personal").in("status",["verified","reimbursed"]).lte("expense_date",asOf));
  if(expenseError) throw new Error("Claim expense data unavailable");
  if(!expenses.length) return [];
  const {data: liabilities,error} = await allReportRows(db.from("staff_reimbursement_liabilities")
    .select("id,expense_id,staff_id,amount,status,payout_id,staff_reimbursement_payouts(paid_on,payment_source)").in("expense_id",expenses.map(e=>e.id)));
  if(error) throw new Error("Claim liability data unavailable");
  if(!liabilities.length) return [];
  const {data: allocations,error: allocationError} = await allReportRows(db.from("staff_reimbursement_allocations")
    .select("payout_id,liability_id,amount,staff_reimbursement_payouts(paid_on,payment_source)").in("liability_id",liabilities.map(l=>l.id)).order("liability_id"),"payout_id");
  if(allocationError) throw new Error("Claim settlement data unavailable");
  const byExpense=new Map(expenses.map(e=>[e.id,e]));
  return liabilities.map(l=>{
    const expense=byExpense.get(l.expense_id)!;
    const allocationsForBill=allocations.filter(a=>a.liability_id===l.id);
    const settlements: Settlement[]=allocationsForBill.map(a=>{
      const payout=one(a.staff_reimbursement_payouts);
      if(!payout) throw new Error("Claim payout reference unavailable");
      return {amount:Number(a.amount),date:payout.paid_on,source:payout.payment_source};
    });
    if(!allocationsForBill.length && l.status==='paid') {
      const payout=one(l.staff_reimbursement_payouts);
      if(!payout) throw new Error("Legacy claim payout reference unavailable");
      settlements.push({amount:Number(l.amount),date:payout.paid_on,source:payout.payment_source});
    }
    return {id:l.id,staffId:l.staff_id,expense,originalAmount:Number(l.amount),remaining:claimBalanceAt(Number(l.amount),settlements,asOf),
      cashReimbursed:settlements.filter(s=>s.date<=asOf&&s.source==='company_cash').reduce((sum,s)=>sum+s.amount,0),settlements};
  });
}
