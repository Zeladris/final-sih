import type { SupabaseClient } from '@supabase/supabase-js';
import type { CreateHelplineRequest, HelplineEntry } from '@kisansetu/shared';
import { notFound } from '../../lib/errors.js';
import { unwrap, unwrapMaybe } from '../../repositories/postgrestError.js';
import type { AuthContext } from '../../types/request.js';

/**
 * Helpline (§16–§22) — verified official contacts only. There is no
 * fallback number anywhere in this file: an empty result means the UI shows
 * "Official contact information is not configured for this area yet," never
 * a fabricated contact (§20).
 */

const HELPLINE_SELECT =
  'id, title_en, title_ta, title_kn, title_hi, title_ml, ' +
  'description_en, description_ta, description_kn, description_hi, description_ml, ' +
  'phone_number, email, office_name, address, scope_type, state_id, district_id, centre_id, ' +
  'category, official_url, source_reference, is_active, last_verified_at';

interface HelplineRow {
  id: string;
  title_en: string;
  title_ta: string | null;
  title_kn: string | null;
  title_hi: string | null;
  title_ml: string | null;
  description_en: string | null;
  description_ta: string | null;
  description_kn: string | null;
  description_hi: string | null;
  description_ml: string | null;
  phone_number: string | null;
  email: string | null;
  office_name: string | null;
  address: string | null;
  scope_type: HelplineEntry['scopeType'];
  state_id: string | null;
  district_id: string | null;
  centre_id: string | null;
  category: string;
  official_url: string | null;
  source_reference: string | null;
  is_active: boolean;
  last_verified_at: string | null;
}

function toHelplineEntry(row: HelplineRow): HelplineEntry {
  const hasDescription = row.description_en || row.description_ta || row.description_kn || row.description_hi || row.description_ml;
  return {
    id: row.id,
    title: { en: row.title_en, ta: row.title_ta, kn: row.title_kn, hi: row.title_hi, ml: row.title_ml },
    description: hasDescription
      ? { en: row.description_en ?? '', ta: row.description_ta, kn: row.description_kn, hi: row.description_hi, ml: row.description_ml }
      : null,
    phoneNumber: row.phone_number,
    email: row.email,
    officeName: row.office_name,
    address: row.address,
    scopeType: row.scope_type,
    stateId: row.state_id,
    districtId: row.district_id,
    centreId: row.centre_id,
    category: row.category,
    officialUrl: row.official_url,
    sourceReference: row.source_reference,
    isActive: row.is_active,
    lastVerifiedAt: row.last_verified_at,
  };
}

/**
 * Every reader sees NATIONAL entries plus whichever STATE/DISTRICT/CENTRE
 * entries match their own scope — RLS already allows reading every active
 * row, so this is what keeps a Kerala farmer from seeing a Bihar district's
 * office number ahead of their own (§17, §18).
 */
export async function listHelpline(auth: AuthContext): Promise<HelplineEntry[]> {
  const { db, scope } = auth;
  const orClauses = ['scope_type.eq.NATIONAL'];
  if (scope.stateId) orClauses.push(`and(scope_type.eq.STATE,state_id.eq.${scope.stateId})`);
  if (scope.districtId) orClauses.push(`and(scope_type.eq.DISTRICT,district_id.eq.${scope.districtId})`);
  if (scope.centreId) orClauses.push(`and(scope_type.eq.CENTRE,centre_id.eq.${scope.centreId})`);

  const rows = unwrap<HelplineRow[]>(
    await db
      .from('helpline_entries')
      .select(HELPLINE_SELECT)
      .eq('is_active', true)
      .or(orClauses.join(','))
      .order('category', { ascending: true }),
    'helplineEntries.list',
  );
  return rows.map(toHelplineEntry);
}

