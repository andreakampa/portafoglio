import { PROXY } from './config.js';

const PROXIES = [
    ticker => `${PROXY}?url=${encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1m&range=1d&includePrePost=true')}`,
ticker => `https://api.allorigins.win/get?url=${encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1m&range=1d&includePrePost=true')}`,
];

const PROXIES_30D = [
    ticker => `${PROXY}?url=${encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1d&range=1mo')}`,
    ticker => `https://api.allorigins.win/get?url=${encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1d&range=1mo')}`,
];

// Cache in memoria delle notizie (15 minuti): evita di rifare le richieste a ogni domanda all'AI.
const NEWS_TTL_MS = 15 * 60 * 1000;
const _newsCache = {};

export const Yahoo = {
    async fetchPrice(ticker) {
    for (let i = 0; i < PROXIES.length; i++) {
        try {
            const r = await fetch(PROXIES[i](ticker), { signal: AbortSignal.timeout(7000) });
            const raw = await r.json();
            const parsed = (i === 1) ? JSON.parse(raw.contents) : raw;
            const result = parsed.chart.result[0];
            const meta   = result.meta;
            const timestamps = result.timestamp ?? [];
            const closes     = result.indicators?.quote?.[0]?.close ?? [];
            const pre     = meta.currentTradingPeriod?.pre;
            const regular = meta.currentTradingPeriod?.regular;
            const post    = meta.currentTradingPeriod?.post;

            // Prev close
            const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;

            // Pre-market: ultimi candle prima del regular
            let preMarket = null;
            if (pre && regular) {
                const preCandles = timestamps
                    .map((t, i) => ({ t, c: closes[i] }))
                    .filter(x => x.t >= pre.start && x.t < regular.start && x.c != null);
                if (preCandles.length) preMarket = preCandles.at(-1).c;
            }

            // Post-market: ultimi candle dopo il regular
            let postMarket = null;
            if (post) {
                const postCandles = timestamps
                    .map((t, i) => ({ t, c: closes[i] }))
                    .filter(x => x.t >= post.start && x.c != null);
                if (postCandles.length) postMarket = postCandles.at(-1).c;
            }

            // Serie intraday per lo sparkline (pre + regular + post della giornata)
            const intraday = closes.filter(c => c !== null && c !== undefined);

            return {
                price: meta.regularMarketPrice,
                prevClose: prev,
                open: meta.regularMarketOpen ?? null,
                marketState: meta.marketState ?? null,
                preMarket,
                postMarket,
                week52Low:  meta.fiftyTwoWeekLow  ?? null,
                week52High: meta.fiftyTwoWeekHigh ?? null,
                intraday,
            };
        } catch (e) { /* try next proxy */ }
    }
    return null;
},

    async fetchAll(tickers) {
        const entries = Object.entries(tickers);
        const results = await Promise.allSettled(
            entries.map(([id, ticker]) =>
                this.fetchPrice(ticker).then(r => ({ id, r }))
            )
        );
        const prices = {}, prevs = {};
        const preMarkets = {}, postMarkets = {}, week52Lows = {}, week52Highs = {}, intraday = {};
        const opens = {}, marketStates = {};
        results.forEach(({ status, value }) => {
            if (status === 'fulfilled' && value?.r) {
                prices[value.id]       = value.r.price;
                prevs[value.id]        = value.r.prevClose;
                opens[value.id]        = value.r.open;
                marketStates[value.id] = value.r.marketState;
                preMarkets[value.id]   = value.r.preMarket;
                postMarkets[value.id]  = value.r.postMarket;
                week52Lows[value.id]   = value.r.week52Low;
                week52Highs[value.id]  = value.r.week52High;
                intraday[value.id]     = value.r.intraday;
            }
        });
        return { prices, prevs, opens, marketStates, preMarkets, postMarkets, week52Lows, week52Highs, intraday };
    },

    async fetchSparkline(ticker) {
        for (let i = 0; i < PROXIES_30D.length; i++) {
            try {
                const r = await fetch(PROXIES_30D[i](ticker), { signal: AbortSignal.timeout(7000) });
                const raw = await r.json();
                const parsed = (i === 1) ? JSON.parse(raw.contents) : raw;
                const closes = parsed.chart.result[0].indicators?.quote?.[0]?.close ?? [];
                return closes.filter(v => v !== null && v !== undefined);
            } catch (e) { /* try next proxy */ }
        }
        return [];
    },

    async fetchAllSparklines(tickers) {
        const entries = Object.entries(tickers);
        const results = await Promise.allSettled(
            entries.map(([id, ticker]) =>
                this.fetchSparkline(ticker).then(data => ({ id, data }))
            )
        );
        const sparklines = {};
        results.forEach(({ status, value }) => {
            if (status === 'fulfilled' && value?.data?.length) {
                sparklines[value.id] = value.data;
            }
        });
        return sparklines;
    },

    // Titoli di notizie recenti per un ticker, solo tramite il tuo Worker
    // (nessun proxy di terze parti). Restituisce [] se non ce ne sono o in caso di errore.
    async fetchNews(ticker, limit = 3) {
        const hit = _newsCache[ticker];
        if (hit && Date.now() - hit.ts < NEWS_TTL_MS) return hit.items.slice(0, limit);
        try {
            const target = 'https://query1.finance.yahoo.com/v1/finance/search?q=' +
                encodeURIComponent(ticker) + '&quotesCount=0&newsCount=8';
            const r = await fetch(`${PROXY}?url=${encodeURIComponent(target)}`, { signal: AbortSignal.timeout(6000) });
            const data = await r.json();
            const items = (data.news || [])
                .filter(n => n?.title &&
                    (!Array.isArray(n.relatedTickers) || !n.relatedTickers.length || n.relatedTickers.includes(ticker)))
                .map(n => ({
                    titolo: String(n.title).slice(0, 160),
                    fonte: n.publisher || null,
                    data: n.providerPublishTime
                        ? new Date(n.providerPublishTime * 1000).toISOString().slice(0, 10)
                        : null
                }));
            _newsCache[ticker] = { ts: Date.now(), items };
            return items.slice(0, limit);
        } catch (e) {
            return [];
        }
    },

    // Notizie per più titoli in parallelo: { id: ticker } -> { id: [notizie] }
    async fetchNewsMap(tickerMap, limit = 3) {
        const entries = Object.entries(tickerMap);
        const results = await Promise.allSettled(
            entries.map(([id, ticker]) =>
                this.fetchNews(ticker, limit).then(items => ({ id, items }))
            )
        );
        const out = {};
        results.forEach(({ status, value }) => {
            if (status === 'fulfilled' && value?.items?.length) out[value.id] = value.items;
        });
        return out;
    }
};