import type { SupabaseClient } from '@supabase/supabase-js';
import { isEditable } from '@kisansetu/shared';
import type { LandHolding } from '@kisansetu/shared';
import { conflict, notFound } from '../../lib/errors.js';
import { findFarmerProfile } from '../../repositories/farmersRepository.js';
import {
  deleteLandHolding,
  insertLandHolding,
  listLandHoldings,
  updateLandHolding,
} from '../../repositories/landRepository.js';
import type { LandHoldingInput } from '../../repositories/landRepository.js';

/**
 * Land holdings (§13).
 *
 * Note what this service does NOT do: it never sets verificationStatus.
 * Declaring land and having land verified are different things (§14), and the
 * database pins that column for farmer writers regardless.
 */

async function assertEditable(db: SupabaseClient, userId: string): Promise<void> {
  const farmer = await findFarmerProfile(db, userId);
  if (!farmer) throw notFound('Registration has not been started for this account.');

  if (!isEditable(farmer.registrationStatus)) {
    throw conflict('Your registration is being reviewed and cannot be changed right now.');
  }
}

export async function listOwnLandHoldings(
  db: SupabaseClient,
  userId: string,
): Promise<LandHolding[]> {
  return listLandHoldings(db, userId);
}

export async function addLandHolding(
  db: SupabaseClient,
  userId: string,
  input: LandHoldingInput,
): Promise<LandHolding> {
  await assertEditable(db, userId);
  return insertLandHolding(db, userId, input);
}

export async function editLandHolding(
  db: SupabaseClient,
  userId: string,
  holdingId: string,
  input: Partial<LandHoldingInput>,
): Promise<LandHolding> {
  await assertEditable(db, userId);

  // The update runs under RLS, so a holding belonging to another farmer simply
  // does not match and comes back null — indistinguishable from "no such id",
  // which is the correct amount to disclose.
  const updated = await updateLandHolding(db, holdingId, input);
  if (!updated) throw notFound('Land details not found.');

  return updated;
}

export async function removeLandHolding(
  db: SupabaseClient,
  userId: string,
  holdingId: string,
): Promise<void> {
  await assertEditable(db, userId);

  const removed = await deleteLandHolding(db, holdingId);
  if (!removed) throw notFound('Land details not found.');
}
