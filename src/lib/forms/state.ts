/**
 * Shared form-action result shape.
 *
 * Kept out of the `'use server'` modules because those files may only export
 * async functions — a constant there fails the build.
 */
export interface FormState {
  ok: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
}

export const emptyFormState: FormState = { ok: false };

export function fieldErrorsOf(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}
