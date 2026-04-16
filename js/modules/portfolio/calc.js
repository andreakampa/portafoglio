import { Exchange } from '../../api/exchange.js';

function taxOnGain(pnl, tipoAsset) {
    if (pnl <= 0) return 0;
    if (tipoAsset === 'bond')   return pnl * 0.125;
    if (tipoAsset === 'crypto') return pnl * 0.33;
    return pnl * 0.26;
}

export const Calc = {
    _posCache: new WeakMap(),
    _posSyncCache: new WeakMap(),

    clearCaches() {
        this._posCache = new WeakMap();
        this._posSyncCache = new WeakMap();
    },

    fmt(n, d = 2) {
        return Number(n || 0).toLocaleString('it-IT', {
            minimumFractionDigits: d,
            maximumFractionDigits: d
        });
    },

    async position(p) {
        if (!p) {
            return {
                qta: 0, pmc: 0, pmcEur: 0,
                realizedPnL: 0, totalComm: 0,
                investedNative: 0, investedEur: 0
            };
        }

        const cached = this._posCache.get(p);
        if (cached) return cached;

        const txs = (p.transactions || []).slice().sort((a, b) => a.date.localeCompare(b.date));

        let qta = 0;
        let pmc = 0;
        let pmcEur = 0;
        let realizedPnL = +(p._legacyRealizedPnL || 0);
        let totalComm = 0;

        let investedNative = 0;
        let investedEur = 0;

        for (const tx of txs) {
            const qty  = +tx.qty || 0;
            const pr   = +tx.price || 0;
            const comm = +(tx.commission || 0);
            totalComm += comm;

            let fx = 1;
            if ((p.valuta || 'EUR') === 'USD') {
                const manualFx = parseFloat(tx.exchangeRate);
                fx = (manualFx && isFinite(manualFx) && manualFx > 0)
                    ? manualFx
                    : await Exchange.getRateForDate(tx.date);
            }

            if (tx.type === 'buy') {
                const buyCostNative = qty * pr + comm;
                const buyCostEur = (p.valuta === 'USD')
                    ? (qty * pr) / fx + comm
                    : buyCostNative;

                investedNative += buyCostNative;
                investedEur += buyCostEur;

                const newQta = qta + qty;
                pmc = newQta > 0 ? ((qta * pmc) + buyCostNative) / newQta : 0;
                pmcEur = newQta > 0 ? ((qta * pmcEur) + buyCostEur) / newQta : 0;
                qta = newQta;
            }

            if (tx.type === 'sell') {
                const sellGrossNative = qty * pr - comm;

                if (qta > 0) {
                    const costRemovedNative = qty * pmc;
                    const costRemovedEur = qty * pmcEur;

                    const pnlNative = sellGrossNative - costRemovedNative;
                    realizedPnL += pnlNative;

                    investedNative -= costRemovedNative;
                    investedEur -= costRemovedEur;

                    qta -= qty;
                    if (qta < 0.0000001) qta = 0;
                    if (qta === 0) {
                        pmc = 0;
                        pmcEur = 0;
                        investedNative = 0;
                        investedEur = 0;
                    }
                }
            }
        }

        const out = {
            qta,
            pmc,
            pmcEur,
            realizedPnL,
            totalComm,
            investedNative,
            investedEur
        };

        this._posCache.set(p, out);
        return out;
    },

    positionSync(p) {
        if (!p) {
            return {
                qta: 0, pmc: 0, pmcEur: 0,
                realizedPnL: 0, totalComm: 0,
                investedNative: 0, investedEur: 0
            };
        }

        const cached = this._posSyncCache.get(p);
        if (cached) return cached;

        const txs = (p.transactions || []).slice().sort((a, b) => a.date.localeCompare(b.date));

        let qta = 0;
        let pmc = 0;
        let pmcEur = 0;
        let realizedPnL = +(p._legacyRealizedPnL || 0);
        let totalComm = 0;
        let investedNative = 0;
        let investedEur = 0;

        for (const tx of txs) {
            const qty  = +tx.qty || 0;
            const pr   = +tx.price || 0;
            const comm = +(tx.commission || 0);
            totalComm += comm;

            let fx = 1;
            if ((p.valuta || 'EUR') === 'USD') {
                const manualFx = parseFloat(tx.exchangeRate);
                fx = (manualFx && isFinite(manualFx) && manualFx > 0)
                    ? manualFx
                    : (Exchange.rate || 1);
            }

            if (tx.type === 'buy') {
                const buyCostNative = qty * pr + comm;
                const buyCostEur = (p.valuta === 'USD')
                    ? (qty * pr) / fx + comm
                    : buyCostNative;

                investedNative += buyCostNative;
                investedEur += buyCostEur;

                const newQta = qta + qty;
                pmc = newQta > 0 ? ((qta * pmc) + buyCostNative) / newQta : 0;
                pmcEur = newQta > 0 ? ((qta * pmcEur) + buyCostEur) / newQta : 0;
                qta = newQta;
            }

            if (tx.type === 'sell') {
                const sellGrossNative = qty * pr - comm;

                if (qta > 0) {
                    const costRemovedNative = qty * pmc;
                    const costRemovedEur = qty * pmcEur;

                    const pnlNative = sellGrossNative - costRemovedNative;
                    realizedPnL += pnlNative;

                    investedNative -= costRemovedNative;
                    investedEur -= costRemovedEur;

                    qta -= qty;
                    if (qta < 0.0000001) qta = 0;
                    if (qta === 0) {
                        pmc = 0;
                        pmcEur = 0;
                        investedNative = 0;
                        investedEur = 0;
                    }
                }
            }
        }

        const out = {
            qta,
            pmc,
            pmcEur,
            realizedPnL,
            totalComm,
            investedNative,
            investedEur
        };

        this._posSyncCache.set(p, out);
        return out;
    },

    marketValue(position, currentPrice) {
        return (position?.qta || 0) * (+currentPrice || 0);
    },

    marketValueEur(position, currentPrice, valuta = 'EUR') {
        const nativeValue = this.marketValue(position, currentPrice);
        return valuta === 'USD'
            ? nativeValue / (Exchange.rate || 1)
            : nativeValue;
    },

    unrealizedPnL(position, currentPrice) {
        const mv = this.marketValue(position, currentPrice);
        const cost = (position?.qta || 0) * (position?.pmc || 0);
        return mv - cost;
    },

    unrealizedPnLEur(position, currentPrice, valuta = 'EUR') {
        const mvEur = this.marketValueEur(position, currentPrice, valuta);
        const costEur = (position?.qta || 0) * (position?.pmcEur || 0);
        return mvEur - costEur;
    },

    pnlPercent(position, currentPrice) {
        const cost = (position?.qta || 0) * (position?.pmc || 0);
        if (!cost) return 0;
        return (this.unrealizedPnL(position, currentPrice) / cost) * 100;
    },

    pnlPercentWithFx(position, currentPrice, valuta = 'EUR') {
        const costEur = (position?.qta || 0) * (position?.pmcEur || 0);
        if (!costEur) return 0;
        return (this.unrealizedPnLEur(position, currentPrice, valuta) / costEur) * 100;
    },

    netSellPreview(position, sellQty, sellPrice, commission = 0, tipoAsset = 'stock') {
        const qty = +sellQty || 0;
        const pr = +sellPrice || 0;
        const comm = +(commission || 0);
        const pmc = +(position?.pmc || 0);

        const grossReceipt = qty * pr - comm;
        const pnl = (pr - pmc) * qty - comm;
        const tax = taxOnGain(pnl, tipoAsset);
        const netReceipt = grossReceipt - tax;

        return {
            grossReceipt,
            pnl,
            tax,
            netReceipt,
            remainingQty: Math.max(0, (position?.qta || 0) - qty)
        };
    },

    taxOnGain
};
