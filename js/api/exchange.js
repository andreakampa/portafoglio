export const Exchange = {
    rate: 1.08,

    async update() {
        try {
            const r = await fetch('https://open.er-api.com/v6/latest/EUR');
            const d = await r.json();
            if (d.result === 'success') {
                this.rate = d.rates.USD;
                return true;
            }
        } catch (e) {}
        return false;
    },

    convert(value, from, to) {
        if (from === to) return value;
        return from === 'EUR' ? value * this.rate : value / this.rate;
    }
};
