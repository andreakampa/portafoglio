export const Toast = {
    _timer: null,
    show(msg, type = '') {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = msg;
        el.className = 'show' + (type ? ' ' + type : '');
        clearTimeout(this._timer);
        this._timer = setTimeout(() => el.className = '', 3400);
    }
};
