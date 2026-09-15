import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  ALL_REGISTRATION_STATUSES,
  canTransition,
  isAwaitingReview,
  isEditable,
  needsFarmerAction,
  nextStep,
  previousStep,
  STEP_BY_PATH,
  STEP_PATH,
  STEP_SEQUENCE,
} from '@kisansetu/shared';
import type { RegistrationStatus } from '@kisansetu/shared';

/**
 * The state machine (§33), tested exhaustively rather than by example: every
 * one of the 36 ordered pairs is asserted, so a transition added to the table
 * without thought shows up here.
 *
 * The same table is implemented independently in SQL
 * (app.assert_registration_transition). `tests/integration/rls.test.ts` proves
 * the database agrees.
 */
describe('registration state machine', () => {
  it('allows exactly the documented transitions and no others', () => {
    const expected: Record<RegistrationStatus, RegistrationStatus[]> = {
      DRAFT: ['SUBMITTED'],
      SUBMITTED: ['UNDER_REVIEW', 'DRAFT'],
      UNDER_REVIEW: ['VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED'],
      RESUBMISSION_REQUIRED: ['DRAFT'],
      REJECTED: ['DRAFT'],
      VERIFIED: [],
    };

    for (const from of ALL_REGISTRATION_STATUSES) {
      for (const to of ALL_REGISTRATION_STATUSES) {
        expect(
          canTransition(from, to),
          `${from} -> ${to} should be ${expected[from].includes(to)}`,
        ).toBe(expected[from].includes(to));
      }
    }
  });

  it('treats VERIFIED as terminal', () => {
    expect(ALLOWED_TRANSITIONS.VERIFIED).toEqual([]);
    for (const to of ALL_REGISTRATION_STATUSES) {
      expect(canTransition('VERIFIED', to)).toBe(false);
    }
  });

  it('never allows a farmer-visible shortcut to VERIFIED', () => {
    // The only way in is UNDER_REVIEW, which only a reviewer can reach.
    const waysIn = ALL_REGISTRATION_STATUSES.filter((from) => canTransition(from, 'VERIFIED'));
    expect(waysIn).toEqual(['UNDER_REVIEW']);
  });

  it('requires a rejected registration to pass back through DRAFT', () => {
    expect(canTransition('REJECTED', 'SUBMITTED')).toBe(false);
    expect(canTransition('RESUBMISSION_REQUIRED', 'SUBMITTED')).toBe(false);
    expect(canTransition('REJECTED', 'DRAFT')).toBe(true);
    expect(canTransition('RESUBMISSION_REQUIRED', 'DRAFT')).toBe(true);
  });

  it('classifies each status as editable, awaiting review, or needing action', () => {
    expect(isEditable('DRAFT')).toBe(true);
    expect(isEditable('RESUBMISSION_REQUIRED')).toBe(true);
    expect(isEditable('REJECTED')).toBe(true);
    expect(isEditable('SUBMITTED')).toBe(false);
    expect(isEditable('UNDER_REVIEW')).toBe(false);
    expect(isEditable('VERIFIED')).toBe(false);

    expect(isAwaitingReview('SUBMITTED')).toBe(true);
    expect(isAwaitingReview('UNDER_REVIEW')).toBe(true);
    expect(isAwaitingReview('DRAFT')).toBe(false);

    expect(needsFarmerAction('REJECTED')).toBe(true);
    expect(needsFarmerAction('RESUBMISSION_REQUIRED')).toBe(true);
    expect(needsFarmerAction('UNDER_REVIEW')).toBe(false);
  });

  it('never lets a submitted registration be edited', () => {
    // The invariant §19 rests on: anything awaiting review is locked.
    for (const status of ALL_REGISTRATION_STATUSES) {
      if (isAwaitingReview(status)) expect(isEditable(status)).toBe(false);
    }
  });
});

describe('registration steps', () => {
  it('walks forward and back through the sequence', () => {
    expect(nextStep('PERSONAL_DETAILS')).toBe('ADDRESS');
    expect(nextStep('REVIEW')).toBeNull();
    expect(previousStep('ADDRESS')).toBe('PERSONAL_DETAILS');
    expect(previousStep('PERSONAL_DETAILS')).toBeNull();
  });

  it('has a unique, reversible path for every step', () => {
    const paths = STEP_SEQUENCE.map((step) => STEP_PATH[step]);
    expect(new Set(paths).size).toBe(STEP_SEQUENCE.length);

    for (const step of STEP_SEQUENCE) {
      expect(STEP_BY_PATH[STEP_PATH[step]]).toBe(step);
    }
  });
});
