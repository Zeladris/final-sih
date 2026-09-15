import { addDays } from '@kisansetu/shared';
import type { ProcurementSlot, SlotStatus } from '@kisansetu/shared';
import { conflict, forbidden, notFound, validationError } from '../../lib/errors.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import * as ops from '../../repositories/operationsRepository.js';
import { today } from './operationsService.js';
import type { AuthContext } from '../../types/request.js';

/**
 * Slot management (§12, §13).
 *
 * Staff manage slots for their own centre only — the centre comes from their
 * staff profile, so there is no centre parameter to tamper with.
 *
 * Note what is NOT here: creating a booking. Slots are the centre's
 * responsibility; booking a slot is the farmer's, and belongs to Phase 4 (§57).
 */

function centreOf(auth: AuthContext): string {
  const centreId = auth.scope.centreId;
  if (!centreId) throw forbidden('No procurement centre is assigned to this account.');
  return centreId;
}

export async function listForRange(
  auth: AuthContext,
  fromDate: string,
  toDate: string,
): Promise<ProcurementSlot[]> {
  return ops.listSlots(auth.db, centreOf(auth), fromDate, toDate);
}

/** Today, tomorrow and the following week — the operational horizon (§15). */
export async function listUpcoming(auth: AuthContext): Promise<{
  today: ProcurementSlot[];
  tomorrow: ProcurementSlot[];
  upcoming: ProcurementSlot[];
}> {
  const start = today();
  const tomorrow = addDays(start, 1);
  const horizon = addDays(start, 7);

  const all = await listForRange(auth, start, horizon);

  return {
    today: all.filter((slot) => slot.slotDate === start),
    tomorrow: all.filter((slot) => slot.slotDate === tomorrow),
    upcoming: all.filter((slot) => slot.slotDate > tomorrow),
  };
}

export interface CreateSlotInput {
  slotDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
}

export async function createSlot(
  auth: AuthContext,
  input: CreateSlotInput,
): Promise<ProcurementSlot> {
  const centreId = centreOf(auth);

  if (input.startTime >= input.endTime) {
    throw validationError('The slot must end after it starts.');
  }

  // Creating a slot in the past cannot be a deliberate act.
  if (input.slotDate < today()) {
    throw validationError('Slots cannot be created for a past date.');
  }

  try {
    const row = await ops.insertSlot(supabaseAdminClient, {
      centreId,
      slotDate: input.slotDate,
      startTime: input.startTime,
      endTime: input.endTime,
      capacity: input.capacity,
      createdBy: auth.userId,
    });

    return {
      id: row.id,
      centreId: row.centre_id,
      slotDate: row.slot_date,
      startTime: row.start_time.slice(0, 5),
      endTime: row.end_time.slice(0, 5),
      capacity: row.capacity,
      bookedCount: 0,
      remainingCapacity: row.capacity,
      status: row.status,
      isFull: false,
    };
  } catch (error) {
    // The unique index on (centre, date, start) is what actually prevents
    // overlapping duplicates; translate it into something a human can act on.
    if (error instanceof Error && /already exists|duplicate/i.test(error.message)) {
      throw conflict('A slot already starts at that time on that date.');
    }
    throw error;
  }
}

export interface UpdateSlotInput {
  capacity?: number;
  status?: SlotStatus;
}

export async function updateSlotDetails(
  auth: AuthContext,
  slotId: string,
  input: UpdateSlotInput,
): Promise<ProcurementSlot> {
  const centreId = centreOf(auth);

  const existing = await ops.findSlot(auth.db, slotId);
  if (!existing || existing.centre_id !== centreId) {
    throw notFound('This slot is not available at your centre.');
  }

  try {
    const updated = await ops.updateSlot(supabaseAdminClient, slotId, input);
    if (!updated) throw notFound('This slot is not available at your centre.');
  } catch (error) {
    // The database refuses a capacity cut that would strand confirmed
    // bookings; surface that as an operational message, not a 500 (§13).
    if (error instanceof Error && /already booked/i.test(error.message)) {
      throw conflict('That capacity is lower than the number of farmers already booked.');
    }
    throw error;
  }

  const slots = await ops.listSlots(auth.db, centreId, existing.slot_date, existing.slot_date);
  const match = slots.find((slot) => slot.id === slotId);
  if (!match) throw notFound('This slot is not available at your centre.');
  return match;
}
