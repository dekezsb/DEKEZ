"use client";

import { Trash2, X } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { deletePortalUser } from "../../actions";

type DeleteUserDialogProps = {
  fullName: string;
  profileId: string;
};

export function DeleteUserDialog({
  fullName,
  profileId,
}: DeleteUserDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button
        className="border-red-300 bg-red-600 text-white hover:bg-red-700 hover:text-white"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
        variant="outline"
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
        Delete user
      </Button>

      <dialog
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-md border border-[#d7dde5] bg-white p-0 text-gray-950 shadow-2xl backdrop:bg-black/45"
        ref={dialogRef}
      >
        <form action={deletePortalUser} className="p-5 sm:p-6">
          <input name="profileId" type="hidden" value={profileId} />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">
                Permanently delete this user?
              </h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                This permanently removes {fullName}&apos;s login and profile.
                DEKEZ will refuse the deletion if the user has any linked
                property, tenancy, payment, agreement, claim, document, or
                audit record.
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

          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-5 text-amber-900">
            Use <strong>Remove access</strong> when the person has left but
            their historical records must remain.
          </div>

          <label className="mt-5 block">
            <span className="text-sm font-medium text-gray-800">
              Reason for deletion
            </span>
            <textarea
              className="mt-2 min-h-24 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
              name="reason"
              placeholder="Example: Duplicate unused registration"
              required
            />
          </label>

          <label className="mt-4 block">
            <span className="text-sm font-medium text-gray-800">
              Type DELETE to confirm
            </span>
            <input
              autoComplete="off"
              className="mt-2 h-11 w-full rounded-md border border-[#d7dde5] px-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
              name="confirmation"
              pattern="DELETE"
              placeholder="DELETE"
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
              Delete permanently
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
