import { redirect } from "next/navigation";

export default function ClaimsPage() {
  redirect("/maintenance#claim-bills");
}
