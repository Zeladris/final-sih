import type { Role } from '@kisansetu/shared';

/**
 * The demo dataset's shape (§ user request "DEMO HIERARCHY").
 *
 *   2 states → 2 districts each → 3 centres each → 2 staff each
 *   1 district admin per district, 1 state admin per state
 *   5 farmers per district
 *
 * Everything here is DATA, not authentication. Seeding calls the same
 * `provisionAccount` used by `npm run provision` for staff/admins, and the
 * same farmer-registration writes a real self-registration produces. No phone
 * number is ever compared to decide a role — the role sits on the profile row
 * exactly as it would for a real account.
 *
 * Phone numbers use a fixed, clearly-fake block (+91 79 …) chosen to be
 * disjoint from both real Indian numbers users might dial by habit and the
 * retired prototype's +91 90000 000xx block. They are DEMO identities, not
 * production credentials: on a project with no SMS provider they only work at
 * all via Supabase's local test-number feature or a deliberately configured
 * "Test phone numbers" list — this file does not configure either.
 */

export interface DemoCentre {
  code: string;
  name: string;
  village: string;
  addressLine1: string;
  pincode: string;
  latitude: number;
  longitude: number;
  openTime: string;
  closeTime: string;
  dailyCapacityQtl: number;
}

export interface DemoDistrict {
  code: string;
  name: string;
  admin: DemoPerson;
  centres: DemoCentre[];
  farmers: DemoFarmer[];
}

export interface DemoState {
  code: string;
  name: string;
  admin: DemoPerson;
  districts: DemoDistrict[];
}

export interface DemoPerson {
  phone: string;
  fullName: string;
  employeeReferenceId: string;
  preferredLanguage?: 'en' | 'ta';
}

export interface DemoStaff extends DemoPerson {
  centreCode: string;
  designation: string;
}

/** One of the six registration_status values a demo farmer can be seeded at. */
export type DemoFarmerStory =
  | 'VERIFIED_HISTORY' // verified; has one completed, paid procurement (history/analytics demo)
  | 'VERIFIED_LIVE' // verified; has a booking mid-workflow, waiting in the queue right now
  | 'UNDER_REVIEW' // submitted and claimed by a named staff member — resume review live
  | 'SUBMITTED' // submitted, unclaimed — sits in the queue for a staff member to claim
  | 'DRAFT' // started registration and stopped partway — resume flow
  | 'REJECTED' // reviewed and rejected, with a reason
  | 'RESUBMISSION_REQUIRED'; // reviewed, sent back for correction

export interface DemoFarmer extends DemoPerson {
  story: DemoFarmerStory;
  gender: 'MALE' | 'FEMALE';
  dateOfBirth: string;
  village: string;
  pincode: string;
  landAcres: number;
  primaryCrop: string;
}

const TIME_WINDOWS: Array<{ start: string; end: string; capacity: number }> = [
  { start: '08:00', end: '10:00', capacity: 25 },
  { start: '10:00', end: '12:00', capacity: 25 },
  { start: '13:00', end: '15:00', capacity: 20 },
];
export const DEMO_SLOT_WINDOWS = TIME_WINDOWS;
export const DEMO_SLOT_DAYS_AHEAD = 5;

/**
 * +91 79 <role:2 digits> <sequence:6 digits> — 10 digits after +91, first
 * digit 7 (valid E.164-shaped Indian mobile), distinct 2-digit block per
 * role so numbers never collide across roles: farmers 10, staff 20, district
 * admins 30, state admins 40.
 */
function phone(rolePrefix: '10' | '20' | '30' | '40', seq: number): string {
  return `+9179${rolePrefix}${String(seq).padStart(6, '0')}`;
}

function farmer(
  seq: number,
  story: DemoFarmerStory,
  fullName: string,
  gender: 'MALE' | 'FEMALE',
  dateOfBirth: string,
  village: string,
  pincode: string,
  landAcres: number,
  primaryCrop: string,
  preferredLanguage: 'en' | 'ta' = 'en',
): DemoFarmer {
  return {
    phone: phone('10', seq),
    fullName,
    employeeReferenceId: `DEMO-FARMER-${String(seq).padStart(3, '0')}`,
    story,
    gender,
    dateOfBirth,
    village,
    pincode,
    landAcres,
    primaryCrop,
    preferredLanguage,
  };
}

let staffSeq = 0;
function staff(centreCode: string, name: string, designation: string): DemoStaff {
  staffSeq += 1;
  return {
    phone: phone('20', staffSeq),
    fullName: name,
    employeeReferenceId: `DEMO-STAFF-${String(staffSeq).padStart(3, '0')}`,
    centreCode,
    designation,
  };
}

let districtAdminSeq = 0;
function districtAdmin(name: string): DemoPerson {
  districtAdminSeq += 1;
  return {
    phone: phone('30', districtAdminSeq),
    fullName: name,
    employeeReferenceId: `DEMO-DAD-${String(districtAdminSeq).padStart(3, '0')}`,
  };
}

