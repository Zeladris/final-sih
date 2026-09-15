import type { SupabaseClient } from '@supabase/supabase-js';
import type { CreateSchemeRequest, SchemeDetail, SchemeLevel, SchemeListItem, SchemeStatus } from '@kisansetu/shared';
import { conflict, notFound } from '../../lib/errors.js';
import { sanitizeSearchTerm } from '../../lib/textSearch.js';
import { unwrap, unwrapMaybe } from '../../repositories/postgrestError.js';
import { findFarmerProfile } from '../../repositories/farmersRepository.js';
import type { AuthContext } from '../../types/request.js';

/**
 * Government schemes (§23–§32).
 *
 * §29's relevance ranking is deliberately plain: a small set of boolean
 * matches against the farmer's own profile, summed. No model, no service
 * call, and the reasons returned are literal ("Matches your state") so a
 * farmer can see exactly why something was ranked above another — this is
 * "informational relevance," never an eligibility decision (§28).
 */

const SCHEME_LIST_SELECT =
  'id, scheme_code, name_en, name_ta, name_kn, name_hi, name_ml, ' +
  'short_description_en, short_description_ta, short_description_kn, short_description_hi, short_description_ml, ' +
  'authority_name, category, level, state_id, district_id, relevant_crop_codes, status';

const SCHEME_DETAIL_SELECT =
  `${SCHEME_LIST_SELECT}, ` +
  'department_name, description_en, description_ta, description_kn, description_hi, description_ml, ' +
  'benefit_summary_en, benefit_summary_ta, benefit_summary_kn, benefit_summary_hi, benefit_summary_ml, ' +
  'eligibility_summary_en, eligibility_summary_ta, eligibility_summary_kn, eligibility_summary_hi, eligibility_summary_ml, ' +
  'documents_summary_en, documents_summary_ta, documents_summary_kn, documents_summary_hi, documents_summary_ml, ' +
  'application_method_en, application_method_ta, application_method_kn, application_method_hi, application_method_ml, ' +
  'official_url, source_reference, last_verified_at, valid_from, valid_until';

interface SchemeListRow {
  id: string;
  scheme_code: string | null;
  name_en: string;
  name_ta: string | null;
  name_kn: string | null;
  name_hi: string | null;
  name_ml: string | null;
  short_description_en: string | null;
  short_description_ta: string | null;
  short_description_kn: string | null;
  short_description_hi: string | null;
  short_description_ml: string | null;
  authority_name: string;
  category: string;
  level: SchemeLevel;
  state_id: string | null;
  district_id: string | null;
  relevant_crop_codes: string[];
  status: SchemeStatus;
}

interface SchemeDetailRow extends SchemeListRow {
  department_name: string | null;
  description_en: string | null;
  description_ta: string | null;
  description_kn: string | null;
  description_hi: string | null;
  description_ml: string | null;
  benefit_summary_en: string | null;
  benefit_summary_ta: string | null;
  benefit_summary_kn: string | null;
  benefit_summary_hi: string | null;
  benefit_summary_ml: string | null;
  eligibility_summary_en: string | null;
  eligibility_summary_ta: string | null;
  eligibility_summary_kn: string | null;
  eligibility_summary_hi: string | null;
  eligibility_summary_ml: string | null;
  documents_summary_en: string | null;
  documents_summary_ta: string | null;
  documents_summary_kn: string | null;
  documents_summary_hi: string | null;
  documents_summary_ml: string | null;
  application_method_en: string | null;
  application_method_ta: string | null;
  application_method_kn: string | null;
  application_method_hi: string | null;
  application_method_ml: string | null;
  official_url: string | null;
  source_reference: string;
  last_verified_at: string | null;
  valid_from: string | null;
  valid_until: string | null;
}

interface RelevanceContext {
  stateId: string | null;
  districtId: string | null;
  cropCodes: Set<string>;
  savedCategories: Set<string>;
}

/** Every reason string is a plain fact about the match, never a claim of
 *  eligibility — "Matches your district" is true regardless of whether the
 *  farmer actually qualifies for the scheme (§28). */
