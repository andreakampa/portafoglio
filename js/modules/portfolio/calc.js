import { Exchange } from '../../api/exchange.js';

export const Calc = {
    position(holding) {
        const txs = (holding.transactions || [])
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date));

        let qta = 0, pmcCost = 0, realizedPnL = 0, totalComm = 0;
        realizedPnL += parseFloat(holding._legacyRealizedPnL || 0);

        for (const tx of txs) {
            const q = +tx.qty, pr = +tx.price, c = +(tx.commission || 0);
            totalComm += c;
            if (tx.type === 'buy') {
                const newCost = (qta * pmcCost) + (q * pr) + c;
                qta += q;
                pmcCost = qta > 0 ? newCost / qta : 0;
            } else {
                realizedPnL += (pr - pmcCost) * q - c;
                qta -= q;
                if (qta < 0.00001) qta = 0;
            }
        }
        return { qta, pmc: pmcCost, realizedPnL, totalComm };
    },

    taxOnGain(unrealizedPnL, tipoAsset) {
    if (unrealizedPnL <= 0) return 0;
    const rates = { bond: 0.125, crypto: 0.33, stock: 0.26 };
    const rate = rates[tipoAsset] ?? 0.26;
    return unrealizedPnL * rate;
},

    // Calcola % P&L tenendo conto del cambio storico alla data acquisto
    // Se il titolo è in valuta diversa da quella di visualizzazione,
    // la % riflette anche l'effetto cambio
    async pnlPercentWithFx(holding, prLive, displayCurrency) {
        const v = holding.valuta || 'EUR';
        const { qta, pmc } = this.position(holding);
        if (qta <= 0 || pmc <= 0) return 0;

        if (v === displayCurrency) {
            // stessa valuta → % normale
            return ((prLive - pmc) / pmc) * 100;
        }

        // cambio storico ponderato alla data degli acquisti
        const historicRate = await Exchange.getWeightedHistoricRate(
            holding.transactions, v, displayCurrency
        );
        const currentRate = Exchange.rate; // EUR/USD attuale

        // costo in displayCurrency usando tasso storico
        const costInDisplay = v === 'EUR'
            ? pmc * historicRate
            : pmc / historicRate;

        // valore attuale in displayCurrency usando tasso attuale
        const valueInDisplay = v === 'EUR'
            ? prLive * currentRate
            : prLive / currentRate;

        return ((valueInDisplay - costInDisplay) / costInDisplay) * 100;
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

