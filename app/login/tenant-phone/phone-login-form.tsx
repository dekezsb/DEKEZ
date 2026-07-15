"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function PhoneLoginForm() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [message, setMessage] = useState("");

  async function sendOtp() {
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({ phone });

    if (error) {
      setMessage(error.message);
      return;
    }

    setStep("otp");
    setMessage("OTP sent. Enter the code from SMS/WhatsApp provider.");
  }

  async function verifyOtp() {
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token: otp,
      type: "sms",
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    window.location.href = "/dashboard";
  }

  return (
    <div className="space-y-4">
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Phone OTP requires Supabase phone auth and an SMS provider to be configured in Supabase.
      </p>
      <label className="block">
        <span className="text-sm font-medium text-gray-700">WhatsApp / mobile number</span>
        <input
          className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+60123456789"
          value={phone}
        />
      </label>
      {step === "otp" ? (
        <label className="block">
          <span className="text-sm font-medium text-gray-700">OTP code</span>
          <input
            className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
            onChange={(event) => setOtp(event.target.value)}
            value={otp}
          />
        </label>
      ) : null}
      {message ? <p className="text-sm text-red-600">{message}</p> : null}
      {step === "phone" ? (
        <Button onClick={sendOtp} type="button">Send OTP</Button>
      ) : (
        <Button onClick={verifyOtp} type="button">Verify and login</Button>
      )}
    </div>
  );
}
