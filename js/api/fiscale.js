import { Calc } from '../modules/portfolio/calc.js';
import { Exchange } from '../api/exchange.js';

const ANNI_COMPENSAZIONE = 4;

export function getAvailableMinusForPreview(fiscalState, assetType = 'stock') {
  if (!fiscalState) return 0;

  if (typeof fiscalState.totalCompensabile === 'number') {
    return Math.max(0, fiscalState.totalCompensabile);
  }

  if (Array.isArray(fiscalState.rows)) {
    return fiscalState.rows.reduce((sum, row) => {
      const amount = +(row.amountCompensabile ?? row.amount ?? 0);
      if (amount <= 0) return sum;
      if (!row.assetType || row.assetType === assetType || row.assetType === 'generic') return sum + amount;
      return sum;
    }, 0);
  }

  if (fiscalState.byYear && typeof fiscalState.byYear === 'object') {
    return Object.values(fiscalState.byYear).reduce((sum, yearBlock) => {
      const rows = Array.isArray(yearBlock?.rows) ? yearBlock.rows : [];
      return sum + rows.reduce((acc, row) => {
        const amount = +(row.amountCompensabile ?? row.amount ?? 0);
        if (amount <= 0) return acc;
        if (!row.assetType || row.assetType === assetType || row.assetType === 'generic') return acc + amount;
        return acc;
      }, 0);
    }, 0);
  }

  return 0;
}

export function previewMinusCompensation({ gainEur, assetType, availableMinus = 0 }) {
  const gain = Math.max(0, +gainEur || 0);
  const minus = Math.max(0, +availableMinus || 0);
  const taxRate = assetType === 'bond' ? 0.125 : assetType === 'crypto' ? 0.33 : 0.26;
  const minusUsate = Math.min(gain, minus);
  const gainTaxableAfterCompensation = Math.max(0, gain - minusUsate);
  const taxEffettiva = gainTaxableAfterCompensation * taxRate;
  const netAfterCompensation = gain - taxEffettiva;

  return {
    minusDisponibili: minus,
    minusUsate,
    gainTaxableAfterCompensation,
    taxEffettiva,
    netAfterCompensation,
    taxRate
  };
}

export function calcolaMinusvalenze(portfolio) {
  const righe = [];
  const oggi = new Date();
  const annoCorrente = oggi.getFullYear();
  const annoMinimo = annoCorrente - ANNI_COMPENSAZIONE;
  const assets = portfolio && portfolio.assets ? portfolio.assets : portfolio || {};

  for (const id in assets) {
    const p = assets[id];
    const txs = (p.transactions || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    if (!txs.length) continue;

    let rQta = 0;
    let rPmc = 0;
    const isUSD = (p.valuta || 'EUR').toUpperCase() === 'USD';

    for (const tx of txs) {
      const q = +tx.qty || 0;
      const pr = +tx.price || 0;
      const c = +(tx.commission || 0);

      if (tx.type === 'buy') {
        const newCost = (rQta * rPmc) + (q * pr) + c;
        rQta += q;
        rPmc = rQta > 0 ? newCost / rQta : 0;
      } else {
        const pnlNativo = (pr - rPmc) * q - c;
        let pnlEur;
        if (isUSD) {
          const txRate = tx.exchangeRate ? parseFloat(tx.exchangeRate) : (Exchange._memoryCache.get(tx.date)?.rate || Exchange.rate || 1);
          pnlEur = pnlNativo / txRate;
        } else {
          pnlEur = pnlNativo;
        }

        if (pnlEur < -0.01) {
          const dataVendita = new Date(tx.date);
          const annoVendita = dataVendita.getFullYear();
          if (annoVendita >= annoMinimo) {
            const categoria = p.tipoAsset === 'crypto' ? 'crypto' : 'strumenti';
            righe.push({
              anno: annoVendita,
              data: tx.date,
              titolo: p.nome,
              tipoAsset: p.tipoAsset || 'stock',
              categoria,
              minus: Math.abs(pnlEur),
              id
            });
          }
        }

        rQta -= q;
        if (rQta < 0.00001) {
          rQta = 0;
          rPmc = 0;
        }
      }
    }
  }

  righe.sort((a, b) => b.data.localeCompare(a.data));
  return righe;
}
