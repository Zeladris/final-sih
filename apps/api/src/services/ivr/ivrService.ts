import { randomUUID } from 'node:crypto';
import { cropName, isEligibleToBook, MAX_QUANTITY_KG, MIN_QUANTITY_KG } from '@kisansetu/shared';
import type { Language, StorageDurationBand, StorageType } from '@kisansetu/shared';
import { AppError } from '../../lib/errors.js';
import { logger, maskPhone } from '../../lib/logger.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import { findProfileByPhone } from '../../repositories/profilesRepository.js';
import {
  checkEligibility,
  createBooking,
  listAvailableDates,
  listCentresForCrop,
  listCrops,
  listSlotsForDate,
} from '../booking/bookingService.js';
import { endSession, getSession, saveSession } from './ivrSession.js';
import type { IvrSession } from './ivrSession.js';
import {
  ALL_STORAGE_DURATION_BANDS,
  ALL_STORAGE_TYPES,
  IVR_LOCALE,
  LANGUAGE_MENU,
  LANGUAGE_MENU_ORDER,
  menuPrompt,
  phrasesFor,
} from './ivrPrompts.js';
import { gatherDigits, gatherDigitsMultiLanguage, sayAndHangup } from './twiml.js';

/**
 * The phone-call booking flow (Phase 9 IVR) — the same booking a farmer can
 * make in the app, keypad-driven, for anyone who can dial a number: no app,
 * no data connection, no literacy requirement beyond digits (§ mirrors real
 * IVR crop/utility booking systems in India).
 *
 * Reuses `bookingService.ts` outright rather than re-implementing catalogue
 * lookups or booking creation — a call gets exactly the same eligibility
 * check, crop/centre/slot compatibility rules and capacity guarantee as the
 * app does, because it is calling the same functions with the same
 * `supabaseAdminClient` `bookingService.ts` already treats as its
 * insert-time authority. `db` here is always the service-role client: a
 * phone call has no Supabase session to scope an RLS-bound client to
 * (Twilio has no notion of a JWT), so identity comes entirely from matching
 * the caller's number to a verified farmer's — see `findProfileByPhone`.
 *
 * LANGUAGE is the very first thing every call asks, before identity is even
 * checked — see ivrPrompts.ts's LANGUAGE_MENU, spoken as five short verses,
 * each in its own voice, since the caller's language cannot be known until
 * they answer it. Every prompt after that (including a rejection for an
 * unverified or unregistered caller) is in the language they chose.
 */

const IVR_ACTION_PATH = '/api/ivr/voice';
const MAX_RETRIES = 2;

const STORAGE_TYPE_KEY_ORDER: StorageType[] = [...ALL_STORAGE_TYPES];
const STORAGE_DURATION_KEY_ORDER: StorageDurationBand[] = [...ALL_STORAGE_DURATION_BANDS];

