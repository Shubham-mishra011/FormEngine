import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AppNotification } from './api'
import { beep, showNotification } from './sound'
import { useSettings } from './useSettings'

export const POLL_MS = 30_000

/**
 * Keeps the notification list fresh. There is no background worker: this only runs while the page is open,
 * pauses while the tab is hidden, and catches up when it becomes visible again. A server outage just sets
 * `offline` (no error spam).
 */
export function useNotifications() {
  const { settings } = useSettings()
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings // latest value for timers/callbacks without re-subscribing them
  }, [settings])
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [offline, setOffline] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const seen = useRef<Set<number> | null>(null) // null until the first load: old notifications must not blast
  const busy = useRef(false)

  const refresh = useCallback(async (sync = true) => {
    if (busy.current) return
    busy.current = true
    try {
      if (sync) await api.syncNotifications(settingsRef.current.overdueAlerts)
      const list = await api.listNotifications()
      setItems(list.items)
      setUnread(list.unread)
      setOffline(false)
      setLoaded(true)
      if (seen.current === null) {
        seen.current = new Set(list.items.map((n) => n.id))
      } else {
        const fresh = list.items.filter((n) => !n.readAt && !seen.current!.has(n.id))
        for (const n of list.items) seen.current.add(n.id)
        if (fresh.length > 0) {
          const s = settingsRef.current
          if (s.browserNotifications)
            for (const n of fresh.slice(0, 3)) showNotification(n.title, n.message ?? undefined)
          if (s.notificationSound) beep()
        }
      }
    } catch {
      setOffline(true)
    } finally {
      busy.current = false
    }
  }, [])

  useEffect(() => {
    void refresh()
    const tick = () => { if (!document.hidden) void refresh() }
    const id = setInterval(tick, POLL_MS)
    const onVisible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [refresh])

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch {
      setOffline(true)
      return
    }
    await refresh(false)
  }, [refresh])

  return {
    items, unread, offline, loaded, refresh,
    markRead: (id: number, read = true) => act(() => api.markNotificationRead(id, read)),
    markAllRead: () => act(() => api.markAllRead()),
    dismiss: (id: number) => act(() => api.dismissNotification(id)),
    dismissAll: () => act(() => api.dismissAllNotifications()),
  }
}
