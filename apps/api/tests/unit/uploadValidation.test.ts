import { describe, expect, it } from 'vitest';
import { validateUpload } from '../../src/services/documents/documentService.js';
import { AppError } from '../../src/lib/errors.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_MAGIC = Buffer.from('%PDF-1.7\n');
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

const file = (overrides: Partial<Parameters<typeof validateUpload>[0]> = {}) => ({
  originalname: 'patta.png',
  mimetype: 'image/png',
  size: PNG_MAGIC.length,
  buffer: PNG_MAGIC,
  ...overrides,
});

function expectRejection(input: Parameters<typeof validateUpload>[0], fragment: string): void {
  try {
    validateUpload(input);
    throw new Error('expected validateUpload to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_ERROR');
    expect((error as AppError).message).toContain(fragment);
  }
}

describe('document upload validation (§16, §23)', () => {
  it('accepts a PNG, a JPEG and a PDF whose bytes match their type', () => {
    expect(() => validateUpload(file())).not.toThrow();
    expect(() =>
      validateUpload(
        file({
          originalname: 'passbook.jpg',
          mimetype: 'image/jpeg',
          buffer: JPEG_MAGIC,
          size: JPEG_MAGIC.length,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateUpload(
        file({
          originalname: 'chitta.pdf',
          mimetype: 'application/pdf',
          buffer: PDF_MAGIC,
          size: PDF_MAGIC.length,
        }),
      ),
    ).not.toThrow();
  });

  it('rejects a type that is not on the allow list', () => {
    expectRejection(
      file({ originalname: 'land.docx', mimetype: 'application/msword' }),
      'JPEG, PNG or PDF',
    );
  });

  it('rejects a mismatch between the declared type and the extension', () => {
    expectRejection(file({ originalname: 'patta.pdf', mimetype: 'image/png' }), '.png extension');
  });

  it('rejects a file whose contents contradict its declared type', () => {
    // The dangerous case: an executable renamed and re-typed as a PDF. The
    // extension and Content-Type both agree; only the bytes give it away.
    const executable = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
    expectRejection(
      file({
        originalname: 'land-record.pdf',
        mimetype: 'application/pdf',
        buffer: executable,
        size: executable.length,
      }),
      'do not match its type',
    );
  });

  it('rejects an empty file', () => {
    expectRejection(file({ size: 0, buffer: Buffer.alloc(0) }), 'empty');
  });

  it('rejects a file over the configured size limit', () => {
    expectRejection(file({ size: 11 * 1024 * 1024 }), 'MB or smaller');
  });

  it('rejects a PDF submitted as a farmer photograph', () => {
    // §15: a photograph is an image. A PDF here is a mistake, not a choice —
    // and it passes every generic document check, so it needs its own rule.
    try {
      validateUpload(
        file({
          originalname: 'me.pdf',
          mimetype: 'application/pdf',
          buffer: PDF_MAGIC,
          size: PDF_MAGIC.length,
        }),
        'FARMER_PHOTO',
      );
      throw new Error('expected validateUpload to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).toContain('JPEG or PNG');
    }
  });

  it('accepts a JPEG as a farmer photograph', () => {
    expect(() =>
      validateUpload(
        file({
          originalname: 'me.jpg',
          mimetype: 'image/jpeg',
          buffer: JPEG_MAGIC,
          size: JPEG_MAGIC.length,
        }),
        'FARMER_PHOTO',
      ),
    ).not.toThrow();
  });
});
