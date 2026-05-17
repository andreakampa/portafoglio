import { Exchange } from '../../api/exchange.js';
import { getAvailableMinusForPreview } from '../../api/fiscale.js';

export const Calc = {

    buildDashboardTaxMetrics(portfolio, fiscalState = null) {
    let realizedLordoEur = 0;
    let realizedNettoTeoricoEur = 0;
    let realizedNettoEffettivoEur = 0;

    let rollingMinusStock = 0;
    let rollingMinusCrypto = 0;
    let rollingMinusBond = 0;

    const readMinus = (state, type) => {
        if (!state) return 0;

        if (typeof state === 'object') {
            if (typeof state[type] === 'number') return state[type];
            if (typeof state[`${type}Minus`] === 'number') return state[`${type}Minus`];
            if (typeof state[`${type}Losses`] === 'number') return state[`${type}Losses`];
        }

        return 0;
    };

    if (fiscalState) {
        rollingMinusStock = readMinus(fiscalState, 'stock');
        rollingMinusCrypto = readMinus(fiscalState, 'crypto');
        rollingMinusBond = readMinus(fiscalState, 'bond');
    }

    for (const p of Object.values(portfolio || {})) {
        const txs = [...(p.transactions || [])].sort((a, b) => new Date(a.date) - new Date(b.date));

        let qty = 0;
        let totalCostEur = 0;

        for (const tx of txs) {
            const n = Calc.normalizeTx(tx, p);

            if (tx.type === 'buy') {
                qty += n.qty;
                totalCostEur += n.grossEur + n.commissionEur;
                continue;
            }

            if (tx.type !== 'sell' || n.qty <= 0 || qty <= 0) continue;

            const avgCostEur = qty > 0 ? totalCostEur / qty : 0;
            const costBasisSoldEur = avgCostEur * n.qty;
            const proceedsNetEur = n.grossEur - n.commissionEur;
            const gainEur = proceedsNetEur - costBasisSoldEur;

            qty -= n.qty;
            totalCostEur -= costBasisSoldEur;

            realizedLordoEur += gainEur;

            if (gainEur > 0) {
                const assetType = p.tipoAsset || 'stock';

                let availableMinus = 0;
                if (assetType === 'crypto') availableMinus = rollingMinusCrypto;
                else if (assetType === 'bond') availableMinus = rollingMinusBond;
                else availableMinus = rollingMinusStock;

                const tax = Calc.realizedTaxBreakdown({
                    gainEur,
                    assetType,
                    availableMinus
                });

                realizedNettoTeoricoEur += tax.nettoTeorico;
                realizedNettoEffettivoEur += tax.nettoEffettivo;

                if (assetType === 'crypto') rollingMinusCrypto = Math.max(0, rollingMinusCrypto - tax.minusUsate);
                else if (assetType === 'bond') rollingMinusBond = Math.max(0, rollingMinusBond - tax.minusUsate);
                else rollingMinusStock = Math.max(0, rollingMinusStock - tax.minusUsate);
            } else {
                realizedNettoTeoricoEur += gainEur;
                realizedNettoEffettivoEur += gainEur;
            }
        }
    }

    return {
        realizedLordoEur,
        realizedNettoTeoricoEur,
        realizedNettoEffettivoEur
    };
},

realizedTaxBreakdown({ gainEur, assetType, availableMinus = 0 }) {
    const gain = Math.max(0, +gainEur || 0);
    const minus = Math.max(0, +availableMinus || 0);

    const taxRate =
        assetType === 'bond' ? 0.125 :
        assetType === 'crypto' ? 0.33 :
        0.26;

    const taxTeorica = gain > 0 ? gain * taxRate : 0;
    const nettoTeorico = gain - taxTeorica;

    const minusUsate = Math.min(gain, minus);
    const imponibileCompensato = Math.max(0, gain - minusUsate);
    const taxEffettiva = imponibileCompensato * taxRate;
    const nettoEffettivo = gain - taxEffettiva;

    return {
        taxRate,
        taxTeorica,
        nettoTeorico,
        minusDisponibili: minus,
        minusUsate,
        imponibileCompensato,
        taxEffettiva,
        nettoEffettivo
    };
},

    _assetCurrency(p) {
        return (p?.valuta || 'EUR').toUpperCase();
    },

    _txPriceCurrency(tx, p) {
        return (tx?.priceCurrency || Calc._assetCurrency(p) || 'EUR').toUpperCase();
    },

    _txCommissionCurrency(tx) {
        return (tx?.commissionCurrency || 'EUR').toUpperCase();
    },

    _txRate(tx) {
        const r = parseFloat(tx?.exchangeRate);
        return Number.isFinite(r) && r > 0 ? r : (Exchange.rate || 1);
    },

    _toEur(amount, currency, rate = 1) {
        if (!Number.isFinite(amount)) return 0;
        return (currency || 'EUR').toUpperCase() === 'USD' ? amount / rate : amount;
    },

    _fromEur(amount, currency, rate = 1) {
        if (!Number.isFinite(amount)) return 0;
        return (currency || 'EUR').toUpperCase() === 'USD' ? amount * rate : amount;
    },

    normalizeTx(tx, p) {
        const priceCurrency = Calc._txPriceCurrency(tx, p);
        const commissionCurrency = Calc._txCommissionCurrency(tx);
        const exchangeRate = Calc._txRate(tx);

        const qty = +tx.qty || 0;
        const price = +tx.price || 0;
        const commission = +(tx.commission || 0);

        const grossNative = qty * price;
        const grossEur = Calc._toEur(grossNative, priceCurrency, exchangeRate);
        const commissionEur = Calc._toEur(commission, commissionCurrency, exchangeRate);

        return {
            ...tx,
            qty,
            price,
            commission,
            priceCurrency,
            commissionCurrency,
            exchangeRate,
            grossNative,
            grossEur,
            commissionEur
        };
    },

        previewBuy(p, { qty, price, commission = 0, exchangeRate = null }) {
        const assetCurrency = Calc._assetCurrency(p);
        const rate = exchangeRate || Exchange.rate || 1;
        const { qta, pmc, pmcEur, totalCostEur = 0 } = Calc.positionSync(p);

        const grossNative = qty * price;
        const grossEur = Calc._toEur(grossNative, assetCurrency, rate);
        const commissionEur = commission;
        const totalEur = grossEur + commissionEur;

        const currentCostEur = totalCostEur || Calc._toEur(qta * pmc, assetCurrency, rate);
        const newQta = qta + qty;
        const newTotalCostEur = currentCostEur + totalEur;
        const newPmcEur = newQta > 0 ? newTotalCostEur / newQta : 0;
        const newPmcNative = assetCurrency === 'USD'
            ? Calc._fromEur(newPmcEur, 'USD', rate)
            : newPmcEur;

        return {
            assetCurrency,
            grossNative,
            grossEur,
            commissionEur,
            totalEur,
            newQta,
            newPmcNative,
            newPmcEur,
            currentPmcNative: pmc,
            currentPmcEur: pmcEur || Calc._toEur(pmc, assetCurrency, rate)
        };
    },

    previewSell(p, { qty, price, commission = 0, exchangeRate = null, compensation = null }) {
        const assetCurrency = Calc._assetCurrency(p);
        const rate = exchangeRate || Exchange.rate || 1;
        const { qta, pmc, pmcEur, totalCostEur = 0 } = Calc.positionSync(p);

        const grossNative = qty * price;
        const grossEur = Calc._toEur(grossNative, assetCurrency, rate);
        const commissionEur = commission;

        const costBasisEurPerUnit = qta > 0
            ? ((totalCostEur || Calc._toEur(qta * pmc, assetCurrency, rate)) / qta)
            : 0;

        const costBasisSoldEur = costBasisEurPerUnit * qty;
        const proceedsNetEur = grossEur - commissionEur;
        const pnlLordoEur = proceedsNetEur - costBasisSoldEur;

        const taxPct = p.tipoAsset === 'bond' ? 0.125 : p.tipoAsset === 'crypto' ? 0.33 : 0.26;
        const taxTeorica = pnlLordoEur > 0 ? pnlLordoEur * taxPct : 0;
        const pnlNettoTeorico = pnlLordoEur - taxTeorica;

        const minusDisponibili = compensation?.minusDisponibili || 0;
        const minusUsate = compensation?.minusUsate || 0;
        const taxEffettiva = compensation?.taxEffettiva ?? taxTeorica;
        const pnlNettoEffettivo = compensation?.netAfterCompensation ?? pnlNettoTeorico;

        return {
            assetCurrency,
            grossNative,
            grossEur,
            commissionEur,
            proceedsNetEur,
            pnlLordoEur,
            taxPct,
            taxTeorica,
            pnlNettoTeorico,
            minusDisponibili,
            minusUsate,
            taxEffettiva,
            pnlNettoEffettivo,
            remainingQty: Math.max(0, qta - qty),
            pmcNative: pmc,
            pmcEur: pmcEur || costBasisEurPerUnit
        };
    },

    _positionCache: new Map(),
    _positionSyncCache: new Map(),

    _holdingSignature(holding) {
        const txs = (holding?.transactions || [])
            .map(tx => [
                tx.date,
                tx.type,
                tx.qty,
                tx.price,
                tx.commission || 0,
                tx.exchangeRate || ''
            ].join('|'))
            .join('||');

        return [
            holding?.id || '',
            holding?.simbolo || '',
            holding?.valuta || 'EUR',
            holding?._legacyRealizedPnL || 0,
            txs
        ].join('###');
    },

    clearCaches() {
        this._positionCache.clear();
        this._positionSyncCache.clear();
    },

    async position(holding) {
    const sig = this._holdingSignature(holding);
    if (this._positionCache.has(sig)) {
        return this._positionCache.get(sig);
    }

    const promise = (async () => {
        const txs = (holding.transactions || [])
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date));

        const v = (holding.valuta || 'EUR').toUpperCase();

        let qta = 0;
        let pmcCost = 0;
        let realizedPnL = parseFloat(holding._legacyRealizedPnL || 0);
        let totalComm = 0;
        let totalCostEur = 0;
        let totalCostNative = 0; // FIX: traccia il costo nativo per il metodo banca

        // --- FIX: prefetch batch per TUTTE le date (acquisti + vendite) ---
        const fxDatesNeeded = [...new Set(
            txs
                .filter(tx => v !== 'EUR' && !tx.exchangeRate && tx.date)
                .map(tx => tx.date)
        )];

        const rateMap = new Map();
        if (fxDatesNeeded.length) {
            const rates = await Promise.all(
                fxDatesNeeded.map(date =>
                    Exchange.getRateForDate(date).catch(() => null)
                )
            );
            fxDatesNeeded.forEach((date, i) => {
                if (rates[i]) rateMap.set(date, rates[i]);
            });
        }

        const getRate = (tx) => {
            if (tx.exchangeRate) return parseFloat(tx.exchangeRate);
            return rateMap.get(tx.date) || Exchange.rate || 1;
        };

        for (const tx of txs) {
            const q = +tx.qty || 0;
            const pr = +tx.price || 0;
            const c = +(tx.commission || 0);
            totalComm += c;

            if (tx.type === 'buy') {
                const newCost = (qta * pmcCost) + (q * pr) + c;
                qta += q;
                pmcCost = qta > 0 ? newCost / qta : 0;

                if (v === 'EUR') {
                    totalCostEur += (q * pr + c);
                    totalCostNative += (q * pr + c);
                } else {
                    const rate = getRate(tx);
                    totalCostEur += (q * pr + c) / rate;
                    totalCostNative += (q * pr + c);
                }

            } else {
                // --- FIX: metodo banca per P&L realizzato FX ---
                if (v === 'EUR') {
                    realizedPnL += (pr - pmcCost) * q - c;
                } else {
                    const sellRate = getRate(tx);
                    const ricavoEur = (pr * q - c) / sellRate;

                    // PMC EUR corrente = costo medio EUR per unità detenuta
                    const pmcEurCurrent = qta > 0 ? totalCostEur / qta : 0;
                    const costoEur = pmcEurCurrent * q;

                    // FIX: metodo banca — separa la conversione di ricavo e costo
                    realizedPnL += ricavoEur - costoEur;
                }

                // --- FIX: rimuovi esattamente le quote al PMC EUR corrente ---
                if (qta > 0) {
                    const pmcEurCurrent = totalCostEur / qta;
                    totalCostEur -= pmcEurCurrent * q;      // preciso, no ratio
                    const pmcNativeCurrent = totalCostNative / qta;
                    totalCostNative -= pmcNativeCurrent * q;
                }

                qta -= q;

                if (qta < 0.00001) {
                    qta = 0;
                    pmcCost = 0;
                    totalCostEur = 0;
                    totalCostNative = 0;
                }
            }
        }

        const pmc = qta > 0 ? pmcCost : 0;
        const pmcEur = qta > 0
            ? (v === 'EUR' ? pmc : totalCostEur / qta)
            : 0;

        return { qta, pmc, pmcEur, totalCostEur, totalCostNative, realizedPnL: Calc.round(realizedPnL), totalComm };
    })();

    this._positionCache.set(sig, promise);

    try {
        return await promise;
    } catch (err) {
        this._positionCache.delete(sig);
        throw err;
    }
},

    positionSync(holding) {
    const sig = this._holdingSignature(holding);
    if (this._positionSyncCache.has(sig)) {
        return this._positionSyncCache.get(sig);
    }

    const txs = (holding.transactions || [])
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));

    const v = (holding.valuta || 'EUR').toUpperCase();

    let qta = 0;
    let pmcCost = 0;
    let realizedPnL = parseFloat(holding._legacyRealizedPnL || 0);
    let totalComm = 0;
    let totalCostEur = 0;

    const getRateSync = (tx) => {
        if (tx.exchangeRate) return parseFloat(tx.exchangeRate);
        // Legge dalla cache in-memory senza await
        const cached = Exchange._memoryCache.get(tx.date);
        if (cached?.rate > 0) return cached.rate;
        return Exchange.rate || 1;
    };

    for (const tx of txs) {
        const q = +tx.qty || 0;
        const pr = +tx.price || 0;
        const c = +(tx.commission || 0);
        totalComm += c;

        if (tx.type === 'buy') {
            const newCost = (qta * pmcCost) + (q * pr) + c;
            qta += q;
            pmcCost = qta > 0 ? newCost / qta : 0;

            if (v === 'EUR') {
                totalCostEur += (q * pr + c);
            } else {
                const rate = getRateSync(tx);
                totalCostEur += (q * pr + c) / rate;
            }
        } else {
            if (v === 'EUR') {
                realizedPnL += (pr - pmcCost) * q - c;
            } else {
                const sellRate = getRateSync(tx);
                const ricavoEur = (pr * q - c) / sellRate;
                const pmcEurCurrent = qta > 0 ? totalCostEur / qta : 0;
                realizedPnL += ricavoEur - pmcEurCurrent * q;
            }

            if (qta > 0) {
                const pmcEurCurrent = totalCostEur / qta;
                totalCostEur -= pmcEurCurrent * q;
            }

            qta -= q;
            if (qta < 0.00001) {
                qta = 0;
                pmcCost = 0;
                totalCostEur = 0;
            }
        }
    }

    const pmc = qta > 0 ? pmcCost : 0;
    const pmcEur = qta > 0
        ? (v === 'EUR' ? pmc : totalCostEur / qta)
        : 0;

    const result = { qta, pmc, pmcEur, totalCostEur, realizedPnL: Calc.round(realizedPnL), totalComm };
    this._positionSyncCache.set(sig, result);
    return result;
},

    taxOnGain(unrealizedPnL, tipoAsset) {
        if (unrealizedPnL <= 0) return 0;
        const rates = { bond: 0.125, crypto: 0.33, stock: 0.26 };
        const rate = rates[tipoAsset] ?? 0.26;
        return unrealizedPnL * rate;
    },

    async pnlPercentWithFx(holding, prLive, displayCurrency) {
        const v = (holding.valuta || 'EUR').toUpperCase();
        const pos = await this.position(holding);
        const { qta, pmc, pmcEur } = pos;

        if (qta <= 0 || pmc <= 0) return 0;

        if (v === displayCurrency) {
            return ((prLive - pmc) / pmc) * 100;
        }

        if (v !== 'EUR' && displayCurrency === 'EUR') {
            if (pmcEur <= 0) return 0;
            const fx = Exchange.rate || 1;
            const valueEur = (prLive * qta) / fx;
            const costEur = pmcEur * qta;
            return costEur > 0 ? ((valueEur - costEur) / costEur) * 100 : 0;
        }

        const historicRate = await Exchange.getWeightedHistoricRate(
            holding.transactions,
            v,
            displayCurrency
        );

        const costInDisplay = v === 'EUR' ? pmc * historicRate : pmc / historicRate;
        const valueInDisplay = v === 'EUR' ? prLive * (Exchange.rate || 1) : prLive / (Exchange.rate || 1);

        return costInDisplay > 0
            ? ((valueInDisplay - costInDisplay) / costInDisplay) * 100
            : 0;
    },

    round(n, d = 10) {
        if (!Number.isFinite(n)) return n;
        return Math.round(n * 10 ** d) / 10 ** d;
    },

    fmt(n, d = 2) {
        if (n === null || n === undefined || isNaN(n)) return '—';
        return Number(n).toLocaleString('it-IT', {
            minimumFractionDigits: d,
            maximumFractionDigits: d
        });
    },

    fmtSign(n, d = 2) {
        if (isNaN(n)) return '—';
        const formatted = Math.abs(n).toLocaleString('it-IT', {
            minimumFractionDigits: d,
            maximumFractionDigits: d
        });
        return (n >= 0 ? '+' : '-') + formatted;
    }
};
