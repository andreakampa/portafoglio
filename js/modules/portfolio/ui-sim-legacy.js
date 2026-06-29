import { Calc } from './calc.js';
import { Exchange } from '../../api/exchange.js';
import { Cart } from './ui/cart.js';
import { lockScroll, unlockScroll } from './ui/helpers.js';
import { calcolaCompensazione } from '../../api/fiscale.js';

import {
    simulateBuyByBudget,
    simulateBuyByQty,
    simulateSell,
    simulateSellLIFO
} from './ui/sim-core.js';

// ── SIMULATION MODAL ───────────────────────────────────────────────────────
export async function openSimModal(id, portfolio, prices, taxRegime = 'amministrato', activePortfolio = null) {
    const p = portfolio[id];
    const { qta, pmc, pmcEur } = Calc.positionSync(p, taxRegime);

    let minusDisponibili = 0;
    if (taxRegime === 'amministrato') {
        const categoria = p.tipoAsset === 'crypto' ? 'crypto' : 'strumenti';
        const fiscalAssets = { ...portfolio, fiscal: activePortfolio?.fiscal || {} };
        const { residuoFinale } = calcolaCompensazione(fiscalAssets, taxRegime);
        minusDisponibili = (residuoFinale[categoria] || []).reduce((s, b) => s + b.residuo, 0);
    }

    let minusDisponibili = 0;
    if (taxRegime === 'amministrato') {
        const categoria = p.tipoAsset === 'crypto' ? 'crypto' : 'strumenti';
        const { residuoFinale } = calcolaCompensazione(portfolio, taxRegime);
        minusDisponibili = (residuoFinale[categoria] || []).reduce((s, b) => s + b.residuo, 0);
    }
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
                            <input type="number" id="sim-comm" step="any" placeholder="0.00">
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
                            <input type="number" id="sim-sell-comm" step="any" placeholder="0.00">
                        </div>
                        <div style="display:flex; align-items:flex-end;">
                            <div class="preview-box" style="padding:6px 10px; font-size:12px; width:100%;">
                                PMC attuale: <b>${Calc.fmt(pmc)}</b><br>
                                Q.tà disponibile: <b>${Calc.fmt(qta, 4)}</b>
                            </div>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; margin-top:14px;">
                        <button type="button" id="sim-sell-mode-normale" class="btn btn-ghost" style="flex:1; font-weight:700;">Vendita normale</button>
                        <button type="button" id="sim-sell-mode-lotti" class="btn btn-ghost" style="flex:1; font-weight:700;">📦 Vendita a lotti</button>
                    </div>
                    <div id="sim-sell-lotti-panel" style="display:none; margin-top:10px;"></div>
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

    let sellMode = 'normale';
    const btnSellNormale = document.getElementById('sim-sell-mode-normale');
    const btnSellLotti   = document.getElementById('sim-sell-mode-lotti');
    const sellLottiPanel = document.getElementById('sim-sell-lotti-panel');
    const sellQtyInput   = document.getElementById('sim-sell-qty');
    const sellMaxBtn     = document.getElementById('sim-sell-max');

    const setActiveSellBtn = (active) => {
        [btnSellNormale, btnSellLotti].forEach(b => { b.style.background = ''; b.style.color = ''; });
        active.style.background = 'var(--purple)';
        active.style.color = '#fff';
    };
    setActiveSellBtn(btnSellNormale);

    btnSellNormale.onclick = () => {
        sellMode = 'normale';
        setActiveSellBtn(btnSellNormale);
        sellLottiPanel.style.display = 'none';
        sellQtyInput.readOnly = false;
        sellQtyInput.value = '';
        if (sellMaxBtn) sellMaxBtn.style.display = '';
        calcSimSell();
    };

    btnSellLotti.onclick = () => {
        sellMode = 'lotti';
        setActiveSellBtn(btnSellLotti);
        sellLottiPanel.style.display = 'block';
        sellQtyInput.readOnly = true;
        if (sellMaxBtn) sellMaxBtn.style.display = 'none';
        renderSimLottiPanel();
    };

    function renderSimLottiPanel() {
        const panel = document.getElementById('sim-sell-lotti-panel');
        if (!panel) return;
        const lots = Calc.getLots(p, taxRegime);
        if (!lots.length) {
            panel.innerHTML = `<div class="text-muted fs-xs">Nessun lotto disponibile.</div>`;
            return;
        }
        const sym = isUSD ? '$' : '€';

        panel.innerHTML = lots.map(l => {
            let pmcLabel = `${sym} ${Calc.fmt(l.price)}`;
            if (isUSD) {
                const lotRate = l.exchangeRate || Exchange._memoryCache.get(l.date)?.rate || Exchange.rate || 1;
                pmcLabel += ` <span class="text-muted fs-xs">(≈ € ${Calc.fmt(l.price / lotRate)})</span>`;
            }
            return `
                <div class="lotto-row" style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border);">
                    <div style="flex:1;">
                        <div style="font-weight:600;">${l.date}</div>
                        <div class="text-muted fs-xs">Disponibili: ${Calc.fmt(l.qtyResidua, 4)} · PMC lotto: ${pmcLabel}</div>
                    </div>
                    <input type="number" class="sim-lotto-qty-input" data-lot-id="${l.id}" step="any" min="0" max="${l.qtyResidua}" placeholder="0" style="width:90px;">
                </div>`;
        }).join('');

        panel.querySelectorAll('.sim-lotto-qty-input').forEach(inp => {
            inp.oninput = () => calcSimSellLotti(lots);
        });

        calcSimSellLotti(lots);
    }

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
        if (sellMode === 'lotti') {
            renderSimLottiPanel();
        } else {
            calcSimSell();
        }
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
    const pr = parseFloat(document.getElementById('sim-prezzo').value);
    const c = parseFloat(document.getElementById('sim-comm').value) || 0;
    const box = document.getElementById('sim-result');
    const cartBtn = document.getElementById('sim-add-cart-buy');
    const s = p.valuta === 'USD' ? '$' : '€';

    lastBuyResult = null;
    cartBtn.style.display = 'none';

    if (isNaN(pr) || pr <= 0) {
        box.style.display = 'none';
        return;
    }

    if (buyMode === 'budget') {
        const b = parseFloat(document.getElementById('sim-budget').value);
        const result = simulateBuyByBudget({
            budget: b,
            price: pr,
            commission: c,
            qta,
            pmc,
            isUSD,
            rate
        });

        if (!result) {
            box.style.display = 'none';
            return;
        }

        if (result.error === 'budget_too_low') {
            box.style.display = 'block';
            box.innerHTML = `<span class="neg-loss">Budget insufficiente a coprire le commissioni (€ ${Calc.fmt(c)})</span>`;
            return;
        }

        const convLine = isUSD
            ? `<br>Budget convertito: <b>$ ${Calc.fmt(result.budgetNative)}</b> &nbsp;|&nbsp; Comm. ≈ <b>$ ${Calc.fmt(result.commissionNative)}</b>`
            : '';

        box.style.display = 'block';
        box.innerHTML = `
            Budget: <b>€ ${Calc.fmt(b)}</b> − Commissioni: <b>€ ${Calc.fmt(c)}</b>${convLine}<br>
            Azioni acquistabili: <b>${Calc.fmt(result.qty, 4)}</b> a ${s} ${Calc.fmt(pr)}<br>
            Nuovo PMC: <b class="hl">${s} ${Calc.fmt(result.newPmc)}</b> (attuale: ${s} ${Calc.fmt(pmc)})<br>
            Nuova Q.tà totale: <b>${Calc.fmt(result.newQty, 4)}</b>
        `;

        lastBuyResult = {
            qty: result.qty,
            price: result.price,
            commission: result.commission,
            newPmc: result.newPmc,
            newQty: result.newQty
        };
    } else {
        const aq = parseFloat(document.getElementById('sim-qty').value);
        const result = simulateBuyByQty({
            qty: aq,
            price: pr,
            commission: c,
            qta,
            pmc,
            isUSD,
            rate
        });

        if (!result) {
            box.style.display = 'none';
            return;
        }

        const convLine = isUSD
            ? `<br>Costo in EUR: <b>€ ${Calc.fmt(result.totalEur)}</b>`
            : '';

        box.style.display = 'block';
        box.innerHTML = `
            Quantità: <b>${Calc.fmt(result.qty, 4)}</b> × ${s} ${Calc.fmt(pr)} + comm. € ${Calc.fmt(c)} = Totale: <b class="hl">${s} ${Calc.fmt(result.totalNative)}</b>${convLine}<br>
            Nuovo PMC: <b class="hl">${s} ${Calc.fmt(result.newPmc)}</b> (attuale: ${s} ${Calc.fmt(pmc)})<br>
            Nuova Q.tà totale: <b>${Calc.fmt(result.newQty, 4)}</b>
        `;

        lastBuyResult = {
            qty: result.qty,
            price: result.price,
            commission: result.commission,
            newPmc: result.newPmc,
            newQty: result.newQty
        };
    }

    if (lastBuyResult) cartBtn.style.display = 'block';
};

    let lastSellResult = null;

    const calcSimSellLotti = (lots) => {
        const pr = parseFloat(document.getElementById('sim-sell-prezzo').value);
        const c = parseFloat(document.getElementById('sim-sell-comm').value) || 0;
        const box = document.getElementById('sim-sell-result');
        const cartBtn = document.getElementById('sim-add-cart-sell');
        const panel = document.getElementById('sim-sell-lotti-panel');

        lastSellResult = null;
        cartBtn.style.display = 'none';

        let qtyTotale = 0;
        panel.querySelectorAll('.sim-lotto-qty-input').forEach(inp => {
            qtyTotale += parseFloat(inp.value) || 0;
        });
        document.getElementById('sim-sell-qty').value = qtyTotale || '';

        if (qtyTotale <= 0 || isNaN(pr) || pr <= 0) {
            box.style.display = 'none';
            return;
        }

        const result = simulateSellLIFO({
            qty: qtyTotale,
            price: pr,
            commission: c,
            lots,
            tipoAsset: p.tipoAsset,
            isUSD,
            rate,
            minusDisponibili
        });

        if (!result) {
            box.style.display = 'none';
            return;
        }

        if (result.error === 'qty_exceeds') {
            box.style.display = 'block';
            box.innerHTML = `<span class="neg-loss">Quantità superiore al disponibile (${Calc.fmt(result.availableQty, 4)})</span>`;
            return;
        }

        const dettaglioHtml = result.dettaglioLotti.map(d =>
            `<div class="text-muted fs-xs">${d.date}: ${Calc.fmt(d.qty, 4)} pz a ${Calc.fmt(d.price)}</div>`
        ).join('');

        box.style.display = 'block';
        box.innerHTML = `
            <div style="margin-bottom:6px;">Lotti consumati (LIFO):</div>
            ${dettaglioHtml}
            <div style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">
                <div>Incasso lordo: <b>${isUSD ? `$ ${Calc.fmt(result.grossReceipt)} ≈ € ${Calc.fmt(result.grossReceiptEur)}` : `€ ${Calc.fmt(result.grossReceipt)}`}</b></div>
                <div>P&L operazione: <b class="${result.pnl >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(result.pnl)}</b></div>
                ${result.pnl > 0
                    ? `<div>Tasse (${result.taxLabel}): <b class="neg-loss">− € ${Calc.fmt(result.tax)}</b></div>`
                    : `<div style="color:var(--text-muted)">Nessuna tassa (operazione in perdita)</div>`}
                <div style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px;">
                    Incasso netto: <b class="${result.netReceiptEur >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(result.netReceiptEur)}</b>
                </div>
                <div>Q.tà rimanente: <b>${Calc.fmt(result.remQty, 4)}</b></div>
            </div>`;

        lastSellResult = {
            qty: result.qty,
            price: result.price,
            commission: result.commission,
            pmc: null, // non applicabile in modalità lotti (PMC varia per lotto)
            remQty: result.remQty,
            grossReceipt: result.grossReceiptEur,
            netReceipt: result.netReceiptEur,
            tax: result.tax,
            pnlLordoEur: result.pnl,
            saleMode: 'lotti',
            lotAllocation: result.dettaglioLotti.map(d => ({ lotId: d.lotId, qty: d.qty }))
        };

        cartBtn.style.display = 'block';
    };

