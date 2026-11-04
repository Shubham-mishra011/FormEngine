/** Short, quiet two-tone beep. Silently does nothing where WebAudio is unavailable (jsdom, old browsers) or blocked. */
export function beep(): void {
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    const Ctx = w.AudioContext ?? w.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const tone = (freq: number, at: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at)
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.3)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + at)
      osc.stop(ctx.currentTime + at + 0.32)
    }
    tone(880, 0)
    tone(1175, 0.25)
    setTimeout(() => void ctx.close?.(), 1000)
  } catch {
    /* no sound is fine */
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported'
}

/** Only ever call from a click handler: browsers expect permission prompts to follow a user gesture. */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

/** Shows a system notification only when supported and already granted. Returns whether one was shown. */
export function showNotification(title: string, body?: string): boolean {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false
  try {
    new Notification(title, { body })
    return true
  } catch {
    return false
  }
}
