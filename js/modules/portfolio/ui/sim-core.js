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
    rate,
    minusDisponibili = 0
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
    let netReceipt;
    let netReceiptEur;

    if (isUSD) {
        grossReceipt = qty * price;
        grossReceiptEur = grossReceipt / rate;
        const commissionEur = (commission || 0) / rate;
        const costoEur = (pmcEur > 0 ? pmcEur : pmc / rate) * qty;
        pnl = grossReceiptEur - costoEur - commissionEur;
    } else {
        grossReceipt = qty * price - (commission || 0);
        pnl = (price - pmc) * qty - (commission || 0);
        grossReceiptEur = grossReceipt;
    }

    const minusUsate = pnl > 0 ? Math.min(pnl, Math.max(0, minusDisponibili || 0)) : 0;
    const imponibile = pnl > 0 ? Math.max(0, pnl - minusUsate) : 0;
    const tax = imponibile * taxRate;

    if (isUSD) {
        const commissionEur = (commission || 0) / rate;
        netReceiptEur = grossReceiptEur - commissionEur - tax;
        netReceipt = netReceiptEur;
    } else {
        netReceipt = grossReceipt - tax;
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
        netReceiptEur,
        minusDisponibili: minusDisponibili || 0,
        minusUsate,
        imponibile
    };
}

export function simulateSellLIFO({
    qty,
    price,
    commission,
    lots,
    tipoAsset,
    isUSD,
    rate,
    minusDisponibili = 0
}) {
    if (isNaN(price) || price <= 0 || isNaN(qty) || qty <= 0) return null;

    const qtaResidua = (lots || []).reduce((s, l) => s + l.qtyResidua, 0);
    if (qty > qtaResidua + 0.0001) {
        return {
            error: 'qty_exceeds',
            availableQty: qtaResidua
        };
    }

    const { rate: taxRate, label: taxLabel } = getTaxConfig(tipoAsset);

    // Consumo LIFO: dal lotto più recente (per data) a scendere.
    // Non muta i lotti originali: lavora su una copia con qtyResidua decrescente.
    const lottiOrdinati = (lots || [])
        .map(l => ({ ...l }))
        .sort((a, b) => b.date.localeCompare(a.date));

    let daConsumare = qty;
    let costoBaseNative = 0;
    const dettaglioLotti = [];

    for (const lot of lottiOrdinati) {
        if (daConsumare <= 0.00001) break;
        if (lot.qtyResidua <= 0) continue;

        const usato = Math.min(lot.qtyResidua, daConsumare);
        const commissioneProquota = (lot.commission || 0) * usato / (lot.qtyOriginal || lot.qtyResidua || usato);
        const costoLotto = lot.price * usato + commissioneProquota;

        costoBaseNative += costoLotto;
        daConsumare -= usato;

        dettaglioLotti.push({
            lotId: lot.id,
            date: lot.date,
            qty: usato,
            price: lot.price,
            exchangeRate: lot.exchangeRate || rate || 1
        });
    }

    const costoBaseEur = isUSD
        ? dettaglioLotti.reduce((s, d) => s + (d.price * d.qty) / (d.exchangeRate || 1), 0)
        : costoBaseNative;

    let grossReceipt, grossReceiptEur, pnl, netReceipt, netReceiptEur;

    if (isUSD) {
        grossReceipt = qty * price;
        grossReceiptEur = grossReceipt / rate;
        const commissionEur = (commission || 0) / rate;
        pnl = grossReceiptEur - costoBaseEur - commissionEur;
    } else {
        grossReceipt = qty * price - (commission || 0);
        pnl = (qty * price) - costoBaseNative - (commission || 0);
        grossReceiptEur = grossReceipt;
    }

    const minusUsate = pnl > 0 ? Math.min(pnl, Math.max(0, minusDisponibili || 0)) : 0;
    const imponibile = pnl > 0 ? Math.max(0, pnl - minusUsate) : 0;
    const tax = imponibile * taxRate;

    if (isUSD) {
        const commissionEur = (commission || 0) / rate;
        netReceiptEur = grossReceiptEur - commissionEur - tax;
        netReceipt = netReceiptEur;
    } else {
        netReceipt = grossReceipt - tax;
        netReceiptEur = netReceipt;
    }

    return {
        qty,
        price,
        commission: commission || 0,
        remQty: qtaResidua - qty,
        grossReceipt,
        grossReceiptEur,
        pnl,
        tax,
        taxLabel,
        netReceipt,
        netReceiptEur,
        minusDisponibili: minusDisponibili || 0,
        minusUsate,
        imponibile,
        dettaglioLotti
    };
}