const SEARCH_PROXIES = [
    q => `https://api.allorigins.win/get?url=${encodeURIComponent('https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) + '&lang=it-IT&region=IT&quotesCount=8&newsCount=0')}`,
    q => `https://corsproxy.io/?${encodeURIComponent('https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) + '&lang=it-IT&region=IT&quotesCount=8&newsCount=0')}`
];

const CURRENCY_MAP = {
    'EUR': 'EUR', 'USD': 'USD', 'GBp': 'EUR', 'GBP': 'EUR',
    'CHF': 'EUR', 'JPY': 'USD', 'CAD': 'USD', 'AUD': 'USD',
};

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
    // Pulisce il ticker da suffissi borsa (.MI, .DE, -USD, ecc.)
    const base = ticker.split('.')[0].split('-')[0].toUpperCase();
    return `https://financialmodelingprep.com/image-stock/${base}.png`;
}

export const Search = {
    async query(q) {
        if (!q || q.length < 1) return [];
        for (let i = 0; i < SEARCH_PROXIES.length; i++) {
            try {
                const r   = await fetch(SEARCH_PROXIES[i](q), { signal: AbortSignal.timeout(5000) });
                const raw = await r.json();
                const parsed = (i === 0) ? JSON.parse(raw.contents) : raw;
                const quotes = parsed?.quotes || [];
                return quotes
                    .filter(q => q.symbol && q.quoteType !== 'CURRENCY')
                    .map(q => {
                        const assetInfo = ASSET_TYPE_MAP[q.quoteType?.toUpperCase()]
                            ?? { tipo: 'stock', label: 'Altro (26%)' };
                        return {
                            ticker:    q.symbol,
                            name:      q.shortname || q.longname || q.symbol,
                            type:      q.quoteType || '',
                            exchange:  q.exchDisp || '',
                            currency:  CURRENCY_MAP[q.currency] || (q.currency?.startsWith('EUR') ? 'EUR' : 'USD'),
                            tipoAsset: assetInfo.tipo,
                            tipoLabel: assetInfo.label,
                            logoUrl:   q.logoUrl || q.iconUrl || buildLogoUrl(q.symbol),
                        };
                    });
            } catch (e) { /* prova proxy successivo */ }
        }
        return [];
    }
};

