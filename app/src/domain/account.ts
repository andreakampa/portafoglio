// Impostazioni dell'account: cambio password e pulizia della cache dei prezzi (come settings/index.js del sito vecchio).

export interface PasswordForm {
  current: string
  next: string
  repeat: string
}

export function validatePassword(f: PasswordForm): string | null {
  if (!f.current) return 'Scrivi la password attuale.'
  if (f.next.length < 8) return 'La nuova password deve avere almeno 8 caratteri.'
  if (f.next !== f.repeat) return 'Le due nuove password non coincidono.'
  if (f.next === f.current) return 'La nuova password è uguale a quella attuale.'
  return null
}

/** Messaggio chiaro per gli errori di Firebase Auth più comuni. */
export function passwordError(code: string): string {
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') return 'La password attuale non è giusta.'
  if (code === 'auth/weak-password') return 'Password troppo debole: usane una più lunga.'
  if (code === 'auth/too-many-requests') return 'Troppi tentativi: riprova tra qualche minuto.'
  if (code === 'auth/network-request-failed') return 'Connessione assente: riprova.'
  return 'Cambio password non riuscito: riprova.'
}

/** Cache dei dati di mercato su questo dispositivo (prezzi, cambi, dividendi, storici). Le preferenze restano. */
export const isMarketCacheKey = (k: string) => /^ptpro_v2_(quotes|fx|dividends|closes|history|prices)/.test(k)
