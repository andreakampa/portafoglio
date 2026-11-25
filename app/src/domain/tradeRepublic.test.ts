import { describe, expect, it } from 'vitest'
import type { RawTx } from './engine/types'
import { applyTrMatches, parseTrCsv, planTrImport } from './tradeRepublic'

const HEAD = '"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id","counterparty_name","counterparty_iban","payment_reference","mcc_code"'
const row = (o: { date: string; cat?: string; type?: string; isin?: string; shares?: string; price?: string; amount?: string; fee?: string; desc?: string; id: string }) =>
  [`${o.date}T10:00:00Z`, o.date, 'DEFAULT', o.cat ?? 'TRADING', o.type ?? 'BUY', 'FUND', 'Fondo, prova', o.isin ?? 'IE000VAHT5T0', o.shares ?? '', o.price ?? '',
    o.amount ?? '', o.fee ?? '', '', 'EUR', '', '', '', o.desc ?? 'Savings plan execution IE000VAHT5T0', o.id, '', '', '', '']
    .map(v => `"${v}"`).join(',')

const CSV = [
  HEAD,
  row({ date: '2026-11-01', cat: 'CASH', type: 'CARD_TRANSACTION', isin: '', amount: '-6.59', desc: 'BAR', id: 'c1' }),
  row({ date: '2026-11-02', shares: '11.4681520000', price: '4.3599000000', amount: '-50.00', id: 't1' }),
  row({ date: '2026-11-02', shares: '1.5456940000', price: '4.3605000000', amount: '-6.74', id: 't2' }),
  row({ date: '2026-11-16', shares: '11.3954910000', price: '4.3877000000', amount: '-50.00', id: 't3' }),
  row({ date: '2026-10-05', type: 'SELL', isin: 'IE0003XJA0J9', shares: '-0.1341210000', price: '13.28', amount: '1.78', fee: '-1.00', desc: 'Sell trade', id: 't4' }),
].join('\n')

describe('lettura del CSV di Trade Republic', () => {
  it('tiene solo le operazioni sui titoli, con numeri senza segno', () => {
    const t = parseTrCsv(CSV)
    expect(t.map(x => x.id)).toEqual(['t4', 't1', 't2', 't3'])
    expect(t[0]).toMatchObject({ side: 'sell', qty: 0.134121, fee: 1, amount: 1.78, savingsPlan: false })
    expect(t[1]).toMatchObject({ side: 'buy', isin: 'IE000VAHT5T0', qty: 11.468152, price: 4.3599, amount: 50, savingsPlan: true })
  })
  it('rifiuta un file diverso', () => {
    expect(() => parseTrCsv('a,b,c\n1,2,3')).toThrow(/Trade Republic/)
  })
})

describe('collegamento ai movimenti', () => {
  const txs: RawTx[] = [
    { id: 'a', date: '2026-11-02', type: 'buy', qty: 11.443, price: 4.37, source: 'pac', importoPac: 50, priceEstimated: true, exchangeRate: 1 },
    { id: 'b', date: '2026-11-16', type: 'buy', qty: 11.395491, price: 4.3877, source: 'pac', commission: 0 },
    { id: 'c', date: '2026-11-20', type: 'buy', qty: 1, price: 4.4 },
  ]
  const assets = { VALL_AS: { isin: 'IE000VAHT5T0', valuta: 'EUR', transactions: txs } }
  const plan = planTrImport(assets, parseTrCsv(CSV))
  const by = (id: string) => plan.matches.find(m => m.trade.id === id)!

  it('la stima prende i numeri del file, la rata piccola dello stesso giorno è nuova', () => {
    expect(by('t1')).toMatchObject({ action: 'replace', assetId: 'VALL_AS', txId: 'a' })
    expect(by('t2').action).toBe('new')
  })
  it('una rata già uguale non cambia, un titolo assente si ignora', () => {
    expect(by('t3')).toMatchObject({ action: 'same', txId: 'b' })
    expect(by('t4').action).toBe('unknown')
  })
  it('i movimenti dell\'app che il file non ha sono solo segnalati', () => {
    expect(plan.onlyInApp).toEqual([])
    const extra = { VALL_AS: { ...assets.VALL_AS, transactions: [...txs, { id: 'd', date: '2026-11-10', type: 'buy', qty: 3, price: 4.4 }] } }
    expect(planTrImport(extra, parseTrCsv(CSV)).onlyInApp).toEqual([{ assetId: 'VALL_AS', date: '2026-11-10', qty: 3, price: 4.4 }])
  })
  it('una rata confermata ma diversa viene corretta', () => {
    const changed = { VALL_AS: { ...assets.VALL_AS, transactions: [txs[0]!, { ...txs[1]!, price: 4.39 }] } }
    expect(planTrImport(changed, parseTrCsv(CSV)).matches.find(m => m.trade.id === 't3')).toMatchObject({ action: 'fix' })
  })

  it('applicando: numeri del file, niente stima né cambio vecchio, rata nuova come PAC', () => {
    const out = applyTrMatches(txs, [by('t1'), by('t2')], () => 'nuovo')!
    const a = out.find(t => t.id === 'a')!
    expect(a).toMatchObject({ qty: 11.468152, price: 4.3599, commission: 0, source: 'pac', importoPac: 50, trId: 't1' })
    expect(a.priceEstimated).toBeUndefined()
    expect(a.exchangeRate).toBeUndefined()
    expect(out.find(t => t.id === 'nuovo')).toMatchObject({ date: '2026-11-02', qty: 1.545694, source: 'pac', importoPac: 6.74, trId: 't2' })
    expect(out).toHaveLength(4)
  })
  it('un secondo import non crea doppioni', () => {
    const out = applyTrMatches(txs, [by('t1'), by('t2')], () => 'nuovo')!
    const again = planTrImport({ VALL_AS: { ...assets.VALL_AS, transactions: out } }, parseTrCsv(CSV))
    expect(again.matches.filter(m => m.assetId).map(m => m.action)).toEqual(['same', 'same', 'same'])
  })
  it('null se il movimento è cambiato nel frattempo', () => {
    expect(applyTrMatches([{ ...txs[0]!, qty: 2 }], [by('t1')], () => 'n')).toBeNull()
  })
})
