// Isolated browser fixture: no credentials, network writes or real payments.
window.fixtureCalls = [];
export function useRouter() { return {refresh(){window.fixtureCalls.push({action:'refresh'});}}; }
export async function savePaymentBankReference(id,reference,previous) {
  window.fixtureCalls.push({action:'save',id,reference,previous});
  if(reference==='99999999')return {error:'This bank code is already linked to another payment.'};
  if(!reference)return {error:'Please enter bank code.'};
  return {reference,error:null};
}
export async function reviewPaymentSubmissionInline(form) {
  window.fixtureCalls.push({action:'verify',data:Object.fromEntries(form)});
  return {error:null,verified:true};
}
export async function reviewPaymentSubmission() { throw Error('Legacy action not expected'); }
export async function reversePaymentSubmission() { throw Error('Reversal not expected'); }
