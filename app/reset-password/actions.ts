"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function updateRecoveredPassword(formData: FormData) {
  const password = textValue(formData, "password");
  const confirmPassword = textValue(formData, "confirmPassword");

  if (password.length < 8) {
    redirect("/reset-password?error=password_short");
  }
  if (password !== confirmPassword) {
    redirect("/reset-password?error=password_mismatch");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/reset-password?error=link_invalid");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect("/reset-password?error=update_failed");
  }

  redirect("/reset-password?updated=1");
}
