export const dashboardStats = [
  { label: "Total Properties", value: "18", detail: "Across 4 locations" },
  { label: "Total Rooms", value: "326", detail: "Managed rooms" },
  { label: "Occupied Rooms", value: "281", detail: "86% occupancy" },
  { label: "Vacant Rooms", value: "31", detail: "Ready for tenants" },
  { label: "Monthly Income", value: "RM 184,250.00", detail: "Collected this month" },
  { label: "Outstanding Rent", value: "RM 21,430.00", detail: "Pending collection" },
  { label: "Expiring Contracts", value: "14", detail: "Next 30 days" },
  { label: "Maintenance Requests", value: "9", detail: "Open repair items" },
];

export const properties = [
  { name: "Taman Bukit Residence", location: "Kuala Lumpur", rooms: 88, occupancy: "91%" },
  { name: "Seri Mutiara House", location: "Petaling Jaya", rooms: 42, occupancy: "83%" },
  { name: "Cyber Heights", location: "Cyberjaya", rooms: 116, occupancy: "87%" },
  { name: "Ampang City Rooms", location: "Ampang", rooms: 80, occupancy: "84%" },
];

export const rooms = [
  { room: "A-01", property: "Taman Bukit Residence", tenant: "Aiman Hakim", status: "Occupied" },
  { room: "A-02", property: "Taman Bukit Residence", tenant: "-", status: "Vacant" },
  { room: "B-12", property: "Cyber Heights", tenant: "Nur Alya", status: "Reserved" },
  { room: "C-09", property: "Ampang City Rooms", tenant: "-", status: "Maintenance" },
];

export const tenants = [
  { name: "Aiman Hakim", room: "A-01", balance: "RM 0.00", status: "Active" },
  { name: "Nur Alya", room: "B-12", balance: "RM 450.00", status: "Reserved" },
  { name: "Chen Wei", room: "D-04", balance: "RM 1,200.00", status: "Overdue" },
  { name: "Priya Nair", room: "C-02", balance: "RM 0.00", status: "Active" },
];

export const payments = [
  { tenant: "Aiman Hakim", category: "Monthly rent", amount: "RM 850.00", method: "DuitNow" },
  { tenant: "Priya Nair", category: "Deposit", amount: "RM 1,600.00", method: "Bank transfer" },
  { tenant: "Nur Alya", category: "Utility collection", amount: "RM 120.00", method: "Cash" },
];

export const maintenance = [
  { title: "Aircond leaking", room: "C-09", priority: "High", status: "In Progress" },
  { title: "Door lock loose", room: "A-07", priority: "Medium", status: "Open" },
  { title: "Water heater check", room: "B-02", priority: "Low", status: "Assigned" },
];

export const reports = [
  "Monthly income",
  "Monthly expenses",
  "Net cash flow",
  "Income by property",
  "Expenses by property",
  "Tenant outstanding balances",
  "Rent collection report",
  "Repair cost by room",
];
