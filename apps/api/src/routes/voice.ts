import { Router } from 'express';
import multer from 'multer';
import { MAX_VOICE_AUDIO_BYTES, VOICE_AUDIO_UPLOAD_FIELD } from '../config/constants.js';
import { asyncHandler, requireSession } from '../middleware/auth.js';
import { validateBody } from '../middleware/validation.js';
import { voiceLimiter } from '../middleware/rateLimit.js';
import { voiceSynthesizeSchema, voiceTranscribeFieldsSchema } from '../schemas/voice.js';
import { getVoiceConfig, postSynthesize, postTranscribe } from '../controllers/voiceController.js';

/**
 * Voice booking's Bhashini ASR/TTS proxy (Phase 9). `requireSession` rather
 * than a role check: like `locationRouter`, this is used mid-registration and
 * mid-booking, carries no farmer PII of its own, and a recording is never
 * stored — see bhashiniProvider.ts.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VOICE_AUDIO_BYTES, files: 1, fields: 4 },
  fileFilter: (_req, file, callback) => {
    callback(null, file.mimetype.startsWith('audio/'));
  },
});

export const voiceRouter = Router();

voiceRouter.get('/config', requireSession, asyncHandler(getVoiceConfig));

voiceRouter.post(
  '/transcribe',
  requireSession,
  voiceLimiter,
  upload.single(VOICE_AUDIO_UPLOAD_FIELD),
  validateBody(voiceTranscribeFieldsSchema),
  asyncHandler(postTranscribe),
);

voiceRouter.post(
  '/synthesize',
  requireSession,
  voiceLimiter,
  validateBody(voiceSynthesizeSchema),
  asyncHandler(postSynthesize),
);
