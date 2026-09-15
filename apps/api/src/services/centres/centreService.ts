import type { District, ProcurementCentre, State } from '@kisansetu/shared';
import { forbidden, notFound } from '../../lib/errors.js';
import {
  findCentreById,
  findDistrictById,
  findStateById,
  listCentresByDistrict,
  listCentresByDistrictIds,
  listDistrictsByState,
} from '../../repositories/centresRepository.js';
import type { AuthContext } from '../../types/request.js';

export interface StaffContext {
  centre: ProcurementCentre;
  district: District;
  state: State;
}

export async function getStaffContext(auth: AuthContext): Promise<StaffContext> {
  if (!auth.scope.centreId) throw forbidden('No procurement centre is assigned to this account.');

  const centre = await findCentreById(auth.db, auth.scope.centreId);
  if (!centre) throw notFound('The assigned procurement centre no longer exists.');

  const district = await findDistrictById(auth.db, centre.districtId);
  if (!district) throw notFound('The assigned district no longer exists.');

  const state = await findStateById(auth.db, district.stateId);
  if (!state) throw notFound('The assigned state no longer exists.');

  return { centre, district, state };
}

export interface DistrictContext {
  district: District;
  state: State;
  centreCount: number;
}

export async function getDistrictContext(auth: AuthContext): Promise<DistrictContext> {
  if (!auth.scope.districtId) throw forbidden('No district is assigned to this account.');

  const district = await findDistrictById(auth.db, auth.scope.districtId);
  if (!district) throw notFound('The assigned district no longer exists.');

  const state = await findStateById(auth.db, district.stateId);
  if (!state) throw notFound('The assigned state no longer exists.');

  const centres = await listCentresByDistrict(auth.db, district.id);

  return { district, state, centreCount: centres.length };
}

/**
 * Centres in the district admin's own district.
 *
 * The district id comes from `auth.scope`, which was read from the admin's
 * own provisioning row — a `?districtId=` parameter cannot reach this query.
 */
export async function listCentresForDistrictAdmin(auth: AuthContext): Promise<ProcurementCentre[]> {
  if (!auth.scope.districtId) throw forbidden('No district is assigned to this account.');
  return listCentresByDistrict(auth.db, auth.scope.districtId);
}

export interface StateContext {
  state: State;
  districtCount: number;
  centreCount: number;
}

export async function getStateContext(auth: AuthContext): Promise<StateContext> {
  if (!auth.scope.stateId) throw forbidden('No state is assigned to this account.');

  const state = await findStateById(auth.db, auth.scope.stateId);
  if (!state) throw notFound('The assigned state no longer exists.');

  const districts = await listDistrictsByState(auth.db, state.id);
  const centres = await listCentresByDistrictIds(
    auth.db,
    districts.map((district) => district.id),
  );

  return { state, districtCount: districts.length, centreCount: centres.length };
}

export async function listDistrictsForStateAdmin(auth: AuthContext): Promise<District[]> {
  if (!auth.scope.stateId) throw forbidden('No state is assigned to this account.');
  return listDistrictsByState(auth.db, auth.scope.stateId);
}

export async function listCentresForStateAdmin(auth: AuthContext): Promise<ProcurementCentre[]> {
  const districts = await listDistrictsForStateAdmin(auth);
  return listCentresByDistrictIds(
    auth.db,
    districts.map((district) => district.id),
  );
}
