import type { Language, StorageDurationBand, StorageType } from '@kisansetu/shared';
import { ALL_STORAGE_DURATION_BANDS, ALL_STORAGE_TYPES } from '@kisansetu/shared';

/**
 * Every spoken IVR string, in each of the app's five languages (Phase 9
 * IVR). Reuses the same five languages the rest of the app supports — see
 * `Language` in packages/shared/src/language.ts — and the same crop-name
 * limitation the whole app already has (`cropName()` only distinguishes
 * English/Tamil, see booking.ts): a Kannada/Hindi/Malayalam caller still
 * hears crop names in English, because there is no Kannada/Hindi/Malayalam
 * crop name anywhere in the data to speak instead.
 *
 * IMPORTANT: these translations were written by an AI assistant, not
 * reviewed by a native speaker of Tamil, Kannada, Hindi or Malayalam. They
 * are good enough to demo the feature; treat them as a first draft that
 * needs a native-speaker review before any real farmer ever hears them —
 * the same honesty the rest of this codebase holds itself to (§ never
 * pretending full coverage where none exists).
 */

export const IVR_LOCALE: Record<Language, string> = {
  en: 'en-IN',
  ta: 'ta-IN',
  kn: 'kn-IN',
  hi: 'hi-IN',
  ml: 'ml-IN',
};

/** The very first menu, before a language is known — so each line is
 *  necessarily spoken in ITS OWN language/voice, not the (not yet chosen)
 *  caller's. Order fixes the DTMF digit each language is selected with. */
export const LANGUAGE_MENU: Array<{ language: Language; text: string }> = [
  { language: 'en', text: 'Welcome to Procure Mintra. For English, press 1.' },
  { language: 'ta', text: 'தமிழுக்கு, 2 அழுத்தவும்.' },
  { language: 'kn', text: 'ಕನ್ನಡಕ್ಕಾಗಿ, 3 ಒತ್ತಿ.' },
  { language: 'hi', text: 'हिंदी के लिए, 4 दबाएं।' },
  { language: 'ml', text: 'മലയാളത്തിന്, 5 അമർത്തുക.' },
];
/** Index (0-based) into LANGUAGE_MENU <-> DTMF digit pressed (1-based). */
export const LANGUAGE_MENU_ORDER: Language[] = LANGUAGE_MENU.map((entry) => entry.language);

export interface IvrPhrases {
  pressFor(digit: number, label: string): string;
  welcome(name: string | null): string;
  chooseCrop: string;
  youChose(item: string): string;
  enterQuantity: string;
  notValid: string;
  chooseDuration: string;
  durationLabel: Record<StorageDurationBand, string>;
  chooseStorageType: string;
  storageTypeLabel: Record<StorageType, string>;
  chooseCentre: string;
  chooseDate: string;
  chooseSlot: string;
  timeJoiner: string;
  bookingSummary(quantityKg: number, crop: string, centre: string, date: string, slot: string): string;
  pressConfirm: string;
  cancelled: string;
  giveUp: string;
  bookingConfirmed(spelledReference: string): string;
  bookingFailed(reason: string): string;
  notFarmer: string;
  notVerified: string;
  noCrops: string;
  noCentres: string;
  noDates(centre: string): string;
  noSlots: string;
  genericBookingError: string;
  /** One DTMF digit per option caps a menu at 9 (§ menuPrompt) — said aloud
   *  so a caller with a 10th+ option knows more exist rather than silently
   *  never hearing them. */
  moreOptions(total: number): string;
}

