import { Calc } from '../calc.js';
import { Exchange } from '../../../api/exchange.js';
import { Toast } from '../../../core/toast.js';

export const Cart = {
    items: [],

    add(item) {
        this.items.push({ ...item, _cartId: Date.now() + Math.random() });
        CartPanel.render();
        CartPanel.show();
        Toast.show(`${item.nome} aggiunto al carrello`, 'ok');
    },

    remove(cartId) {
        this.items = this.items.filter(i => i._cartId !== cartId);
        CartPanel.render();
    },

    clear() {
        this.items = [];
        CartPanel.render();
    }
};

export const CartPanel = {
    _visible: false,

    init() {
        if (document.getElementById('cart-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'cart-panel';
        panel.innerHTML = `
            <div class="cart-header">
                <span>🛒 Lista della Spesa</span>
                <div style="display:flex;gap:6px;align-items:center;">
                    <button id="cart-clear" title="Svuota carrello" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--text-muted);padding:2px 6px;border-radius:4px;">✕ Svuota</button>
                    <button id="cart-toggle-btn" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--text-muted);">▼</button>
                </div>
            </div>
            <div id="cart-body">
                <div id="cart-items"></div>
                <div id="cart-footer"></div>
            </div>`;
        document.body.appendChild(panel);

        document.getElementById('cart-toggle-btn').onclick = () => this.toggle();
        document.getElementById('cart-clear').onclick = () => {
            if (Cart.items.length && confirm('Svuotare il carrello?')) {
                Cart.clear();
            }
        };

        const fab = document.createElement('button');
        fab.id = 'cart-fab';
        fab.innerHTML = '🛒 <span id="cart-badge">0</span>';
        fab.onclick = () => this.toggle();
        document.body.appendChild(fab);

        this.render();
    },

    show() {
        const panel = document.getElementById('cart-panel');
        if (panel) {
            panel.classList.add('visible');
            this._visible = true;
            const body = document.getElementById('cart-body');
            if (body) body.style.display = 'block';
            const btn = document.getElementById('cart-toggle-btn');
            if (btn) btn.textContent = '▼';
        }
    },

    toggle() {
        const body = document.getElementById('cart-body');
        const btn  = document.getElementById('cart-toggle-btn');
        const panel = document.getElementById('cart-panel');
        if (!body || !panel) return;
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        if (btn) btn.textContent = isOpen ? '▲' : '▼';
        panel.classList.toggle('visible', true);
        this._visible = true;
    },

    render() {
        const itemsEl  = document.getElementById('cart-items');
        const footerEl = document.getElementById('cart-footer');
        const badge    = document.getElementById('cart-badge');
        const fab      = document.getElementById('cart-fab');
        const panel    = document.getElementById('cart-panel');

        if (!itemsEl) return;
        if (badge) badge.textContent = Cart.items.length;
        if (fab)   fab.classList.toggle('has-items', Cart.items.length > 0);

        if (!Cart.items.length) {
            itemsEl.innerHTML = `<div class="cart-empty">Nessuna simulazione aggiunta</div>`;
            if (footerEl) footerEl.innerHTML = '';
            return;
        }

        if (panel) panel.classList.add('visible');

        let totalBuyEur  = 0;
        let totalSellNet = 0;
        let totalTax     = 0;
        let html = '';

        Cart.items.forEach(item => {
            const s = item.valuta === 'USD' ? '$' : '€';
            const rate = Exchange.rate || 1;
            const toEur = v => item.valuta === 'USD' ? v / rate : v;

            if (item.type === 'buy') {
                const cost = item.qty * item.price + item.commission;
                const costEur = toEur(cost);
                totalBuyEur += costEur;
                html += `
                    <div class="cart-item cart-item-buy">
                        <div class="cart-item-header">
                            <span class="cart-item-badge buy">🟢 ACQ</span>
                            <span class="cart-item-name">${item.nome}</span>
                            <button class="cart-item-remove" data-cid="${item._cartId}">✕</button>
                        </div>
                        <div class="cart-item-detail">
                            ${Calc.fmt(item.qty, 4)} az. × ${Calc.fmt(item.price)} + comm. ${Calc.fmt(item.commission)}
                        </div>
                        <div class="cart-item-total buy-color">
                            Costo: <b>${s} ${Calc.fmt(cost)}</b>
                            ${item.valuta === 'USD' ? `<span class="cart-eur-hint">≈ € ${Calc.fmt(costEur)}</span>` : ''}
                        </div>
                        <div class="cart-item-pmc">Nuovo PMC: <b>${Calc.fmt(item.newPmc)}</b> &nbsp;|&nbsp; Q.tà tot: <b>${Calc.fmt(item.newQty, 4)}</b></div>
                    </div>`;
            } else {
                const grossReceipt = item.grossReceipt;
                const tax          = item.tax;
                const netReceipt   = item.netReceipt;
                const netEur       = toEur(netReceipt);
                totalSellNet      += netEur;
                totalTax          += toEur(tax);
                const taxPct       = item.tipoAsset === 'bond' ? '12,5%' : item.tipoAsset === 'crypto' ? '33%' : '26%';
                html += `
                    <div class="cart-item cart-item-sell">
                        <div class="cart-item-header">
                            <span class="cart-item-badge sell">🔴 VEN</span>
                            <span class="cart-item-name">${item.nome}</span>
                            <button class="cart-item-remove" data-cid="${item._cartId}">✕</button>
                        </div>
                        <div class="cart-item-detail">
                            ${Calc.fmt(item.qty, 4)} az. × ${Calc.fmt(item.price)} − comm. ${Calc.fmt(item.commission)}
                        </div>
                        <div class="cart-item-total">
                            Lordo: <b>${s} ${Calc.fmt(grossReceipt)}</b>
                            &nbsp;−&nbsp; Tasse ${taxPct}: <b class="neg-loss">${s} ${Calc.fmt(tax)}</b>
                        </div>
                        <div class="cart-item-pmc sell-net">
                            Netto: <b>${s} ${Calc.fmt(netReceipt)}</b>
                            ${item.valuta === 'USD' ? `<span class="cart-eur-hint">≈ € ${Calc.fmt(netEur)}</span>` : ''}
                            &nbsp;|&nbsp; Q.tà rim: <b>${Calc.fmt(item.remQty, 4)}</b>
                        </div>
                    </div>`;
            }
        });

        itemsEl.innerHTML = html;

        itemsEl.querySelectorAll('.cart-item-remove').forEach(btn => {
            btn.onclick = () => Cart.remove(+btn.dataset.cid);
        });

        const balance = totalSellNet - totalBuyEur;
        if (footerEl) {
            footerEl.innerHTML = `
                <div class="cart-totals">
                    <div class="cart-total-row">
                        <span>💸 Uscite (acquisti):</span>
                        <span class="neg-loss"><b>− € ${Calc.fmt(totalBuyEur)}</b></span>
                    </div>
                    <div class="cart-total-row">
                        <span>💰 Entrate nette (vendite):</span>
                        <span class="pos-gain"><b>+ € ${Calc.fmt(totalSellNet)}</b></span>
                    </div>
                    ${totalTax > 0 ? `<div class="cart-total-row text-muted"><span>📋 Tasse totali stimate:</span><span>€ ${Calc.fmt(totalTax)}</span></div>` : ''}
                    <div class="cart-total-row cart-grand-total ${balance >= 0 ? 'pos-gain' : 'neg-loss'}">
                        <span>Saldo netto:</span>
                        <span><b>${balance >= 0 ? '+' : ''}€ ${Calc.fmt(balance)}</b></span>
                    </div>
                </div>`;
        }
    }
};