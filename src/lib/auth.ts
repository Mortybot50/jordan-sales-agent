import type { AppUser } from '@/hooks/useAuth'

/**
 * Role hierarchy for LeadFlow.
 *
 * - `owner`  — full admin (org owner). Sees /admin/workers + every admin gate.
 * - `admin`  — same as owner today; reserved for future delegated admins.
 * - `member` — default fallback for any user without a role set (see useAuth fetchUser).
 *
 * Per audit FE-P1-03, these helpers are the single source of truth for
 * role-gated UI. Do NOT inline `user.role === 'owner'` or `=== 'admin'`
 * anywhere else — fight drift here instead.
 */

const ADMIN_ROLES = ['owner', 'admin'] as const

type AdminRole = (typeof ADMIN_ROLES)[number]

function hasRole(user: Pick<AppUser, 'role'> | null | undefined, allowed: readonly string[]): boolean {
  if (!user) return false
  return allowed.includes(user.role)
}

/** True if the user is an org owner or admin (sees admin UI). */
export function canAdmin(user: Pick<AppUser, 'role'> | null | undefined): boolean {
  return hasRole(user, ADMIN_ROLES)
}

/** True only for owners. Reserved for owner-only actions (delete org, billing). */
export function isOwner(user: Pick<AppUser, 'role'> | null | undefined): boolean {
  return hasRole(user, ['owner'])
}

export type { AdminRole }