let stateAdminSeq = 0;
function stateAdmin(name: string): DemoPerson {
  stateAdminSeq += 1;
  return {
    phone: phone('40', stateAdminSeq),
    fullName: name,
    employeeReferenceId: `DEMO-SAD-${String(stateAdminSeq).padStart(3, '0')}`,
  };
}

/**
 * The 5-farmer roster shared by every district, with names/villages
 * substituted per district by the caller. Position in the array is what
 * decides the story: it is a fixed, documented mapping, not a random draw.
 */
function farmerRoster(
  baseSeq: number,
  districtLabel: string,
  fifth: DemoFarmerStory,
  villageA: string,
  villageB: string,
  pincodePrefix: string,
  crop: string,
  lang: 'en' | 'ta',
): DemoFarmer[] {
  const names: Array<[string, 'MALE' | 'FEMALE']> = [
    [`${districtLabel} Farmer One`, 'MALE'],
    [`${districtLabel} Farmer Two`, 'FEMALE'],
    [`${districtLabel} Farmer Three`, 'MALE'],
    [`${districtLabel} Farmer Four`, 'FEMALE'],
    [`${districtLabel} Farmer Five`, 'MALE'],
  ];

  return [
    farmer(baseSeq + 1, 'VERIFIED_HISTORY', names[0]![0], names[0]![1], '1978-04-12', villageA, `${pincodePrefix}01`, 3.5, crop, lang),
    farmer(baseSeq + 2, 'VERIFIED_LIVE', names[1]![0], names[1]![1], '1985-09-03', villageB, `${pincodePrefix}02`, 2.2, crop, lang),
    farmer(baseSeq + 3, 'UNDER_REVIEW', names[2]![0], names[2]![1], '1990-01-21', villageA, `${pincodePrefix}03`, 4.0, crop, lang),
    farmer(baseSeq + 4, 'SUBMITTED', names[3]![0], names[3]![1], '1982-11-30', villageB, `${pincodePrefix}04`, 1.8, crop, lang),
    farmer(baseSeq + 5, fifth, names[4]![0], names[4]![1], '1975-06-17', villageA, `${pincodePrefix}05`, 5.0, crop, lang),
  ];
}