function relevanceFor(row: SchemeListRow, ctx: RelevanceContext | null): string[] {
  if (!ctx) return [];
  const reasons: string[] = [];
  if (row.level === 'NATIONAL') reasons.push('Available nationwide');
  if (row.level === 'STATE' && row.state_id && row.state_id === ctx.stateId) reasons.push('Matches your state');
  if (row.level === 'DISTRICT' && row.district_id && row.district_id === ctx.districtId) {
    reasons.push('Matches your district');
  }
  if (row.relevant_crop_codes.some((code) => ctx.cropCodes.has(code.trim().toUpperCase()))) {
    reasons.push('Matches a crop you grow');
  }
  if (ctx.savedCategories.has(row.category)) reasons.push('Similar to schemes you saved');
  return reasons;
}

function relevanceScore(reasons: string[]): number {
  return reasons.length;
}

function toListItem(row: SchemeListRow, reasons: string[], savedIds: Set<string>): SchemeListItem {
  const hasShortDescription =
    row.short_description_en || row.short_description_ta || row.short_description_kn || row.short_description_hi || row.short_description_ml;
  return {
    id: row.id,
    schemeCode: row.scheme_code,
    name: { en: row.name_en, ta: row.name_ta, kn: row.name_kn, hi: row.name_hi, ml: row.name_ml },
    shortDescription: hasShortDescription
      ? {
          en: row.short_description_en ?? '',
          ta: row.short_description_ta,
          kn: row.short_description_kn,
          hi: row.short_description_hi,
          ml: row.short_description_ml,
        }
      : null,
    authorityName: row.authority_name,
    category: row.category,
    level: row.level,
    relevanceReasons: reasons,
    isSaved: savedIds.has(row.id),
  };
}

async function buildRelevanceContext(db: SupabaseClient, auth: AuthContext): Promise<RelevanceContext | null> {
  if (auth.role !== 'FARMER') return null;
  const farmer = await findFarmerProfile(db, auth.userId);
  if (!farmer) return null;

  const [landRows, savedRows] = await Promise.all([
    unwrap<Array<{ primary_crop: string | null }>>(
      await db.from('farmer_land_holdings').select('primary_crop').eq('farmer_user_id', auth.userId),
      'farmerLandHoldings.forRelevance',
    ),
    unwrap<Array<{ scheme_id: string; government_schemes: { category: string } | null }>>(
      await db
        .from('farmer_saved_schemes')
        .select('scheme_id, government_schemes(category)')
        .eq('farmer_user_id', auth.userId),
      'farmerSavedSchemes.forRelevance',
    ),
  ]);

  return {
    stateId: farmer.stateId,
    districtId: farmer.districtId,
    cropCodes: new Set(
      landRows.map((r) => r.primary_crop?.trim().toUpperCase()).filter((c): c is string => Boolean(c)),
    ),
    savedCategories: new Set(
      savedRows.map((r) => r.government_schemes?.category).filter((c): c is string => Boolean(c)),
    ),
  };
}

export interface SchemeFilters {
  category?: string;
  search?: string;
  savedOnly?: boolean;
}

export async function listSchemes(auth: AuthContext, filters: SchemeFilters): Promise<SchemeListItem[]> {
  const { db } = auth;

  const savedRows = unwrap<Array<{ scheme_id: string }>>(
    auth.role === 'FARMER'
      ? await db.from('farmer_saved_schemes').select('scheme_id').eq('farmer_user_id', auth.userId)
      : { data: [], error: null },
    'farmerSavedSchemes.listIds',
  );
  const savedIds = new Set(savedRows.map((r) => r.scheme_id));

  let query = db.from('government_schemes').select(SCHEME_LIST_SELECT).eq('status', 'PUBLISHED');
  if (filters.category) query = query.eq('category', filters.category);
  const search = filters.search ? sanitizeSearchTerm(filters.search) : '';
  if (search) query = query.ilike('name_en', `%${search}%`);
  if (filters.savedOnly) query = query.in('id', [...savedIds]);

  const rows = unwrap<SchemeListRow[]>(await query.limit(200), 'governmentSchemes.list');
  const ctx = await buildRelevanceContext(db, auth);

  const withRelevance = rows.map((row) => ({ row, reasons: relevanceFor(row, ctx) }));
  withRelevance.sort((a, b) => relevanceScore(b.reasons) - relevanceScore(a.reasons));

  return withRelevance.map(({ row, reasons }) => toListItem(row, reasons, savedIds));
}

