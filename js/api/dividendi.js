import { Exchange } from './exchange.js';

const PROXY = 'https://finance-proxy.andrea-kampa.workers.dev';
const CACHE_TTL = 24 * 60 * 60 * 1000;

function cacheKey(portfolioId = 'default') {
  return `ptpro_dividendi_v2_${portfolioId}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() + days);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function getRateForDate(dateIso) {
  try {
    const cached = Exchange?._memoryCache?.get?.(dateIso)?.rate;
    if (cached) return cached;
  } catch (e) {}

  try {
    if (typeof Exchange.getHistoricalRate === 'function') {
      const rate = await Exchange.getHistoricalRate(dateIso);
      if (rate) return rate;
    }
  } catch (e) {}

  return Exchange.rate || 1;
}

export const Dividendi = {
  async fetchDividendi(ticker) {
    try {
      if (!ticker) return [];
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=10y&events=dividends`;
      const proxyUrl = `${PROXY}?url=${encodeURIComponent(url)}`;
      const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
      const raw = await r.json();
      const divs = raw?.chart?.result?.[0]?.events?.dividends;
      if (!divs) return [];

      return Object.values(divs)
        .map(d => ({
          exDate: new Date(d.date * 1000).toISOString().slice(0, 10),
          amount: Number(d.amount) || 0
        }))
        .filter(d => d.exDate && d.amount > 0)
        .sort((a, b) => a.exDate.localeCompare(b.exDate));
    } catch (e) {
      return [];
    }
  },

  async calcolaDividendiRicevuti(asset, dividendiTicker) {
    const txs = [...(asset.transactions || [])].sort((a, b) => a.date.localeCompare(b.date));
    if (!txs.length || !dividendiTicker.length) return [];

    const risultati = [];
    const oggi = todayIso();

    for (const div of dividendiTicker) {
      const exDate = div.exDate;

      let qtaAllExDate = 0;
      for (const tx of txs) {
        if (tx.date > exDate) break;
        if (tx.type === 'buy') qtaAllExDate += Number(tx.qty) || 0;
        if (tx.type === 'sell') qtaAllExDate -= Number(tx.qty) || 0;
      }

      qtaAllExDate = Math.max(0, qtaAllExDate);
      if (qtaAllExDate < 0.0001) continue;

      const importoNativo = (Number(div.amount) || 0) * qtaAllExDate;

            const payDateEstimated = addDays(exDate, 21);
      const maturato = exDate <= oggi;
      const pagato = payDateEstimated <= oggi;

      const rateDate = asset.valuta === 'USD' ? payDateEstimated : exDate;
      const rate = await getRateForDate(rateDate);

      const importoEur = asset.valuta === 'USD'
        ? importoNativo / rate
        : importoNativo;

      risultati.push({
        exDate,
        payDate: payDateEstimated,
        payDateEstimated: true,
        maturato,
        pagato,
        dividendoPerAzione: Number(div.amount) || 0,
        qta: qtaAllExDate,
        importoNativo,
        importoEur,
        valuta: asset.valuta || 'EUR'
      });
    }

    return risultati;
  },

  async aggiornaPortfolio(portfolio) {
    const risultati = {};

    const assets = Object.entries(portfolio || {})
      .filter(([, p]) => (p.transactions || []).length > 0)
      .map(([id, p]) => ({
        id,
        ticker: p.ticker || p.nome,
        asset: p
      }))
      .filter(x => !!x.ticker);

    await Promise.all(
      assets.map(async ({ id, ticker, asset }) => {
        const divsTicker = await this.fetchDividendi(ticker);
        const ricevuti = await this.calcolaDividendiRicevuti(asset, divsTicker);
        if (ricevuti.length > 0) risultati[id] = ricevuti;
      })
    );

    return risultati;
  },

  salva(dividendi, portfolioId = 'default') {
    try {
      localStorage.setItem(cacheKey(portfolioId), JSON.stringify({
        ts: Date.now(),
        data: dividendi
      }));
    } catch (e) {}
  },

  carica(portfolioId = 'default') {
    try {
      const raw = localStorage.getItem(cacheKey(portfolioId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts > CACHE_TTL) return null;
      return parsed.data;
    } catch (e) {
      return null;
    }
  },

  clear(portfolioId = null) {
    try {
      if (portfolioId) {
        localStorage.removeItem(cacheKey(portfolioId));
        return;
      }

      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('ptpro_dividendi_v2_') || k === 'ptpro_dividendi_v1') {
          localStorage.removeItem(k);
        }
      });
    } catch (e) {}
  },

  totaleRicevuto(dividendiAsset) {
    return (dividendiAsset || [])
      .filter(d => d.pagato)
      .reduce((s, d) => s + (Number(d.importoEur) || 0), 0);
  },

  haRicevutoDividendi(dividendiAsset) {
  return (dividendiAsset || []).some(d => d.maturato);
}
};