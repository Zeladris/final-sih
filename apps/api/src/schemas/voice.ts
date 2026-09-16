import { z } from 'zod';
import { languageSchema } from './registration.js';

/** Multer has already parsed the multipart body into strings by the time
 *  this runs (Phase 9 voice booking — see routes/voice.ts). */
export const voiceTranscribeFieldsSchema = z.object({ language: languageSchema }).strict();

export const voiceSynthesizeSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    language: languageSchema,
  })
  .strict();
