import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "./organization";

function sumAmount<T extends Record<string, unknown>>(items: T[], key: keyof T) {
  return items.reduce((total, item) => total + Number(item[key] ?? 0), 0);
}

export async function getOwnerPortalSummary() {
  const supabase = await createClient();
  const [propertiesResult, unitsResult, roomsResult, rentBillsResult, utilityBillsResult, claimsResult, ticketsResult] =
    await Promise.all([
      supabase.from("properties").select("id, name"),
      supabase.from("units").select("id, name"),
      supabase.from("rooms").select("id, status, monthly_rent"),
      supabase.from("rent_bills").select("amount, paid_amount, status"),
      supabase.from("utility_bills").select("utility_type, amount, paid_amount, status"),
      supabase.from("claims").select("status, total_amount, labour_cost, material_cost"),
      supabase.from("maintenance_tickets").select("status"),
    ]);

  const properties = propertiesResult.data ?? [];
  const units = unitsResult.data ?? [];
  const rooms = roomsResult.data ?? [];
  const rentBills = rentBillsResult.data ?? [];
  const utilityBills = utilityBillsResult.data ?? [];
  const claims = claimsResult.data ?? [];
  const tickets = ticketsResult.data ?? [];
  const waterBills = utilityBills.filter((bill) => bill.utility_type === "water");
  const electricityBills = utilityBills.filter((bill) => bill.utility_type === "electricity");
  const approvedClaims = claims.filter((claim) => claim.status === "approved");

  return {
    totalProperties: properties.length,
    totalUnits: units.length,
    totalRooms: rooms.length,
    occupiedRooms: rooms.filter((room) => room.status === "occupied").length,
    vacantRooms: rooms.filter((room) => room.status === "vacant").length,
    monthlyRentalExpected: sumAmount(rooms, "monthly_rent"),
    monthlyRentalCollected: sumAmount(rentBills, "paid_amount"),
    outstandingRental: sumAmount(rentBills, "amount") - sumAmount(rentBills, "paid_amount"),
    waterBills: sumAmount(waterBills, "amount"),
    electricityBills: sumAmount(electricityBills, "amount"),
    maintenanceExpenses: approvedClaims.reduce(
      (total, claim) =>
        total +
        Number(claim.total_amount ?? Number(claim.labour_cost ?? 0) + Number(claim.material_cost ?? 0)),
      0,
    ),
    pendingClaims: claims.filter((claim) => claim.status === "pending_owner_approval").length,
    approvedClaims: approvedClaims.length,
    openMaintenanceTickets: tickets.filter(
      (ticket) => !["completed", "rejected", "closed"].includes(String(ticket.status)),
    ).length,
  };
}

export async function getTenantPortalSummary() {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const supabase = await createClient();
  const [tenanciesResult, rentBillsResult, utilityBillsResult, paymentsResult, walletResult, ticketsResult] =
    await Promise.all([
      supabase
        .from("tenancies")
        .select("id, monthly_rental, contract_start, contract_end, due_day, status, property_id, unit_id, room_id")
        .eq("tenant_id", user.id)
        .order("created_at", { ascending: false }),
      supabase.from("rent_bills").select("amount, paid_amount, status").eq("tenant_id", user.id),
      supabase.from("utility_bills").select("utility_type, amount, paid_amount, status").eq("tenant_id", user.id),
      supabase.from("payments").select("amount, status").eq("tenant_id", user.id),
      supabase.from("wallet_transactions").select("amount, transaction_type").eq("tenant_id", user.id),
      supabase.from("maintenance_tickets").select("status").eq("tenant_id", user.id),
    ]);

  const tenancy = tenanciesResult.data?.[0] ?? null;
  const rentBills = rentBillsResult.data ?? [];
  const utilityBills = utilityBillsResult.data ?? [];
  const payments = paymentsResult.data ?? [];
  const walletTransactions = walletResult.data ?? [];
  const tickets = ticketsResult.data ?? [];

  return {
    hasTenancy: Boolean(tenancy),
    monthlyRental: Number(tenancy?.monthly_rental ?? 0),
    dueDay: tenancy?.due_day ?? null,
    contractStart: tenancy?.contract_start ?? null,
    contractEnd: tenancy?.contract_end ?? null,
    outstandingAmount: sumAmount(rentBills, "amount") - sumAmount(rentBills, "paid_amount"),
    paymentHistoryTotal: sumAmount(payments, "amount"),
    waterBill: sumAmount(utilityBills.filter((bill) => bill.utility_type === "water"), "amount"),
    electricityBill: sumAmount(utilityBills.filter((bill) => bill.utility_type === "electricity"), "amount"),
    balance: walletTransactions.reduce((total, item) => {
      const amount = Number(item.amount ?? 0);
      return item.transaction_type === "deduction" ? total - amount : total + amount;
    }, 0),
    maintenanceTickets: tickets.length,
    openTickets: tickets.filter((ticket) => !["completed", "closed", "rejected"].includes(String(ticket.status))).length,
  };
}

export async function getStaffPortalSummary() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("maintenance_ticket_assignments")
    .select("status, maintenance_tickets(status)")
    .order("assigned_at", { ascending: false });

  const assignments = data ?? [];
  const ticketStatus = (assignment: (typeof assignments)[number]) => {
    const ticket = assignment.maintenance_tickets as
      | { status?: string | null }
      | { status?: string | null }[]
      | null;
    return Array.isArray(ticket) ? ticket[0]?.status : ticket?.status;
  };

  return {
    newAssignedJobs: assignments.filter((assignment) => assignment.status === "assigned").length,
    inProgressJobs: assignments.filter(
      (assignment) => ticketStatus(assignment) === "in_progress",
    ).length,
    waitingForParts: assignments.filter(
      (assignment) => ticketStatus(assignment) === "waiting_for_parts",
    ).length,
    completedJobs: assignments.filter(
      (assignment) => ticketStatus(assignment) === "completed",
    ).length,
  };
}
