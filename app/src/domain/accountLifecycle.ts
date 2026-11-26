// Ciclo di vita degli account degli amici (decisioni di Andrea, 25/11/2026):
// - sospensione: l'amico entra ancora ma solo in lettura, ha 30 giorni per scaricare i dati, poi si cancella tutto;
// - chiusura del sito: avviso 60 giorni prima, in app e via email.
// Le regole del database fanno il controllo vero (database.rules.json); qui solo conti e testi.

export const GRACE_DAYS = 30
export const CLOSING_NOTICE_DAYS = 60
const DAY = 86_400_000

/** Campi di members/{uid} che servono qui. */
export interface MemberInfo {
  email?: string
  joinedAt?: number
  suspendedAt?: number
  deleteAfter?: number
}

/** Avviso per tutti in /notice: per ora solo la chiusura del sito. */
export interface SiteNotice {
  closesAt?: number
  message?: string
}

export const dateIt = (ms: number) => new Date(ms).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })

/** Scrittura su members/{uid} per sospendere: da adesso, cancellazione dopo 30 giorni. */
export function suspension(now: number): Required<Pick<MemberInfo, 'suspendedAt' | 'deleteAfter'>> {
  return { suspendedAt: now, deleteAfter: now + GRACE_DAYS * DAY }
}

/** Giorni interi che mancano (0 se la data è passata). */
export function daysLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / DAY))
}

export const isSuspended = (m: MemberInfo | null | undefined) => m?.suspendedAt != null

/** I dati si possono cancellare definitivamente solo a periodo di grazia finito (le regole fanno lo stesso controllo). */
export const canPurge = (m: MemberInfo, now: number) => m.deleteAfter != null && m.deleteAfter <= now

/** Chiusura del sito annunciata oggi: data 60 giorni più avanti. */
export function closingNotice(now: number, message = ''): SiteNotice {
  return { closesAt: now + CLOSING_NOTICE_DAYS * DAY, ...(message.trim() ? { message: message.trim().slice(0, 300) } : {}) }
}

export interface Banner {
  tone: 'warn' | 'error'
  title: string
  text: string
}

/** Avvisi da mostrare a ogni accesso, il più urgente prima. */
export function bannersFor(member: MemberInfo | null, notice: SiteNotice | null, now: number): Banner[] {
  const out: Banner[] = []
  if (member?.suspendedAt != null && member.deleteAfter != null) {
    const d = daysLeft(member.deleteAfter, now)
    out.push({
      tone: 'error',
      title: 'Il tuo accesso è stato sospeso',
      text:
        `Dal ${dateIt(member.suspendedAt)} puoi solo consultare i tuoi dati, non modificarli. ` +
        `Il ${dateIt(member.deleteAfter)} ${d > 0 ? `(tra ${d} ${d === 1 ? 'giorno' : 'giorni'}) ` : ''}verranno cancellati: scaricali prima di quella data.`,
    })
  }
  if (notice?.closesAt != null) {
    const d = daysLeft(notice.closesAt, now)
    out.push({
      tone: 'warn',
      title: `Il sito chiude il ${dateIt(notice.closesAt)}`,
      text:
        `${d > 0 ? `Mancano ${d} ${d === 1 ? 'giorno' : 'giorni'}. ` : ''}Dopo quella data tutti i dati verranno cancellati: scarica i tuoi prima.` +
        (notice.message ? ` ${notice.message}` : ''),
    })
  }
  return out
}

/** Email pronta da mandare (si apre nel programma di posta, Andrea la spedisce con un clic). */
export function mailto({ to = [], bcc = [], subject, body }: { to?: string[]; bcc?: string[]; subject: string; body: string }): string {
  const q = new URLSearchParams()
  if (bcc.length) q.set('bcc', bcc.join(','))
  q.set('subject', subject)
  q.set('body', body)
  // mailto vuole %20 per gli spazi, non "+".
  return `mailto:${to.map(encodeURIComponent).join(',')}?${q.toString().replace(/\+/g, '%20')}`
}

export function suspensionMail(email: string, m: Required<Pick<MemberInfo, 'suspendedAt' | 'deleteAfter'>>, appUrl: string) {
  return mailto({
    to: [email],
    subject: 'Gruzzolo: il tuo accesso è sospeso',
    body:
      `Ciao,\n\nti scrivo per dirti che dal ${dateIt(m.suspendedAt)} il tuo accesso a Gruzzolo è sospeso.\n\n` +
      `Puoi ancora entrare e consultare i tuoi dati fino al ${dateIt(m.deleteAfter)}. In Impostazioni trovi "Scarica i miei dati": ` +
      `ti consiglio di farlo prima di quella data, perché dopo verrà cancellato tutto.\n\n${appUrl}\n\nUn saluto`,
  })
}

export function closingMail(emails: string[], n: SiteNotice, appUrl: string) {
  const when = n.closesAt != null ? dateIt(n.closesAt) : ''
  return mailto({
    bcc: emails,
    subject: `Gruzzolo chiude il ${when}`,
    body:
      `Ciao,\n\nGruzzolo chiuderà il ${when}. Dopo quella data i dati di tutti verranno cancellati.\n\n` +
      `Entra e scarica i tuoi da Impostazioni → "Scarica i miei dati".` +
      (n.message ? `\n\n${n.message}` : '') +
      `\n\n${appUrl}\n\nGrazie di averlo usato!`,
  })
}

/** Nome del file con tutti i dati dell'utente. */
export const exportFileName = (now: number) => `gruzzolo-miei-dati-${new Date(now).toISOString().slice(0, 10)}.json`

/** Contenuto del file: tutto users/{uid} più due righe per capire cos'è. */
export function exportPayload(email: string | null, data: unknown, now: number) {
  return { esportatoIl: new Date(now).toISOString(), account: email, formato: 'Gruzzolo, copia completa dei dati (users/{uid})', dati: data ?? {} }
}
