import type {
  DepartmentProfile,
  FleetState,
  ReportInput,
  Role,
  TicketInput,
  TicketStatus,
  VehicleInput,
  VehicleStatus,
} from './domain'

/** Server authority owns user identity, permissions, audit actors and record versions. */
export type SharedUser = {
  id: string
  username: string
  displayName: string
  role: Role
  department: string | null
}

export type SharedCommand =
  | { type: 'submit-report'; payload: ReportInput }
  | { type: 'review-report'; payload: { reportId: string; decision: 'Approved' | 'Returned'; note: string } }
  | { type: 'reopen-report'; payload: { reportId: string; reason: string } }
  | { type: 'add-vehicle'; payload: { input: VehicleInput } }
  | { type: 'update-vehicle'; payload: { vehicleId: string; changes: Partial<VehicleInput> } }
  | { type: 'vehicle-status'; payload: { vehicleId: string; status: VehicleStatus; note: string } }
  | { type: 'update-department'; payload: { name: string; input: Pick<DepartmentProfile, 'coordinator' | 'contact' | 'monthlyDueDay' | 'notes'> } }
  | { type: 'create-follow-up'; payload: { vehicleId: string; period: string; note: string; dueOn: string; owner: string } }
  | { type: 'update-follow-up'; payload: { id: string; status: 'Open' | 'Closed'; options: { dueOn?: string; owner?: string; outcome?: string } } }
  | { type: 'add-ticket'; payload: { input: TicketInput } }
  | { type: 'update-ticket'; payload: { ticketId: string; status: TicketStatus; details: { assignee?: string; scheduledFor?: string; resolutionNote?: string; actualCost?: number; reopenReason?: string } } }
  | { type: 'record-export'; payload: { scope: 'Monthly' | 'Quarterly'; label: string; recordCount: number } }

export class SharedApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = 'SharedApiError'
  }
}

export type SharedImportPreview = {
  allowed: boolean
  reason: string
  counts: { vehicles: number; reports: number; tickets: number; followUps: number }
  fingerprint: string
}

async function request<T>(url: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  let response: Response
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 18000)
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(method === 'POST' ? { 'X-FleetSync-Request': '1', 'Content-Type': 'application/json' } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    throw new SharedApiError('The shared request was interrupted or timed out. Refresh shared records before retrying a change, or return to Demo.', 0)
  } finally {
    window.clearTimeout(timeout)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new SharedApiError('The shared server is not responding with JSON. Return to Demo or check the server.', response.status)
  }
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new SharedApiError('The shared server returned an invalid response.', response.status)
  }
  if (!response.ok) {
    const value = result && typeof result === 'object' ? result as Record<string, unknown> : {}
    const detail = typeof value.error === 'string'
      ? value.error : typeof value.message === 'string' ? value.message : null
    const errorCode = typeof value.code === 'string' ? value.code : undefined
    throw new SharedApiError(detail ?? (
      response.status === 409 ? 'Changes from another session; refreshed, retry.'
        : response.status === 401 ? 'Your session expired. Sign in again.'
          : response.status === 403 ? 'Your shared account cannot perform this action.'
            : 'The shared request failed (' + response.status + ').'
    ), response.status, errorCode)
  }
  return result as T
}

export const sharedClient = {
  health: () => request<{ shared: boolean }>('/api/health'),
  session: () => request<{ user: SharedUser | null }>('/api/session'),
  login: (username: string, password: string) => request<{ user: SharedUser }>('/api/login', 'POST', { username, password }),
  logout: () => request<unknown>('/api/logout', 'POST'),
  state: () => request<{ revision: number; state: FleetState }>('/api/state'),
  action: (revision: number, command: SharedCommand) =>
    request<{ revision: number; state: FleetState }>('/api/actions', 'POST', { revision, ...command }),
  importPreview: (state: FleetState) => request<SharedImportPreview>('/api/import/preview', 'POST', { state }),
  importState: (revision: number, state: FleetState, fingerprint: string) =>
    request<{ revision: number; state: FleetState }>('/api/import', 'POST', { revision, state, fingerprint }),
}
