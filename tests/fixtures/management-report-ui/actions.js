// Deliberately browser-local fixture. This module never imports server services or credentials.
export async function oneTimeTestAction(_previous, form) {
  const intent = form.get('intent');
  window.fixtureActions = [...(window.fixtureActions || []), intent];
  if (intent === 'request') return {
    phase: 'ready', message: 'Nothing has been sent. Review and explicitly confirm.',
    authorization: {
      authorizationId: '00000000-0000-4000-8000-000000000010',
      expiresAt: new Date(Date.now() + (new URLSearchParams(location.search).has('expire') ? 1500 : 300000)).toISOString(),
      reportDate: '2026-10-25', recipient: '60198894911',
      body: '[TEST]\nDEKEZ Daily Management Report\nSynthetic local preview only\nCollections today: RM0.00\nMonth-to-date collections: RM34,220.00\nLong record unavailable: ' + 'x'.repeat(90),
    },
  };
  if (intent === 'cancel') return { phase: 'finished', message: 'Authorization cancelled. No message sent.' };
  if (form.get('confirm') !== 'send-once') throw Error('Explicit confirmation missing');
  await new Promise(resolve => setTimeout(resolve, 300));
  return { phase: 'finished', message: 'Delivery is uncertain. Do not resend. This local fixture sent no message.' };
}
