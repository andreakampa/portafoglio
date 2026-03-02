export const Calc = {
    // Calcola posizione da storico transazioni
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

    // Tasse su plusvalenza non realizzata
    taxOnGain(unrealizedPnL, tipoAsset) {
        if (unrealizedPnL <= 0) return 0;
        const rate = tipoAsset === 'bond' ? 0.125 : 0.26;
        return unrealizedPnL * rate;
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

