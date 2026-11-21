import { describe, expect, it } from 'vitest'
import { parseFlex, yahooTicker } from './flex'
import { applyFlexOrders, type SyncPortfolio } from './sync'

const trade = (a: Record<string, string>) =>
  `<Trade ${Object.entries({ assetCategory: 'STK', currency: 'USD', fxRateToBase: '0.8', levelOfDetail: 'EXECUTION', listingExchange: 'NASDAQ', ibCommissionCurrency: 'USD', ...a }).map(([k, v]) => `${k}="${v}"`).join(' ')} />`
const report = (...trades: string[]) =>
  `<FlexQueryResponse><FlexStatements><FlexStatement fromDate="20261101" toDate="20261120"><AccountInformation currency="EUR" /><Trades>${trades.join('')}</Trades></FlexStatement></FlexStatements></FlexQueryResponse>`

const XML = report(
  trade({ symbol: 'ANT', isin: 'US1', tradeDate: '20261119', buySell: 'BUY', openCloseIndicator: 'O', quantity: '3', tradePrice: '100', ibCommission: '-0.2', ibOrderID: '1', tradeID: 'a' }),
  trade({ symbol: 'ANT', isin: 'US1', tradeDate: '20261119', buySell: 'BUY', openCloseIndicator: 'O', quantity: '2', tradePrice: '110', ibCommission: '-0.1', ibOrderID: '1', tradeID: 'b' }),
  trade({ symbol: 'NVDA', isin: 'US2', tradeDate: '20261112', buySell: 'SELL', openCloseIndicator: 'O', quantity: '-5', tradePrice: '165.42', ibCommission: '-0.37', ibOrderID: '2', tradeID: 'c' }),
  trade({ symbol: 'NVDA', isin: 'US2', tradeDate: '20261116', buySell: 'BUY', openCloseIndicator: 'C', quantity: '15', tradePrice: '156.1', ibCommission: '-0.35', ibOrderID: '3', tradeID: 'd' }),
  trade({ symbol: 'RACEm', isin: 'IT1', currency: 'EUR', fxRateToBase: '1', listingExchange: 'BVME', tradeDate: '20261118', buySell: 'SELL', openCloseIndicator: 'C', quantity: '-2', tradePrice: '370', ibCommission: '-3', ibCommissionCurrency: 'EUR', ibOrderID: '4', tradeID: 'e' }),
  trade({ symbol: 'BMEA 28C', assetCategory: 'OPT', tradeDate: '20261117', buySell: 'BUY', quantity: '1', tradePrice: '1', ibOrderID: '5', tradeID: 'f' }),
)

describe('report Flex', () => {
  const r = parseFlex(XML)

  it('unisce le esecuzioni dello stesso ordine con prezzo medio e commissioni sommate', () => {
    const ant = r.orders.find(o => o.symbol === 'ANT')!
    expect(ant).toMatchObject({ externalId: '1@2026-11-19', type: 'buy', qty: 5, commission: 0.30000000000000004 })
    expect(ant.price).toBeCloseTo(104, 8)
    expect(ant.exchangeRate).toBeCloseTo(1.25, 8)
  })

  it('distingue apertura e chiusura di short', () => {
    expect(r.orders.filter(o => o.symbol === 'NVDA').map(o => o.type)).toEqual(['short_sell', 'buy_to_cover'])
  })

  it('le opzioni non si importano ma vengono segnalate', () => {
    expect(r.orders.some(o => o.symbol.startsWith('BMEA'))).toBe(false)
    expect(r.skipped).toEqual([{ symbol: 'BMEA 28C', category: 'OPT', date: '2026-11-17' }])
    expect([r.from, r.to]).toEqual(['2026-11-01', '2026-11-20'])
  })

  it('rifiuta un file che non è un report Flex', () => {
    expect(() => parseFlex('<html/>')).toThrow()
  })

  it('ticker Yahoo dal mercato IBKR', () => {
    expect(yahooTicker('RACEm', 'BVME')).toBe('RACE.MI')
    expect(yahooTicker('PNG', 'VENTURE')).toBe('PNG.V')
    expect(yahooTicker('NVDA', 'NASDAQ')).toBe('NVDA')
    expect(yahooTicker('XYZ', 'BOH')).toBeNull()
  })
})

