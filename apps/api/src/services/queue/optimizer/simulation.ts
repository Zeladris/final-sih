import type { PolicySimulationResult, WaitStats } from '@kisansetu/shared';
import { fcfsOrder, optimizeQueue } from './optimizer.js';
import { isCompatible } from './scores.js';
import type { QueuePolicy } from './policy.js';
import type { CandidateInput, WorkstationInput } from './types.js';

/**
 * FCFS vs FA-DQO on the SAME workload (§43, §53).
 *
 * A deterministic discrete-event replay: the recorded queue arrivals, each
 * farmer's recorded processing estimate, and the centre's workstations. When
 * a station frees up, the policy picks who goes next from those who have
 * arrived and are compatible with it.
 *
 * What it is: a like-for-like comparison of two ordering policies.
 * What it is not: a measurement of what actually happened, or a claim about
 * improvement in general. Actual processing times differ from estimates, and
 * the result says so (`basis`). Nothing here is fabricated — every input is a
 * recorded row, and the output is whatever the replay produces.
 */
export interface SimulationJob {
  input: CandidateInput;
  estimatedMinutes: number;
}

export function simulate(
  kind: 'FCFS' | 'FA_DQO',
  jobs: SimulationJob[],
  stations: WorkstationInput[],
  policy: QueuePolicy,
  centreCloseAt: Date | null,
): PolicySimulationResult | null {
  const usable = stations.filter((station) => station.status !== 'OFFLINE');
  if (jobs.length === 0 || usable.length === 0) return null;

  const pending = [...jobs];
  const freeAt = new Map(usable.map((station) => [station.id, Number.NEGATIVE_INFINITY]));
  const waits: number[] = [];
  const slotDelays: number[] = [];
  const order: string[] = [];
  let starvation = 0;
  let firstStart: number | null = null;
  let lastFinish: number | null = null;

  const arrival = (job: SimulationJob): number => job.input.enteredAt.getTime();

  // Bounded: each iteration serves one job or drops one unusable station.
  for (let guard = 0; guard < jobs.length * (usable.length + 2) && pending.length > 0; guard += 1) {
    // The station that frees up first (ties by code), among those still useful.
    const live = usable.filter((station) =>
      pending.some((job) => isCompatible(station, job.input.cropId)),
    );
    if (live.length === 0) break;

    const station = [...live].sort(
      (a, b) => (freeAt.get(a.id)! - freeAt.get(b.id)!) || a.code.localeCompare(b.code),
    )[0]!;

    const compatible = pending.filter((job) => isCompatible(station, job.input.cropId));
    const earliestArrival = Math.min(...compatible.map(arrival));
    const t = Math.max(freeAt.get(station.id)!, earliestArrival);
    const present = compatible.filter((job) => arrival(job) <= t);

    const chosen = kind === 'FCFS' ? pickFcfs(present) : pickOptimized(present, usable, station, freeAt, t, policy, centreCloseAt);
    if (!chosen) break;

    const waitMinutes = (t - arrival(chosen)) / 60_000;
    waits.push(waitMinutes);
    if (waitMinutes >= policy.maxWaitOverrideMinutes) starvation += 1;
    if (chosen.input.slotEndAt) {
      slotDelays.push(Math.max(0, (t - chosen.input.slotEndAt.getTime()) / 60_000));
    }

    order.push(chosen.input.bookingReference);
    const finish = t + chosen.estimatedMinutes * 60_000;
    freeAt.set(station.id, finish);
    firstStart = firstStart === null ? t : Math.min(firstStart, t);
    lastFinish = lastFinish === null ? finish : Math.max(lastFinish, finish);

    pending.splice(pending.indexOf(chosen), 1);
  }

  return {
    policy: kind,
    waits: waitStats(waits),
    averageSlotDelayMinutes: slotDelays.length ? round(average(slotDelays)) : null,
    starvationEvents: starvation,
    makespanMinutes:
      firstStart !== null && lastFinish !== null ? round((lastFinish - firstStart) / 60_000) : null,
    order,
  };
}

function pickFcfs(present: SimulationJob[]): SimulationJob | undefined {
  return fcfsOrder(present)[0];
}

function pickOptimized(
  present: SimulationJob[],
  stations: WorkstationInput[],
  station: WorkstationInput,
  freeAt: Map<string, number>,
  t: number,
  policy: QueuePolicy,
  centreCloseAt: Date | null,
): SimulationJob | undefined {
  const now = new Date(t);

  // Station state as it would be at time t.
  const view: WorkstationInput[] = stations.map((other) => {
    const free = freeAt.get(other.id)!;
    const busy = other.id !== station.id && free > t;
    return {
      ...other,
      status: busy ? 'BUSY' : 'AVAILABLE',
      remainingMinutes: busy ? (free - t) / 60_000 : null,
    };
  });

  const result = optimizeQueue(
    present.map((job) => ({ ...job.input, priorityAdvantageCount: 0, lastAdvantageAt: null })),
    view,
    { now, centreCloseAt, policy, previousNextBookingId: null },
  );

  const best = result.ranked.find((entry) => isCompatible(station, entry.input.cropId));
  return best ? present.find((job) => job.input.bookingId === best.input.bookingId) : undefined;
}

export function waitStats(values: number[]): WaitStats {
  if (values.length === 0) {
    return { count: 0, averageMinutes: null, medianMinutes: null, maxMinutes: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return {
    count: values.length,
    averageMinutes: round(average(values)),
    medianMinutes: round(median),
    maxMinutes: round(sorted[sorted.length - 1]!),
  };
}

const average = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;
const round = (value: number): number => Math.round(value * 10) / 10;
