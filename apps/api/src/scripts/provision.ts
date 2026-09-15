/**
 * Provisioning CLI for government roles (§40, Step 9).
 *
 * Usage:
 *   npm run provision -w @kisansetu/api -- \
 *     --role CENTRE_STAFF --phone +919876543210 --name "R Subramanian" \
 *     --centre TNJ-PPC-01 --employee-id EMP-TNJ-0007 [--designation "Officer"]
 *
 *   npm run provision -w @kisansetu/api -- \
 *     --role DISTRICT_ADMIN --phone +919876543211 --name "A Venkatesan" \
 *     --district TNJ --employee-id EMP-DAD-0007
 *
 *   npm run provision -w @kisansetu/api -- \
 *     --role STATE_ADMIN --phone +919876543212 --name "M Sundaram" \
 *     --state TN --employee-id EMP-SAD-0007
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY, i.e. an operator with database access —
 * which is exactly the point. There is no HTTP endpoint that does this.
 */
import { ROLES } from '@kisansetu/shared';
import type { Role } from '@kisansetu/shared';
import { supabaseAdminClient } from '../lib/supabaseAdmin.js';
import { logger, maskPhone } from '../lib/logger.js';
import { provisionAccount } from '../services/provisioning/provisioningService.js';
import type { ScopeAssignment } from '../services/provisioning/provisioningService.js';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function required(args: Record<string, string>, key: string): string {
  const value = args[key];
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

async function lookupId(
  table: 'procurement_centres' | 'districts' | 'states',
  code: string,
): Promise<string> {
  const { data, error } = await supabaseAdminClient
    .from(table)
    .select('id')
    .eq('code', code)
    .maybeSingle();

  if (error) throw new Error(`Lookup failed for ${table} ${code}: ${error.message}`);
  if (!data) throw new Error(`No ${table} found with code "${code}".`);
  return data.id as string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const role = required(args, 'role') as Role;
  if (!Object.values(ROLES).includes(role)) {
    throw new Error(`--role must be one of ${Object.values(ROLES).join(', ')}`);
  }
  if (role === ROLES.FARMER) {
    throw new Error('Farmers self-register through the app; provisioning is for government roles.');
  }

  const phone = required(args, 'phone');
  if (!/^\+91[6-9]\d{9}$/.test(phone)) {
    throw new Error('--phone must be an Indian mobile number in E.164, e.g. +919876543210');
  }

  const fullName = required(args, 'name');
  const employeeReferenceId = required(args, 'employee-id');

  let scope: ScopeAssignment;
  switch (role) {
    case ROLES.CENTRE_STAFF:
      scope = {
        kind: 'centre',
        centreId: await lookupId('procurement_centres', required(args, 'centre')),
        employeeReferenceId,
        designation: args.designation ?? 'Procurement Assistant',
      };
      break;
    case ROLES.DISTRICT_ADMIN:
      scope = {
        kind: 'district',
        districtId: await lookupId('districts', required(args, 'district')),
        employeeReferenceId,
      };
      break;
    case ROLES.STATE_ADMIN:
      scope = {
        kind: 'state',
        stateId: await lookupId('states', required(args, 'state')),
        employeeReferenceId,
      };
      break;
    default:
      throw new Error(`Unsupported role ${role}`);
  }

  const userId = await provisionAccount({ phone, role, fullName }, scope);

  process.stdout.write(
    `\nProvisioned ${role} ${fullName} (${maskPhone(phone)})\n  user id: ${userId}\n\n` +
      'They sign in on the normal sign-in page with a phone OTP sent by SMS; their\n' +
      'role and scope come from the rows just written. The Supabase project needs a\n' +
      'working SMS provider for that code to arrive.\n\n',
  );
}

main().catch((error: unknown) => {
  logger.error('provisioning failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
