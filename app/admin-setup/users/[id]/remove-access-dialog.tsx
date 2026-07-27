"use client";

import { Trash2, X } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { removePortalUserAccess } from "../../actions";

type RemoveAccessDialogProps = {
  fullName: string;
  profileId: string;
};

export function RemoveAccessDialog({
  fullName,
  profileId,
}: RemoveAccessDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button
        className="border-red-200 text-red-700 hover:bg-red-50"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
        variant="outline"
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
        Remove access
      </Button>

      <dialog
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-md border border-[#d7dde5] bg-white p-0 text-gray-950 shadow-2xl backdrop:bg-black/45"
        ref={dialogRef}
      >
        <form action={removePortalUserAccess} className="p-5 sm:p-6">
          <input name="profileId" type="hidden" value={profileId} />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Remove user access?</h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                {fullName} will no longer be able to sign in. Existing
                tenancies, payments, documents, agreements, and audit history
                will remain stored.
              </p>
            </div>
            <button
              aria-label="Close"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-950"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          <label className="mt-5 block">
            <span className="text-sm font-medium text-gray-800">
              Reason for removal
            </span>
            <textarea
              className="mt-2 min-h-24 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
              name="reason"
              placeholder="Example: Staff left the company"
              required
            />
          </label>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              onClick={() => dialogRef.current?.close()}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
              type="submit"
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              Confirm removal
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
