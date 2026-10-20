import type { RenovationDocument } from './model';
import { safeTranslation, translationFields, type TranslationReview } from './languages';

export type SavedTranslations = Partial<Record<'ms' | 'zh', TranslationReview>>;

// Export wording is separate from the immutable financial document. Never accept
// client-supplied numbers, descriptions, source text, or arbitrary extra fields.
export function validateTranslationReview(document: RenovationDocument, input: unknown): TranslationReview {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid translation wording.');
  const values = input as Record<string, unknown>;
  const fields = translationFields(document);
  if (Object.keys(values).some(key => !fields.some(field => field.key === key))) throw new Error('Unknown translation field. Refresh this document.');
  const result: TranslationReview = {};
  for (const field of fields) {
    const value = values[field.key] as { source?: unknown; text?: unknown } | undefined;
    const limit = field.key === 'terms' ? 15000 : field.key === 'remarks' ? 5000 : 1000;
    if (!value || value.source !== field.source || typeof value.text !== 'string' || !value.text.trim() || value.text.length > limit) {
      throw new Error(`Complete ${field.label} using the current document wording before saving.`);
    }
    if (!safeTranslation(field.source, value.text)) throw new Error(`${field.label}: keep every number, product code and technical specification unchanged.`);
    result[field.key] = { source: field.source, text: value.text.trim() };
  }
  return result;
}