function formatSpokenDate(iso: string, language: Language): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year!, (month ?? 1) - 1, day));
  return new Intl.DateTimeFormat(IVR_LOCALE[language], {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Digits are read the same in every language; only the AM/PM convention is
 *  kept, since that is how times are commonly spoken in India regardless of
 *  language, and a translated "AM"/"PM" would be more confusing than clear. */
function formatSpokenTime(hhmm: string): string {
  const [hour = 0, minute = 0] = hhmm.split(':').map(Number);
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${hour12} ${period}` : `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

/** A booking reference read as a word ("PM24001") is easy to mishear over a
 *  phone line; spaced out, Twilio's Say reads each character individually. */
function spellOut(text: string): string {
  return text.split('').join(' ');
}

function pickFromMenu<T>(items: readonly T[], digits: string | undefined): T | null {
  if (!digits) return null;
  const index = Number.parseInt(digits, 10) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= Math.min(items.length, 9)) return null;
  return items[index] ?? null;
}

export interface IvrStepResult {
  twiml: string;
  callEnded: boolean;
  /** Set only on a successful booking — lets the controller record the same
   *  BOOKING_CREATED audit entry the web app's postBooking does (§ the audit
   *  write needs `req`, which this service layer never has). */
  bookingCreated?: {
    id: string;
    userId: string;
    bookingReference: string;
    cropName: string;
    expectedQuantityKg: number;
    slotDate: string;
  };
}

function retry(session: IvrSession, buildPrompt: () => string): IvrStepResult {
  session.retries += 1;
  if (session.retries > MAX_RETRIES) {
    const language = session.language ?? 'en';
    endSession(session.callSid);
    return {
      twiml: sayAndHangup(phrasesFor(language).giveUp, IVR_LOCALE[language]),
      callEnded: true,
    };
  }
  saveSession(session);
  return { twiml: buildPrompt(), callEnded: false };
}

// ---------------------------------------------------------------------------
// Entry point — a brand new call. Language first, before anything else.
// ---------------------------------------------------------------------------

export function startCall(callSid: string, fromPhone: string): IvrStepResult {
  const session: IvrSession = {
    callSid,
    fromPhone,
    userId: '',
    farmerName: null,
    step: 'LANGUAGE',
    retries: 0,
    language: null,
    crops: [],
    cropId: null,
    cropLabel: null,
    quantityKg: null,
    storageDurationBand: null,
    storageType: null,
    centres: [],
    centreId: null,
    centreLabel: null,
    dates: [],
    date: null,
    slots: [],
    slotId: null,
    slotLabel: null,
    idempotencyKey: randomUUID(),
    createdAt: Date.now(),
  };
  saveSession(session);

  return {
    twiml: gatherDigitsMultiLanguage({
      verses: LANGUAGE_MENU.map((entry) => ({ text: entry.text, languageTag: IVR_LOCALE[entry.language] })),
      actionPath: IVR_ACTION_PATH,
      numDigits: 1,
      timeoutSeconds: 10,
    }),
    callEnded: false,
  };
}

// ---------------------------------------------------------------------------
// One turn of an existing call
// ---------------------------------------------------------------------------

export async function continueCall(session: IvrSession, digits: string | undefined): Promise<IvrStepResult> {
  switch (session.step) {
    case 'LANGUAGE':
      return handleLanguageStep(session, digits);
    case 'CROP':
      return handleCropStep(session, digits);
    case 'QUANTITY':
      return handleQuantityStep(session, digits);
    case 'STORAGE_DURATION':
      return handleStorageDurationStep(session, digits);
    case 'STORAGE_TYPE':
      return handleStorageTypeStep(session, digits);
    case 'CENTRE':
      return handleCentreStep(session, digits);
    case 'DATE':
      return handleDateStep(session, digits);
    case 'SLOT':
      return handleSlotStep(session, digits);
    case 'CONFIRM':
      return handleConfirmStep(session, digits);
  }
}

async function handleLanguageStep(session: IvrSession, digits: string | undefined): Promise<IvrStepResult> {
  const language = pickFromMenu(LANGUAGE_MENU_ORDER, digits);
  if (!language) {
    return retry(session, () =>
      gatherDigitsMultiLanguage({
        verses: LANGUAGE_MENU.map((entry) => ({ text: entry.text, languageTag: IVR_LOCALE[entry.language] })),
        actionPath: IVR_ACTION_PATH,
        numDigits: 1,
        timeoutSeconds: 10,
      }),
    );
  }

  session.language = language;
  const phrases = phrasesFor(language);
  const localeTag = IVR_LOCALE[language];

  const profile = await findProfileByPhone(supabaseAdminClient, session.fromPhone.replace(/^\+/, ''));
  if (!profile || profile.role !== 'FARMER') {
    logger.info('ivr call rejected: no matching farmer account', {
      callSid: session.callSid,
      phone: maskPhone(session.fromPhone),
    });
    endSession(session.callSid);
    return { twiml: sayAndHangup(phrases.notFarmer, localeTag), callEnded: true };
  }

  const eligibility = await checkEligibility(supabaseAdminClient, profile.id);
  if (!isEligibleToBook(eligibility)) {
    logger.info('ivr call rejected: farmer not verified', {
      callSid: session.callSid,
      userId: profile.id,
      eligibility,
    });
    endSession(session.callSid);
    return { twiml: sayAndHangup(phrases.notVerified, localeTag), callEnded: true };
  }

  const crops = await listCrops(supabaseAdminClient);
  if (crops.length === 0) {
    endSession(session.callSid);
    return { twiml: sayAndHangup(phrases.noCrops, localeTag), callEnded: true };
  }

  session.userId = profile.id;
  session.farmerName = profile.fullName;
  session.crops = crops;
  session.step = 'CROP';
  session.retries = 0;
  saveSession(session);

  const prompt = menuPrompt(
    language,
    `${phrases.welcome(profile.fullName)} ${phrases.chooseCrop}`,
    crops.map((crop) => cropName(crop, language)),
  );
  return {
    twiml: gatherDigits({ prompt, actionPath: IVR_ACTION_PATH, languageTag: localeTag, numDigits: 1, timeoutSeconds: 8 }),
    callEnded: false,
  };
}

function cropPrompt(session: IvrSession): string {
  const language = session.language as Language;
  return menuPrompt(
    language,
    phrasesFor(language).chooseCrop,
    session.crops.map((crop) => cropName(crop, language)),
  );
}

function handleCropStep(session: IvrSession, digits: string | undefined): IvrStepResult {
  const language = session.language as Language;
  const localeTag = IVR_LOCALE[language];
  const phrases = phrasesFor(language);
  const crop = pickFromMenu(session.crops, digits);
  if (!crop) {
    return retry(session, () =>
      gatherDigits({
        prompt: `${phrases.notValid} ${cropPrompt(session)}`,
        actionPath: IVR_ACTION_PATH,
        languageTag: localeTag,
        numDigits: 1,
        timeoutSeconds: 8,
      }),
    );
  }

  const label = cropName(crop, language);
  session.cropId = crop.id;
  session.cropLabel = label;
  session.step = 'QUANTITY';
  session.retries = 0;
  saveSession(session);

  return {
    twiml: gatherDigits({
      prompt: `${phrases.youChose(label)} ${phrases.enterQuantity}`,
      actionPath: IVR_ACTION_PATH,
      languageTag: localeTag,
      finishOnKey: '#',
      timeoutSeconds: 10,
    }),
    callEnded: false,
  };
}

function handleQuantityStep(session: IvrSession, digits: string | undefined): IvrStepResult {
  const language = session.language as Language;
  const localeTag = IVR_LOCALE[language];
  const phrases = phrasesFor(language);
  const quantity = digits ? Number.parseInt(digits, 10) : NaN;
  if (!Number.isFinite(quantity) || quantity < MIN_QUANTITY_KG || quantity > MAX_QUANTITY_KG) {
    return retry(session, () =>
      gatherDigits({
        prompt: `${phrases.notValid} ${phrases.enterQuantity}`,
        actionPath: IVR_ACTION_PATH,
        languageTag: localeTag,
        finishOnKey: '#',
        timeoutSeconds: 10,
      }),
    );
  }

  session.quantityKg = quantity;
  session.step = 'STORAGE_DURATION';
  session.retries = 0;
  saveSession(session);

  return {
    twiml: gatherDigits({
      prompt: storageDurationPrompt(language),
      actionPath: IVR_ACTION_PATH,
      languageTag: localeTag,
      numDigits: 1,
      timeoutSeconds: 8,
    }),
    callEnded: false,
  };
}

function storageDurationPrompt(language: Language): string {
  const phrases = phrasesFor(language);
  return menuPrompt(
    language,
    phrases.chooseDuration,
    STORAGE_DURATION_KEY_ORDER.map((band) => phrases.durationLabel[band]),
  );
}

function handleStorageDurationStep(session: IvrSession, digits: string | undefined): IvrStepResult {
  const language = session.language as Language;
  const localeTag = IVR_LOCALE[language];
  const phrases = phrasesFor(language);
  const band = pickFromMenu(STORAGE_DURATION_KEY_ORDER, digits);
  if (!band) {
    return retry(session, () =>
      gatherDigits({
        prompt: `${phrases.notValid} ${storageDurationPrompt(language)}`,
        actionPath: IVR_ACTION_PATH,
        languageTag: localeTag,
        numDigits: 1,
        timeoutSeconds: 8,
      }),
    );
  }

  session.storageDurationBand = band;
  session.step = 'STORAGE_TYPE';
  session.retries = 0;
  saveSession(session);

  return {
    twiml: gatherDigits({
      prompt: storageTypePrompt(language),
      actionPath: IVR_ACTION_PATH,
      languageTag: localeTag,
      numDigits: 1,
      timeoutSeconds: 8,
    }),
    callEnded: false,
  };
}

function storageTypePrompt(language: Language): string {
  const phrases = phrasesFor(language);
  return menuPrompt(
    language,
    phrases.chooseStorageType,
    STORAGE_TYPE_KEY_ORDER.map((type) => phrases.storageTypeLabel[type]),
  );
}

async function handleStorageTypeStep(
  session: IvrSession,
  digits: string | undefined,
): Promise<IvrStepResult> {
  const language = session.language as Language;
  const localeTag = IVR_LOCALE[language];
  const phrases = phrasesFor(language);
  const type = pickFromMenu(STORAGE_TYPE_KEY_ORDER, digits);
  if (!type) {
    return retry(session, () =>
      gatherDigits({
        prompt: `${phrases.notValid} ${storageTypePrompt(language)}`,
        actionPath: IVR_ACTION_PATH,
        languageTag: localeTag,
        numDigits: 1,
        timeoutSeconds: 8,
      }),
    );
  }

  session.storageType = type;
  session.step = 'CENTRE';
  session.retries = 0;

  const centres = (await listCentresForCrop(supabaseAdminClient, session.cropId as string)).filter(
    (centre) => centre.availableSlotCount > 0,
  );
  session.centres = centres;
  saveSession(session);

  if (centres.length === 0) {
    endSession(session.callSid);
    return { twiml: sayAndHangup(phrases.noCentres, localeTag), callEnded: true };
  }

  const prompt = menuPrompt(
    language,
    phrases.chooseCentre,
    centres.map((centre) => (centre.village ? `${centre.name}, ${centre.village}` : centre.name)),
  );
  return {
    twiml: gatherDigits({ prompt, actionPath: IVR_ACTION_PATH, languageTag: localeTag, numDigits: 1, timeoutSeconds: 8 }),
    callEnded: false,
  };
}

function centrePrompt(session: IvrSession): string {
  const language = session.language as Language;
  return menuPrompt(
    language,
    phrasesFor(language).chooseCentre,
    session.centres.map((centre) => (centre.village ? `${centre.name}, ${centre.village}` : centre.name)),
  );
}

async function handleCentreStep(session: IvrSession, digits: string | undefined): Promise<IvrStepResult> {
  const language = session.language as Language;
  const localeTag = IVR_LOCALE[language];
  const phrases = phrasesFor(language);
  const centre = pickFromMenu(session.centres, digits);
  if (!centre) {
    return retry(session, () =>
      gatherDigits({
        prompt: `${phrases.notValid} ${centrePrompt(session)}`,
        actionPath: IVR_ACTION_PATH,
        languageTag: localeTag,
        numDigits: 1,
        timeoutSeconds: 8,
      }),
    );
  }

  session.centreId = centre.id;
  session.centreLabel = centre.name;
  session.step = 'DATE';
  session.retries = 0;

  const dates = await listAvailableDates(supabaseAdminClient, centre.id, session.cropId as string);
  session.dates = dates;
  saveSession(session);

  if (dates.length === 0) {
    endSession(session.callSid);
    return { twiml: sayAndHangup(phrases.noDates(centre.name), localeTag), callEnded: true };
  }

  const prompt = menuPrompt(
    language,
    phrases.chooseDate,
    dates.map((date) => formatSpokenDate(date.date, language)),
  );
  return {
    twiml: gatherDigits({ prompt, actionPath: IVR_ACTION_PATH, languageTag: localeTag, numDigits: 1, timeoutSeconds: 8 }),
    callEnded: false,
  };
}

function datePrompt(session: IvrSession): string {
  const language = session.language as Language;
  return menuPrompt(
    language,
    phrasesFor(language).chooseDate,
    session.dates.map((date) => formatSpokenDate(date.date, language)),
  );
}

async function handleDateStep(session: IvrSession, digits: string | undefined): Promise<IvrStepResult> {
  const language = session.language as Language;
  const localeTag = IVR_LOCALE[language];
  const phrases = phrasesFor(language);
  const chosen = pickFromMenu(session.dates, digits);
  if (!chosen) {
    return retry(session, () =>
      gatherDigits({
        prompt: `${phrases.notValid} ${datePrompt(session)}`,
        actionPath: IVR_ACTION_PATH,
        languageTag: localeTag,
        numDigits: 1,
        timeoutSeconds: 8,
      }),
    );
  }

  session.date = chosen.date;
  session.step = 'SLOT';
  session.retries = 0;

  const slots = (
    await listSlotsForDate(supabaseAdminClient, session.centreId as string, session.cropId as string, chosen.date)
  ).filter((slot) => slot.status === 'OPEN' && slot.remainingCapacity > 0);
  session.slots = slots;
  saveSession(session);

  if (slots.length === 0) {
    endSession(session.callSid);
    return { twiml: sayAndHangup(phrases.noSlots, localeTag), callEnded: true };
  }

  const prompt = menuPrompt(
    language,
    phrases.chooseSlot,
    slots.map((slot) => `${formatSpokenTime(slot.startTime)} ${phrases.timeJoiner} ${formatSpokenTime(slot.endTime)}`),
  );
  return {
    twiml: gatherDigits({ prompt, actionPath: IVR_ACTION_PATH, languageTag: localeTag, numDigits: 1, timeoutSeconds: 8 }),
    callEnded: false,
  };
}

function slotPrompt(session: IvrSession): string {
  const language = session.language as Language;
  const phrases = phrasesFor(language);
  return menuPrompt(
    language,
    phrases.chooseSlot,
    session.slots.map(
      (slot) => `${formatSpokenTime(slot.startTime)} ${phrases.timeJoiner} ${formatSpokenTime(slot.endTime)}`,
    ),
  );
}

function handleSlotStep(session: IvrSession, digits: string | undefined): IvrStepResult {
  const language = session.language as Language;
  const localeTag = IVR_LOCALE[language];
  const phrases = phrasesFor(language);
  const slot = pickFromMenu(session.slots, digits);
  if (!slot) {
    return retry(session, () =>
      gatherDigits({
        prompt: `${phrases.notValid} ${slotPrompt(session)}`,
        actionPath: IVR_ACTION_PATH,
        languageTag: localeTag,
        numDigits: 1,
        timeoutSeconds: 8,
      }),
    );
  }

  session.slotId = slot.id;
  session.slotLabel = `${formatSpokenTime(slot.startTime)} ${phrases.timeJoiner} ${formatSpokenTime(slot.endTime)}`;
  session.step = 'CONFIRM';
  session.retries = 0;
  saveSession(session);

  const prompt =
    `${phrases.bookingSummary(
      session.quantityKg as number,
      session.cropLabel as string,
      session.centreLabel as string,
      formatSpokenDate(session.date as string, language),
      session.slotLabel,
    )} ${phrases.pressConfirm}`;
  return {
    twiml: gatherDigits({ prompt, actionPath: IVR_ACTION_PATH, languageTag: localeTag, numDigits: 1, timeoutSeconds: 8 }),
    callEnded: false,
  };
}

async function handleConfirmStep(session: IvrSession, digits: string | undefined): Promise<IvrStepResult> {
  const language = session.language as Language;
  const localeTag = IVR_LOCALE[language];
  const phrases = phrasesFor(language);

  if (digits === '2') {
    endSession(session.callSid);
    return { twiml: sayAndHangup(phrases.cancelled, localeTag), callEnded: true };
  }

  if (digits !== '1') {
    return retry(session, () =>
      gatherDigits({
        prompt: `${phrases.notValid} ${phrases.pressConfirm}`,
        actionPath: IVR_ACTION_PATH,
        languageTag: localeTag,
        numDigits: 1,
        timeoutSeconds: 8,
      }),
    );
  }

  try {
    const booking = await createBooking(supabaseAdminClient, session.userId, {
      cropId: session.cropId as string,
      expectedQuantityKg: session.quantityKg as number,
      // A phone call cannot practically collect free-text location (no
      // sensible way to type letters on a numeric keypad); the storage-type
      // label is the closest honest substitute (§ storageLocationText is
      // required by CreateBookingRequest).
      storageLocationText: `${phrases.storageTypeLabel[session.storageType as StorageType]} (booked by phone)`,
      storageDurationBand: session.storageDurationBand,
      storageType: session.storageType,
      slotId: session.slotId as string,
      idempotencyKey: session.idempotencyKey,
      bookingMethod: 'ivr',
    });

    endSession(session.callSid);
    logger.info('ivr booking created', { callSid: session.callSid, userId: session.userId, bookingId: booking.id });
    return {
      twiml: sayAndHangup(phrases.bookingConfirmed(spellOut(booking.bookingReference)), localeTag),
      callEnded: true,
      bookingCreated: {
        id: booking.id,
        userId: session.userId,
        bookingReference: booking.bookingReference,
        cropName: booking.cropName,
        expectedQuantityKg: booking.expectedQuantityKg,
        slotDate: booking.slotDate,
      },
    };
  } catch (error) {
    endSession(session.callSid);
    const reason = error instanceof AppError ? error.message : phrases.genericBookingError;
    logger.error('ivr booking failed', {
      callSid: session.callSid,
      userId: session.userId,
      reason: (error as Error).message,
    });
    return { twiml: sayAndHangup(phrases.bookingFailed(reason), localeTag), callEnded: true };
  }
}

export { getSession };
