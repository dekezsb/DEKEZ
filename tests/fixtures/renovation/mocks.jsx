import React from 'react';
export async function saveDraft(previous, form) { window.savedDraft=JSON.parse(form.get('payload')); return {}; }
export async function issueDocument() { return {}; }
export async function saveClient() { return {}; }
export async function saveCatalogueItem() { return {}; }
export async function submitRenovationPayment() { return {}; }
export async function verifyRenovationPayment() { return {}; }
export async function matchRenovationPayment() { return {}; }
export default function Image({priority, ...props}) { return <img {...props}/>; }