/** The workspace list needs `status` (DRAFT/PUBLISHED/ARCHIVED) to drive the
 *  publish/archive actions — SchemeListItem omits it (a farmer never sees a
 *  draft), so this returns the full SchemeDetail shape instead. */
export async function listGovernmentSchemes(db: SupabaseClient): Promise<SchemeDetail[]> {
  const rows = unwrap<SchemeDetailRow[]>(
    await db.from('government_schemes').select(SCHEME_DETAIL_SELECT).order('created_at', { ascending: false }),
    'governmentSchemes.listAll',
  );
  return rows.map((row) => toDetail(row, [], new Set()));
}

function toDetail(row: SchemeDetailRow, reasons: string[], savedIds: Set<string>): SchemeDetail {
  const localized = (en: string | null, ta: string | null, kn: string | null, hi: string | null, ml: string | null) =>
    en || ta || kn || hi || ml ? { en: en ?? '', ta, kn, hi, ml } : null;

  return {
    ...toListItem(row, reasons, savedIds),
    description: localized(row.description_en, row.description_ta, row.description_kn, row.description_hi, row.description_ml),
    departmentName: row.department_name,
    benefitSummary: localized(
      row.benefit_summary_en, row.benefit_summary_ta, row.benefit_summary_kn, row.benefit_summary_hi, row.benefit_summary_ml,
    ),
    eligibilitySummary: localized(
      row.eligibility_summary_en, row.eligibility_summary_ta, row.eligibility_summary_kn, row.eligibility_summary_hi, row.eligibility_summary_ml,
    ),
    documentsSummary: localized(
      row.documents_summary_en, row.documents_summary_ta, row.documents_summary_kn, row.documents_summary_hi, row.documents_summary_ml,
    ),
    applicationMethod: localized(
      row.application_method_en, row.application_method_ta, row.application_method_kn, row.application_method_hi, row.application_method_ml,
    ),
    officialUrl: row.official_url,
    sourceReference: row.source_reference,
    lastVerifiedAt: row.last_verified_at,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    status: row.status,
  };
}

export async function getSchemeDetail(auth: AuthContext, id: string): Promise<SchemeDetail> {
  const row = unwrapMaybe<SchemeDetailRow>(
    await auth.db.from('government_schemes').select(SCHEME_DETAIL_SELECT).eq('id', id).maybeSingle(),
    'governmentSchemes.findById',
  );
  if (!row) throw notFound('That scheme could not be found.');

  const ctx = await buildRelevanceContext(auth.db, auth);
  const savedIds =
    auth.role === 'FARMER'
      ? new Set(
          unwrap<Array<{ scheme_id: string }>>(
            await auth.db.from('farmer_saved_schemes').select('scheme_id').eq('farmer_user_id', auth.userId),
            'farmerSavedSchemes.forDetail',
          ).map((r) => r.scheme_id),
        )
      : new Set<string>();

  return toDetail(row, relevanceFor(row, ctx), savedIds);
}

export async function createScheme(auth: AuthContext, input: CreateSchemeRequest): Promise<SchemeDetail> {
  const row = unwrapMaybe<SchemeDetailRow>(
    await auth.db
      .from('government_schemes')
      .insert({
        scheme_code: input.schemeCode ?? null,
        name_en: input.nameEn.trim(),
        name_ta: input.nameTa ?? null,
        name_kn: input.nameKn ?? null,
        name_hi: input.nameHi ?? null,
        name_ml: input.nameMl ?? null,
        short_description_en: input.shortDescriptionEn ?? null,
        description_en: input.descriptionEn ?? null,
        authority_name: input.authorityName.trim(),
        department_name: input.departmentName ?? null,
        level: input.level,
        state_id: input.stateId ?? null,
        district_id: input.districtId ?? null,
        category: input.category,
        benefit_summary_en: input.benefitSummaryEn ?? null,
        eligibility_summary_en: input.eligibilitySummaryEn ?? null,
        documents_summary_en: input.documentsSummaryEn ?? null,
        application_method_en: input.applicationMethodEn ?? null,
        relevant_crop_codes: input.relevantCropCodes ?? [],
        official_url: input.officialUrl ?? null,
        source_reference: input.sourceReference.trim(),
        valid_from: input.validFrom ?? null,
        valid_until: input.validUntil ?? null,
        created_by: auth.userId,
        updated_by: auth.userId,
      })
      .select(SCHEME_DETAIL_SELECT)
      .single(),
    'governmentSchemes.insert',
  );
  if (!row) throw notFound('Could not create that scheme.');
  return toDetail(row, [], new Set());
}