const calcSimSell = () => {
    const pr = parseFloat(document.getElementById('sim-sell-prezzo').value);
    const sq = parseFloat(document.getElementById('sim-sell-qty').value);
    const c = parseFloat(document.getElementById('sim-sell-comm').value) || 0;
    const box = document.getElementById('sim-sell-result');
    const cartBtn = document.getElementById('sim-add-cart-sell');

    lastSellResult = null;
    cartBtn.style.display = 'none';

    const result = simulateSell({
        qty: sq,
        price: pr,
        commission: c,
        qta,
        pmc,
        pmcEur,
        tipoAsset: p.tipoAsset,
        isUSD,
        rate,
        minusDisponibili
    });

    if (!result) {
        box.style.display = 'none';
        return;
    }

    if (result.error === 'qty_exceeds') {
        box.style.display = 'block';
        box.innerHTML = `<span class="neg-loss">Quantità superiore al disponibile (${Calc.fmt(result.availableQty, 4)})</span>`;
        return;
    }

    box.style.display = 'block';
    box.innerHTML = `
        <div style="display:grid; gap:4px;">
            <div>Incasso lordo: <b>${isUSD ? `$ ${Calc.fmt(result.grossReceipt)} ≈ € ${Calc.fmt(result.grossReceiptEur)}` : `€ ${Calc.fmt(result.grossReceipt)}`}</b></div>
            <div>P&L operazione: <b class="${result.pnl >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(result.pnl)}</b></div>
            ${result.pnl > 0 && result.minusUsate > 0
                ? `<div class="text-muted fs-xs">Minus compensate: − € ${Calc.fmt(result.minusUsate)} (di € ${Calc.fmt(result.minusDisponibili)} disponibili) → imponibile € ${Calc.fmt(result.imponibile)}</div>`
                : ''}
            ${result.pnl > 0
                ? `<div>Tasse (${result.taxLabel}): <b class="neg-loss">− € ${Calc.fmt(result.tax)}</b></div>`
                : `<div style="color:var(--text-muted)">Nessuna tassa (operazione in perdita)</div>`}
            <div style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px;">
                Incasso netto: <b class="${result.netReceiptEur >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(result.netReceiptEur)}</b>
            </div>
            <div>Q.tà rimanente: <b>${Calc.fmt(result.remQty, 4)}</b></div>
        </div>`;

    lastSellResult = {
        qty: result.qty,
        price: result.price,
        commission: result.commission,
        pmc: result.pmc,
        remQty: result.remQty,
        grossReceipt: result.grossReceiptEur,
        netReceipt: result.netReceiptEur,
        tax: result.tax,
        pnlLordoEur: result.pnl,
        saleMode: 'normale'
    };

    cartBtn.style.display = 'block';
};

    ['sim-prezzo', 'sim-comm', 'sim-budget', 'sim-qty'].forEach(elId => {
        document.getElementById(elId)?.addEventListener('input', calcSimBuy);
    });

    ['sim-sell-prezzo', 'sim-sell-comm'].forEach(elId => {
        document.getElementById(elId)?.addEventListener('input', () => {
            if (sellMode === 'lotti') {
                const lots = Calc.getLots(p, taxRegime);
                calcSimSellLotti(lots);
            } else {
                calcSimSell();
            }
        });
    });
    document.getElementById('sim-sell-qty')?.addEventListener('input', () => {
        if (sellMode === 'normale') calcSimSell();
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
            pnlLordoEur:  lastSellResult.pnlLordoEur,
            saleMode:     lastSellResult.saleMode,
            ...(lastSellResult.lotAllocation ? { lotAllocation: lastSellResult.lotAllocation } : {}),
            valuta:       p.valuta || 'EUR',
            tipoAsset:    p.tipoAsset
        });
    };
}