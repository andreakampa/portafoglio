// ibkr-flex.js
// Parser puro dell'Activity Flex Query di IBKR (XML). Nessuna dipendenza dal sito,
// non scrive nulla: legge il testo XML e restituisce dati normalizzati.
// Uso previsto: parseFlexXml(testo) -> anteprima -> reconcileTrades(...) -> conferma utente.

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
                 JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
const round = (x, d = 6) => Math.round(x * 10 ** d) / 10 ** d;
const all = (doc, tag) => Array.from(doc.getElementsByTagName(tag));
const attr = (el, name) => el.getAttribute(name) || '';

// '20261105' o '20260612;202000' -> '2026-11-05'
const iso = (d) => {
    const s = String(d || '').replace(/\D/g, '').slice(0, 8);
    return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
};

// 'DEBIT INT FOR OCT-2026' -> '2026-10'
const monthKey = (text) => {
    const m = /([A-Z]{3})-(\d{4})/.exec(text || '');
    return m && MONTHS[m[1]] ? `${m[2]}-${MONTHS[m[1]]}` : null;
};

export function parseFlexXml(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('File XML non valido');
    const stmt = doc.getElementsByTagName('FlexStatement')[0];
    if (!stmt) throw new Error('Non sembra un report Flex di IBKR (manca FlexStatement)');
    const info = doc.getElementsByTagName('AccountInformation')[0];

    const meta = {
        queryName: attr(doc.documentElement, 'queryName'),
        from: iso(attr(stmt, 'fromDate')),
        to: iso(attr(stmt, 'toDate')),
        generatedAt: attr(stmt, 'whenGenerated'),
        baseCurrency: (info && attr(info, 'currency')) || 'EUR',
        // ultimi 3 caratteri dell'ID conto: serve solo a evitare di importare
        // il file di un altro conto nel portafoglio sbagliato
        accountHint: attr(stmt, 'accountId').slice(-3)
    };

    const toClassify = []; // cose che NON importiamo in automatico: le mostra l'anteprima
    const counts = { cashTrades: 0 };

    // ── Trade azionari: un movimento per ORDINE (le esecuzioni parziali si sommano) ──
    const orders = new Map();
    for (const t of all(doc, 'Trade')) {
        const cat = attr(t, 'assetCategory');
        const date = iso(attr(t, 'tradeDate'));
        if (cat === 'CASH') { counts.cashTrades++; continue; } // conversioni valuta
        if (cat !== 'STK') {
            toClassify.push({ kind: 'strumento-non-supportato', date, symbol: attr(t, 'symbol'),
                              detail: `${cat} ${attr(t, 'buySell')} ${attr(t, 'quantity')} @ ${attr(t, 'tradePrice')}` });
            continue;
        }
        const side = attr(t, 'buySell');
        const oc = attr(t, 'openCloseIndicator');
        let type = null;
        if (oc === 'O') type = side === 'BUY' ? 'buy' : 'short_sell';
        else if (oc === 'C') type = side === 'BUY' ? 'buy_to_cover' : 'sell';
        if (!type) {
            toClassify.push({ kind: 'apertura-chiusura-mista', date, symbol: attr(t, 'symbol'),
                              detail: `${side} ${attr(t, 'quantity')} (${oc || 'n/d'})` });
            continue;
        }
        const externalId = `${attr(t, 'ibOrderID')}@${date}`;
        let o = orders.get(externalId);
        if (!o) {
            o = { externalId, source: 'ibkr', date, type, symbol: attr(t, 'symbol'), isin: attr(t, 'isin'),
                  conid: attr(t, 'conid'), currency: attr(t, 'currency'), listingExchange: attr(t, 'listingExchange'),
                  dateTime: '', qty: 0, notional: 0, commission: 0, commissionCurrency: attr(t, 'ibCommissionCurrency') || attr(t, 'currency'),
                  fxToBase: n(attr(t, 'fxRateToBase')), executions: [] };
            orders.set(externalId, o);
        }
        const dt = attr(t, 'dateTime'); // serve a ordinare i trade dello stesso giorno
        if (dt && (!o.dateTime || dt < o.dateTime)) o.dateTime = dt;
        const q = Math.abs(n(attr(t, 'quantity')));
        o.qty += q;
        o.notional += q * n(attr(t, 'tradePrice'));
        o.commission += Math.abs(n(attr(t, 'ibCommission')));
        o.executions.push(attr(t, 'tradeID'));
    }
    const trades = [...orders.values()].map(({ notional, ...o }) => ({
        ...o, qty: round(o.qty), price: round(o.qty ? notional / o.qty : 0), commission: round(o.commission, 4)
    }));

    // ── Trasferimenti di titoli (ACATS/FOP): NON sono acquisti, il costo fiscale viene dal broker di origine ──
    const transfers = all(doc, 'Transfer').map((t) => ({
        externalId: `T${attr(t, 'transactionID')}`, date: iso(attr(t, 'date')), symbol: attr(t, 'symbol'),
        isin: attr(t, 'isin'), conid: attr(t, 'conid'), direction: attr(t, 'direction'), kind: attr(t, 'type'),
        qty: Math.abs(n(attr(t, 'quantity'))), valoreAlTrasferimento: n(attr(t, 'positionAmount')),
        currency: attr(t, 'currency')
    }));

    // ── Movimenti di cassa ──
    const out = { marginInterest: [], creditInterest: [], lendingIncome: [], paymentInLieu: [],
                  brokerFees: [], dividends: [], withholding: [], deposits: [] };
    for (const c of all(doc, 'CashTransaction')) {
        const type = attr(c, 'type');
        const desc = attr(c, 'description');
        const row = { externalId: `C${attr(c, 'transactionID')}`, date: iso(attr(c, 'dateTime') || attr(c, 'reportDate')),
                      currency: attr(c, 'currency'), amount: n(attr(c, 'amount')), description: desc,
                      symbol: attr(c, 'symbol') };
        if (type === 'Broker Interest Paid') {
            // costo positivo; uno storno (importo positivo) diventa costo negativo
            out.marginInterest.push({ ...row, period: monthKey(desc), cost: round(-row.amount, 4) });
        } else if (type === 'Broker Interest Received') {
            if (/SYEP/i.test(desc)) out.lendingIncome.push({ ...row, period: monthKey(desc) });
            else out.creditInterest.push({ ...row, period: monthKey(desc) });
        } else if (type === 'Payment In Lieu Of Dividends') out.paymentInLieu.push(row);
        else if (type === 'Other Fees') out.brokerFees.push(row);
        else if (type === 'Dividends') out.dividends.push(row);
        else if (type === 'Withholding Tax') out.withholding.push(row);
        else if (type === 'Deposits/Withdrawals') out.deposits.push(row);
    }

    // ── Interessi giornalieri (saldo, tasso, importo) ──
    const interestDaily = all(doc, 'TierInterestDetail').map((d) => ({
        date: iso(attr(d, 'valueDate')), currency: attr(d, 'currency'),
        kind: attr(d, 'interestType') === 'Debit Interest' ? 'debit' : 'credit',
        principal: n(attr(d, 'totalPrincipal')), ratePct: n(attr(d, 'rate')), interest: n(attr(d, 'totalInterest'))
    }));

    // Interessi maturati e non ancora addebitati, per valuta
    const accruals = all(doc, 'InterestAccrualsCurrency')
        .filter((a) => attr(a, 'currency') !== 'BASE_SUMMARY')
        .map((a) => ({ currency: attr(a, 'currency'), accrued: n(attr(a, 'interestAccrued')),
                       reversal: n(attr(a, 'accrualReversal')), ending: n(attr(a, 'endingAccrualBalance')) }));

    // ── Prestito titoli (SYEP): aggregato per mese e titolo, per non gonfiare il database ──
    const lendMap = new Map();
    for (const f of all(doc, 'SLBFee')) {
        const period = iso(attr(f, 'valueDate')).slice(0, 7);
        const key = `${period}|${attr(f, 'symbol')}|${attr(f, 'currency')}`;
        const r = lendMap.get(key) || { period, symbol: attr(f, 'symbol'), isin: attr(f, 'isin'),
                                        currency: attr(f, 'currency'), netLendFee: 0, grossLendFee: 0 };
        r.netLendFee += n(attr(f, 'netLendFee'));
        r.grossLendFee += n(attr(f, 'grossLendFee'));
        lendMap.set(key, r);
    }
    const lendingMonthly = [...lendMap.values()].map((r) => ({
        ...r, netLendFee: round(r.netLendFee, 4), grossLendFee: round(r.grossLendFee, 4) }));
    const lendingOpen = all(doc, 'SLBOpenContract').map((c) => ({
        symbol: attr(c, 'symbol'), isin: attr(c, 'isin'), qty: Math.abs(n(attr(c, 'quantity'))),
        feeRatePct: n(attr(c, 'feeRate')), currency: attr(c, 'currency') }));

    // Borrow fee sugli short (compare solo per i titoli difficili da prendere in prestito).
    // Struttura non ancora verificata su dati reali: restituiamo gli attributi grezzi.
    const hardToBorrow = all(doc, 'HardToBorrowDetail').map((el) =>
        Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value])));

    // Posizioni aperte (solo righe riepilogo) per verificare i totali dopo l'import
    const positions = all(doc, 'OpenPosition')
        .filter((p) => attr(p, 'levelOfDetail') === 'SUMMARY')
        .map((p) => ({ symbol: attr(p, 'symbol'), isin: attr(p, 'isin'), conid: attr(p, 'conid'),
                       listingExchange: attr(p, 'listingExchange'), assetCategory: attr(p, 'assetCategory'),
                       qty: n(attr(p, 'position')), side: attr(p, 'side'), currency: attr(p, 'currency'),
                       markPrice: n(attr(p, 'markPrice')) }));

    // ── Voci da classificare a mano ──
    for (const g of all(doc, 'StockGrantActivity')) {
        toClassify.push({ kind: 'premio-in-azioni', date: iso(attr(g, 'reportDate')), symbol: attr(g, 'symbol'),
                          detail: `${attr(g, 'quantity')} azioni, valore ${attr(g, 'value')} ${attr(g, 'currency')}` });
    }
    for (const t of all(doc, 'TransactionTax')) {
        toClassify.push({ kind: 'tassa-transazioni', date: iso(attr(t, 'date')), symbol: attr(t, 'symbol'),
                          detail: `${attr(t, 'taxDescription')} ${attr(t, 'taxAmount')} ${attr(t, 'currency')}` });
    }

    return { meta, trades, transfers, ...out, interestDaily, accruals,
             lending: { monthly: lendingMonthly, open: lendingOpen }, hardToBorrow, positions, toClassify, counts };
}

