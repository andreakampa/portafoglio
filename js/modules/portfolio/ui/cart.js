import { Calc } from '../calc.js';
import { Exchange } from '../../../api/exchange.js';
import { Toast } from '../../../core/toast.js';
import { calcolaCompensazioneProvvisoria } from '../../../api/fiscale.js';

const CART_KEY = 'ptpro_cart';

function loadCartItems() {
    try {
        const raw = localStorage.getItem(CART_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function saveCartItems(items) {
    try {
        localStorage.setItem(CART_KEY, JSON.stringify(items));
    } catch (e) {}
}

export const Cart = {
    items: loadCartItems(),

    add(item) {
        this.items.push({ ...item, _cartId: Date.now() + Math.random() });
        saveCartItems(this.items);
        CartPanel.render();
        CartPanel.show();
        Toast.show(`${item.nome} aggiunto al carrello`, 'ok');
    },

    remove(cartId) {
        this.items = this.items.filter(i => i._cartId !== cartId);
        saveCartItems(this.items);
        CartPanel.render();
    },

    clear() {
        this.items = [];
        saveCartItems(this.items);
        CartPanel.render();
    },

    _persist() {
        saveCartItems(this.items);
    }
};

export const CartPanel = {
    _visible: false,
    _getPortfolio: null,
    _getTaxRegime: null,

    init(getPortfolio = null, getTaxRegime = null) {
        this._getPortfolio = getPortfolio;
        this._getTaxRegime = getTaxRegime;
        if (document.getElementById('cart-panel')) {
            this.render();
            return;
        }
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

        // Ricalcolo dinamico della compensazione tra le vendite del carrello,
        // nell'ordine attuale (modificabile via drag&drop). Non altera nulla
        // di persistito: è una simulazione "in sospeso".
        const portfolio = typeof this._getPortfolio === 'function' ? this._getPortfolio() : null;
        const taxRegime = typeof this._getTaxRegime === 'function' ? this._getTaxRegime() : 'amministrato';

        const cartSells = Cart.items
            .filter(i => i.type === 'sell' && typeof i.pnlLordoEur === 'number')
            .map(i => ({
                cartId: i._cartId,
                pnlLordoEur: i.pnlLordoEur,
                categoria: i.tipoAsset === 'crypto' ? 'crypto' : 'strumenti',
                isFondo: i.tipoAsset === 'fondo'
            }));

        const isDichiarativo = taxRegime === 'dichiarativo';
        const compensazioni = (portfolio && !isDichiarativo && cartSells.length)
            ? calcolaCompensazioneProvvisoria(portfolio, cartSells, taxRegime)
            : [];

        const compensazioneMap = {};
        compensazioni.forEach(c => { compensazioneMap[c.cartId] = c; });

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
                const taxRateMap = { bond: 0.125, crypto: 0.33 };
                const taxRate = taxRateMap[item.tipoAsset] ?? 0.26;
                const taxPct  = item.tipoAsset === 'bond' ? '12,5%' : item.tipoAsset === 'crypto' ? '33%' : '26%';

                const comp = compensazioneMap[item._cartId];
                let grossReceipt = item.grossReceipt;
                let tax, netReceipt, compensHtml = '';

                if (comp && typeof item.pnlLordoEur === 'number') {
                    if (item.pnlLordoEur > 0.01) {
                        tax = comp.residuoTassabileEur * taxRate;
                        netReceipt = grossReceipt - tax;
                        if (comp.motivoEsclusione === 'fondo') {
                            compensHtml = `<div class="cart-item-comp text-muted fs-xs">Fondo: nessuna compensazione possibile</div>`;
                        } else if (comp.compensatoEur > 0.01) {
                            compensHtml = `<div class="cart-item-comp text-muted fs-xs">Compensato con minus: − € ${Calc.fmt(comp.compensatoEur)}</div>`;
                        }
                    } else {
                        tax = 0;
                        netReceipt = grossReceipt;
                        compensHtml = `<div class="cart-item-comp text-muted fs-xs">In perdita: alimenta il pool minus per le righe successive</div>`;
                    }
                } else {
                    // Fallback: nessun portfolio/regime disponibile, usa i valori congelati originari.
                    tax = item.tax;
                    netReceipt = item.netReceipt;
                }

                const netEur = toEur(netReceipt);
                totalSellNet += netEur;
                totalTax     += toEur(tax);

                html += `
                    <div class="cart-item cart-item-sell" draggable="true" data-cid="${item._cartId}">
                        <div class="cart-item-header">
                            <span class="cart-item-drag" title="Trascina per riordinare">⠿</span>
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
                        ${compensHtml}
                        <div class="cart-item-pmc sell-net">
                            Netto: <b>${s} ${Calc.fmt(netReceipt)}</b>
                            ${item.valuta === 'USD' ? `<span class="cart-eur-hint">≈ € ${Calc.fmt(netEur)}</span>` : ''}
                            &nbsp;|&nbsp; Q.tà rim: <b>${Calc.fmt(item.remQty, 4)}</b>
                        </div>
                    </div>`;
            }
        });

        const noteDichiarativo = (isDichiarativo && cartSells.length)
            ? `<div class="cart-regime-note">ℹ️ Regime dichiarativo: la compensazione minus/plus non è automatica. Le tasse mostrate sono sul lordo, senza compensazione — la gestirai tu in dichiarazione.</div>`
            : '';

        itemsEl.innerHTML = noteDichiarativo + html;

        itemsEl.querySelectorAll('.cart-item-remove').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                Cart.remove(+btn.dataset.cid);
            };
        });

        this._bindDragAndDrop(itemsEl);

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
    },

    _bindDragAndDrop(itemsEl) {
        let dragCartId = null;

        itemsEl.querySelectorAll('.cart-item[draggable="true"]').forEach(card => {
            card.addEventListener('dragstart', (e) => {
                dragCartId = +card.dataset.cid;
                card.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
            });

            card.addEventListener('dragover', (e) => {
                e.preventDefault();
                card.classList.add('drag-over');
            });

            card.addEventListener('dragleave', () => {
                card.classList.remove('drag-over');
            });

            card.addEventListener('drop', (e) => {
                e.preventDefault();
                card.classList.remove('drag-over');
                const targetCartId = +card.dataset.cid;
                if (dragCartId === null || dragCartId === targetCartId) return;

                const fromIdx = Cart.items.findIndex(i => i._cartId === dragCartId);
                const toIdx   = Cart.items.findIndex(i => i._cartId === targetCartId);
                if (fromIdx === -1 || toIdx === -1) return;

                const [moved] = Cart.items.splice(fromIdx, 1);
                Cart.items.splice(toIdx, 0, moved);

                Cart._persist();
                this.render();
            });
        });
    }
};