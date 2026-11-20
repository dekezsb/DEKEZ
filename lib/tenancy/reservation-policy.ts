export function supportsReservations(propertyCode: string | null | undefined) {
  const code = (propertyCode ?? '').trim().toUpperCase();
  // Putatan (PTT) stays Office Sewa and does not use the room reservation deposit flow.
  return Boolean(code) && code !== 'PTT';
}
