const cache = new Map<string, Intl.NumberFormat>()
const nf = (opts: Intl.NumberFormatOptions) => {
  const key = JSON.stringify(opts)
  let f = cache.get(key)
  if (!f) cache.set(key, (f = new Intl.NumberFormat('it-IT', opts)))
  return f
}

const empty = '—'

export const eur = (n: number | null | undefined, signed = false) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? empty
    : nf({ style: 'currency', currency: 'EUR', signDisplay: signed ? 'exceptZero' : 'auto' }).format(n)

export const money = (n: number | null | undefined, currency: string) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? empty
    : nf({ style: 'currency', currency, maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : 2 }).format(n)

/** Importo in una valuta qualsiasi, con segno se richiesto (es. tabella Posizioni in dollari). */
export const cash = (n: number | null | undefined, currency: string, signed = false) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? empty
    : nf({ style: 'currency', currency, signDisplay: signed ? 'exceptZero' : 'auto' }).format(n)

export const pct = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? empty : nf({ maximumFractionDigits: 2, minimumFractionDigits: 2, signDisplay: 'exceptZero' }).format(n) + '%'

export const qty = (n: number) => nf({ maximumFractionDigits: 4 }).format(n)

/** Classe CSS per colorare guadagni e perdite. */
export const tone = (n: number | null | undefined) => (n === null || n === undefined || Math.abs(n) < 0.005 ? '' : n > 0 ? 'pos up' : 'neg down')

/** Anno corrente, letto una volta all'avvio (va bene: l'app si ricarica da sola agli aggiornamenti). */
export const THIS_YEAR = new Date().getFullYear()
