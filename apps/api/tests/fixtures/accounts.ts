import type { Role } from '@kisansetu/shared';

/**
 * TEST FIXTURES — not part of the product.
 *
 * These accounts exist so the integration and RLS suites can prove scope
 * isolation, which needs several farmers, two staff in *different* centres and
 * two district admins in *different* districts. Nothing here is imported by
 * application code, and none of these numbers appears anywhere in the UI
 * (Phase 1 §2).
 *
 * They work only against LOCAL Supabase, whose `supabase/config.toml` registers
 * them as test numbers. The seeder refuses any other target unless it is a
 * disposable project explicitly named in ALLOW_REMOTE_FIXTURES — never a real
 * deployment, and never alongside real or demo users. Nothing about them
 * (numbers, OTP, role) is known to application code: their roles come from
 * the profile rows the seeder provisions, exactly like a real account.
 *
 * Seed them with: npm run seed:fixtures -w @kisansetu/api
 */

export interface FixtureAccount {
  phone: string;
  fullName: string;
  role: Role;
  /** Centre code, district code or state code depending on the role. */
  scopeCode?: string;
  employeeReferenceId?: string;
  designation?: string;
  preferredLanguage?: 'en' | 'ta';
}

export const FIXTURE_ACCOUNTS: FixtureAccount[] = [
  { phone: '+919000000001', fullName: 'Arumugam Selvaraj', role: 'FARMER', preferredLanguage: 'ta' },
  { phone: '+919000000002', fullName: 'Lakshmi Thangavel', role: 'FARMER', preferredLanguage: 'ta' },
  { phone: '+919000000003', fullName: 'Murugan Pandian', role: 'FARMER', preferredLanguage: 'ta' },
  { phone: '+919000000004', fullName: 'Kavitha Ramesh', role: 'FARMER', preferredLanguage: 'en' },
  { phone: '+919000000005', fullName: 'Senthil Kumar', role: 'FARMER', preferredLanguage: 'ta' },

  // Two staff in different centres — the point of the fixture.
  {
    phone: '+919000000011',
    fullName: 'Rajesh Subramanian',
    role: 'CENTRE_STAFF',
    scopeCode: 'TNJ-PPC-01',
    employeeReferenceId: 'EMP-TNJ-0001',
    designation: 'Procurement Assistant',
  },
  {
    phone: '+919000000012',
    fullName: 'Divya Natarajan',
    role: 'CENTRE_STAFF',
    scopeCode: 'TNJ-PPC-02',
    employeeReferenceId: 'EMP-TNJ-0002',
    designation: 'Procurement Assistant',
  },

  // Two district admins in different districts.
  {
    phone: '+919000000021',
    fullName: 'Anitha Venkatesan',
    role: 'DISTRICT_ADMIN',
    scopeCode: 'TNJ',
    employeeReferenceId: 'EMP-DAD-0001',
  },
  {
    phone: '+919000000022',
    fullName: 'Karthik Balasubramanian',
    role: 'DISTRICT_ADMIN',
    scopeCode: 'TRY',
    employeeReferenceId: 'EMP-DAD-0002',
  },

  {
    phone: '+919000000031',
    fullName: 'Meenakshi Sundaram',
    role: 'STATE_ADMIN',
    scopeCode: 'TN',
    employeeReferenceId: 'EMP-SAD-0001',
  },
];

/** Never seeded — reserved so the new-farmer flow can be tested from scratch. */
export const FIXTURE_NEW_FARMER_PHONE = '+919000000099';

/** Residence details attached to seeded farmer fixtures. */
export const FIXTURE_FARMER_DETAILS: Record<
  string,
  { village: string; districtCode: string; pincode: string; areaAcres: number; crop: string }
> = {
  '+919000000001': {
    village: 'Orathanadu',
    districtCode: 'TNJ',
    pincode: '614625',
    areaAcres: 3.5,
    crop: 'Paddy (Samba)',
  },
  '+919000000002': {
    village: 'Papanasam',
    districtCode: 'TNJ',
    pincode: '614205',
    areaAcres: 1.75,
    crop: 'Paddy (Kuruvai)',
  },
  '+919000000003': {
    village: 'Thiruvaiyaru',
    districtCode: 'TNJ',
    pincode: '613204',
    areaAcres: 6,
    crop: 'Paddy (Samba)',
  },
  '+919000000004': {
    village: 'Lalgudi',
    districtCode: 'TRY',
    pincode: '621601',
    areaAcres: 2.25,
    crop: 'Paddy (Thaladi)',
  },
  '+919000000005': {
    village: 'Musiri',
    districtCode: 'TRY',
    pincode: '621211',
    areaAcres: 4.8,
    crop: 'Paddy (Samba)',
  },
};
