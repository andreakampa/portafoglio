// Codici invito: stesso formato accettato da database.rules.json (/^[A-Z0-9-]{8,32}$/).
import { appUrl } from './site'

export const INVITE_RE = /^[A-Z0-9-]{8,32}$/

/** Rende il codice tollerante a minuscole e spazi copiati per sbaglio. */
export function normalizeInvite(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

export function isValidInvite(code: string): boolean {
  return INVITE_RE.test(code)
}

// Nessun carattere ambiguo (0/O, 1/I/L): il codice si detta anche a voce.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Codice casuale del tipo K7PM-Q2XD-9RWA. */
export function newInviteCode(random: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n))): string {
  const chars: string[] = []
  while (chars.length < 12) {
    for (const b of random(16)) {
      // Scarta i valori che renderebbero alcune lettere più probabili di altre.
      if (b < 248 && chars.length < 12) chars.push(ALPHABET[b % ALPHABET.length]!)
    }
  }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`
}

/** Indirizzo da mandare a chi è invitato: apre la registrazione con il codice già scritto. */
export function inviteLink(code: string, base = appUrl()): string {
  return `${base}?invito=${encodeURIComponent(code)}`
}

/** Codice invito dall'indirizzo (?invito=…), se valido. */
export function inviteFromUrl(search: string): string | null {
  const raw = new URLSearchParams(search).get('invito')
  const code = raw ? normalizeInvite(raw) : ''
  return isValidInvite(code) ? code : null
}
