import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { DEFAULT_APP_TIMEZONE, DEFAULT_MAX_UPLOAD_BYTES } from '@kisansetu/shared';

// The repo keeps one .env at the workspace root so the API and the Vite app
// read the same values. apps/api/.env still wins if it exists.
loadDotenv({ path: resolve(process.cwd(), '.env') });
loadDotenv({ path: resolve(process.cwd(), '../../.env') });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(4000),
    FRONTEND_URL: z.string().url().default('http://localhost:5173'),

    SUPABASE_URL: z.string().url({
      message: 'SUPABASE_URL must be your project URL, e.g. https://xxxx.supabase.co',
    }),
    SUPABASE_ANON_KEY: z.string().min(20, {
      message: 'SUPABASE_ANON_KEY is missing. Find it under Project Settings -> API.',
    }),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, {
      message:
        'SUPABASE_SERVICE_ROLE_KEY is missing. Find it under Project Settings -> API. ' +
        'It is server-only — never copy it into a VITE_ variable.',
    }),

    APP_TIMEZONE: z.string().min(1).default(DEFAULT_APP_TIMEZONE),
    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(50 * 1024 * 1024)
      .default(DEFAULT_MAX_UPLOAD_BYTES),

    // --- AI quality service (Phase 7). Optional: without it, quality is
    // assessed manually and the queue runs on deterministic estimates (§33).
    ML_SERVICE_URL: z.string().url().optional(),
    ML_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(8_000),
    QUALITY_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),

    // --- Location search/reverse geocoding (Phase 10 §2, §41). Nominatim's
    // public instance, keyless. Configurable so a disposable/self-hosted or
    // commercial instance can replace it without a code change.
    NOMINATIM_BASE_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
    NOMINATIM_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(5_000),
    /** Nominatim's usage policy requires real identification, ideally with a
     *  contact. The default identifies the project but not an operator —
     *  set this before sending it any real traffic. */
    NOMINATIM_USER_AGENT: z.string().min(3).default('KisanSetu-Procurement/1.0'),

    // --- Bhashini ASR/TTS for voice booking (Phase 9). Optional: unset means
    // voice booking runs on the browser's own speech engine instead — see
    // apps/web/.../providers/browserSpeechProvider.ts. USER_ID and API_KEY
    // come from a Bhashini/MeitY account; PIPELINE_ID defaults to the public
    // ASR+Translation+TTS pipeline used across Bhashini's own sample apps.
    BHASHINI_USER_ID: z.string().min(1).optional(),
    BHASHINI_API_KEY: z.string().min(1).optional(),
    BHASHINI_PIPELINE_ID: z.string().min(1).default('64392f96daac500b55c543cd'),
    BHASHINI_CONFIG_URL: z
      .string()
      .url()
      .default('https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline'),
    BHASHINI_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(15_000),

    // --- Twilio IVR: phone-call booking (Phase 9). Optional: unset means the
    // /api/ivr/voice webhook still runs (useful for local testing with curl)
    // but never verifies Twilio's request signature — see
    // services/ivr/twilioSignature.ts. TWILIO_PHONE_NUMBER is the number
    // farmers actually call; recorded nowhere server-side, useful only for
    // README/operator reference.
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    TWILIO_PHONE_NUMBER: z.string().min(1).optional(),

    // --- Weather context for pre-arrival assessment (§7). Optional in every
    // sense: 'none' disables it, and a provider failure never blocks booking.
    // open-meteo needs no key and no account.
    WEATHER_PROVIDER: z.enum(['open-meteo', 'none']).default('open-meteo'),
    WEATHER_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(4_000),

    // --- Fairness-aware queue policy (§47). Starting values, not claimed optima.
    QUEUE_TARGET_WAIT_MINUTES: z.coerce.number().positive().default(60),
    QUEUE_AGING_THRESHOLD_MINUTES: z.coerce.number().positive().default(60),
    QUEUE_SLOT_LATENESS_THRESHOLD_MINUTES: z.coerce.number().positive().default(30),
    QUEUE_MAX_WAIT_OVERRIDE_MINUTES: z.coerce.number().positive().default(90),
    QUEUE_URGENCY_WINDOW_MINUTES: z.coerce.number().positive().default(30),
    QUEUE_FIT_SCALE_MINUTES: z.coerce.number().positive().default(15),
    QUEUE_ADVANTAGE_LIMIT: z.coerce.number().int().positive().default(3),
    QUEUE_ADVANTAGE_DECAY_MINUTES: z.coerce.number().positive().default(30),

    // Top-level: FinalPriority = fairness·F + efficiency·E + quality·QF + urgency·U − penalty·R.
    // fa-dqo-v2 gives AI quality its own small, BOUNDED top-level weight rather
    // than burying it inside efficiency alone — still far below fairness.
    QUEUE_FAIRNESS_WEIGHT: z.coerce.number().min(0).max(1).default(0.6),
    QUEUE_EFFICIENCY_WEIGHT: z.coerce.number().min(0).max(1).default(0.2),
    QUEUE_QUALITY_WEIGHT: z.coerce.number().min(0).max(1).default(0.1),
    QUEUE_URGENCY_WEIGHT: z.coerce.number().min(0).max(1).default(0.1),
    QUEUE_PENALTY_WEIGHT: z.coerce.number().min(0).max(1).default(0.1),

    // Fairness = wait·W + lateness·L + aging·A + urgency·U. Waiting is the
    // dominant term inside fairness, which is itself the dominant top-level term.
    QUEUE_FAIRNESS_WAIT_WEIGHT: z.coerce.number().min(0).max(1).default(0.45),
    QUEUE_FAIRNESS_LATENESS_WEIGHT: z.coerce.number().min(0).max(1).default(0.3),
    QUEUE_FAIRNESS_AGING_WEIGHT: z.coerce.number().min(0).max(1).default(0.2),
    QUEUE_FAIRNESS_URGENCY_WEIGHT: z.coerce.number().min(0).max(1).default(0.05),

    // Efficiency = processingFit·P + workstationFit·S + readiness·Q. Readiness
    // is workflow-effort (confidence/risk/manual-inspection), distinct from the
    // top-level QualityFactor (the AI's actual score, bounded, blended toward
    // neutral under low confidence — see optimizer/scores.ts qualityFactorScore()).
    QUEUE_PROCESSING_FIT_WEIGHT: z.coerce.number().min(0).max(1).default(0.55),
    QUEUE_WORKSTATION_FIT_WEIGHT: z.coerce.number().min(0).max(1).default(0.3),
    QUEUE_QUALITY_READINESS_WEIGHT: z.coerce.number().min(0).max(1).default(0.15),

    /** Background recalculation as time passes (waits grow). 0 disables. */
    QUEUE_RECALC_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(60),

    // --- Payments (Phase 8). Only the demo provider exists; it moves no money.
    // A real provider is added as an adapter, with its secrets set here and
    // never in a VITE_ variable (§14, §38).
    PAYMENT_PROVIDER: z.enum(['demo']).default('demo'),
    /** Demo: how long a transfer stays PROCESSING before its outcome. */
    PAYMENT_DEMO_SETTLE_SECONDS: z.coerce.number().int().min(0).max(3600).default(5),
    /** How often in-flight payments are checked with the provider. 0 disables. */
    PAYMENT_STATUS_POLL_SECONDS: z.coerce.number().int().min(0).default(10),
    PAYMENT_WEBHOOK_SECRET: z.string().min(16).optional(),

    // --- Admin analytics (Phase 12). Explicit, configurable policy — not
    // hidden frontend constants, and not claimed to be optimal.
    ADMIN_HIGH_LOAD_QUEUE: z.coerce.number().int().positive().default(10),
    ADMIN_DELAYED_WAIT_MINUTES: z.coerce.number().positive().default(60),
    ADMIN_ALERT_AVG_WAIT_MINUTES: z.coerce.number().positive().default(60),
    ADMIN_ALERT_SLOT_DELAY_MINUTES: z.coerce.number().positive().default(30),
    ADMIN_ALERT_MANUAL_REVIEW_RATE: z.coerce.number().min(0).max(1).default(0.5),
    ADMIN_ALERT_LOW_CONFIDENCE_RATE: z.coerce.number().min(0).max(1).default(0.5),
    ADMIN_ALERT_CANCELLATION_RATE: z.coerce.number().min(0).max(1).default(0.3),
    /** Rates are not alerted on until there are at least this many cases. */
    ADMIN_ALERT_MIN_SAMPLE: z.coerce.number().int().positive().default(5),
    /** Centres with fewer completed procurements are not ranked. */
    ADMIN_RANKING_MIN_SAMPLE: z.coerce.number().int().positive().default(3),
    ADMIN_MAX_RANGE_DAYS: z.coerce.number().int().positive().max(366).default(92),
  })
  .superRefine((env, ctx) => {
    // A service-role key pasted into a public variable is the single worst
    // mistake available here, so fail loudly rather than warn.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('VITE_') && process.env[key] === env.SUPABASE_SERVICE_ROLE_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SUPABASE_SERVICE_ROLE_KEY'],
          message: `${key} contains the service-role key. That value would be shipped to every browser. Remove it.`,
        });
      }
    }

    if (Boolean(env.TWILIO_ACCOUNT_SID) !== Boolean(env.TWILIO_AUTH_TOKEN)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_AUTH_TOKEN'],
        message: 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set together, or not at all.',
      });
    }

    if (Boolean(env.BHASHINI_USER_ID) !== Boolean(env.BHASHINI_API_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BHASHINI_API_KEY'],
        message: 'BHASHINI_USER_ID and BHASHINI_API_KEY must be set together, or not at all.',
      });
    }

    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIMEZONE });
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_TIMEZONE'],
        message: `"${env.APP_TIMEZONE}" is not an IANA timezone (expected e.g. Asia/Kolkata).`,
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    // Deliberately verbose: a missing key here is the most common reason a
    // fresh checkout will not boot.
    throw new Error(
      ['Invalid environment configuration:', ...lines, '', 'See .env.example for the full list.'].join(
        '\n',
      ),
    );
  }

  return parsed.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
