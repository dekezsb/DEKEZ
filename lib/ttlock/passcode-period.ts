const dayMs = 24 * 60 * 60 * 1000;
const monthMs = 30 * dayMs;

function malaysiaEnd(date: string) {
  return new Date(`${date}T23:59:59+08:00`);
}

/**
 * Next passcode expiry after a staff-verified rent payment: add 30 days to
 * the current end (or from now if it already ended), then cap at the contract
 * end. Never returns an earlier expiry than the current one.
 */
export function nextPasscodeValidity(input: {
  now?: Date;
  currentUntil?: string | null;
  contractEnd?: string | null;
}) {
  const now = input.now ?? new Date();
  const currentUntil = input.currentUntil ? new Date(input.currentUntil) : null;
  const base =
    currentUntil && currentUntil.getTime() > now.getTime() ? currentUntil : now;
  const requestedUntil = new Date(base.getTime() + monthMs);
  const contractUntil = input.contractEnd ? malaysiaEnd(input.contractEnd) : null;
  let validUntil =
    contractUntil && contractUntil < requestedUntil
      ? contractUntil
      : requestedUntil;

  if (currentUntil && validUntil.getTime() < currentUntil.getTime()) {
    validUntil = currentUntil;
  }

  if (validUntil.getTime() <= now.getTime()) {
    throw new Error("The tenancy has already ended.");
  }

  const unchanged = Boolean(
    currentUntil && Math.abs(validUntil.getTime() - currentUntil.getTime()) < 60_000,
  );

  return {
    validFrom: new Date(now.getTime() - 5 * 60_000),
    validUntil,
    unchanged,
  };
}
