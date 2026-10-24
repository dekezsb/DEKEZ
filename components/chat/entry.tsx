import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChatWorkspace } from "./workspace";

/** Existing portal wrappers authenticate roles. The API/RLS checks chat grants. */
export async function ChatEntry() {
  if (process.env.DEKEZ_CHAT_ENABLED !== "true") return <section><h1>DEKEZ Messages</h1><p>In-app chat is awaiting secure setup and testing. No messages can be sent yet.</p></section>;
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/");
  return <ChatWorkspace key={data.user.id} userId={data.user.id} realtimeEnabled={process.env.DEKEZ_CHAT_REALTIME_ENABLED === "true"} filesEnabled={process.env.DEKEZ_CHAT_FILES_ENABLED === "true"}/>;
}