const PHRASES: Record<Language, IvrPhrases> = {
  en: {
    pressFor: (n, label) => `Press ${n} for ${label}.`,
    welcome: (name) =>
      name
        ? `Welcome to Procure Mintra, ${name}. Let's book a procurement slot.`
        : "Welcome to Procure Mintra. Let's book a procurement slot.",
    chooseCrop: 'Choose your crop.',
    youChose: (item) => `You chose ${item}.`,
    enterQuantity: 'Enter the quantity in kilograms using the keypad, then press pound.',
    notValid: "Sorry, that wasn't valid.",
    chooseDuration: 'How many days before you bring it to the centre?',
    durationLabel: {
      DAYS_0_3: '0 to 3 days',
      DAYS_4_7: '4 to 7 days',
      DAYS_8_14: '8 to 14 days',
      DAYS_15_30: '15 to 30 days',
      DAYS_30_PLUS: 'more than 30 days',
    },
    chooseStorageType: 'How is it stored?',
    storageTypeLabel: {
      OPEN: 'open storage',
      COVERED: 'covered storage',
      WAREHOUSE: 'warehouse',
      OTHER: 'other storage',
    },
    chooseCentre: 'Choose a procurement centre.',
    chooseDate: 'Choose a date.',
    chooseSlot: 'Choose a time slot.',
    timeJoiner: 'to',
    bookingSummary: (qty, crop, centre, date, slot) =>
      `You are booking ${qty} kilograms of ${crop} at ${centre} on ${date}, ${slot}.`,
    pressConfirm: 'Press 1 to confirm. Press 2 to cancel.',
    cancelled: 'Booking cancelled. Goodbye.',
    giveUp: "Sorry, I still couldn't understand that. Please call again, or book through the app. Goodbye.",
    bookingConfirmed: (ref) =>
      `Your booking is confirmed. Your reference number is ${ref}. Thank you for using Procure Mintra. Goodbye.`,
    bookingFailed: (reason) => `Sorry, we could not complete your booking. ${reason} Goodbye.`,
    notFarmer:
      "We couldn't find a farmer account for this phone number. Please register in the Procure Mintra app first. Goodbye.",
    notVerified:
      'Your farmer registration is not verified yet. Please complete verification in the app before booking by phone. Goodbye.',
    noCrops: 'No crops are currently open for procurement. Please try again later. Goodbye.',
    noCentres:
      'Sorry, no centres currently have open slots for this crop. Please try again later, or book through the app. Goodbye.',
    noDates: (centre) => `Sorry, ${centre} has no open dates right now. Please try again later. Goodbye.`,
    noSlots: 'Sorry, that date has no open slots anymore. Please call again. Goodbye.',
    genericBookingError: 'Something went wrong while creating your booking. Please try again, or use the app.',
    moreOptions: (total) => `Showing 9 of ${total}. The rest are only in the app.`,
  },
  ta: {
    pressFor: (n, label) => `${label}க்கு ${n} அழுத்தவும்.`,
    welcome: (name) =>
      name
        ? `ப்ரொக்யூர் மிண்ட்ராவிற்கு வரவேற்கிறோம், ${name}. ஒரு கொள்முதல் நேரத்தை பதிவு செய்வோம்.`
        : 'ப்ரொக்யூர் மிண்ட்ராவிற்கு வரவேற்கிறோம். ஒரு கொள்முதல் நேரத்தை பதிவு செய்வோம்.',
    chooseCrop: 'உங்கள் பயிரைத் தேர்ந்தெடுக்கவும்.',
    youChose: (item) => `நீங்கள் ${item} தேர்ந்தெடுத்தீர்கள்.`,
    enterQuantity: 'கிலோகிராமில் அளவை கீபேடில் உள்ளிட்டு, பிறகு பவுண்ட் பட்டனை அழுத்தவும்.',
    notValid: 'மன்னிக்கவும், அது சரியானதாக இல்லை.',
    chooseDuration: 'மையத்திற்கு கொண்டு வர எத்தனை நாட்கள் ஆகும்?',
    durationLabel: {
      DAYS_0_3: '0 முதல் 3 நாட்கள்',
      DAYS_4_7: '4 முதல் 7 நாட்கள்',
      DAYS_8_14: '8 முதல் 14 நாட்கள்',
      DAYS_15_30: '15 முதல் 30 நாட்கள்',
      DAYS_30_PLUS: '30 நாட்களுக்கு மேல்',
    },
    chooseStorageType: 'அது எவ்வாறு சேமிக்கப்படுகிறது?',
    storageTypeLabel: {
      OPEN: 'திறந்த சேமிப்பு',
      COVERED: 'மூடிய சேமிப்பு',
      WAREHOUSE: 'கிடங்கு',
      OTHER: 'மற்றவை',
    },
    chooseCentre: 'ஒரு கொள்முதல் மையத்தைத் தேர்ந்தெடுக்கவும்.',
    chooseDate: 'ஒரு தேதியைத் தேர்ந்தெடுக்கவும்.',
    chooseSlot: 'ஒரு நேர இடைவெளியைத் தேர்ந்தெடுக்கவும்.',
    timeJoiner: 'முதல்',
    bookingSummary: (qty, crop, centre, date, slot) =>
      `நீங்கள் ${crop} ${qty} கிலோகிராம் ${centre} இல் ${date}, ${slot} அன்று பதிவு செய்கிறீர்கள்.`,
    pressConfirm: 'உறுதிப்படுத்த 1 அழுத்தவும். ரத்து செய்ய 2 அழுத்தவும்.',
    cancelled: 'பதிவு ரத்து செய்யப்பட்டது. நன்றி.',
    giveUp: 'மன்னிக்கவும், எனக்கு புரியவில்லை. தயவுசெய்து மீண்டும் அழைக்கவும் அல்லது ஆப்பில் பதிவு செய்யவும். நன்றி.',
    bookingConfirmed: (ref) =>
      `உங்கள் பதிவு உறுதி செய்யப்பட்டது. உங்கள் குறிப்பு எண் ${ref}. ப்ரொக்யூர் மிண்ட்ராவைப் பயன்படுத்தியதற்கு நன்றி.`,
    bookingFailed: (reason) => `மன்னிக்கவும், உங்கள் பதிவை முடிக்க முடியவில்லை. ${reason} நன்றி.`,
    notFarmer:
      'இந்த தொலைபேசி எண்ணுக்கு விவசாயி கணக்கு எதுவும் கிடைக்கவில்லை. முதலில் ப்ரொக்யூர் மிண்ட்ரா ஆப்பில் பதிவு செய்யவும். நன்றி.',
    notVerified:
      'உங்கள் விவசாயி பதிவு இன்னும் சரிபார்க்கப்படவில்லை. தொலைபேசி மூலம் பதிவு செய்யும் முன் ஆப்பில் சரிபார்ப்பை முடிக்கவும். நன்றி.',
    noCrops: 'தற்போது எந்த பயிரும் கொள்முதலுக்கு திறந்திருக்கவில்லை. பின்னர் முயற்சிக்கவும். நன்றி.',
    noCentres:
      'மன்னிக்கவும், இந்த பயிருக்கு தற்போது காலியிடங்கள் உள்ள மையங்கள் இல்லை. பின்னர் முயற்சிக்கவும் அல்லது ஆப்பில் பதிவு செய்யவும். நன்றி.',
    noDates: (centre) => `மன்னிக்கவும், ${centre} இல் தற்போது திறந்த தேதிகள் இல்லை. பின்னர் முயற்சிக்கவும். நன்றி.`,
    noSlots: 'மன்னிக்கவும், அந்த தேதியில் இனி திறந்த நேரங்கள் இல்லை. மீண்டும் அழைக்கவும். நன்றி.',
    genericBookingError: 'உங்கள் பதிவை உருவாக்குவதில் ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும் அல்லது ஆப்பைப் பயன்படுத்தவும்.',
    moreOptions: (total) => `${total} இல் 9 காட்டப்படுகின்றன. மற்றவை ஆப்பில் மட்டுமே.`,
  },
  kn: {
    pressFor: (n, label) => `${label} ಗಾಗಿ ${n} ಒತ್ತಿ.`,
    welcome: (name) =>
      name
        ? `ಪ್ರೊಕ್ಯೂರ್ ಮಿಂಟ್ರಾಗೆ ಸ್ವಾಗತ, ${name}. ಖರೀದಿ ಸ್ಲಾಟ್ ಅನ್ನು ಬುಕ್ ಮಾಡೋಣ.`
        : 'ಪ್ರೊಕ್ಯೂರ್ ಮಿಂಟ್ರಾಗೆ ಸ್ವಾಗತ. ಖರೀದಿ ಸ್ಲಾಟ್ ಅನ್ನು ಬುಕ್ ಮಾಡೋಣ.',
    chooseCrop: 'ನಿಮ್ಮ ಬೆಳೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ.',
    youChose: (item) => `ನೀವು ${item} ಆಯ್ಕೆ ಮಾಡಿದ್ದೀರಿ.`,
    enterQuantity: 'ಕೀಪ್ಯಾಡ್ ಬಳಸಿ ಕಿಲೋಗ್ರಾಂನಲ್ಲಿ ಪ್ರಮಾಣವನ್ನು ನಮೂದಿಸಿ, ನಂತರ ಪೌಂಡ್ ಒತ್ತಿ.',
    notValid: 'ಕ್ಷಮಿಸಿ, ಅದು ಸರಿಯಾಗಿಲ್ಲ.',
    chooseDuration: 'ಕೇಂದ್ರಕ್ಕೆ ತರುವ ಮೊದಲು ಎಷ್ಟು ದಿನಗಳು ಆಗುತ್ತದೆ?',
    durationLabel: {
      DAYS_0_3: '0 ರಿಂದ 3 ದಿನಗಳು',
      DAYS_4_7: '4 ರಿಂದ 7 ದಿನಗಳು',
      DAYS_8_14: '8 ರಿಂದ 14 ದಿನಗಳು',
      DAYS_15_30: '15 ರಿಂದ 30 ದಿನಗಳು',
      DAYS_30_PLUS: '30 ದಿನಗಳಿಗಿಂತ ಹೆಚ್ಚು',
    },
    chooseStorageType: 'ಅದನ್ನು ಹೇಗೆ ಸಂಗ್ರಹಿಸಲಾಗಿದೆ?',
    storageTypeLabel: {
      OPEN: 'ತೆರೆದ ಸಂಗ್ರಹಣೆ',
      COVERED: 'ಮುಚ್ಚಿದ ಸಂಗ್ರಹಣೆ',
      WAREHOUSE: 'ಗೋದಾಮು',
      OTHER: 'ಇತರೆ',
    },
    chooseCentre: 'ಖರೀದಿ ಕೇಂದ್ರವನ್ನು ಆಯ್ಕೆಮಾಡಿ.',
    chooseDate: 'ದಿನಾಂಕವನ್ನು ಆಯ್ಕೆಮಾಡಿ.',
    chooseSlot: 'ಸಮಯದ ಸ್ಲಾಟ್ ಅನ್ನು ಆಯ್ಕೆಮಾಡಿ.',
    timeJoiner: 'ಇಂದ',
    bookingSummary: (qty, crop, centre, date, slot) =>
      `ನೀವು ${centre} ನಲ್ಲಿ ${date}, ${slot} ರಂದು ${crop} ನ ${qty} ಕಿಲೋಗ್ರಾಂ ಬುಕ್ ಮಾಡುತ್ತಿದ್ದೀರಿ.`,
    pressConfirm: 'ದೃಢೀಕರಿಸಲು 1 ಒತ್ತಿ. ರದ್ದುಮಾಡಲು 2 ಒತ್ತಿ.',
    cancelled: 'ಬುಕಿಂಗ್ ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ. ಧನ್ಯವಾದಗಳು.',
    giveUp: 'ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಕರೆ ಮಾಡಿ ಅಥವಾ ಆಪ್‌ನಲ್ಲಿ ಬುಕ್ ಮಾಡಿ. ಧನ್ಯವಾದಗಳು.',
    bookingConfirmed: (ref) =>
      `ನಿಮ್ಮ ಬುಕಿಂಗ್ ದೃಢಪಟ್ಟಿದೆ. ನಿಮ್ಮ ಉಲ್ಲೇಖ ಸಂಖ್ಯೆ ${ref}. ಪ್ರೊಕ್ಯೂರ್ ಮಿಂಟ್ರಾ ಬಳಸಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು.`,
    bookingFailed: (reason) => `ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ ಬುಕಿಂಗ್ ಪೂರ್ಣಗೊಳಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ${reason} ಧನ್ಯವಾದಗಳು.`,
    notFarmer:
      'ಈ ಫೋನ್ ಸಂಖ್ಯೆಗೆ ರೈತ ಖಾತೆ ಕಂಡುಬಂದಿಲ್ಲ. ದಯವಿಟ್ಟು ಮೊದಲು ಪ್ರೊಕ್ಯೂರ್ ಮಿಂಟ್ರಾ ಆಪ್‌ನಲ್ಲಿ ನೋಂದಾಯಿಸಿ. ಧನ್ಯವಾದಗಳು.',
    notVerified:
      'ನಿಮ್ಮ ರೈತ ನೋಂದಣಿ ಇನ್ನೂ ಪರಿಶೀಲಿಸಲಾಗಿಲ್ಲ. ಫೋನ್ ಮೂಲಕ ಬುಕ್ ಮಾಡುವ ಮೊದಲು ಆಪ್‌ನಲ್ಲಿ ಪರಿಶೀಲನೆ ಪೂರ್ಣಗೊಳಿಸಿ. ಧನ್ಯವಾದಗಳು.',
    noCrops: 'ಪ್ರಸ್ತುತ ಯಾವುದೇ ಬೆಳೆ ಖರೀದಿಗೆ ತೆರೆದಿಲ್ಲ. ದಯವಿಟ್ಟು ನಂತರ ಪ್ರಯತ್ನಿಸಿ. ಧನ್ಯವಾದಗಳು.',
    noCentres:
      'ಕ್ಷಮಿಸಿ, ಈ ಬೆಳೆಗೆ ಪ್ರಸ್ತುತ ಯಾವುದೇ ಕೇಂದ್ರದಲ್ಲಿ ಸ್ಥಳಾವಕಾಶವಿಲ್ಲ. ನಂತರ ಪ್ರಯತ್ನಿಸಿ ಅಥವಾ ಆಪ್‌ನಲ್ಲಿ ಬುಕ್ ಮಾಡಿ. ಧನ್ಯವಾದಗಳು.',
    noDates: (centre) => `ಕ್ಷಮಿಸಿ, ${centre} ನಲ್ಲಿ ಈಗ ಯಾವುದೇ ದಿನಾಂಕ ತೆರೆದಿಲ್ಲ. ನಂತರ ಪ್ರಯತ್ನಿಸಿ. ಧನ್ಯವಾದಗಳು.`,
    noSlots: 'ಕ್ಷಮಿಸಿ, ಆ ದಿನಾಂಕದಂದು ಇನ್ನು ಯಾವುದೇ ಸ್ಲಾಟ್ ತೆರೆದಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಕರೆ ಮಾಡಿ. ಧನ್ಯವಾದಗಳು.',
    genericBookingError: 'ನಿಮ್ಮ ಬುಕಿಂಗ್ ಮಾಡುವಾಗ ಏನೋ ತಪ್ಪಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ ಅಥವಾ ಆಪ್ ಬಳಸಿ.',
    moreOptions: (total) => `${total} ರಲ್ಲಿ 9 ತೋರಿಸಲಾಗುತ್ತಿದೆ. ಉಳಿದವು ಆಪ್‌ನಲ್ಲಿ ಮಾತ್ರ.`,
  },
  hi: {
    pressFor: (n, label) => `${label} के लिए ${n} दबाएं।`,
    welcome: (name) =>
      name
        ? `प्रोक्योर मिंत्रा में आपका स्वागत है, ${name}। चलिए एक खरीद स्लॉट बुक करते हैं।`
        : 'प्रोक्योर मिंत्रा में आपका स्वागत है। चलिए एक खरीद स्लॉट बुक करते हैं।',
    chooseCrop: 'अपनी फसल चुनें।',
    youChose: (item) => `आपने ${item} चुना।`,
    enterQuantity: 'कीपैड से किलोग्राम में मात्रा डालें, फिर पाउंड दबाएं।',
    notValid: 'क्षमा करें, यह सही नहीं था।',
    chooseDuration: 'केंद्र में लाने से पहले कितने दिन लगेंगे?',
    durationLabel: {
      DAYS_0_3: '0 से 3 दिन',
      DAYS_4_7: '4 से 7 दिन',
      DAYS_8_14: '8 से 14 दिन',
      DAYS_15_30: '15 से 30 दिन',
      DAYS_30_PLUS: '30 दिनों से अधिक',
    },
    chooseStorageType: 'इसे कैसे संग्रहीत किया गया है?',
    storageTypeLabel: {
      OPEN: 'खुला भंडारण',
      COVERED: 'ढका हुआ भंडारण',
      WAREHOUSE: 'गोदाम',
      OTHER: 'अन्य',
    },
    chooseCentre: 'एक खरीद केंद्र चुनें।',
    chooseDate: 'एक तारीख चुनें।',
    chooseSlot: 'एक समय स्लॉट चुनें।',
    timeJoiner: 'से',
    bookingSummary: (qty, crop, centre, date, slot) =>
      `आप ${centre} में ${date}, ${slot} को ${crop} के ${qty} किलोग्राम बुक कर रहे हैं।`,
    pressConfirm: 'पुष्टि के लिए 1 दबाएं। रद्द करने के लिए 2 दबाएं।',
    cancelled: 'बुकिंग रद्द कर दी गई। धन्यवाद।',
    giveUp: 'क्षमा करें, मुझे समझ नहीं आया। कृपया फिर से कॉल करें या ऐप से बुक करें। धन्यवाद।',
    bookingConfirmed: (ref) =>
      `आपकी बुकिंग पक्की हो गई है। आपका संदर्भ नंबर ${ref} है। प्रोक्योर मिंत्रा का उपयोग करने के लिए धन्यवाद।`,
    bookingFailed: (reason) => `क्षमा करें, हम आपकी बुकिंग पूरी नहीं कर सके। ${reason} धन्यवाद।`,
    notFarmer:
      'इस फोन नंबर के लिए कोई किसान खाता नहीं मिला। कृपया पहले प्रोक्योर मिंत्रा ऐप में पंजीकरण करें। धन्यवाद।',
    notVerified:
      'आपका किसान पंजीकरण अभी सत्यापित नहीं हुआ है। फोन से बुक करने से पहले ऐप में सत्यापन पूरा करें। धन्यवाद।',
    noCrops: 'फिलहाल कोई फसल खरीद के लिए खुली नहीं है। कृपया बाद में प्रयास करें। धन्यवाद।',
    noCentres:
      'क्षमा करें, इस फसल के लिए फिलहाल किसी केंद्र में जगह खाली नहीं है। बाद में प्रयास करें या ऐप से बुक करें। धन्यवाद।',
    noDates: (centre) => `क्षमा करें, ${centre} में अभी कोई तारीख खुली नहीं है। बाद में प्रयास करें। धन्यवाद।`,
    noSlots: 'क्षमा करें, उस तारीख पर अब कोई स्लॉट खुला नहीं है। कृपया फिर से कॉल करें। धन्यवाद।',
    genericBookingError: 'आपकी बुकिंग बनाने में कुछ गड़बड़ हो गई। कृपया फिर से प्रयास करें या ऐप का उपयोग करें।',
    moreOptions: (total) => `${total} में से 9 दिखाए जा रहे हैं। बाकी केवल ऐप में हैं।`,
  },
  ml: {
    pressFor: (n, label) => `${label} ന് ${n} അമർത്തുക.`,
    welcome: (name) =>
      name
        ? `പ്രൊക്യുവർ മിന്ത്രയിലേക്ക് സ്വാഗതം, ${name}. ഒരു സംഭരണ സ്ലോട്ട് ബുക്ക് ചെയ്യാം.`
        : 'പ്രൊക്യുവർ മിന്ത്രയിലേക്ക് സ്വാഗതം. ഒരു സംഭരണ സ്ലോട്ട് ബുക്ക് ചെയ്യാം.',
    chooseCrop: 'നിങ്ങളുടെ വിള തിരഞ്ഞെടുക്കുക.',
    youChose: (item) => `നിങ്ങൾ ${item} തിരഞ്ഞെടുത്തു.`,
    enterQuantity: 'കീപാഡ് ഉപയോഗിച്ച് കിലോഗ്രാമിൽ അളവ് നൽകുക, എന്നിട്ട് പൗണ്ട് അമർത്തുക.',
    notValid: 'ക്ഷമിക്കണം, അത് ശരിയായില്ല.',
    chooseDuration: 'കേന്ദ്രത്തിലേക്ക് കൊണ്ടുവരാൻ എത്ര ദിവസമെടുക്കും?',
    durationLabel: {
      DAYS_0_3: '0 മുതൽ 3 ദിവസം',
      DAYS_4_7: '4 മുതൽ 7 ദിവസം',
      DAYS_8_14: '8 മുതൽ 14 ദിവസം',
      DAYS_15_30: '15 മുതൽ 30 ദിവസം',
      DAYS_30_PLUS: '30 ദിവസത്തിൽ കൂടുതൽ',
    },
    chooseStorageType: 'അത് എങ്ങനെയാണ് സൂക്ഷിച്ചിരിക്കുന്നത്?',
    storageTypeLabel: {
      OPEN: 'തുറന്ന സംഭരണം',
      COVERED: 'മൂടിയ സംഭരണം',
      WAREHOUSE: 'ഗോഡൗൺ',
      OTHER: 'മറ്റുള്ളവ',
    },
    chooseCentre: 'ഒരു സംഭരണ കേന്ദ്രം തിരഞ്ഞെടുക്കുക.',
    chooseDate: 'ഒരു തീയതി തിരഞ്ഞെടുക്കുക.',
    chooseSlot: 'ഒരു സമയ സ്ലോട്ട് തിരഞ്ഞെടുക്കുക.',
    timeJoiner: 'മുതൽ',
    bookingSummary: (qty, crop, centre, date, slot) =>
      `നിങ്ങൾ ${centre} ൽ ${date}, ${slot} ന് ${crop} ന്റെ ${qty} കിലോഗ്രാം ബുക്ക് ചെയ്യുന്നു.`,
    pressConfirm: 'സ്ഥിരീകരിക്കാൻ 1 അമർത്തുക. റദ്ദാക്കാൻ 2 അമർത്തുക.',
    cancelled: 'ബുക്കിംഗ് റദ്ദാക്കി. നന്ദി.',
    giveUp: 'ക്ഷമിക്കണം, എനിക്ക് മനസ്സിലായില്ല. ദയവായി വീണ്ടും വിളിക്കുക അല്ലെങ്കിൽ ആപ്പ് വഴി ബുക്ക് ചെയ്യുക. നന്ദി.',
    bookingConfirmed: (ref) =>
      `നിങ്ങളുടെ ബുക്കിംഗ് സ്ഥിരീകരിച്ചു. നിങ്ങളുടെ റഫറൻസ് നമ്പർ ${ref}. പ്രൊക്യുവർ മിന്ത്ര ഉപയോഗിച്ചതിന് നന്ദി.`,
    bookingFailed: (reason) => `ക്ഷമിക്കണം, നിങ്ങളുടെ ബുക്കിംഗ് പൂർത്തിയാക്കാൻ കഴിഞ്ഞില്ല. ${reason} നന്ദി.`,
    notFarmer:
      'ഈ ഫോൺ നമ്പറിന് കർഷക അക്കൗണ്ട് കണ്ടെത്താനായില്ല. ദയവായി ആദ്യം പ്രൊക്യുവർ മിന്ത്ര ആപ്പിൽ രജിസ്റ്റർ ചെയ്യുക. നന്ദി.',
    notVerified:
      'നിങ്ങളുടെ കർഷക രജിസ്ട്രേഷൻ ഇതുവരെ പരിശോധിച്ചിട്ടില്ല. ഫോൺ വഴി ബുക്ക് ചെയ്യുന്നതിന് മുമ്പ് ആപ്പിൽ പരിശോധന പൂർത്തിയാക്കുക. നന്ദി.',
    noCrops: 'നിലവിൽ ഒരു വിളയും സംഭരണത്തിനായി തുറന്നിട്ടില്ല. ദയവായി പിന്നീട് ശ്രമിക്കുക. നന്ദി.',
    noCentres:
      'ക്ഷമിക്കണം, ഈ വിളയ്ക്ക് നിലവിൽ ഒഴിവുള്ള കേന്ദ്രങ്ങളില്ല. പിന്നീട് ശ്രമിക്കുക അല്ലെങ്കിൽ ആപ്പ് വഴി ബുക്ക് ചെയ്യുക. നന്ദി.',
    noDates: (centre) => `ക്ഷമിക്കണം, ${centre} ൽ ഇപ്പോൾ തീയതികളൊന്നും ഇല്ല. പിന്നീട് ശ്രമിക്കുക. നന്ദി.`,
    noSlots: 'ക്ഷമിക്കണം, ആ തീയതിയിൽ ഇനി സ്ലോട്ടുകൾ ഇല്ല. ദയവായി വീണ്ടും വിളിക്കുക. നന്ദി.',
    genericBookingError: 'നിങ്ങളുടെ ബുക്കിംഗ് ഉണ്ടാക്കുന്നതിനിടെ എന്തോ പിഴവ് സംഭവിച്ചു. ദയവായി വീണ്ടും ശ്രമിക്കുക അല്ലെങ്കിൽ ആപ്പ് ഉപയോഗിക്കുക.',
    moreOptions: (total) => `${total} ൽ 9 കാണിക്കുന്നു. ബാക്കിയുള്ളവ ആപ്പിൽ മാത്രം.`,
  },
};

export function phrasesFor(language: Language): IvrPhrases {
  return PHRASES[language];
}

/** "Press 1 for Rice. Press 2 for Wheat. ..." (or the equivalent phrase
 *  order in the given language) — capped at 9, one DTMF digit each. */
export function menuPrompt(language: Language, intro: string, items: string[]): string {
  const p = phrasesFor(language);
  const options = items
    .slice(0, 9)
    .map((label, index) => p.pressFor(index + 1, label))
    .join(' ');
  // A caller with a 10th+ option is told more exist rather than the menu
  // just silently stopping at 9 (one DTMF digit per option is the ceiling).
  const truncationNote = items.length > 9 ? ` ${p.moreOptions(items.length)}` : '';
  return `${intro} ${options}${truncationNote}`;
}

export { ALL_STORAGE_DURATION_BANDS, ALL_STORAGE_TYPES };
