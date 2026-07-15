export function statusBadgeClass(status: string | null | undefined) {
  switch (String(status ?? "").toLowerCase()) {
    case "vacant":
      return "bg-red-50 text-red-700";
    case "occupied":
      return "bg-[#e7f2f0] text-[#126b5f]";
    case "maintenance":
      return "bg-amber-50 text-amber-700";
    case "reserved":
      return "bg-blue-50 text-blue-700";
    case "active":
    case "approved":
    case "confirmed":
      return "bg-[#e7f2f0] text-[#126b5f]";
    case "pending":
    case "pending_owner_approval":
    case "submitted":
    case "assigned":
    case "in_progress":
      return "bg-amber-50 text-amber-700";
    case "rejected":
    case "cancelled":
    case "unassigned":
      return "bg-red-50 text-red-700";
    default:
      return "";
  }
}
