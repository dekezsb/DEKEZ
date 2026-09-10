export function supportsReservations(propertyCode: string | null | undefined) {
  const code = (propertyCode ?? '').trim().toUpperCase();
  return Boolean(code) && !['BDS', 'PTT'].includes(code);
}
