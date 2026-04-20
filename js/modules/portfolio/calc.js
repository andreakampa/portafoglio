import { Exchange } from '../../api/exchange.js';

export const Calc = {
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

        return { qta, pmc, pmcEur, totalCostEur, totalCostNative, realizedPnL, totalComm };
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

    const result = { qta, pmc, pmcEur, totalCostEur, realizedPnL, totalComm };
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
