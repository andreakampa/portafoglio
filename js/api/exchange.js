const RATE_CACHE_KEY = 'ptpro_fx_history';
const FX_TTL = 24 * 60 * 60 * 1000;
const HIST_TTL = 7 * 24 * 60 * 60 * 1000;
const PROXY = 'https://finance-proxy.andrea-kampa.workers.dev';

const LATEST_PROXIES = [
  `${PROXY}?url=${encodeURIComponent('https://open.er-api.com/v6/latest/EUR')}`,
  `https://api.allorigins.win/get?url=${encodeURIComponent('https://open.er-api.com/v6/latest/EUR')}`,
];

const BDITALIA_URL = (dateStr) =>
  `https://tassidicambio.bancaditalia.it/terzevalute-wf-ui-web/timeSeries` +
  `?startDate=${dateStr}&endDate=${dateStr}&currencyIsoCode=USD&lang=it`;

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
        const data = i === 1 ? JSON.parse(raw.contents) : raw;

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

        const rates = data?.rates ?? data?.timeSeries ?? [];
        if (rates.length > 0) {
          const uicRate = parseFloat(rates[0].uicRate ?? rates[0].avgRate ?? 0);
          if (uicRate > 0) return uicRate;
        }
      } catch (e) {}
    }

    console.warn(`[Exchange] Tasso storico non trovato per ${dateStr}, uso tasso live ${this.rate}`);
    return this.rate;
  },

  _normalizeProxyPayload(raw, proxyIndex) {
    if (proxyIndex === 1) {
      return typeof raw?.contents === 'string' ? JSON.parse(raw.contents) : raw?.contents;
    }
    return raw;
  },

  async getWeightedHistoricRate(transactions, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) return 1;

    const buys = (transactions || []).filter(t => t.type === 'buy');
    if (!buys.length) return this.rate;

    const rates = await Promise.all(
      buys.map(tx => this.getRateForDate(tx.date))
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
