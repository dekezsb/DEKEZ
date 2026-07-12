import { AlertTriangle, CalendarClock, DoorOpen, WalletCards } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dashboardStats, maintenance, payments, tenants } from "@/lib/dummy-data";

export default function DashboardPage() {
  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Overview</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          Admin Dashboard
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          High-level room rental operations using dummy data for Phase 1.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardStats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-2xl">{stat.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">{stat.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <WalletCards className="h-5 w-5 text-[#126b5f]" />
              Recent Payments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {payments.map((payment) => (
                <div className="flex justify-between gap-3" key={payment.tenant}>
                  <div>
                    <p className="text-sm font-medium">{payment.tenant}</p>
                    <p className="text-xs text-gray-500">{payment.category}</p>
                  </div>
                  <p className="text-sm font-semibold">{payment.amount}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[#126b5f]" />
              Overdue Tenants
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {tenants
                .filter((tenant) => tenant.status === "Overdue")
                .map((tenant) => (
                  <div className="flex justify-between gap-3" key={tenant.name}>
                    <div>
                      <p className="text-sm font-medium">{tenant.name}</p>
                      <p className="text-xs text-gray-500">Room {tenant.room}</p>
                    </div>
                    <p className="text-sm font-semibold">{tenant.balance}</p>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DoorOpen className="h-5 w-5 text-[#126b5f]" />
              Rooms Under Repair
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {maintenance.map((item) => (
                <div className="flex justify-between gap-3" key={item.title}>
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-gray-500">Room {item.room}</p>
                  </div>
                  <Badge>{item.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-[#126b5f]" />
            Upcoming Rent Due
          </CardTitle>
          <CardDescription>Dummy tenant schedule for Phase 1 UI.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.name}>
                  <TableCell className="font-medium text-gray-950">{tenant.name}</TableCell>
                  <TableCell>{tenant.room}</TableCell>
                  <TableCell>{tenant.balance}</TableCell>
                  <TableCell>
                    <Badge>{tenant.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}