describe('sincronizzazione', () => {
  let n = 0
  const id = () => `id${++n}`
  const orders = parseFlex(XML).orders
  const base = (): SyncPortfolio => ({
    assets: {
      nv: { ticker: 'NVDA', isin: '', valuta: 'USD', transactions: [{ id: 'm1', date: '2026-11-12', type: 'short_sell', qty: 5, price: 165.4 }] },
      rc: { ticker: 'RACE.MI', isin: 'IT1', valuta: 'EUR', transactions: [{ date: '2026-01-02', type: 'buy', qty: 2, price: 300, externalId: 'vecchio' }] },
    },
  })

  it('crea i titoli nuovi, collega i manuali certi, aggiunge il resto', () => {
    const r = applyFlexOrders(base(), orders, id)
    const a = r.portfolio.assets!
    expect(r.linked).toHaveLength(1) // NVDA short del 12/11 inserito a mano
    expect(a.nv!.transactions![0]).toMatchObject({ id: 'm1', externalId: '2@2026-11-12', price: 165.42, commission: 0.37 })
    expect(Object.values(a).find(x => x.ticker === 'ANT')).toMatchObject({ valuta: 'USD', isin: 'US1' })
    expect(a.rc!.transactions!.map(t => t.type)).toEqual(['buy', 'sell'])
    expect(r.added).toHaveLength(3) // ANT, NVDA ricopertura, RACE vendita
    expect(r.review).toEqual([])
    expect(r.changed).toBe(true)
  })

  it('rieseguito sullo stesso report non cambia nulla (nessun doppione)', () => {
    const first = applyFlexOrders(base(), orders, id)
    const again = applyFlexOrders(first.portfolio, orders, id)
    expect(again.changed).toBe(false)
    expect(again.added).toEqual([])
  })

  it('nel dubbio segnala invece di scrivere', () => {
    const p = base()
    p.assets!.nv!.transactions![0]!.type = 'buy_to_cover' // inserito con il tipo sbagliato
    const r = applyFlexOrders(p, orders, id)
    expect(r.review.some(s => s.includes('NVDA short_sell'))).toBe(true)
    expect(r.portfolio.assets!.nv!.transactions!.filter(t => t.type === 'short_sell')).toHaveLength(0)
  })

  it('stesso giorno e tipo ma quantità diversa: da controllare, niente doppione', () => {
    const p = base()
    p.assets!.nv!.transactions!.push({ date: '2026-11-16', type: 'buy_to_cover', qty: 5, price: 156.1 })
    const r = applyFlexOrders(p, orders, id)
    expect(r.review.some(s => s.includes('NVDA buy_to_cover 15'))).toBe(true)
    expect(r.portfolio.assets!.nv!.transactions!.filter(t => t.type === 'buy_to_cover')).toHaveLength(1)
  })

  it('non modifica il portafoglio di partenza', () => {
    const p = base()
    const snapshot = JSON.stringify(p)
    applyFlexOrders(p, orders, id)
    expect(JSON.stringify(p)).toBe(snapshot)
  })
})

const cashXml = (...rows: Record<string, string>[]) =>
  `<FlexQueryResponse><FlexStatements><FlexStatement fromDate="20261101" toDate="20261120"><AccountInformation currency="EUR" /><CashTransactions>${rows
    .map(r => `<CashTransaction ${Object.entries({ currency: 'USD', fxRateToBase: '0.8', levelOfDetail: 'DETAIL', ...r }).map(([k, v]) => `${k}="${v}"`).join(' ')} />`)
    .join('')}</CashTransactions></FlexStatement></FlexStatements></FlexQueryResponse>`

