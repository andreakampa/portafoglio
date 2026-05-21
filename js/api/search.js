import { PROXY } from './config.js';

const SEARCH_PROXIES = [
    q => `${PROXY}?url=${encodeURIComponent('https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) + '&lang=it-IT&region=IT&quotesCount=8&newsCount=0')}`,
    q => `https://api.allorigins.win/get?url=${encodeURIComponent('https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) + '&lang=it-IT&region=IT&quotesCount=8&newsCount=0')}`,
];

const CURRENCY_MAP = {
    'EUR': 'EUR', 'USD': 'USD', 'GBp': 'EUR', 'GBP': 'EUR',
    'CHF': 'CHF', 'JPY': 'USD', 'CAD': 'USD', 'AUD': 'USD',
};

const EUR_SUFFIXES = [
    '.MI', '.DE', '.PA', '.AS', '.MC', '.BR', '.LS', '.VI',
    '.WA', '.HE', '.CO', '.OL', '.ST', '.F', '.XETRA'
];

function resolveCurrency(ticker, yahooRawCurrency) {
    const upper = (ticker || '').toUpperCase();
    if (EUR_SUFFIXES.some(s => upper.endsWith(s))) return 'EUR';
    return CURRENCY_MAP[yahooRawCurrency] || (yahooRawCurrency?.startsWith('EUR') ? 'EUR' : 'USD');
}

const ASSET_TYPE_MAP = {
    'EQUITY':         { tipo: 'stock',  label: 'Azione (26%)' },
    'ETF':            { tipo: 'stock',  label: 'ETF (26%)' },
    'MUTUALFUND':     { tipo: 'stock',  label: 'Fondo (26%)' },
    'CRYPTOCURRENCY': { tipo: 'crypto', label: 'Crypto (33%)' },
    'BOND':           { tipo: 'bond',   label: 'Obbligazione (12.5%)' },
    'FUTURE':         { tipo: 'stock',  label: 'Future (26%)' },
    'INDEX':          { tipo: 'stock',  label: 'Indice (26%)' },
    'OPTION':         { tipo: 'stock',  label: 'Opzione (26%)' },
};

function buildLogoUrl(ticker) {
    const base = ticker.split('.')[0].split('-')[0].toUpperCase();
    return `https://img.logo.dev/ticker/${base}?token=pk_free&size=32`;
}

export const Search = {
    async query(q) {
        if (!q || q.length < 1) return [];
        for (let i = 0; i < SEARCH_PROXIES.length; i++) {
            try {
                const r   = await fetch(SEARCH_PROXIES[i](q), { signal: AbortSignal.timeout(5000) });
                const raw = await r.json();
                const parsed = (i === 0) ? raw : JSON.parse(raw.contents);
                const quotes = parsed?.quotes || [];
                return quotes
                    .filter(q => q.symbol && q.quoteType !== 'CURRENCY')
                    .map(q => {
                        const assetInfo = ASSET_TYPE_MAP[q.quoteType?.toUpperCase()]
                            ?? { tipo: 'stock', label: 'Altro (26%)' };
                        const base = q.symbol.split('.')[0].split('-')[0].toUpperCase();
                        return {
                            ticker:    q.symbol,
                            name:      q.shortname || q.longname || q.symbol,
                            type:      q.quoteType || '',
                            exchange:  q.exchDisp || '',
                            currency:  resolveCurrency(q.symbol, q.currency),
                            tipoAsset: assetInfo.tipo,
                            tipoLabel: assetInfo.label,
                            logoUrl:   `https://img.logo.dev/ticker/${base}?token=pk_free&size=32`,
                        };
                    });
            } catch (e) { /* prova proxy successivo */ }
        }
        return [];
    }
};