/** The district/state admin's own workspace list — active and draft, own scope only. */
export async function listGovernmentHelpline(db: SupabaseClient): Promise<HelplineEntry[]> {
  const rows = unwrap<HelplineRow[]>(
    await db.from('helpline_entries').select(HELPLINE_SELECT).order('created_at', { ascending: false }),
    'helplineEntries.listGovernment',
  );
  return rows.map(toHelplineEntry);
}

export async function createHelpline(auth: AuthContext, input: CreateHelplineRequest): Promise<HelplineEntry> {
  const row = unwrapMaybe<HelplineRow>(
    await auth.db
      .from('helpline_entries')
      .insert({
        title_en: input.titleEn.trim(),
        title_ta: input.titleTa ?? null,
        title_kn: input.titleKn ?? null,
        title_hi: input.titleHi ?? null,
        title_ml: input.titleMl ?? null,
        description_en: input.descriptionEn ?? null,
        description_ta: input.descriptionTa ?? null,
        description_kn: input.descriptionKn ?? null,
        description_hi: input.descriptionHi ?? null,
        description_ml: input.descriptionMl ?? null,
        phone_number: input.phoneNumber ?? null,
        email: input.email ?? null,
        office_name: input.officeName ?? null,
        address: input.address ?? null,
        scope_type: input.scopeType,
        state_id: input.stateId ?? null,
        district_id: input.districtId ?? null,
        centre_id: input.centreId ?? null,
        category: input.category,
        official_url: input.officialUrl ?? null,
        source_reference: input.sourceReference ?? null,
        created_by: auth.userId,
        updated_by: auth.userId,
      })
      .select(HELPLINE_SELECT)
      .single(),
    'helplineEntries.insert',
  );
  if (!row) throw notFound('Could not create that helpline entry.');
  return toHelplineEntry(row);
}

export async function updateHelpline(
  auth: AuthContext,
  id: string,
  input: Partial<CreateHelplineRequest> & { isActive?: boolean },
): Promise<HelplineEntry> {
  const patch: Record<string, unknown> = { updated_by: auth.userId };
  const assign = (key: keyof typeof input, column: string) => {
    if (input[key] !== undefined) patch[column] = input[key];
  };
  assign('titleEn', 'title_en');
  assign('titleTa', 'title_ta');
  assign('titleKn', 'title_kn');
  assign('titleHi', 'title_hi');
  assign('titleMl', 'title_ml');
  assign('descriptionEn', 'description_en');
  assign('descriptionTa', 'description_ta');
  assign('descriptionKn', 'description_kn');
  assign('descriptionHi', 'description_hi');
  assign('descriptionMl', 'description_ml');
  assign('phoneNumber', 'phone_number');
  assign('email', 'email');
  assign('officeName', 'office_name');
  assign('address', 'address');
  assign('scopeType', 'scope_type');
  assign('stateId', 'state_id');
  assign('districtId', 'district_id');
  assign('centreId', 'centre_id');
  assign('category', 'category');
  assign('officialUrl', 'official_url');
  assign('sourceReference', 'source_reference');
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  const row = unwrapMaybe<HelplineRow>(
    await auth.db.from('helpline_entries').update(patch).eq('id', id).select(HELPLINE_SELECT).single(),
    'helplineEntries.update',
  );
  if (!row) throw notFound('That helpline entry could not be found.');
  return toHelplineEntry(row);
}

/** Marks a contact as freshly confirmed — a deliberate human action, not a
 *  side effect of any other write (§19). */
export async function verifyHelpline(auth: AuthContext, id: string): Promise<HelplineEntry> {
  const row = unwrapMaybe<HelplineRow>(
    await auth.db
      .from('helpline_entries')
      .update({ last_verified_at: new Date().toISOString(), updated_by: auth.userId })
      .eq('id', id)
      .select(HELPLINE_SELECT)
      .single(),
    'helplineEntries.verify',
  );
  if (!row) throw notFound('That helpline entry could not be found.');
  return toHelplineEntry(row);
}