describe('movimenti di cassa', () => {
  let n = 0
  const id = () => `cid${++n}`
  const xml = cashXml(
    { type: 'Dividends', transactionID: '1', dateTime: '20261110;202000', symbol: 'IBM', isin: 'US4592001014', amount: '25.35', description: 'IBM(US4592001014) CASH DIVIDEND USD 1.69 PER SHARE' },
    { type: 'Withholding Tax', transactionID: '2', dateTime: '20261110;202000', symbol: 'IBM', amount: '-3.8', description: 'IBM(US4592001014) CASH DIVIDEND - US TAX' },
    { type: 'Broker Interest Paid', transactionID: '3', dateTime: '20261103;202000', amount: '-40', description: 'USD DEBIT INT FOR OCT-2026' },
    { type: 'Broker Interest Paid', transactionID: '4', dateTime: '20261103;202000', amount: '-1.5', currency: 'EUR', description: 'EUR DEBIT INT FOR OCT-2026' },
    { type: 'Broker Interest Received', transactionID: '5', dateTime: '20261103;202000', amount: '2.1', description: 'USD SYEP INTEREST FOR OCT-2026' },
    { type: 'Broker Interest Received', transactionID: '6', dateTime: '20261103;202000', amount: '0.3', description: 'USD CREDIT INT FOR OCT-2026' },
    { type: 'Deposits/Withdrawals', transactionID: '7', dateTime: '20261104;202000', amount: '1000', description: 'versamento' },
    { type: 'Qualcosa Di Nuovo', transactionID: '8', dateTime: '20261104;202000', amount: '1', description: 'boh' },
  )
  const r = parseFlex(xml)

  it('riconosce i tipi e ignora i versamenti', () => {
    expect(r.cash.map(c => c.kind).sort()).toEqual(['credit-interest', 'dividend', 'lending', 'margin-interest', 'margin-interest', 'withholding'])
    expect(r.unknownCash).toEqual({ 'Qualcosa Di Nuovo': 1 })
    expect(r.cash.find(c => c.externalId === 'C3')).toMatchObject({ period: '2026-10', currency: 'USD', amount: -40 })
  })

  it('salva dividendi e ritenute con importo con segno e cambio', () => {
    const res = applyFlexOrders({ assets: {} }, [], id, r.cash)
    const flows = res.portfolio.cashflows!
    expect(flows.map(f => f.kind).sort()).toEqual(['credit-interest', 'dividend', 'lending', 'withholding'])
    expect(flows.find(f => f.kind === 'withholding')).toMatchObject({ amount: -3.8, symbol: 'IBM', exchangeRate: 1.25, externalId: 'C2' })
  })

  it('interessi di margine: una riga per mese e valuta, con il costo positivo', () => {
    const res = applyFlexOrders({ assets: {} }, [], id, r.cash)
    expect(res.portfolio.marginInterest!.map(m => [m.period, m.currency, m.amount]).sort()).toEqual([['2026-10', 'EUR', 1.5], ['2026-10', 'USD', 40]])
  })

  it('una seconda esecuzione non cambia nulla', () => {
    const first = applyFlexOrders({ assets: {} }, [], id, r.cash)
    const second = applyFlexOrders(first.portfolio, [], id, r.cash)
    expect(second.changed).toBe(false)
    expect(second.cashAdded).toEqual([])
    expect(second.portfolio).toEqual(first.portfolio)
  })

  it('un addebito di margine arrivato un altro giorno si somma e uno storno lo riduce', () => {
    const first = applyFlexOrders({ assets: {} }, [], id, r.cash)
    const later = parseFlex(cashXml(
      { type: 'Broker Interest Paid', transactionID: '9', dateTime: '20261105;202000', amount: '-5', description: 'USD DEBIT INT FOR OCT-2026' },
      { type: 'Broker Interest Paid', transactionID: '10', dateTime: '20261106;202000', amount: '2', description: 'USD DEBIT INT FOR OCT-2026' },
    ))
    const res = applyFlexOrders(first.portfolio, [], id, later.cash)
    expect(res.portfolio.marginInterest!.find(m => m.currency === 'USD')!.amount).toBe(43)
  })

  it('interesse già inserito a mano e uguale: si collega; diverso: da controllare', () => {
    const same = applyFlexOrders({ marginInterest: [{ period: '2026-10', currency: 'USD', amount: 40 }] }, [], id, r.cash)
    expect(same.portfolio.marginInterest).toHaveLength(2)
    expect(same.portfolio.marginInterest!.find(m => m.currency === 'USD')).toMatchObject({ amount: 40, externalId: 'MI:2026-10:USD', source: 'ibkr' })
    const diff = applyFlexOrders({ marginInterest: [{ period: '2026-10', currency: 'USD', amount: 99 }] }, [], id, r.cash)
    expect(diff.review.some(s => s.includes('inserito a mano'))).toBe(true)
    expect(diff.portfolio.marginInterest!.find(m => m.currency === 'USD')!.amount).toBe(99)
  })
})