export const DEMO_STATES: DemoState[] = [
  {
    code: 'TN',
    name: 'Tamil Nadu',
    admin: stateAdmin('Deepa Rajendran (Demo State Admin, Tamil Nadu)'),
    districts: [
      {
        code: 'DTNJ',
        name: 'Thanjavur',
        admin: districtAdmin('Anitha Venkatesan (Demo District Admin, Thanjavur)'),
        centres: [
          {
            code: 'DTNJ-PPC-01',
            name: 'Thanjavur Central Paddy Procurement Centre (Demo)',
            village: 'Thanjavur',
            addressLine1: 'Trichy Road, near Old Bus Stand',
            pincode: '613001',
            latitude: 10.787,
            longitude: 79.1378,
            openTime: '08:00',
            closeTime: '17:00',
            dailyCapacityQtl: 1200,
          },
          {
            code: 'DTNJ-PPC-02',
            name: 'Kumbakonam Paddy Procurement Centre (Demo)',
            village: 'Kumbakonam',
            addressLine1: 'Mannargudi Road',
            pincode: '612001',
            latitude: 10.9601,
            longitude: 79.3788,
            openTime: '08:00',
            closeTime: '17:00',
            dailyCapacityQtl: 900,
          },
          {
            code: 'DTNJ-PPC-03',
            name: 'Pattukkottai Paddy Procurement Centre (Demo)',
            village: 'Pattukkottai',
            addressLine1: 'Aranthangi Road',
            pincode: '614601',
            latitude: 10.4254,
            longitude: 79.3181,
            openTime: '08:30',
            closeTime: '16:30',
            dailyCapacityQtl: 700,
          },
        ],
        farmers: farmerRoster(0, 'Thanjavur', 'DRAFT', 'Orathanadu', 'Papanasam', '6146', 'Paddy', 'ta'),
      },
      {
        code: 'DTRY',
        name: 'Tiruchirappalli',
        admin: districtAdmin('Karthik Balasubramanian (Demo District Admin, Tiruchirappalli)'),
        centres: [
          {
            code: 'DTRY-PPC-01',
            name: 'Trichy Main Paddy Procurement Centre (Demo)',
            village: 'Tiruchirappalli',
            addressLine1: 'Salai Road, near Central Bus Stand',
            pincode: '620001',
            latitude: 10.7905,
            longitude: 78.7047,
            openTime: '08:00',
            closeTime: '17:00',
            dailyCapacityQtl: 1100,
          },
          {
            code: 'DTRY-PPC-02',
            name: 'Manapparai Paddy Procurement Centre (Demo)',
            village: 'Manapparai',
            addressLine1: 'Dindigul Road',
            pincode: '621306',
            latitude: 10.6072,
            longitude: 78.4256,
            openTime: '08:30',
            closeTime: '16:30',
            dailyCapacityQtl: 600,
          },
          {
            code: 'DTRY-PPC-03',
            name: 'Lalgudi Paddy Procurement Centre (Demo)',
            village: 'Lalgudi',
            addressLine1: 'Trichy Main Road',
            pincode: '621601',
            latitude: 10.8712,
            longitude: 78.8241,
            openTime: '08:00',
            closeTime: '17:00',
            dailyCapacityQtl: 650,
          },
        ],
        farmers: farmerRoster(5, 'Tiruchirappalli', 'REJECTED', 'Lalgudi', 'Musiri', '6216', 'Paddy', 'ta'),
      },
    ],
  },
  {
    code: 'KA',
    name: 'Karnataka',
    admin: stateAdmin('Manjunath Gowda (Demo State Admin, Karnataka)'),
    districts: [
      {
        code: 'DBLR',
        name: 'Bengaluru Urban',
        admin: districtAdmin('Lakshmi Narasimhan (Demo District Admin, Bengaluru Urban)'),
        centres: [
          {
            code: 'DBLR-PPC-01',
            name: 'Yelahanka Procurement Centre (Demo)',
            village: 'Yelahanka',
            addressLine1: 'Doddaballapur Road',
            pincode: '560064',
            latitude: 13.1007,
            longitude: 77.5963,
            openTime: '08:00',
            closeTime: '17:00',
            dailyCapacityQtl: 800,
          },
          {
            code: 'DBLR-PPC-02',
            name: 'Anekal Procurement Centre (Demo)',
            village: 'Anekal',
            addressLine1: 'Bengaluru-Hosur Road',
            pincode: '562106',
            latitude: 12.7106,
            longitude: 77.6955,
            openTime: '08:30',
            closeTime: '16:30',
            dailyCapacityQtl: 550,
          },
          {
            code: 'DBLR-PPC-03',
            name: 'Hoskote Procurement Centre (Demo)',
            village: 'Hoskote',
            addressLine1: 'Old Madras Road',
            pincode: '562114',
            latitude: 13.0707,
            longitude: 77.7986,
            openTime: '08:00',
            closeTime: '17:00',
            dailyCapacityQtl: 600,
          },
        ],
        farmers: farmerRoster(10, 'Bengaluru', 'DRAFT', 'Hoskote', 'Anekal', '5620', 'Maize', 'en'),
      },
      {
        code: 'DMYS',
        name: 'Mysuru',
        admin: districtAdmin('Prakash Hegde (Demo District Admin, Mysuru)'),
        centres: [
          {
            code: 'DMYS-PPC-01',
            name: 'Mysuru Central Procurement Centre (Demo)',
            village: 'Mysuru',
            addressLine1: 'Bannur Road',
            pincode: '570001',
            latitude: 12.2958,
            longitude: 76.6394,
            openTime: '08:00',
            closeTime: '17:00',
            dailyCapacityQtl: 950,
          },
          {
            code: 'DMYS-PPC-02',
            name: 'Nanjangud Procurement Centre (Demo)',
            village: 'Nanjangud',
            addressLine1: 'Ooty Road',
            pincode: '571301',
            latitude: 12.1204,
            longitude: 76.6816,
            openTime: '08:30',
            closeTime: '16:30',
            dailyCapacityQtl: 500,
          },
          {
            code: 'DMYS-PPC-03',
            name: 'T. Narasipura Procurement Centre (Demo)',
            village: 'Tirumakudal Narasipura',
            addressLine1: 'Mysuru-Talakadu Road',
            pincode: '571124',
            latitude: 12.2185,
            longitude: 76.9022,
            openTime: '08:00',
            closeTime: '17:00',
            dailyCapacityQtl: 550,
          },
        ],
        farmers: farmerRoster(15, 'Mysuru', 'RESUBMISSION_REQUIRED', 'Nanjangud', 'T. Narasipura', '5713', 'Groundnut', 'en'),
      },
    ],
  },
];

/** For assertions and the CLI summary. */
export const DEMO_TOTALS = {
  states: DEMO_STATES.length,
  districts: DEMO_STATES.reduce((n, s) => n + s.districts.length, 0),
  centres: DEMO_STATES.reduce((n, s) => n + s.districts.reduce((m, d) => m + d.centres.length, 0), 0),
  staff: DEMO_STATES.reduce((n, s) => n + s.districts.reduce((m, d) => m + d.centres.length * 2, 0), 0),
  districtAdmins: DEMO_STATES.reduce((n, s) => n + s.districts.length, 0),
  stateAdmins: DEMO_STATES.length,
  farmers: DEMO_STATES.reduce((n, s) => n + s.districts.reduce((m, d) => m + d.farmers.length, 0), 0),
};

const STAFF_DESIGNATIONS = ['Procurement Assistant', 'Procurement Officer'];

/** Two staff per centre, generated from the same roster function used everywhere else. */
export function staffForCentre(centre: DemoCentre): DemoStaff[] {
  return [0, 1].map((i) =>
    staff(centre.code, `${centre.village} Staff ${i === 0 ? 'A' : 'B'} (Demo)`, STAFF_DESIGNATIONS[i]!),
  );
}

export const ROLE_LABEL_FOR_LOG: Record<Role, string> = {
  FARMER: 'farmer',
  CENTRE_STAFF: 'centre staff',
  DISTRICT_ADMIN: 'district admin',
  STATE_ADMIN: 'state admin',
};
