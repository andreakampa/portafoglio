const RATE_CACHE_KEY = 'ptpro_fx_history';
const FX_TTL  = 24 * 60 * 60 * 1000;   // 24h cache tasso live
const HIST_TTL = 7 * 24 * 60 * 60 * 1000; // 7 giorni cache tassi storici
const PROXY = 'https://finance-proxy.andrea-kampa.workers.dev';

const LATEST_PROXIES = [
    `${PROXY}?url=${encodeURIComponent('https://open.er-api.com/v6/latest/EUR')}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent('https://open.er-api.com/v6/latest/EUR')}`,
];

// ── Banca d'Italia API (tasso BCE ufficiale giornaliero) ───────────────────
// Restituisce il fixing di fine giornata EUR/USD per una data specifica.
// Documentazione: https://tassidicambio.bancaditalia.it
const BDITALIA_URL = (dateStr) =>
    `https://tassidicambio.bancaditalia.it/terzevalute-wf-ui-web/timeSeries` +
    `?startDate=${dateStr}&endDate=${dateStr}&currencyIsoCode=USD&lang=it`;

const BDITALIA_PROXIES = (dateStr) => [
    `${PROXY}?url=${encodeURIComponent(BDITALIA_URL(dateStr))}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(BDITALIA_URL(dateStr))}`,
];

export const Exchange = {
    rate: 1.08,

    // ── Tasso live ──────────────────────────────────────────────────────────
    async update() {
        for (let i = 0; i < LATEST_PROXIES.length; i++) {
            try {
                const r   = await fetch(LATEST_PROXIES[i], { signal: AbortSignal.timeout(5000) });
                const raw = await r.json();
                const d   = (i === 1) ? JSON.parse(raw.contents) : raw;
                if (d.result === 'success') {
                    this.rate = d.rates.USD;
                    return true;
                }
            } catch (e) { /* prova proxy successivo */ }
        }
        return false;
    },

    convert(value, from, to) {
        if (from === to) return value;
        return from === 'EUR' ? value * this.rate : value / this.rate;
    },

    // ── Tasso storico Banca d'Italia ────────────────────────────────────────
    // Ritorna il fixing BCE EUR/USD del giorno specificato (es. '2023-05-12').
    // Usa cache localStorage 7 giorni. Fallback: tasso live corrente.
    async getRateForDate(dateStr) {
        if (!dateStr) return this.rate;

        // 1. controlla cache
        const cache = this._loadFxCache();
        if (cache[dateStr]) return cache[dateStr];

        // 2. Chiama Banca d'Italia via proxy
        const proxies = BDITALIA_PROXIES(dateStr);
        for (let i = 0; i < proxies.length; i++) {
            try {
                const r   = await fetch(proxies[i], { signal: AbortSignal.timeout(6000) });
                const raw = await r.json();
                const txt = i === 1 ? raw.contents : await (async () => {
                    // il proxy andrea restituisce già il json parsato
                    return typeof raw === 'string' ? raw : JSON.stringify(raw);
                })();
                const data = typeof txt === 'string' ? JSON.parse(txt) : txt;

                // La risposta Banca d'Italia ha struttura:
                // { resultsInfo: {...}, rates: [ { currency:'USD', isoCode:'USD',
                //   referenceDate:'2023-05-12', uicRate: 1.0851, ... } ] }
                const rates = data?.rates ?? data?.timeSeries ?? [];
                if (rates.length > 0) {
                    // uicRate = USD per 1 EUR (quanti USD vale 1 EUR)
                    const uicRate = parseFloat(rates[0].uicRate ?? rates[0].avgRate ?? 0);
                    if (uicRate > 0) {
                        cache[dateStr] = uicRate;
                        this._saveFxCache(cache);
                        return uicRate;
                    }
                }
            } catch (e) { /* prova proxy successivo */ }
        }

        // 3. Fallback: tasso live
        console.warn(`[Exchange] Tasso storico non trovato per ${dateStr}, uso tasso live ${this.rate}`);
        return this.rate;
    },

    // ── Tasso medio ponderato su più transazioni ────────────────────────────
    // Usato per calcolare il PMC in EUR tenendo conto del cambio storico.
    async getWeightedHistoricRate(transactions, fromCurrency, toCurrency) {
        if (fromCurrency === toCurrency) return 1;
        const buys = (transactions || []).filter(t => t.type === 'buy');
        if (!buys.length) return this.rate;

        let totalQty  = 0;
        let totalBase = 0;
        for (const tx of buys) {
            const rate = await this.getRateForDate(tx.date);
            const qty  = +tx.qty;
            totalQty  += qty;
            totalBase += qty * rate;  // somma ponderata per quantità
        }
        return totalQty > 0 ? totalBase / totalQty : this.rate;
    },

    // ── Cache localStorage ──────────────────────────────────────────────────
    _loadFxCache() {
        try {
            const raw = localStorage.getItem(RATE_CACHE_KEY);
            if (!raw) return {};
            const { data, ts } = JSON.parse(raw);
            if (Date.now() - ts > HIST_TTL) return {};
            return data || {};
        } catch (e) { return {}; }
    },

    _saveFxCache(data) {
        try {
            localStorage.setItem(RATE_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
        } catch (e) {}
    }
};
