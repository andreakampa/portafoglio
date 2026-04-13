import { Exchange } from '../../api/exchange.js';

export const Calc = {

    // ── POSITION (async) ────────────────────────────────────────────────────
    // Aggiunta: costEur = costo storico in EUR usando il tasso del giorno
    // di ogni acquisto (fixing BCE Banca d'Italia).
    // pmcEur = PMC in EUR calcolato con i tassi storici.
    // Tutti gli altri valori (qta, pmc, realizedPnL, totalComm) restano invariati.
    async position(holding) {
        const txs = (holding.transactions || [])
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date));

        const v = holding.valuta || 'EUR';

        let qta         = 0;
        let pmcCost     = 0;   // PMC nella valuta del titolo (USD o EUR)
        let realizedPnL = 0;
        let totalComm   = 0;

        // Per il PMC in EUR con tassi storici
        let totalCostEur = 0;  // somma (qty * price + commission) / rate_storico

        realizedPnL += parseFloat(holding._legacyRealizedPnL || 0);

        for (const tx of txs) {
            const q  = +tx.qty;
            const pr = +tx.price;
            const c  = +(tx.commission || 0);
            totalComm += c;

            if (tx.type === 'buy') {
                // PMC nella valuta nativa del titolo (invariato)
                const newCost = (qta * pmcCost) + (q * pr) + c;
                qta     += q;
                pmcCost  = qta > 0 ? newCost / qta : 0;

                // Costo in EUR con tasso storico del giorno
                if (v === 'USD') {
                    // tx.exchangeRate = tasso salvato manualmente (opzionale)
                    // altrimenti chiama Banca d'Italia per la data
                    const rate = tx.exchangeRate
                        ? parseFloat(tx.exchangeRate)
                        : await Exchange.getRateForDate(tx.date);
                    const costEurTx = (q * pr + c) / rate;
                    totalCostEur += costEurTx;
                } else {
                    // titolo in EUR: costo EUR = costo diretto
                    totalCostEur += (q * pr + c);
                }

            } else {
                // Vendita: P&L nella valuta nativa
                realizedPnL += (pr - pmcCost) * q - c;
                // Riduzione proporzionale del costo EUR accumulato
                if (qta > 0) {
                    const ratio = q / qta;
                    totalCostEur -= totalCostEur * ratio;
                }
                qta -= q;
                if (qta < 0.00001) { qta = 0; totalCostEur = 0; }
            }
        }

        // PMC in EUR: costo EUR residuo / quantità residua
        const pmcEur = qta > 0 ? totalCostEur / qta : 0;

        return { qta, pmc: pmcCost, pmcEur, totalCostEur, realizedPnL, totalComm };
    },

    // Versione sincrona (solo PMC nativo, senza tassi storici).
    // Usata dove non serve l'EUR storico (es. preview rapidi nel modal).
    positionSync(holding) {
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

    // ── TAX ─────────────────────────────────────────────────────────────────
    taxOnGain(unrealizedPnL, tipoAsset) {
        if (unrealizedPnL <= 0) return 0;
        const rates = { bond: 0.125, crypto: 0.33, stock: 0.26 };
        const rate  = rates[tipoAsset] ?? 0.26;
        return unrealizedPnL * rate;
    },

    // ── P&L % CON FX STORICO ────────────────────────────────────────────────
    async pnlPercentWithFx(holding, prLive, displayCurrency) {
        const v = holding.valuta || 'EUR';
        const { qta, pmc, pmcEur } = await this.position(holding);
        if (qta <= 0 || pmc <= 0) return 0;

        if (v === displayCurrency) {
            return ((prLive - pmc) / pmc) * 100;
        }

        // Titolo USD, display EUR
        if (v === 'USD' && displayCurrency === 'EUR') {
            if (pmcEur <= 0) return 0;
            // Valore attuale in EUR al tasso live
            const valueEur = (prLive * qta) / Exchange.rate;
            const costEur  = pmcEur * qta;
            return ((valueEur - costEur) / costEur) * 100;
        }

        // Fallback generico
        const historicRate   = await Exchange.getWeightedHistoricRate(holding.transactions, v, displayCurrency);
        const costInDisplay  = v === 'EUR' ? pmc * historicRate : pmc / historicRate;
        const valueInDisplay = v === 'EUR' ? prLive * Exchange.rate : prLive / Exchange.rate;
        return ((valueInDisplay - costInDisplay) / costInDisplay) * 100;
    },

    // ── FORMAT ──────────────────────────────────────────────────────────────
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