describe('margine dal report Flex', () => {
  const tier = (a: Record<string, string>) =>
    `<TierInterestDetail ${Object.entries({ interestType: 'Debit Interest', reportDate: '2026-11-19', valueDate: '20261118', ...a }).map(([k, v]) => `${k}="${v}"`).join(' ')} />`
  const marginXml = (extra = '') =>
    `<FlexQueryResponse><FlexStatements><FlexStatement fromDate="20261119" toDate="20261119"><AccountInformation currency="EUR" />` +
    `<CashReport><CashReportCurrency currency="BASE_SUMMARY" levelOfDetail="BaseCurrency" toDate="20261119" endingCash="-9747.599" />` +
    `<CashReportCurrency currency="USD" levelOfDetail="Currency" toDate="20261119" endingCash="-10212.3817" />` +
    `<CashReportCurrency currency="EUR" levelOfDetail="Currency" toDate="20261119" endingCash="250.5" /></CashReport>` +
    `<InterestAccruals><InterestAccrualsCurrency currency="BASE_SUMMARY" toDate="20261119" endingAccrualBalance="-47.18" />` +
    `<InterestAccrualsCurrency currency="USD" toDate="20261119" endingAccrualBalance="-49.66" /></InterestAccruals>` +
    `<TierInterestDetails>${tier({ currency: 'USD', tierBreak: 'I', totalPrincipal: '-10171.68', rate: '5.38', totalInterest: '-1.52' })}${extra}</TierInterestDetails>` +
    `</FlexStatement></FlexQueryResponse>`

  it('legge saldo per valuta, totale in euro, maturato e tasso del giorno', () => {
    const m = parseFlex(marginXml()).margin
    expect(m.date).toBe('2026-11-19')
    expect(m.baseCash).toBe(-9747.6)
    expect(m.balances).toEqual([
      { currency: 'EUR', endingCash: 250.5, accrued: 0 },
      { currency: 'USD', endingCash: -10212.38, accrued: -49.66 },
    ])
    expect(m.days).toEqual([{ date: '2026-11-18', currency: 'USD', principal: -10171.68, ratePct: 5.38, interest: -1.52 }])
  })

  it('somma i gradini di tasso dello stesso giorno con tasso medio pesato', () => {
    const m = parseFlex(marginXml(tier({ currency: 'USD', tierBreak: 'II', totalPrincipal: '-30000', rate: '4.38', totalInterest: '-3.6' }))).margin
    expect(m.days).toHaveLength(1)
    expect(m.days[0]).toMatchObject({ principal: -40171.68, interest: -5.12 })
    expect(m.days[0]!.ratePct).toBeCloseTo((5.38 * 10171.68 + 4.38 * 30000) / 40171.68, 3)
  })

  it('salva foto e giorni senza doppioni e con il tasso solo sulle valute a debito', () => {
    const margin = parseFlex(marginXml()).margin
    const first = applyFlexOrders({ assets: {} }, [], () => 'x', [], margin)
    expect(first.changed).toBe(true)
    expect(first.portfolio.marginStatus).toMatchObject({ date: '2026-11-19', baseCash: -9747.6 })
    expect(first.portfolio.marginStatus!.balances.map(b => [b.currency, b.ratePct])).toEqual([['EUR', null], ['USD', 5.38]])
    expect(first.portfolio.marginDaily).toHaveLength(1)

    const again = applyFlexOrders(first.portfolio, [], () => 'y', [], margin)
    expect(again.changed).toBe(false)
  })

  it('un report più vecchio non sostituisce la foto più recente', () => {
    const margin = parseFlex(marginXml()).margin
    const first = applyFlexOrders({ assets: {} }, [], () => 'x', [], margin)
    const older = { ...margin, date: '2026-11-10', baseCash: -1, days: [] }
    const r = applyFlexOrders(first.portfolio, [], () => 'y', [], older)
    expect(r.changed).toBe(false)
    expect(r.portfolio.marginStatus!.date).toBe('2026-11-19')
  })
})

