import { createClient } from "@/lib/supabase/server";

function sumAmount<T extends Record<string, unknown>>(items: T[], key: keyof T) {
  return items.reduce((total, item) => total + Number(item[key] ?? 0), 0);
}

function currentMonthStart() {
  return `${new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
  }).format(new Date())}-01`;
}

export async function getOwnerPortalSummary() {
  const supabase = await createClient();
  const [propertiesResult, roomsResult, rentBillsResult, utilityBillsResult, claimsResult, ticketsResult] =
    await Promise.all([
      supabase.from("properties").select("id, name"),
      supabase.from("rooms").select("id, status, monthly_rent"),
      supabase.from("rent_bills").select("amount, paid_amount, status"),
      supabase
        .from("utility_bills")
        .select("utility_type, amount, paid_amount, status")
        .eq("billing_scope", "property")
        .eq("bill_month", currentMonthStart())
        .neq("status", "cancelled"),
      supabase.from("claims").select("status, total_amount, labour_cost, material_cost"),
      supabase.from("maintenance_tickets").select("status"),
    ]);

  const properties = propertiesResult.data ?? [];
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
