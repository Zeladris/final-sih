import { z } from 'zod';
import { uuidSchema } from './common.js';

export const reserveColdStorageSchema = z
  .object({
    facilityId: uuidSchema,
  })
  .strict();
