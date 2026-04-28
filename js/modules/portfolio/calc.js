import { Exchange } from '../../../api/exchange.js';
import { getAvailableMinusForPreview } from '../fiscale.js';
// PATCH da integrare nel tuo Calc esistente
import { getAvailableMinusForPreview } from './fiscale.js';

static buildDashboardTaxMetrics(portfolio, fiscalState = null) {
  let realizedLordoEur = 0;
  let realizedNettoTeoricoEur = 0;
  let realizedNettoEffettivoEur = 0;
  let rollingMinusStock = fiscalState ? getAvailableMinusForPreview(fiscalState, 'stock') : 0;
  let rollingMinusCrypto = fiscalState ? getAvailableMinusForPreview(fiscalState, 'crypto') : 0;
  let rollingMinusBond = fiscalState ? getAvailableMinusForPreview(fiscalState, 'bond') : 0;

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
        let availableMinus = assetType === 'crypto' ? rollingMinusCrypto : assetType === 'bond' ? rollingMinusBond : rollingMinusStock;
        const tax = Calc.realizedTaxBreakdown({ gainEur, assetType, availableMinus });
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

  return { realizedLordoEur, realizedNettoTeoricoEur, realizedNettoEffettivoEur };
}

static realizedTaxBreakdown({ gainEur, assetType, availableMinus = 0 }) {
  const gain = Math.max(0, +gainEur || 0);
  const minus = Math.max(0, +availableMinus || 0);
  const taxRate = assetType === 'bond' ? 0.125 : assetType === 'crypto' ? 0.33 : 0.26;
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
}

export class Calc {
    static fmt(n, d = 2) {
        const x = Number(n);
        if (!Number.isFinite(x)) return '0.00';
        return x.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
    }

    static fmtSign(n, d = 2) {
        const x = Number(n);
        if (!Number.isFinite(x)) return '0.00';
        const s = x > 0 ? '+' : '';
        return s + x.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
    }

    static _assetCurrency(p) {
        return (p?.valuta || 'EUR').toUpperCase();
    }

    static _txPriceCurrency(tx, p) {
        return (tx?.priceCurrency || Calc._assetCurrency(p) || 'EUR').toUpperCase();
    }

    static _txCommissionCurrency(tx) {
        return (tx?.commissionCurrency || 'EUR').toUpperCase();
    }

    static _txRate(tx) {
        const r = parseFloat(tx?.exchangeRate);
        return Number.isFinite(r) && r > 0 ? r : (Exchange.rate || 1);
    }

    static _toEur(amount, currency, rate = 1) {
        if (!Number.isFinite(amount)) return 0;
        return (currency || 'EUR').toUpperCase() === 'USD' ? amount / rate : amount;
    }

    static _fromEur(amount, currency, rate = 1) {
        if (!Number.isFinite(amount)) return 0;
        return (currency || 'EUR').toUpperCase() === 'USD' ? amount * rate : amount;
    }

    static normalizeTx(tx, p) {
        const priceCurrency = Calc._txPriceCurrency(tx, p);
        const commissionCurrency = Calc._txCommissionCurrency(tx);
        const exchangeRate = Calc._txRate(tx);
        const qty = +tx.qty || 0;
        const price = +tx.price || 0;
        const commission = +(tx.commission || 0);
        const grossNative = qty * price;
        const grossEur = Calc._toEur(grossNative, priceCurrency, exchangeRate);
        const commissionEur = Calc._toEur(commission, commissionCurrency, exchangeRate);
        return { ...tx, qty, price, commission, priceCurrency, commissionCurrency, exchangeRate, grossNative, grossEur, commissionEur };
    }

