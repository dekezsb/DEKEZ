// References are text: keep leading zeroes and preserve older / rejection forms.
export function verificationBankReference(form: FormData, decision: string, previous: string | null) {
  if (decision !== 'verified' || !form.has('bankReference')) return previous;
  const value = form.get('bankReference');
  if (typeof value !== 'string') throw new Error('bank_reference');
  if (value.length > 120 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('bank_reference');
  return value.trim() || previous;
}
