import { Calc } from './calc.js';
import { Exchange } from '../../api/exchange.js';
import { Toast } from '../../core/toast.js';

function todayISO() { return new Date().toISOString().slice(0, 10); }
function lockScroll()   { document.body.classList.add('modal-open'); }
function unlockScroll() { document.body.classList.remove('modal-open'); }

// ── CART STORE ─────────────────────────────────────────────────────────────
export const Cart = {
    items: [],

    add(item) {
        // item: { id, nome, type:'buy'|'sell', qty, price, commission, pmc, valuta, tipoAsset }
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

// ── CART PANEL ─────────────────────────────────────────────────────────────
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

// ── HISTORY MODAL ──────────────────────────────────────────────────────────
export function openHistoryModal(id, portfolio, onSave) {
    const p = portfolio[id];
    const overlay = document.getElementById('modal-history');

    overlay.innerHTML = `
        <div class="modal modal-wide">
            <div class="modal-header">
                <h3>📜 Storico — ${p.nome}</h3>
                <button class="btn-x" id="hist-close">✕</button>
            </div>
            <div class="modal-body">
                <div class="preview-box" id="hist-summary" style="margin-bottom:14px;"></div>
                <div class="table-wrapper">
                    <table class="tx-table tx-table-compact">
                        <thead><tr>
                            <th>Data</th><th>Tipo</th><th>Q.tà</th>
                            <th>Prezzo</th><th>Comm.</th><th>Totale</th>
                            <th>PMC</th><th>P&L</th><th></th>
                        </tr></thead>
                        <tbody id="hist-tbody"></tbody>
                    </table>
                </div>
            </div>
        </div>`;
    overlay.classList.add('visible');
    lockScroll();
    document.getElementById('hist-close').onclick = () => {
        overlay.classList.remove('visible');
        unlockScroll();
    };
    _renderHistoryContent(id, portfolio, onSave);
}

function _renderHistoryContent(id, portfolio, onSave) {
    const p = portfolio[id];
    const { qta, pmc, realizedPnL, totalComm } = Calc.positionSync(p);
    const s = p.valuta === 'USD' ? '$' : '€';
    const txsSorted = (p.transactions || []).slice().sort((a, b) => a.date.localeCompare(b.date));

    document.getElementById('hist-summary').innerHTML =
        `Q.tà: <b>${Calc.fmt(qta, 4)}</b> &nbsp;|&nbsp; PMC: <b>${Calc.fmt(pmc)}</b> &nbsp;|&nbsp;
         P&L Realizzato: <b class="${realizedPnL >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(realizedPnL)}</b> &nbsp;|&nbsp;
         Commissioni tot.: <b>${s} ${Calc.fmt(totalComm)}</b>`;

    const tbody = document.getElementById('hist-tbody');
    if (!txsSorted.length) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text-muted);">Nessuna transazione</td></tr>`;
        return;
    }

    let rQta = 0, rPmc = 0;
    tbody.innerHTML = '';
    txsSorted.forEach((tx, i) => {
        const q = +tx.qty, pr = +tx.price, c = +(tx.commission || 0);
        let tradePnL = null;
        if (tx.type === 'buy') {
            rPmc = rQta + q > 0 ? ((rQta * rPmc) + (q * pr) + c) / (rQta + q) : 0;
            rQta += q;
        } else {
            tradePnL = (pr - rPmc) * q - c;
            rQta -= q;
            if (rQta < 0.00001) rQta = 0;
        }
        const totale = tx.type === 'buy' ? q * pr + c : q * pr - c;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${tx.date}</td>
            <td class="${tx.type === 'buy' ? 'tx-buy' : 'tx-sell'}">${tx.type === 'buy' ? '🟢 Acq.' : '🔴 Vend.'}</td>
            <td>${Calc.fmt(q, 4)}</td>
            <td>${Calc.fmt(pr)}</td>
            <td>${Calc.fmt(c)}</td>
            <td>${s} ${Calc.fmt(totale)}</td>
            <td>${Calc.fmt(rPmc)}</td>
            <td>${tradePnL !== null
                ? `<span class="${tradePnL >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(tradePnL)}</span>`
                : '—'}</td>
            <td style="display:flex; gap:4px;">
                <button class="btn btn-dark btn-sm btn-icon btn-edit-tx" data-idx="${i}" title="Modifica">✏️</button>
                <button class="btn-del-tx" data-idx="${i}" title="Elimina">✕</button>
            </td>`;
        tbody.appendChild(tr);
    });

    tbody.onclick = async e => {
        const delBtn  = e.target.closest('.btn-del-tx');
        const editBtn = e.target.closest('.btn-edit-tx');

        if (delBtn) {
            const origTx = txsSorted[+delBtn.dataset.idx];
            if (!confirm(`Eliminare la transazione del ${origTx.date}?`)) return;
            const realIdx = portfolio[id].transactions.findIndex(
                t => t.date === origTx.date && t.qty === origTx.qty &&
                     t.price === origTx.price && t.type === origTx.type
            );
            if (realIdx > -1) portfolio[id].transactions.splice(realIdx, 1);
            await onSave();
            _renderHistoryContent(id, portfolio, onSave);
            Toast.show('Transazione rimossa', 'ok');
        }

        if (editBtn) {
            const origTx = txsSorted[+editBtn.dataset.idx];
            _openEditModal(id, origTx, portfolio, onSave);
        }
    };
}

// ── EDIT TRANSACTION MODAL ─────────────────────────────────────────────────
function _openEditModal(id, origTx, portfolio, onSave) {
    document.getElementById('modal-edit-tx')?.remove();

    const wrap = document.createElement('div');
    wrap.id = 'modal-edit-tx';
    wrap.className = 'overlay visible';
    wrap.innerHTML = `
        <div class="modal" style="border-top: 3px solid var(--warning);">
            <div class="modal-header">
                <h3>✏️ Modifica Transazione — ${portfolio[id].nome}</h3>
                <button class="btn-x" id="edit-tx-close">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-grid-2">
                    <div>
                        <span class="modal-label">Data</span>
                        <input type="date" id="edit-tx-data" value="${origTx.date}">
                    </div>
                    <div>
                        <span class="modal-label">Tipo</span>
                        <select id="edit-tx-tipo">
                            <option value="buy"  ${origTx.type === 'buy'  ? 'selected' : ''}>🟢 Acquisto</option>
                            <option value="sell" ${origTx.type === 'sell' ? 'selected' : ''}>🔴 Vendita</option>
                        </select>
                    </div>
                    <div>
                        <span class="modal-label">Quantità</span>
                        <input type="number" id="edit-tx-qta" step="any" value="${origTx.qty}">
                    </div>
                    <div>
                        <span class="modal-label">Prezzo</span>
                        <input type="number" id="edit-tx-prezzo" step="any" value="${origTx.price}">
                    </div>
                    <div>
                        <span class="modal-label">Commissione</span>
                        <input type="number" id="edit-tx-comm" step="any" value="${origTx.commission || 0}">
                    </div>
                </div>
                <button id="edit-tx-save" class="btn btn-warning btn-full" style="margin-top:16px;">💾 Salva Modifiche</button>
                <button id="edit-tx-cancel" class="btn btn-ghost btn-full" style="margin-top:8px;">Annulla</button>
            </div>
        </div>`;
    document.body.appendChild(wrap);
    lockScroll();

    const close = () => { wrap.remove(); unlockScroll(); };
    document.getElementById('edit-tx-close').onclick  = close;
    document.getElementById('edit-tx-cancel').onclick = close;

    document.getElementById('edit-tx-save').onclick = async () => {
        const newDate = document.getElementById('edit-tx-data').value;
        const newType = document.getElementById('edit-tx-tipo').value;
        const newQty  = parseFloat(document.getElementById('edit-tx-qta').value);
        const newPr   = parseFloat(document.getElementById('edit-tx-prezzo').value);
        const newComm = parseFloat(document.getElementById('edit-tx-comm').value) || 0;
        if (!newDate || isNaN(newQty) || newQty <= 0 || isNaN(newPr) || newPr <= 0) {
            Toast.show('Compila tutti i campi correttamente', 'err'); return;
        }
        const realIdx = portfolio[id].transactions.findIndex(
            t => t.date === origTx.date && t.qty === origTx.qty &&
                 t.price === origTx.price && t.type === origTx.type
        );
        if (realIdx > -1) {
            portfolio[id].transactions[realIdx] = {
                date: newDate, type: newType,
                qty: newQty, price: newPr, commission: newComm
            };
        }
        close();
        await onSave();
        _renderHistoryContent(id, portfolio, onSave);
        Toast.show('Transazione aggiornata', 'ok');
    };
}

// ── TRANSACTION MODAL ──────────────────────────────────────────────────────
export function openTransactionModal(id, type, portfolio, prices, onSave) {
    const p = portfolio[id];
    const { qta, pmc } = Calc.positionSync(p);
    const prLive = prices[id] ?? pmc;
    const overlay = document.getElementById('modal-transazione');
    const isBuy = type === 'buy';

    overlay.innerHTML = `
        <div class="modal" style="border-top: 3px solid ${isBuy ? 'var(--success)' : 'var(--purple)'}">
            <div class="modal-header">
                <h3>${isBuy ? '🟢 Acquisto' : '🔴 Vendita'} — ${p.nome}</h3>
                <button class="btn-x" id="tx-close">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-grid-2">
                    <div>
                        <span class="modal-label">Data</span>
                        <input type="date" id="tx-data" value="${todayISO()}">
                    </div>
                    <div>
                        <span class="modal-label">Quantità</span>
                        <input type="number" id="tx-qta" step="any" placeholder="0">
                    </div>
                    <div>
                        <span class="modal-label">Prezzo Eseguito</span>
                        <input type="number" id="tx-prezzo" step="any" value="${prLive}">
                    </div>
                    <div>
                        <span class="modal-label">Commissione (€)</span>
                        <input type="number" id="tx-comm" step="any" value="${p.commDefault || 7}">
                    </div>
                </div>
                <div id="tx-preview" class="preview-box" style="display:none; margin-top:14px;"></div>
                <button id="tx-confirm" class="btn ${isBuy ? 'btn-success' : 'btn-purple'} btn-full" style="margin-top:16px;">
                    Conferma ${isBuy ? 'Acquisto' : 'Vendita'}
                </button>
                <button id="tx-cancel" class="btn btn-ghost btn-full" style="margin-top:8px;">Annulla</button>
            </div>
        </div>`;
    overlay.classList.add('visible');
    lockScroll();

    const closeModal = () => { overlay.classList.remove('visible'); unlockScroll(); };
    document.getElementById('tx-close').onclick  = closeModal;
    document.getElementById('tx-cancel').onclick = closeModal;

    const preview = () => _txPreview(id, type, portfolio, prices);
    document.getElementById('tx-qta').oninput    = preview;
    document.getElementById('tx-prezzo').oninput = preview;
    document.getElementById('tx-comm').oninput   = preview;

    document.getElementById('tx-confirm').onclick = async () => {
        const q  = parseFloat(document.getElementById('tx-qta').value);
        const pr = parseFloat(document.getElementById('tx-prezzo').value);
        const c  = parseFloat(document.getElementById('tx-comm').value) || 0;
        const dt = document.getElementById('tx-data').value;
        if (isNaN(q) || q <= 0 || isNaN(pr) || pr <= 0) { Toast.show('Inserisci quantità e prezzo validi', 'err'); return; }
        if (type === 'sell') {
            const { qta } = Calc.positionSync(portfolio[id]);
            if (q > qta + 0.0001) { Toast.show('Quantità superiore al disponibile', 'err'); return; }
        }
        if (!portfolio[id].transactions) portfolio[id].transactions = [];
        portfolio[id].transactions.push({ date: dt, type, qty: q, price: pr, commission: c });
        closeModal();
        await onSave();
        Toast.show(`${isBuy ? 'Acquisto' : 'Vendita'} di ${p.nome} registrata`, 'ok');
    };
}

function _txPreview(id, type, portfolio, prices) {
    const q  = parseFloat(document.getElementById('tx-qta').value);
    const pr = parseFloat(document.getElementById('tx-prezzo').value);
    const c  = parseFloat(document.getElementById('tx-comm').value) || 0;
    const box = document.getElementById('tx-preview');
    if (isNaN(q) || isNaN(pr) || q <= 0) { box.style.display = 'none'; return; }

    const { qta, pmc } = Calc.positionSync(portfolio[id]);
    const p = portfolio[id];
    const s = p.valuta === 'USD' ? '$' : '€';
    box.style.display = 'block';

    if (type === 'buy') {
        const newCost = (qta * pmc) + (q * pr) + c;
        const newQta  = qta + q;
        const newPmc  = newQta > 0 ? newCost / newQta : 0;
        box.innerHTML = `Costo operazione: <b>${s} ${Calc.fmt(q * pr + c)}</b> (comm. <b>${Calc.fmt(c)}</b>)<br>
            Nuovo PMC: <b class="hl">${Calc.fmt(newPmc)}</b> (attuale: ${Calc.fmt(pmc)})<br>
            Nuova Q.tà: <b>${Calc.fmt(newQta, 4)}</b>`;
    } else {
        const pnl = (pr - pmc) * q - c;
        box.innerHTML = `P&L questa vendita: <b class="${pnl >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(pnl)}</b><br>
            Q.tà rimanente: <b>${Calc.fmt(qta - q, 4)}</b> &nbsp;|&nbsp; Incasso netto: <b>${s} ${Calc.fmt(q * pr - c)}</b>`;
    }
}

// ── SIMULATION MODAL ───────────────────────────────────────────────────────
export async function openSimModal(id, portfolio, prices) {
    const p = portfolio[id];
    const { qta, pmc } = Calc.positionSync(p);
    const prLive = prices[id] ?? pmc;
    const overlay = document.getElementById('modal-simulazione');

    overlay.innerHTML = `
        <div class="modal" style="border-top: 3px solid var(--warning)">
            <div class="modal-header">
                <h3>📊 Simulazione — ${p.nome}</h3>
                <button class="btn-x" id="sim-close">✕</button>
            </div>
            <div class="modal-body">

                <div style="display:flex; gap:8px; margin-bottom:14px;">
                    <button id="sim-tab-buy"  class="btn-toggle active" style="flex:1;">🟢 Simula Acquisto</button>
                    <button id="sim-tab-sell" class="btn-toggle"        style="flex:1;">🔴 Simula Vendita</button>
                </div>

                <div id="sim-buy-section">
                    <div style="display:flex; gap:8px; margin-bottom:14px;">
                        <button id="sim-mode-budget" class="btn-toggle active" style="flex:1;">💶 Per Budget</button>
                        <button id="sim-mode-qty"    class="btn-toggle"        style="flex:1;">🔢 Per Quantità</button>
                    </div>
                    <div class="form-grid-2" id="sim-fields">
                        <div>
                            <span class="modal-label">Prezzo Simulato</span>
                            <input type="number" id="sim-prezzo" step="any" value="${prLive}">
                        </div>
                        <div>
                            <span class="modal-label">Commissioni</span>
                            <input type="number" id="sim-comm" step="any" value="${p.commDefault || 7}">
                        </div>
                        <div id="sim-budget-field">
                            <span class="modal-label">Budget Disponibile</span>
                            <input type="number" id="sim-budget" step="any" placeholder="0.00">
                        </div>
                        <div id="sim-qty-field" style="display:none;">
                            <span class="modal-label">Quantità da Acquistare</span>
                            <input type="number" id="sim-qty" step="any" placeholder="0">
                        </div>
                    </div>
                    <div id="sim-result" class="preview-box" style="display:none; margin-top:14px;"></div>
                    <button id="sim-add-cart-buy" class="btn btn-cart btn-full" style="margin-top:12px; display:none;">
                        🛒 Aggiungi al Carrello
                    </button>
                </div>

                <div id="sim-sell-section" style="display:none;">
                    <div class="form-grid-2">
                        <div>
                            <span class="modal-label">Prezzo di Vendita Simulato</span>
                            <input type="number" id="sim-sell-prezzo" step="any" value="${prLive}">
                        </div>
                        <div>
                            <span class="modal-label">
                                Quantità da Vendere
                                <button id="sim-sell-max" style="
                                    margin-left:6px; padding:1px 7px; font-size:10px; font-weight:700;
                                    background:var(--accent); color:#fff; border:none;
                                    border-radius:4px; cursor:pointer; vertical-align:middle;">MAX</button>
                            </span>
                            <input type="number" id="sim-sell-qty" step="any" placeholder="0" max="${qta}">
                        </div>
                        <div>
                            <span class="modal-label">Commissioni</span>
                            <input type="number" id="sim-sell-comm" step="any" value="${p.commDefault || 7}">
                        </div>
                        <div style="display:flex; align-items:flex-end;">
                            <div class="preview-box" style="padding:6px 10px; font-size:12px; width:100%;">
                                PMC attuale: <b>${Calc.fmt(pmc)}</b><br>
                                Q.tà disponibile: <b>${Calc.fmt(qta, 4)}</b>
                            </div>
                        </div>
                    </div>
                    <div id="sim-sell-result" class="preview-box" style="display:none; margin-top:14px;"></div>
                    <button id="sim-add-cart-sell" class="btn btn-cart btn-full" style="margin-top:12px; display:none;">
                        🛒 Aggiungi al Carrello
                    </button>
                </div>

                <button id="sim-close2" class="btn btn-ghost btn-full" style="margin-top:16px;">Chiudi</button>
            </div>
        </div>`;

    overlay.classList.add('visible');
    lockScroll();

    const closeModal = () => { overlay.classList.remove('visible'); unlockScroll(); };
    document.getElementById('sim-close').onclick  = closeModal;
    document.getElementById('sim-close2').onclick = closeModal;
    document.getElementById('sim-sell-max').onclick = () => {
        document.getElementById('sim-sell-qty').value = qta;
        calcSimSell();
    };

    document.getElementById('sim-tab-buy').onclick = () => {
        document.getElementById('sim-tab-buy').classList.add('active');
        document.getElementById('sim-tab-sell').classList.remove('active');
        document.getElementById('sim-buy-section').style.display  = '';
        document.getElementById('sim-sell-section').style.display = 'none';
    };
    document.getElementById('sim-tab-sell').onclick = () => {
        document.getElementById('sim-tab-sell').classList.add('active');
        document.getElementById('sim-tab-buy').classList.remove('active');
        document.getElementById('sim-buy-section').style.display  = 'none';
        document.getElementById('sim-sell-section').style.display = '';
        calcSimSell();
    };

    let buyMode = 'budget';
    document.getElementById('sim-mode-budget').onclick = () => {
        buyMode = 'budget';
        document.getElementById('sim-mode-budget').classList.add('active');
        document.getElementById('sim-mode-qty').classList.remove('active');
        document.getElementById('sim-budget-field').style.display = '';
        document.getElementById('sim-qty-field').style.display = 'none';
        calcSimBuy();
    };
    document.getElementById('sim-mode-qty').onclick = () => {
        buyMode = 'qty';
        document.getElementById('sim-mode-qty').classList.add('active');
        document.getElementById('sim-mode-budget').classList.remove('active');
        document.getElementById('sim-budget-field').style.display = 'none';
        document.getElementById('sim-qty-field').style.display = '';
        calcSimBuy();
    };

    let lastBuyResult = null;
    const calcSimBuy = () => {
        const pr  = parseFloat(document.getElementById('sim-prezzo').value);
        const c   = parseFloat(document.getElementById('sim-comm').value) || 0;
        const box = document.getElementById('sim-result');
        const cartBtn = document.getElementById('sim-add-cart-buy');
        const s   = p.valuta === 'USD' ? '$' : '€';
        lastBuyResult = null;
        cartBtn.style.display = 'none';

        if (isNaN(pr) || pr <= 0) { box.style.display = 'none'; return; }

        if (buyMode === 'budget') {
            const b = parseFloat(document.getElementById('sim-budget').value);
            if (isNaN(b) || b <= 0) { box.style.display = 'none'; return; }
            const net = b - c;
            if (net <= 0) {
                box.style.display = 'block';
                box.innerHTML = `<span class="text-danger">Budget insufficiente a coprire le commissioni (${Calc.fmt(c)})</span>`;
                return;
            }
            const aq     = net / pr;
            const newPmc = (qta + aq) > 0 ? ((qta * pmc) + net) / (qta + aq) : 0;
            const convLine = p.valuta === 'USD'
                ? `<br>Costo in EUR: <b>€ ${Calc.fmt(b / Exchange.rate)}</b>` : '';
            box.style.display = 'block';
            box.innerHTML =
                `Budget: <b>${Calc.fmt(b)}</b> − Commissioni: <b>${Calc.fmt(c)}</b> = Netto: <b class="hl">${Calc.fmt(net)}</b>${convLine}<br>
                 Azioni acquistabili: <b>${Calc.fmt(aq, 4)}</b> a ${Calc.fmt(pr)}<br>
                 Nuovo PMC: <b class="hl">${Calc.fmt(newPmc)}</b> (attuale: ${Calc.fmt(pmc)})<br>
                 Nuova Q.tà totale: <b>${Calc.fmt(qta + aq, 4)}</b>`;
            lastBuyResult = { qty: aq, price: pr, commission: c, newPmc, newQty: qta + aq };
        } else {
            const aq = parseFloat(document.getElementById('sim-qty').value);
            if (isNaN(aq) || aq <= 0) { box.style.display = 'none'; return; }
            const costo  = aq * pr + c;
            const newPmc = (qta + aq) > 0 ? ((qta * pmc) + (aq * pr) + c) / (qta + aq) : 0;
            const convLine = p.valuta === 'USD'
                ? `<br>Costo in EUR: <b>€ ${Calc.fmt(costo / Exchange.rate)}</b>` : '';
            box.style.display = 'block';
            box.innerHTML =
                `Quantità: <b>${Calc.fmt(aq, 4)}</b> × ${Calc.fmt(pr)} + comm. ${Calc.fmt(c)} = Totale: <b class="hl">${s} ${Calc.fmt(costo)}</b>${convLine}<br>
                 Nuovo PMC: <b class="hl">${Calc.fmt(newPmc)}</b> (attuale: ${Calc.fmt(pmc)})<br>
                 Nuova Q.tà totale: <b>${Calc.fmt(qta + aq, 4)}</b>`;
            lastBuyResult = { qty: aq, price: pr, commission: c, newPmc, newQty: qta + aq };
        }
        if (lastBuyResult) cartBtn.style.display = 'block';
    };

    let lastSellResult = null;
    const calcSimSell = () => {
        const pr  = parseFloat(document.getElementById('sim-sell-prezzo').value);
        const sq  = parseFloat(document.getElementById('sim-sell-qty').value);
        const c   = parseFloat(document.getElementById('sim-sell-comm').value) || 0;
        const box = document.getElementById('sim-sell-result');
        const cartBtn = document.getElementById('sim-add-cart-sell');
        const s   = p.valuta === 'USD' ? '$' : '€';
        lastSellResult = null;
        cartBtn.style.display = 'none';

        if (isNaN(pr) || pr <= 0 || isNaN(sq) || sq <= 0) { box.style.display = 'none'; return; }

        if (sq > qta + 0.0001) {
            box.style.display = 'block';
            box.innerHTML = `<span class="text-danger">⚠️ Quantità superiore al disponibile (${Calc.fmt(qta, 4)})</span>`;
            return;
        }

        const grossReceipt = sq * pr - c;
        const pnl          = (pr - pmc) * sq - c;
        const taxPct       = p.tipoAsset === 'bond' ? 0.125 : p.tipoAsset === 'crypto' ? 0.33 : 0.26;
        const taxLabel     = p.tipoAsset === 'bond' ? '12,5%' : p.tipoAsset === 'crypto' ? '33%' : '26%';
        const tax          = pnl > 0 ? pnl * taxPct : 0;
        const netReceipt   = grossReceipt - tax;
        const remQty       = qta - sq;
        const convLine     = p.valuta === 'USD'
            ? `<br>Netto in EUR: <b>≈ € ${Calc.fmt(netReceipt / Exchange.rate)}</b>` : '';

        box.style.display = 'block';
        box.innerHTML = `
            <div style="display:grid; gap:4px;">
                <div>Incasso lordo: <b>${s} ${Calc.fmt(grossReceipt)}</b> &nbsp;(${Calc.fmt(sq, 4)} az. × ${Calc.fmt(pr)} − comm. ${Calc.fmt(c)})</div>
                <div>P&L operazione: <b class="${pnl >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(pnl)}</b></div>
                ${pnl > 0
                    ? `<div>Tasse (${taxLabel}): <b class="neg-loss">− ${s} ${Calc.fmt(tax)}</b></div>`
                    : `<div class="text-muted">Nessuna tassa (operazione in perdita)</div>`}
                <div style="border-top:1px solid var(--border); margin-top:4px; padding-top:4px;">
                    Incasso <b>netto</b>: <b class="${netReceipt >= 0 ? 'pos-gain' : 'neg-loss'} hl">${s} ${Calc.fmt(netReceipt)}</b>${convLine}
                </div>
                <div>Q.tà rimanente: <b>${Calc.fmt(remQty, 4)}</b></div>
            </div>`;

        lastSellResult = { qty: sq, price: pr, commission: c, pmc, remQty, grossReceipt, netReceipt, tax };
        cartBtn.style.display = 'block';
    };

    ['sim-prezzo', 'sim-comm', 'sim-budget', 'sim-qty'].forEach(elId => {
        document.getElementById(elId)?.addEventListener('input', calcSimBuy);
    });

    ['sim-sell-prezzo', 'sim-sell-qty', 'sim-sell-comm'].forEach(elId => {
        document.getElementById(elId)?.addEventListener('input', calcSimSell);
    });

    document.getElementById('sim-add-cart-buy').onclick = () => {
        if (!lastBuyResult) return;
        Cart.add({
            id,
            nome:      p.nome,
            type:      'buy',
            qty:       lastBuyResult.qty,
            price:     lastBuyResult.price,
            commission: lastBuyResult.commission,
            newPmc:    lastBuyResult.newPmc,
            newQty:    lastBuyResult.newQty,
            pmc,
            valuta:    p.valuta || 'EUR',
            tipoAsset: p.tipoAsset
        });
    };

    document.getElementById('sim-add-cart-sell').onclick = () => {
        if (!lastSellResult) return;
        Cart.add({
            id,
            nome:        p.nome,
            type:        'sell',
            qty:         lastSellResult.qty,
            price:       lastSellResult.price,
            commission:  lastSellResult.commission,
            pmc:         lastSellResult.pmc,
            remQty:      lastSellResult.remQty,
            grossReceipt: lastSellResult.grossReceipt,
            netReceipt:  lastSellResult.netReceipt,
            tax:         lastSellResult.tax,
            valuta:      p.valuta || 'EUR',
            tipoAsset:   p.tipoAsset
        });
    };
}
