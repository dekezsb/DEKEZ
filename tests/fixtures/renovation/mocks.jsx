import React from 'react';
export async function saveDraft(previous, form) { window.savedDraft=JSON.parse(form.get('payload')); return {}; }
export async function issueDocument() { return {}; }
export async function saveClient() { return {}; }
export async function saveCatalogueItem() { return {}; }
export async function closeRenovationDocument() { return {}; }
export async function submitRenovationPayment() { return {}; }
export async function verifyRenovationPayment(previous,form) { window.testVerification=Object.fromEntries(form); return {}; }
export async function matchRenovationPayment(previous,form) { window.testMatch=Object.fromEntries(form); return {}; }
export async function saveRenovationReference(previous,form) { window.testReference=Object.fromEntries(form); return {}; }
export async function bulkReconcileRenovation(previous,form) { window.testBulk=Object.fromEntries(form); return {}; }
export default function Image({priority, ...props}) { return <img {...props}/>; }