describe('copertura dello storico del margine', () => {
  const xml = `<FlexQueryResponse><FlexStatements><FlexStatement fromDate="20260101" toDate="20261119"><AccountInformation currency="EUR" /><CashReport><CashReportCurrency currency="USD" levelOfDetail="Currency" toDate="20261119" endingCash="-100" /></CashReport></FlexStatement></FlexStatements></FlexQueryResponse>`
  it('ricorda il primo giorno coperto e non lo sposta con report più recenti', () => {
    const m = parseFlex(xml).margin
    const first = applyFlexOrders({ assets: {} }, [], () => 'x', [], m)
    expect(first.portfolio.marginHistoryFrom).toBe('2026-01-01')
    const later = applyFlexOrders(first.portfolio, [], () => 'y', [], { ...m, from: '2026-11-19', date: '2026-11-20' })
    expect(later.portfolio.marginHistoryFrom).toBe('2026-01-01')
  })
})

describe('stesso ISIN su mercati e valute diverse', () => {
  it('assegna l’ordine al titolo con la stessa valuta (Alibaba: BABA in USD, AHLA in EUR)', () => {
    const xml = report(trade({ symbol: 'AHLA', isin: 'US01609W1027', currency: 'EUR', fxRateToBase: '1', listingExchange: 'IBIS', ibCommissionCurrency: 'EUR', tradeDate: '20260611', buySell: 'SELL', openCloseIndicator: 'C', quantity: '-10', tradePrice: '96', ibCommission: '-1.2', ibOrderID: '9', tradeID: 'z' }))
    const p: SyncPortfolio = {
      assets: {
        baba: { ticker: 'BABA', isin: 'US01609W1027', valuta: 'USD', transactions: [{ id: 'b1', date: '2026-05-07', type: 'buy', qty: 10, price: 143 }] },
        ahla: { ticker: 'AHLA.DE', isin: 'US01609W1027', valuta: 'EUR', transactions: [{ id: 'a1', date: '2026-06-11', type: 'sell', qty: 10, price: 96 }] },
      },
    }
    const r = applyFlexOrders(p, parseFlex(xml).orders, () => 'n')
    expect(r.added).toHaveLength(0)
    expect(r.linked).toHaveLength(1)
    expect(r.portfolio.assets!.ahla!.transactions![0]).toMatchObject({ externalId: '9@2026-06-11', commission: 1.2 })
    expect(r.portfolio.assets!.baba!.transactions).toHaveLength(1)
  })
})