export async function updateScheme(
  auth: AuthContext,
  id: string,
  input: Partial<CreateSchemeRequest>,
): Promise<SchemeDetail> {
  const patch: Record<string, unknown> = { updated_by: auth.userId };
  const assign = (key: keyof CreateSchemeRequest, column: string) => {
    if (input[key] !== undefined) patch[column] = input[key];
  };
  assign('schemeCode', 'scheme_code');
  assign('nameEn', 'name_en');
  assign('nameTa', 'name_ta');
  assign('nameKn', 'name_kn');
  assign('nameHi', 'name_hi');
  assign('nameMl', 'name_ml');
  assign('shortDescriptionEn', 'short_description_en');
  assign('descriptionEn', 'description_en');
  assign('authorityName', 'authority_name');
  assign('departmentName', 'department_name');
  assign('level', 'level');
  assign('stateId', 'state_id');
  assign('districtId', 'district_id');
  assign('category', 'category');
  assign('benefitSummaryEn', 'benefit_summary_en');
  assign('eligibilitySummaryEn', 'eligibility_summary_en');
  assign('documentsSummaryEn', 'documents_summary_en');
  assign('applicationMethodEn', 'application_method_en');
  assign('relevantCropCodes', 'relevant_crop_codes');
  assign('officialUrl', 'official_url');
  assign('sourceReference', 'source_reference');
  assign('validFrom', 'valid_from');
  assign('validUntil', 'valid_until');

  const row = unwrapMaybe<SchemeDetailRow>(
    await auth.db.from('government_schemes').update(patch).eq('id', id).select(SCHEME_DETAIL_SELECT).single(),
    'governmentSchemes.update',
  );
  if (!row) throw notFound('That scheme could not be found.');
  return toDetail(row, [], new Set());
}

async function setStatus(auth: AuthContext, id: string, status: SchemeStatus): Promise<SchemeDetail> {
  const row = unwrapMaybe<SchemeDetailRow>(
    await auth.db
      .from('government_schemes')
      .update({ status, updated_by: auth.userId })
      .eq('id', id)
      .select(SCHEME_DETAIL_SELECT)
      .single(),
    'governmentSchemes.setStatus',
  );
  if (!row) throw notFound('That scheme could not be found.');
  return toDetail(row, [], new Set());
}

export const publishScheme = (auth: AuthContext, id: string) => setStatus(auth, id, 'PUBLISHED');
export const archiveScheme = (auth: AuthContext, id: string) => setStatus(auth, id, 'ARCHIVED');

export async function saveScheme(auth: AuthContext, schemeId: string): Promise<void> {
  const { error } = await auth.db
    .from('farmer_saved_schemes')
    .insert({ farmer_user_id: auth.userId, scheme_id: schemeId });
  if (error && error.code !== '23505') {
    throw conflict('Could not save that scheme.', { schemeId, reason: error.message });
  }
}

export async function unsaveScheme(auth: AuthContext, schemeId: string): Promise<void> {
  unwrap(
    await auth.db
      .from('farmer_saved_schemes')
      .delete()
      .eq('farmer_user_id', auth.userId)
      .eq('scheme_id', schemeId)
      .select('scheme_id'),
    'farmerSavedSchemes.delete',
  );
}

export async function listSavedSchemes(auth: AuthContext): Promise<SchemeListItem[]> {
  return listSchemes(auth, { savedOnly: true });
}
