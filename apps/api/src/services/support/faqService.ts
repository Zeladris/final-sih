import type { SupabaseClient } from '@supabase/supabase-js';
import type { FaqItem, SupportScopeType } from '@kisansetu/shared';
import { notFound } from '../../lib/errors.js';
import { unwrap, unwrapMaybe } from '../../repositories/postgrestError.js';
import type { AuthContext } from '../../types/request.js';

/** FAQs (§33–§37) — short, scoped, multilingual. */

const FAQ_SELECT =
  'id, category, question_en, question_ta, question_kn, question_hi, question_ml, ' +
  'answer_en, answer_ta, answer_kn, answer_hi, answer_ml, scope_type, state_id, district_id, sort_order, is_active';

interface FaqRow {
  id: string;
  category: string;
  question_en: string;
  question_ta: string | null;
  question_kn: string | null;
  question_hi: string | null;
  question_ml: string | null;
  answer_en: string;
  answer_ta: string | null;
  answer_kn: string | null;
  answer_hi: string | null;
  answer_ml: string | null;
  scope_type: SupportScopeType;
  state_id: string | null;
  district_id: string | null;
  sort_order: number;
  is_active: boolean;
}

function toFaqItem(row: FaqRow): FaqItem {
  return {
    id: row.id,
    category: row.category,
    question: { en: row.question_en, ta: row.question_ta, kn: row.question_kn, hi: row.question_hi, ml: row.question_ml },
    answer: { en: row.answer_en, ta: row.answer_ta, kn: row.answer_kn, hi: row.answer_hi, ml: row.answer_ml },
    sortOrder: row.sort_order,
  };
}

export async function listFaqs(auth: AuthContext, category?: string): Promise<FaqItem[]> {
  const { db, scope } = auth;
  const orClauses = ['scope_type.eq.NATIONAL'];
  if (scope.stateId) orClauses.push(`and(scope_type.eq.STATE,state_id.eq.${scope.stateId})`);
  if (scope.districtId) orClauses.push(`and(scope_type.eq.DISTRICT,district_id.eq.${scope.districtId})`);

  let query = db.from('support_faqs').select(FAQ_SELECT).eq('is_active', true).or(orClauses.join(','));
  if (category) query = query.eq('category', category);

  const rows = unwrap<FaqRow[]>(
    await query.order('sort_order', { ascending: true }),
    'supportFaqs.list',
  );
  return rows.map(toFaqItem);
}

export async function listGovernmentFaqs(db: SupabaseClient): Promise<FaqItem[]> {
  const rows = unwrap<FaqRow[]>(
    await db.from('support_faqs').select(FAQ_SELECT).order('sort_order', { ascending: true }),
    'supportFaqs.listGovernment',
  );
  return rows.map(toFaqItem);
}

export interface CreateFaqInput {
  category: string;
  questionEn: string;
  questionTa?: string | null;
  questionKn?: string | null;
  questionHi?: string | null;
  questionMl?: string | null;
  answerEn: string;
  answerTa?: string | null;
  answerKn?: string | null;
  answerHi?: string | null;
  answerMl?: string | null;
  scopeType?: SupportScopeType;
  stateId?: string | null;
  districtId?: string | null;
  sortOrder?: number;
}

export async function createFaq(auth: AuthContext, input: CreateFaqInput): Promise<FaqItem> {
  const row = unwrapMaybe<FaqRow>(
    await auth.db
      .from('support_faqs')
      .insert({
        category: input.category,
        question_en: input.questionEn.trim(),
        question_ta: input.questionTa ?? null,
        question_kn: input.questionKn ?? null,
        question_hi: input.questionHi ?? null,
        question_ml: input.questionMl ?? null,
        answer_en: input.answerEn.trim(),
        answer_ta: input.answerTa ?? null,
        answer_kn: input.answerKn ?? null,
        answer_hi: input.answerHi ?? null,
        answer_ml: input.answerMl ?? null,
        scope_type: input.scopeType ?? 'NATIONAL',
        state_id: input.stateId ?? null,
        district_id: input.districtId ?? null,
        sort_order: input.sortOrder ?? 0,
        created_by: auth.userId,
        updated_by: auth.userId,
      })
      .select(FAQ_SELECT)
      .single(),
    'supportFaqs.insert',
  );
  if (!row) throw notFound('Could not create that FAQ.');
  return toFaqItem(row);
}

export async function updateFaq(
  auth: AuthContext,
  id: string,
  input: Partial<CreateFaqInput> & { isActive?: boolean },
): Promise<FaqItem> {
  const patch: Record<string, unknown> = { updated_by: auth.userId };
  const assign = (key: keyof CreateFaqInput, column: string) => {
    if (input[key] !== undefined) patch[column] = input[key];
  };
  assign('category', 'category');
  assign('questionEn', 'question_en');
  assign('questionTa', 'question_ta');
  assign('questionKn', 'question_kn');
  assign('questionHi', 'question_hi');
  assign('questionMl', 'question_ml');
  assign('answerEn', 'answer_en');
  assign('answerTa', 'answer_ta');
  assign('answerKn', 'answer_kn');
  assign('answerHi', 'answer_hi');
  assign('answerMl', 'answer_ml');
  assign('scopeType', 'scope_type');
  assign('stateId', 'state_id');
  assign('districtId', 'district_id');
  assign('sortOrder', 'sort_order');
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  const row = unwrapMaybe<FaqRow>(
    await auth.db.from('support_faqs').update(patch).eq('id', id).select(FAQ_SELECT).single(),
    'supportFaqs.update',
  );
  if (!row) throw notFound('That FAQ could not be found.');
  return toFaqItem(row);
}
