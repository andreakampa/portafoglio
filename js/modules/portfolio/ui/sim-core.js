export function getTaxConfig(tipoAsset) {
    if (tipoAsset === 'bond') return { rate: 0.125, label: '12,5%' };
    if (tipoAsset === 'crypto') return { rate: 0.33, label: '33%' };
    return { rate: 0.26, label: '26%' };
}

export function makeFxHelpers(isUSD, rate) {
    return {
        toEur: (v) => isUSD ? v / rate : v,
        toNative: (v) => isUSD ? v * rate : v
    };
}

export function simulateBuyByBudget({
    budget,
    price,
    commission,
    qta,
    pmc,
    isUSD,
    rate
}) {
    const { toNative } = makeFxHelpers(isUSD, rate);

    if (isNaN(price) || price <= 0 || isNaN(budget) || budget <= 0) return null;

    const budgetNative = toNative(budget);
    const commissionNative = toNative(commission || 0);
    const netNative = budgetNative - commissionNative;

    if (netNative <= 0) {
        return {
            error: 'budget_too_low',
            budgetNative,
            commissionNative
        };
    }

    const qty = netNative / price;
    const newQty = qta + qty;
    const newPmc = newQty > 0
        ? ((qta * pmc) + (qty * price) + commissionNative) / newQty
        : 0;

    return {
        qty,
        price,
        commission: commission || 0,
        newPmc,
        newQty,
        budgetNative,
        commissionNative
    };
}

export function simulateBuyByQty({
    qty,
    price,
    commission,
    qta,
    pmc,
    isUSD,
    rate
}) {
    const { toNative, toEur } = makeFxHelpers(isUSD, rate);

    if (isNaN(price) || price <= 0 || isNaN(qty) || qty <= 0) return null;

    const commissionNative = toNative(commission || 0);
    const totalNative = qty * price + commissionNative;
    const totalEur = toEur(totalNative);

    const newQty = qta + qty;
    const newPmc = newQty > 0
        ? ((qta * pmc) + (qty * price) + commissionNative) / newQty
        : 0;

    return {
        qty,
        price,
        commission: commission || 0,
        totalNative,
        totalEur,
        newPmc,
        newQty
    };
}

export function simulateSell({
    qty,
    price,
    commission,
    qta,
    pmc,
    pmcEur,
    tipoAsset,
    isUSD,
    rate
}) {
    if (isNaN(price) || price <= 0 || isNaN(qty) || qty <= 0) return null;

    if (qty > qta + 0.0001) {
        return {
            error: 'qty_exceeds',
            availableQty: qta
        };
    }

    const { rate: taxRate, label: taxLabel } = getTaxConfig(tipoAsset);

    let grossReceipt;
    let grossReceiptEur;
    let pnl;
    let tax;
    let netReceipt;
    let netReceiptEur;

    if (isUSD) {
        grossReceipt = qty * price;
        grossReceiptEur = grossReceipt / rate;
        const commissionEur = (commission || 0) / rate;
        const costoEur = (pmcEur > 0 ? pmcEur : pmc / rate) * qty;
        pnl = grossReceiptEur - costoEur - commissionEur;
        tax = pnl > 0 ? pnl * taxRate : 0;
        netReceiptEur = grossReceiptEur - commissionEur - tax;
        netReceipt = netReceiptEur;
    } else {
        grossReceipt = qty * price - (commission || 0);
        pnl = (price - pmc) * qty - (commission || 0);
        tax = pnl > 0 ? pnl * taxRate : 0;
        netReceipt = grossReceipt - tax;
        grossReceiptEur = grossReceipt;
        netReceiptEur = netReceipt;
    }

    return {
        qty,
        price,
        commission: commission || 0,
        pmc,
        remQty: qta - qty,
        grossReceipt,
        grossReceiptEur,
        pnl,
        tax,
        taxLabel,
        netReceipt,
        netReceiptEur
    };
}