    static positionSync(p) {
        const txs = [...(p.transactions || [])].sort((a, b) => a.date.localeCompare(b.date));
        const assetCurrency = Calc._assetCurrency(p);
        let qta = 0;
        let totalCostEur = 0;
        let totalComm = 0;
        let realizedPnL = 0;

        for (const tx of txs) {
            const n = Calc.normalizeTx(tx, p);
            totalComm += n.commissionEur;
            if (tx.type === 'buy') {
                qta += n.qty;
                totalCostEur += n.grossEur + n.commissionEur;
            } else if (tx.type === 'sell' && n.qty > 0) {
                const avgCostEur = qta > 0 ? totalCostEur / qta : 0;
                const costSold = avgCostEur * n.qty;
                const proceeds = n.grossEur - n.commissionEur;
                const pnl = proceeds - costSold;
                realizedPnL += pnl;
                qta = Math.max(0, qta - n.qty);
                totalCostEur = Math.max(0, totalCostEur - costSold);
            }
        }

        const pmcEur = qta > 0 ? totalCostEur / qta : 0;
        const pmc = assetCurrency === 'USD' ? Calc._fromEur(pmcEur, 'USD', Exchange.rate || 1) : pmcEur;
        return { qta, pmc, pmcEur, realizedPnL, totalComm, totalCostEur };
    }

    static previewBuy(p, { qty, price, commission = 0, exchangeRate = null }) {
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
        const newPmcNative = assetCurrency === 'USD' ? Calc._fromEur(newPmcEur, 'USD', rate) : newPmcEur;
        return { assetCurrency, grossNative, grossEur, commissionEur, totalEur, newQta, newPmcNative, newPmcEur, currentPmcNative: pmc, currentPmcEur: pmcEur || Calc._toEur(pmc, assetCurrency, rate) };
    }

    static previewSell(p, { qty, price, commission = 0, exchangeRate = null, compensation = null }) {
        const assetCurrency = Calc._assetCurrency(p);
        const rate = exchangeRate || Exchange.rate || 1;
        const { qta, pmc, pmcEur, totalCostEur = 0 } = Calc.positionSync(p);
        const grossNative = qty * price;
        const grossEur = Calc._toEur(grossNative, assetCurrency, rate);
        const commissionEur = commission;
        const costBasisEurPerUnit = qta > 0 ? ((totalCostEur || Calc._toEur(qta * pmc, assetCurrency, rate)) / qta) : 0;
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
        return { assetCurrency, grossNative, grossEur, commissionEur, proceedsNetEur, pnlLordoEur, taxPct, taxTeorica, pnlNettoTeorico, minusDisponibili, minusUsate, taxEffettiva, pnlNettoEffettivo, remainingQty: Math.max(0, qta - qty), pmcNative: pmc, pmcEur: pmcEur || costBasisEurPerUnit };
    }

    static realizedTaxBreakdown({ gainEur, assetType, availableMinus = 0 }) {
        const gain = Math.max(0, +gainEur || 0);
        const minus = Math.max(0, +availableMinus || 0);
        const taxRate = assetType === 'bond' ? 0.125 : assetType === 'crypto' ? 0.33 : 0.26;
        const taxTeorica = gain > 0 ? gain * taxRate : 0;
        const nettoTeorico = gain - taxTeorica;
        const minusUsate = Math.min(gain, minus);
        const imponibileCompensato = Math.max(0, gain - minusUsate);
        const taxEffettiva = imponibileCompensato * taxRate;
        const nettoEffettivo = gain - taxEffettiva;
        return { taxRate, taxTeorica, nettoTeorico, minusDisponibili: minus, minusUsate, imponibileCompensato, taxEffettiva, nettoEffettivo };
    }

    static buildDashboardTaxMetrics(portfolio, fiscalState = null) {
        let realizedLordoEur = 0;
        let realizedNettoTeoricoEur = 0;
        let realizedNettoEffettivoEur = 0;
        let rollingMinusStock = 0, rollingMinusCrypto = 0, rollingMinusBond = 0;
        if (fiscalState) {
            rollingMinusStock = getAvailableMinusForPreview(fiscalState, 'stock');
            rollingMinusCrypto = getAvailableMinusForPreview(fiscalState, 'crypto');
            rollingMinusBond = getAvailableMinusForPreview(fiscalState, 'bond');
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
                totalCostEur = Math.max(0, totalCostEur - costBasisSoldEur);
                realizedLordoEur += gainEur;
                if (gainEur > 0) {
                    const assetType = p.tipoAsset || 'stock';
                    let availableMinus = assetType === 'crypto' ? rollingMinusCrypto : assetType === 'bond' ? rollingMinusBond : rollingMinusStock;
                    const tax = Calc.realizedTaxBreakdown({ gainEur, assetType, availableMinus });
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
        return { realizedLordoEur, realizedNettoTeoricoEur, realizedNettoEffettivoEur };
    }
}
