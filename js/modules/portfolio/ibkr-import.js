// ibkr-import.js
// Dal risultato di parseFlexXml (ibkr-flex.js) a un piano di import e alla sua applicazione.
// Nessuna dipendenza dal DOM: buildImportPlan non modifica nulla, applyImportPlan modifica
// solo l'oggetto portfolio che gli passi (poi salvi tu con _save / _persistPortfolioState).
// Regola: il report IBKR vince sui movimenti inseriti a mano.

const TRADE_TYPES = ['buy', 'sell', 'short_sell', 'buy_to_cover'];
const DAY = 864e5;
const daysBetween = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;
const round2 = (x) => Math.round(x * 100) / 100;
// Stessa regola di _aggiungiTitolo in index.js
const sanitizeId = (s) => String(s).replace(/[.$#[\]/]/g, '_');

export function newTxId() {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── ID dei movimenti (migrazione una tantum, poi idempotente) ──
function forEachTx(state, fn) {
    for (const pf of Object.values(state?.portfolios || {})) {
        for (const a of Object.values(pf.assets || {})) {
            for (const tx of (a.transactions || [])) fn(tx, a, pf);
        }
    }
}
export function countTxWithoutId(state) {
    let n = 0;
    forEachTx(state, (tx) => { if (!tx.id) n++; });
    return n;
}
export function ensureTxIds(state) {
    let n = 0;
    forEachTx(state, (tx) => { if (!tx.id) { tx.id = newTxId(); n++; } });
    return n;
}

// ── Da simbolo IBKR a ticker Yahoo (quello che il sito usa in `nome` e `ticker`) ──
const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'ARCA', 'AMEX', 'NYSEARCA', 'NYSEAMERICAN', 'BATS', 'IEX', 'ISLAND', 'PINK']);
const SUFFIX = { BVME: '.MI', IBIS: '.DE', FWB: '.F', SBF: '.PA', AEB: '.AS', EBS: '.SW', LSE: '.L', BME: '.MC',
                 'ENEXT.BE': '.BR', BVL: '.LS', VENTURE: '.V', TSE: '.TO', SEHK: '.HK', ASX: '.AX' };

export function yahooTickerFor({ symbol, listingExchange }) {
    const ex = String(listingExchange || '').toUpperCase();
    let s = String(symbol || '').trim().replace(/ /g, '-'); // 'BRK B' -> 'BRK-B'
    if (US_EXCHANGES.has(ex)) return { ticker: s, confident: true };
    if (SUFFIX[ex]) {
        if (ex === 'BVME') s = s.replace(/m$/, ''); // IBKR aggiunge una 'm' minuscola ai titoli di Borsa Italiana
        return { ticker: s + SUFFIX[ex], confident: true };
    }
    return { ticker: s, confident: false, note: `Borsa "${listingExchange || 'n/d'}" non riconosciuta: controlla il ticker` };
}

// ── Piano di import: non modifica nulla ──
export function buildImportPlan(parsed, portfolio, opts = {}) {
    const { tickerOverrides = {}, dateTolDays = 1, transferTolDays = 10, priceTol = 0.005 } = opts;
    const assets = portfolio.assets || {};
    const plan = {
        meta: parsed.meta,
        accountMismatch: false,
        warnings: [],
        assetMap: [],
        newAssets: [],
        // matched = stesso movimento (valori quasi uguali); probable = stesso titolo/tipo/giorno ma
        // quantità o prezzo diversi: probabile errore di inserimento, da correggere con IBKR
        trades: { toAdd: [], matched: [], probable: [], alreadyImported: [], unmatchedManual: [] },
        transfers: { matched: [], alreadyImported: [], unmatched: [] },
        interest: { toAdd: [], matched: [], updated: [], alreadyImported: [] },
        toClassify: [...parsed.toClassify]
    };

    const prevHint = portfolio.import?.accountHint;
    if (prevHint && parsed.meta.accountHint && prevHint !== parsed.meta.accountHint) plan.accountMismatch = true;

    // I trasferimenti non riportano la borsa di quotazione: la recuperiamo da trade e posizioni
    const exByConid = new Map();
    const exBySymbol = new Map();
    for (const t of [...parsed.trades, ...(parsed.positions || [])]) {
        if (t.listingExchange) { exByConid.set(t.conid, t.listingExchange); exBySymbol.set(t.symbol, t.listingExchange); }
    }

    // Titoli: per ISIN, poi per ticker, altrimenti nuovo
    const resolved = new Map();
    const resolve = (rawItem) => {
        const item = { ...rawItem, listingExchange: rawItem.listingExchange
            || exByConid.get(rawItem.conid) || exBySymbol.get(rawItem.symbol) || '' };
        const key = `${item.symbol}|${item.listingExchange}`;
        if (resolved.has(key)) return resolved.get(key);
        const guess = yahooTickerFor(item);
        const ticker = tickerOverrides[item.symbol] || guess.ticker;
        const isin = String(item.isin || '').toUpperCase();
        let assetId = Object.keys(assets).find((k) => isin && String(assets[k].isin || '').toUpperCase() === isin);
        if (!assetId) {
            assetId = Object.keys(assets).find((k) =>
                String(assets[k].ticker || assets[k].nome || '').toUpperCase() === ticker.toUpperCase());
        }
        if (!assetId) assetId = sanitizeId(ticker);
        const exists = !!assets[assetId];
        const info = { key, symbol: item.symbol, ticker, isin: item.isin || '', currency: item.currency,
                       listingExchange: item.listingExchange || '', assetId, exists,
                       confident: !!tickerOverrides[item.symbol] || guess.confident, note: guess.note || '' };
        if (exists && assets[assetId].valuta && item.currency && assets[assetId].valuta !== item.currency) {
            plan.warnings.push(`${ticker}: nel sito la valuta è ${assets[assetId].valuta}, IBKR indica ${item.currency}`);
        }
        resolved.set(key, info);
        plan.assetMap.push(info);
        if (!exists) plan.newAssets.push(info);
        return info;
    };

    // Movimenti già nel sito
    const imported = new Set();
    const manual = [];
    const manualTransfers = [];
    for (const [assetId, a] of Object.entries(assets)) {
        for (const tx of (a.transactions || [])) {
            if (tx.externalId) imported.add(tx.externalId);
            else if (TRADE_TYPES.includes(tx.type)) manual.push({ assetId, tx, used: false });
            else if (tx.type === 'transfer' && tx.sourcePortfolioId) manualTransfers.push({ assetId, tx, used: false });
        }
    }

    const diffOf = (tx, t) => {
        const oldComm = +(tx.commission || 0);
        const oldCur = tx.commissionCurrency || 'EUR';
        const newCur = t.commissionCurrency || 'EUR';
        return {
            date: tx.date !== t.date ? [tx.date, t.date] : null,
            qty: Math.abs(+tx.qty - t.qty) > 1e-6 ? [+tx.qty, t.qty] : null,
            price: Math.abs(+tx.price - t.price) > 1e-6 ? [+tx.price, t.price] : null,
            commission: (Math.abs(oldComm - t.commission) > 0.005 || oldCur !== newCur)
                ? [{ amount: oldComm, currency: oldCur }, { amount: t.commission, currency: newCur }] : null
        };
    };

    // Compravendite, in ordine cronologico
    const sorted = [...parsed.trades].sort((a, b) =>
        (a.date + (a.dateTime || '')).localeCompare(b.date + (b.dateTime || '')));

    // Passo 1: abbinamenti esatti (prima di tutto, così un probabile non "ruba" un movimento giusto)
    const leftover = [];
    for (const t of sorted) {
        const info = resolve(t);
        if (imported.has(t.externalId)) { plan.trades.alreadyImported.push({ trade: t, assetId: info.assetId }); continue; }
        const cand = manual
            .filter((m) => !m.used && m.assetId === info.assetId && m.tx.type === t.type
                && Math.abs(+m.tx.qty - t.qty) < 1e-6
                && Math.abs(+m.tx.price - t.price) <= t.price * priceTol
                && daysBetween(m.tx.date, t.date) <= dateTolDays)
            .sort((x, y) => (daysBetween(x.tx.date, t.date) - daysBetween(y.tx.date, t.date))
                || (Math.abs(+x.tx.price - t.price) - Math.abs(+y.tx.price - t.price)))[0];
        if (cand) {
            cand.used = true;
            plan.trades.matched.push({ trade: t, assetId: cand.assetId, tx: cand.tx, diff: diffOf(cand.tx, t) });
        } else {
            leftover.push({ t, info });
        }
    }

    // Passo 2: abbinamenti probabili (stesso titolo, tipo e giorno ±1, ma quantità o prezzo diversi)
    for (const { t, info } of leftover) {
        const cand = manual
            .filter((m) => !m.used && m.assetId === info.assetId && m.tx.type === t.type
                && daysBetween(m.tx.date, t.date) <= dateTolDays)
            .sort((x, y) => (daysBetween(x.tx.date, t.date) - daysBetween(y.tx.date, t.date))
                || (Math.abs(+x.tx.qty - t.qty) - Math.abs(+y.tx.qty - t.qty)))[0];
        if (cand) {
            cand.used = true;
            plan.trades.probable.push({ trade: t, assetId: cand.assetId, tx: cand.tx, diff: diffOf(cand.tx, t) });
        } else {
            plan.trades.toAdd.push({ trade: t, assetId: info.assetId });
        }
    }

    // Movimenti manuali nel periodo del report senza corrispondenza (esclusi quelli che hai deciso di tenere)
    plan.trades.unmatchedManual = manual
        .filter((m) => !m.used && !m.tx.ibkrKeep
            && (!parsed.meta.from || m.tx.date >= parsed.meta.from)
            && (!parsed.meta.to || m.tx.date <= parsed.meta.to))
        .map(({ assetId, tx }) => ({ assetId, txId: tx.id || null, tx }));

    // Trasferimenti in ingresso: si abbinano a quelli già creati nel sito (il costo arriva dal portafoglio d'origine)
    for (const tr of parsed.transfers) {
        if (tr.direction !== 'IN') {
            plan.toClassify.push({ kind: 'trasferimento-in-uscita', date: tr.date, symbol: tr.symbol,
                                   detail: `${tr.qty} ${tr.symbol}` });
            continue;
        }
        const info = resolve(tr);
        if (imported.has(tr.externalId)) { plan.transfers.alreadyImported.push({ transfer: tr, assetId: info.assetId }); continue; }
        const cand = manualTransfers
            .filter((m) => !m.used && m.assetId === info.assetId && Math.abs(+m.tx.qty - tr.qty) < 1e-6
                && daysBetween(m.tx.date, tr.date) <= transferTolDays)
            .sort((x, y) => daysBetween(x.tx.date, tr.date) - daysBetween(y.tx.date, tr.date))[0];
        if (cand) {
            cand.used = true;
            plan.transfers.matched.push({ transfer: tr, assetId: info.assetId, tx: cand.tx });
        } else {
            plan.transfers.unmatched.push({ transfer: tr, assetId: info.assetId, ticker: info.ticker, assetExists: info.exists });
        }
    }

    // Interessi di margine mensili -> stessa struttura della tab Interessi ({ period, currency, amount })
    const agg = new Map();
    for (const m of parsed.marginInterest) {
        if (!m.period) continue;
        const k = `${m.period}|${m.currency}`;
        agg.set(k, (agg.get(k) || 0) + m.cost);
    }
    const rows = portfolio.marginInterest || [];
    for (const [k, total] of agg) {
        const [period, currency] = k.split('|');
        const amount = round2(total);
        if (amount <= 0.004) continue;
        const externalId = `MI:${period}:${currency}`;
        const byExt = rows.find((r) => r.externalId === externalId);
        if (byExt) {
            if (Math.abs(byExt.amount - amount) > 0.004) plan.interest.updated.push({ row: byExt, amount, externalId });
            else plan.interest.alreadyImported.push({ period, currency, amount });
            continue;
        }
        const manualRow = rows.find((r) => !r.externalId && r.period === period && r.currency === currency);
        if (manualRow) plan.interest.matched.push({ row: manualRow, period, currency, amount, externalId, previous: manualRow.amount });
        else plan.interest.toAdd.push({ period, currency, amount, externalId });
    }

    return plan;
}

// Titoli nuovi con ticker incerto: vanno confermati prima di crearli
const uncertainNew = (plan) => plan.newAssets.filter((a) => !a.confident);

// Quante cose richiedono una decisione (badge "N da rivedere")
export function reviewCount(plan, dismissed = []) {
    if (!plan) return 0;
    const seen = new Set(dismissed);
    return (plan.accountMismatch ? 1 : 0)
        + uncertainNew(plan).length
        + plan.trades.probable.length
        + plan.trades.unmatchedManual.length
        + plan.transfers.unmatched.length
        + plan.warnings.length
        + plan.toClassify.filter((x) => !seen.has(classifyKey(x))).length;
}

export const classifyKey = (x) => `${x.kind}|${x.date}|${x.symbol}|${x.detail}`;

// Quante modifiche produrrebbe l'import "solo sicuri" (0 = niente da salvare)
export function safeChangeCount(plan) {
    if (!plan) return 0;
    const blocked = new Set(uncertainNew(plan).map((a) => a.assetId));
    return plan.trades.toAdd.filter((x) => !blocked.has(x.assetId)).length
        + plan.trades.matched.length + plan.transfers.matched.length
        + plan.interest.toAdd.length + plan.interest.matched.length + plan.interest.updated.length;
}

// ── Applicazione: modifica `portfolio` in memoria. Idempotente: un secondo import dello stesso file non cambia nulla. ──
// Opzioni:
//   onlySafe       true = import automatico: applica solo ciò che non richiede decisioni
//   acceptProbable Set di externalId dei probabili da correggere con IBKR (null = tutti, il report vince)
//   manualActions  { [txId]: 'delete' | 'keep' } per i movimenti manuali senza corrispondenza
export function applyImportPlan(plan, portfolio, opts = {}) {
    const { adoptValues = true, force = false, now = new Date(), onlySafe = false,
            acceptProbable = null, manualActions = {} } = opts;
    if (plan.accountMismatch && !force) throw new Error('Il file sembra di un altro conto IBKR: import annullato');
    if (!portfolio.assets) portfolio.assets = {};
    const assets = portfolio.assets;
    const summary = { added: 0, linked: 0, corrected: 0, deleted: 0, kept: 0, assetsCreated: 0,
                      transfersMatched: 0, interestAdded: 0, interestUpdated: 0, leftForReview: 0 };

    const blocked = new Set(onlySafe ? uncertainNew(plan).map((a) => a.assetId) : []);

    // Titoli nuovi + ISIN sui titoli esistenti che non lo avevano (serve ai match futuri)
    for (const info of plan.assetMap) {
        if (blocked.has(info.assetId)) continue;
        if (!assets[info.assetId]) {
            assets[info.assetId] = { nome: info.ticker, ticker: info.ticker, isin: info.isin, valuta: info.currency || 'EUR',
                                     tipoAsset: 'stock', transactions: [], commDefault: 7 };
            summary.assetsCreated++;
        } else if (!assets[info.assetId].isin && info.isin) {
            assets[info.assetId].isin = info.isin;
        }
    }

    const touched = new Set();
    const addTrade = (t, assetId) => {
        const a = assets[assetId];
        if (!a.transactions) a.transactions = [];
        a.transactions.push({
            id: newTxId(), date: t.date, type: t.type, qty: t.qty, price: t.price, commission: t.commission,
            ...(t.commissionCurrency && t.commissionCurrency !== 'EUR' ? { commissionCurrency: t.commissionCurrency } : {}),
            source: 'ibkr', externalId: t.externalId, ibkrFx: t.fxToBase
        });
        touched.add(assetId);
        summary.added++;
    };
    const adopt = (tx, t, withQty) => {
        if (!tx.id) tx.id = newTxId();
        tx.externalId = t.externalId;
        tx.source = 'ibkr';
        tx.ibkrFx = t.fxToBase;
        delete tx.ibkrKeep;
        if (!adoptValues) return;
        tx.date = t.date;
        if (withQty) tx.qty = t.qty;
        tx.price = t.price;
        tx.commission = t.commission;
        if (t.commissionCurrency && t.commissionCurrency !== 'EUR') tx.commissionCurrency = t.commissionCurrency;
        else delete tx.commissionCurrency;
        // una scelta di lotti fatta su una quantità diversa non è più valida
        if (withQty && tx.lotAllocation) delete tx.lotAllocation;
    };

    for (const { trade: t, assetId } of plan.trades.toAdd) {
        if (blocked.has(assetId)) { summary.leftForReview++; continue; }
        addTrade(t, assetId);
    }

    for (const m of plan.trades.matched) {
        const changed = Object.values(m.diff || {}).some(Boolean);
        adopt(m.tx, m.trade, false);
        touched.add(m.assetId);
        summary.linked++;
        if (changed && adoptValues) summary.corrected++;
    }

    for (const p of plan.trades.probable) {
        if (onlySafe) { summary.leftForReview++; continue; }
        const accepted = !acceptProbable || acceptProbable.has(p.trade.externalId);
        if (accepted) {
            adopt(p.tx, p.trade, true);
            touched.add(p.assetId);
            summary.linked++;
            summary.corrected++;
        } else {
            // Hai detto che sono due operazioni diverse: aggiungo quella di IBKR e tengo la tua
            addTrade(p.trade, p.assetId);
            p.tx.ibkrKeep = true;
        }
    }

    if (!onlySafe) {
        for (const u of plan.trades.unmatchedManual) {
            const action = u.txId ? manualActions[u.txId] : null;
            const list = assets[u.assetId]?.transactions;
            if (!action || !list) continue;
            const idx = list.findIndex((tx) => tx === u.tx || (u.txId && tx.id === u.txId));
            if (idx < 0) continue;
            if (action === 'delete') { list.splice(idx, 1); summary.deleted++; }
            else if (action === 'keep') { list[idx].ibkrKeep = true; summary.kept++; }
        }
    }

    for (const m of plan.transfers.matched) {
        if (!m.tx.id) m.tx.id = newTxId();
        m.tx.externalId = m.transfer.externalId;
        summary.transfersMatched++;
    }

    // L'ordine nell'array conta per LIFO: sort stabile per data, i nuovi entrano già in ordine di orario
    for (const id of touched) {
        assets[id].transactions.sort((a, b) => a.date.localeCompare(b.date));
    }

    if (!portfolio.marginInterest) portfolio.marginInterest = [];
    for (const m of plan.interest.toAdd) {
        portfolio.marginInterest.push({ id: 'MI' + newTxId(), period: m.period, currency: m.currency, amount: m.amount,
                                        source: 'ibkr', externalId: m.externalId });
        summary.interestAdded++;
    }
    for (const m of plan.interest.matched) {
        m.row.externalId = m.externalId; m.row.source = 'ibkr'; m.row.amount = m.amount;
        summary.interestUpdated++;
    }
    for (const m of plan.interest.updated) {
        m.row.amount = m.amount;
        summary.interestUpdated++;
    }

    portfolio.import = { broker: 'ibkr', accountHint: plan.meta.accountHint,
                         lastReportTo: plan.meta.to, lastImportAt: now.toISOString() };
    return summary;
}