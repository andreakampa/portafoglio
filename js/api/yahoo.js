import { PROXY } from './config.js';

const PROXIES = [
    ticker => `${PROXY}?url=${encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1m&range=1d&includePrePost=true')}`,
ticker => `https://api.allorigins.win/get?url=${encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1m&range=1d&includePrePost=true')}`,
];

const PROXIES_30D = [
    ticker => `${PROXY}?url=${encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1d&range=1mo')}`,
    ticker => `https://api.allorigins.win/get?url=${encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1d&range=1mo')}`,
];

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

            return {
                price: meta.regularMarketPrice,
                prevClose: prev,
                preMarket,
                postMarket,
                week52Low:  meta.fiftyTwoWeekLow  ?? null,
                week52High: meta.fiftyTwoWeekHigh ?? null,
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
        const preMarkets = {}, postMarkets = {}, week52Lows = {}, week52Highs = {};
        results.forEach(({ status, value }) => {
            if (status === 'fulfilled' && value?.r) {
                prices[value.id]      = value.r.price;
                prevs[value.id]       = value.r.prevClose;
                preMarkets[value.id]  = value.r.preMarket;
                postMarkets[value.id] = value.r.postMarket;
                week52Lows[value.id]  = value.r.week52Low;
                week52Highs[value.id] = value.r.week52High;
            }
        });
        return { prices, prevs, preMarkets, postMarkets, week52Lows, week52Highs };
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
    }
};