// ── Riconciliazione con i movimenti già presenti nel sito ──
// assets = portfolio.assets ({ [id]: { simbolo, isin?, transactions: [...] } }).
// Non modifica nulla: restituisce cosa è già importato, cosa abbinare, cosa aggiungere.
export function reconcileTrades(trades, assets, { from = null, to = null, priceTol = 0.005 } = {}) {
    const TYPES = ['buy', 'sell', 'short_sell', 'buy_to_cover'];
    const imported = new Set();
    const manual = [];
    for (const [assetId, a] of Object.entries(assets || {})) {
        (a.transactions || []).forEach((tx, idx) => {
            if (tx.externalId) imported.add(tx.externalId);
            else if (TYPES.includes(tx.type)) manual.push({ assetId, idx, tx, used: false });
        });
    }

    const sameTitle = (m, t) => {
        const a = assets[m.assetId] || {};
        return (a.isin && a.isin === t.isin) || a.simbolo === t.symbol ? 1 : 0;
    };

    const result = { alreadyImported: [], matched: [], toAdd: [], unmatchedManual: [] };
    for (const t of trades) {
        if (imported.has(t.externalId)) { result.alreadyImported.push(t); continue; }
        const candidates = manual
            .filter((m) => !m.used && m.tx.date === t.date && m.tx.type === t.type
                && Math.abs(+m.tx.qty - t.qty) < 1e-6
                && Math.abs(+m.tx.price - t.price) <= t.price * priceTol)
            .sort((x, y) => sameTitle(y, t) - sameTitle(x, t));
        if (candidates.length) {
            candidates[0].used = true;
            result.matched.push({ trade: t, assetId: candidates[0].assetId, txIndex: candidates[0].idx });
        } else {
            result.toAdd.push(t);
        }
    }
    // Movimenti manuali dentro il periodo del report ma senza corrispondenza nel file
    result.unmatchedManual = manual
        .filter((m) => !m.used && (!from || m.tx.date >= from) && (!to || m.tx.date <= to))
        .map(({ assetId, idx, tx }) => ({ assetId, txIndex: idx, tx }));
    return result;
}