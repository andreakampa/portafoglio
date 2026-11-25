import { ref, remove, set } from 'firebase/database'
import { db } from './firebase'
import { unb64u } from './webpush'

/** Chiave pubblica VAPID (la privata è un secret del Worker ibkr-sync). */
export const VAPID_PUBLIC = 'BNjED-esOVkRhnhej3hrnRpV6ZXwY2yElOtxmO0rNgTOO23w4pKB4LCHzB-XN5AfdxRzggl-CO7GfjTnRHmq8fY'

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

/** Id stabile dell'abbonamento (per la chiave su Firebase). */
async function subId(endpoint: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)))
  return [...h.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  }
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

/** Chiede il permesso, si abbona e salva l'abbonamento su Firebase (users/{uid}/settings/push/{id}). */
export async function enablePush(uid: string): Promise<void> {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Permesso per le notifiche non concesso.')
  const reg = await navigator.serviceWorker.ready
  let sub: PushSubscription
  try {
    sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(VAPID_PUBLIC) as BufferSource }))
  } catch (e) {
    // "Registration failed - push service error": il browser non riesce a parlare col suo servizio di notifiche
    // (Brave con l'opzione spenta, finestra anonima, rete o antivirus che lo bloccano).
    if (e instanceof Error && /push service/i.test(e.message)) {
      const brave = await (navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } }).brave?.isBrave?.().catch(() => false)
      throw new Error(
        brave
          ? 'Stai usando Brave, che di serie tiene spente le notifiche push. Scrivi brave://settings/privacy nella barra degli indirizzi, attiva «Usa i servizi Google per la messaggistica push», chiudi e riapri Brave e premi di nuovo «Attiva le notifiche».'
          : 'Il browser non riesce a raggiungere il suo servizio di notifiche. Prova fuori dalla finestra anonima, controlla che antivirus o rete non lo blocchino, oppure usa Chrome o Edge.',
      )
    }
    throw e
  }
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  await set(ref(db, `users/${uid}/settings/push/${await subId(json.endpoint)}`), {
    endpoint: json.endpoint, keys: json.keys, device: navigator.userAgent.slice(0, 120), createdAt: new Date().toISOString(),
  })
}

export async function disablePush(uid: string): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await remove(ref(db, `users/${uid}/settings/push/${await subId(sub.endpoint)}`))
  await sub.unsubscribe()
}
