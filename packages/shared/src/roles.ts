/**
 * Application roles. These are the single source of truth for the string
 * literals used by the database enum `app_role`, the API and the frontend.
 * Never hard-code "STATE_ADMIN" (or friends) anywhere else.
 */
export const ROLES = {
  FARMER: 'FARMER',
  CENTRE_STAFF: 'CENTRE_STAFF',
  DISTRICT_ADMIN: 'DISTRICT_ADMIN',
  STATE_ADMIN: 'STATE_ADMIN',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES: readonly Role[] = Object.values(ROLES);

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ALL_ROLES as readonly string[]).includes(value);
}

// There is one sign-in screen for every role. The role is never chosen by the
// user or sent by the client — the server derives it from the profile and
// role-assignment rows after authentication, and routes from there.

export const ROLE_LABEL: Record<Role, string> = {
  FARMER: 'Farmer',
  CENTRE_STAFF: 'Centre Staff',
  DISTRICT_ADMIN: 'District Admin',
  STATE_ADMIN: 'State Admin',
};

/** Home route for each role after a successful login. */
export const DASHBOARD_PATH: Record<Role, string> = {
  FARMER: '/farmer/dashboard',
  CENTRE_STAFF: '/staff/dashboard',
  DISTRICT_ADMIN: '/district/dashboard',
  STATE_ADMIN: '/state/dashboard',
};

/**
 * Roles that may be created by anonymous self-registration.
 * Government roles are provisioned, never self-served (§40).
 */
export const SELF_REGISTERABLE_ROLES: readonly Role[] = [ROLES.FARMER];

export function isSelfRegisterable(role: Role): boolean {
  return SELF_REGISTERABLE_ROLES.includes(role);
}
