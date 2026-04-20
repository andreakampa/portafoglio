const RATE_CACHE_KEY = 'ptpro_fx_history';
const FX_TTL = 24 * 60 * 60 * 1000;
const HIST_TTL = 7 * 24 * 60 * 60 * 1000;
const PROXY = 'https://finance-proxy.andrea-kampa.workers.dev';

const LATEST_PROXIES = [
  `${PROXY}?url=${encodeURIComponent('https://open.er-api.com/v6/latest/EUR')}`,
  `https://api.allorigins.win/get?url=${encodeURIComponent('https://open.er-api.com/v6/latest/EUR')}`,
];

// Converte YYYY-DD-MM → YYYY-MM-DD per Banca d'Italia
function toISODate(dateStr) {
    if (!dateStr) return dateStr;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const [year, second, third] = parts;
    // Se il secondo segmento è > 12, è un giorno — inverti
    if (parseInt(second) > 12) {
        return `${year}-${third}-${second}`;
    }
    return dateStr; // già YYYY-MM-DD o ambiguo, lascia stare
}

const BDITALIA_URL = (dateStr) =>
  `https://tassidicambio.bancaditalia.it/terzevalute-wf-web/rest/v1.0/dailyRates` +
  `?lang=it&currencyIsoCode=USD&referenceDate=${dateStr}`;

const BDITALIA_PROXIES = (dateStr) => [
  `${PROXY}?url=${encodeURIComponent(BDITALIA_URL(dateStr))}`,
  `https://api.allorigins.win/get?url=${encodeURIComponent(BDITALIA_URL(dateStr))}`,
];

function withTimeout(ms = 6000) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(ms) };
  }
  return {};
}

function isFresh(ts, ttl) {
  return Number.isFinite(ts) && (Date.now() - ts <= ttl);
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return value; }
}

export const Exchange = {
  rate: 1.08,

  _memoryCache: new Map(),
  _pendingRates: new Map(),
  _liveRateTs: 0,
  _storageLoaded: false,

  async update(force = false) {
    if (!force && isFresh(this._liveRateTs, FX_TTL)) return true;

    for (let i = 0; i < LATEST_PROXIES.length; i++) {
      try {
        const r = await fetch(LATEST_PROXIES[i], withTimeout(5000));
        const raw = await r.json();
        const data = i === 1 ? parseMaybeJson(raw.contents) : raw;

        if (data?.result === 'success' && data?.rates?.USD > 0) {
          this.rate = data.rates.USD;
          this._liveRateTs = Date.now();
          return true;
        }
      } catch (e) {}
    }

    return false;
  },

  convert(value, from, to) {
    if (from === to) return value;
    return from === 'EUR' ? value * this.rate : value / this.rate;
  },

  async getRateForDate(dateStr) {
    if (!dateStr) return this.rate;

    this._ensureStorageLoaded();

    const memEntry = this._memoryCache.get(dateStr);
    if (memEntry && isFresh(memEntry.ts, HIST_TTL)) {
      return memEntry.rate;
    }

    if (this._pendingRates.has(dateStr)) {
      return this._pendingRates.get(dateStr);
    }

    const request = this._fetchHistoricRate(dateStr)
      .then((rate) => {
        const finalRate = rate || this.rate;
        this._memoryCache.set(dateStr, { rate: finalRate, ts: Date.now() });
        this._saveFxCache();
        return finalRate;
      })
      .finally(() => {
        this._pendingRates.delete(dateStr);
      });

    this._pendingRates.set(dateStr, request);
    return request;
  },

  async _fetchHistoricRate(dateStr) {
    const proxies = BDITALIA_PROXIES(dateStr);

    for (let i = 0; i < proxies.length; i++) {
        try {
            const r = await fetch(proxies[i], withTimeout(6000));
            const raw = await r.json();
            const data = this._normalizeProxyPayload(raw, i);

            // Trova il record EUR nella lista
            const rates = Array.isArray(data?.rates) ? data.rates : [];
            const eurRecord = rates.find(r => r.uicCode === '242' || r.isoCode === 'EUR');

            if (eurRecord) {
                const eurPerUsd = parseFloat(eurRecord.avgRate);
                if (eurPerUsd > 0) {
                    // Banca d'Italia esprime EUR per 1 USD — inverti per ottenere USD per 1 EUR
                    const usdPerEur = 1 / eurPerUsd;
                    console.log(`[Exchange] BdI ${dateStr}: ${eurPerUsd} EUR/USD → ${usdPerEur.toFixed(4)} USD/EUR`);
                    return usdPerEur;
                }
            }
        } catch (e) {}
    }

    console.warn(`[Exchange] Tasso storico non trovato per ${dateStr}, uso tasso live ${this.rate}`);
    return null; // restituisce null invece di this.rate — il chiamante decide il fallback
},

  _normalizeProxyPayload(raw, proxyIndex) {
    if (proxyIndex === 1) {
        return parseMaybeJson(raw?.contents);
    }
    return raw; // il proxy diretto restituisce già il JSON corretto
},

  _extractHistoricRows(data) {
    if (!data) return [];
    if (Array.isArray(data?.rates)) return data.rates;
    if (Array.isArray(data?.timeSeries)) return data.timeSeries;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data)) return data;
    if (data?.data) {
      if (Array.isArray(data.data?.rates)) return data.data.rates;
      if (Array.isArray(data.data?.timeSeries)) return data.data.timeSeries;
      if (Array.isArray(data.data)) return data.data;
    }
    return [];
  },

  async getWeightedHistoricRate(transactions, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) return 1;

    const buys = (transactions || []).filter(t => t.type === 'buy');
    if (!buys.length) return this.rate;

    const rates = await Promise.all(
      buys.map(async tx => {
        const manual = parseFloat(tx.exchangeRate);
        if (manual && isFinite(manual) && manual > 0) return manual;
        return this.getRateForDate(tx.date);
      })
    );

    let totalQty = 0;
    let totalBase = 0;

    buys.forEach((tx, index) => {
      const qty = +tx.qty || 0;
      totalQty += qty;
      totalBase += qty * rates[index];
    });

    return totalQty > 0 ? totalBase / totalQty : this.rate;
  },

  _ensureStorageLoaded() {
    if (this._storageLoaded) return;
    this._storageLoaded = true;

    try {
      const raw = localStorage.getItem(RATE_CACHE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      const data = parsed?.data || {};

      for (const [dateStr, entry] of Object.entries(data)) {
        if (entry && isFresh(entry.ts, HIST_TTL) && entry.rate > 0) {
          this._memoryCache.set(dateStr, entry);
        }
      }
    } catch (e) {}
  },

  _saveFxCache() {
    try {
      const data = Object.fromEntries(this._memoryCache.entries());
      localStorage.setItem(RATE_CACHE_KEY, JSON.stringify({ data }));
    } catch (e) {}
  },

  clearHistoricCache() {
    this._memoryCache.clear();
    this._pendingRates.clear();
    this._storageLoaded = false;

    try {
      localStorage.removeItem(RATE_CACHE_KEY);
    } catch (e) {}
  }
};
