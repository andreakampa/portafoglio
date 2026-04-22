import { Calc } from '../calc.js';
import { Exchange } from '../../../api/exchange.js';
import { Cart } from './cart.js';
import { lockScroll, unlockScroll } from './helpers.js';

// ── SIMULATION MODAL ───────────────────────────────────────────────────────
export async function openSimModal(id, portfolio, prices) {
    const p = portfolio[id];
    const { qta, pmc, pmcEur } = Calc.positionSync(p);
    const prLive = prices[id] ?? pmc;
    const overlay = document.getElementById('modal-simulazione');
    const isUSD = p.valuta === 'USD';
    const rate = Exchange.rate || 1.08;
    const toEur = v => isUSD ? v / rate : v;
    const toNative = v => isUSD ? v * rate : v;

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
                                    background:var(--warning); color:#fff; border:none;
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

            const budgetNative = toNative(b);
            const commissionNative = toNative(c);
            const netNative = budgetNative - commissionNative;

            if (netNative <= 0) {
                box.style.display = 'block';
                box.innerHTML = `<span class="neg-loss">Budget insufficiente a coprire le commissioni (€ ${Calc.fmt(c)})</span>`;
                return;
            }

            const aq = netNative / pr;
            const newPmc = (qta + aq) > 0
                ? ((qta * pmc) + (aq * pr) + commissionNative) / (qta + aq)
                : 0;

            const convLine = isUSD
                ? `<br>Budget convertito: <b>$ ${Calc.fmt(budgetNative)}</b> &nbsp;|&nbsp; Comm. ≈ <b>$ ${Calc.fmt(commissionNative)}</b>`
                : '';

            box.style.display = 'block';
            box.innerHTML = `
                Budget: <b>€ ${Calc.fmt(b)}</b> − Commissioni: <b>€ ${Calc.fmt(c)}</b>${convLine}<br>
                Azioni acquistabili: <b>${Calc.fmt(aq, 4)}</b> a ${s} ${Calc.fmt(pr)}<br>
                Nuovo PMC: <b class="hl">${s} ${Calc.fmt(newPmc)}</b> (attuale: ${s} ${Calc.fmt(pmc)})<br>
                Nuova Q.tà totale: <b>${Calc.fmt(qta + aq, 4)}</b>
            `;
            lastBuyResult = { qty: aq, price: pr, commission: c, newPmc, newQty: qta + aq };
        } else {
            const aq = parseFloat(document.getElementById('sim-qty').value);
            if (isNaN(aq) || aq <= 0) { box.style.display = 'none'; return; }
            const commissionNative = toNative(c);
            const costoNative  = aq * pr + commissionNative;
            const newPmc = (qta + aq) > 0 ? ((qta * pmc) + (aq * pr) + commissionNative) / (qta + aq) : 0;
            const convLine = isUSD
                ? `<br>Costo in EUR: <b>€ ${Calc.fmt(toEur(costoNative))}</b>` : '';
            box.style.display = 'block';
            box.innerHTML =
                `Quantità: <b>${Calc.fmt(aq, 4)}</b> × ${s} ${Calc.fmt(pr)} + comm. € ${Calc.fmt(c)} = Totale: <b class="hl">${s} ${Calc.fmt(costoNative)}</b>${convLine}<br>
                 Nuovo PMC: <b class="hl">${s} ${Calc.fmt(newPmc)}</b> (attuale: ${s} ${Calc.fmt(pmc)})<br>
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
            box.innerHTML = `<span class="neg-loss">Quantità superiore al disponibile (${Calc.fmt(qta, 4)})</span>`;
            return;
        }

        const taxPct   = p.tipoAsset === 'bond' ? 0.125 : p.tipoAsset === 'crypto' ? 0.33 : 0.26;
        const taxLabel = p.tipoAsset === 'bond' ? '12,5%' : p.tipoAsset === 'crypto' ? '33%' : '26%';

        let grossReceipt, pnl, tax, netReceipt, grossReceiptEur, netReceiptEur;

        if (isUSD) {
            // Commissione in EUR, ricavo in USD — tutto convertito in EUR per P&L
            grossReceipt    = sq * pr;
            grossReceiptEur = grossReceipt / rate;
            const costoEur  = (pmcEur > 0 ? pmcEur : pmc / rate) * sq;
            pnl             = grossReceiptEur - costoEur - c;
            tax             = pnl > 0 ? pnl * taxPct : 0;
            netReceiptEur   = grossReceiptEur - c - tax;
            netReceipt      = netReceiptEur;
        } else {
            grossReceipt    = sq * pr - c;
            pnl             = (pr - pmc) * sq - c;
            tax             = pnl > 0 ? pnl * taxPct : 0;
            netReceipt      = grossReceipt - tax;
            grossReceiptEur = grossReceipt;
            netReceiptEur   = netReceipt;
        }

        const remQty = qta - sq;

        box.style.display = 'block';
        box.innerHTML = `
            <div style="display:grid; gap:4px;">
                <div>Incasso lordo: <b>${isUSD ? `$ ${Calc.fmt(grossReceipt)} ≈ € ${Calc.fmt(grossReceiptEur)}` : `€ ${Calc.fmt(grossReceipt)}`}</b></div>
                <div>P&L operazione: <b class="${pnl >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(pnl)}</b></div>
                ${pnl > 0
                    ? `<div>Tasse (${taxLabel}): <b class="neg-loss">− € ${Calc.fmt(tax)}</b></div>`
                    : `<div style="color:var(--text-muted)">Nessuna tassa (operazione in perdita)</div>`}
                <div style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px;">
                    Incasso netto: <b class="${netReceiptEur >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(netReceiptEur)}</b>
                </div>
                <div>Q.tà rimanente: <b>${Calc.fmt(remQty, 4)}</b></div>
            </div>`;

        lastSellResult = { qty: sq, price: pr, commission: c, pmc, remQty,
                           grossReceipt: grossReceiptEur, netReceipt: netReceiptEur, tax };
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
            nome:       p.nome,
            type:       'buy',
            qty:        lastBuyResult.qty,
            price:      lastBuyResult.price,
            commission: lastBuyResult.commission,
            newPmc:     lastBuyResult.newPmc,
            newQty:     lastBuyResult.newQty,
            pmc,
            valuta:     p.valuta || 'EUR',
            tipoAsset:  p.tipoAsset
        });
    };

    document.getElementById('sim-add-cart-sell').onclick = () => {
        if (!lastSellResult) return;
        Cart.add({
            id,
            nome:         p.nome,
            type:         'sell',
            qty:          lastSellResult.qty,
            price:        lastSellResult.price,
            commission:   lastSellResult.commission,
            pmc:          lastSellResult.pmc,
            remQty:       lastSellResult.remQty,
            grossReceipt: lastSellResult.grossReceipt,
            netReceipt:   lastSellResult.netReceipt,
            tax:          lastSellResult.tax,
            valuta:       p.valuta || 'EUR',
            tipoAsset:    p.tipoAsset
        });
    };
}