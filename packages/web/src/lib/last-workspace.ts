const KEY = 'bf_last_workspace'

export function getLastWorkspaceId(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setLastWorkspaceId(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // ignore (private browsing may block localStorage writes)
  }
}
