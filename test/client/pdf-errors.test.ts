import { expect, it } from 'vitest';
import { pdfReadError } from '../../src/client/pdf-errors';
it('explains password protected statements without exposing technical details', () => {
  expect(pdfReadError({name:'PasswordException'})).toContain('Passwort');
});
it('distinguishes corrupt PDFs from unavailable reader files', () => {
  expect(pdfReadError({name:'InvalidPDFException'})).toContain('beschädigt');
  expect(pdfReadError(new Error('Failed to fetch dynamically imported module: https://private/path'))).toContain('neu');
  expect(pdfReadError(new Error('secret filename'))).not.toContain('secret');
});
