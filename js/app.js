import { Auth } from './core/auth.js';
import { Router } from './core/router.js';

const auth = new Auth();
const router = new Router();

window.addEventListener('DOMContentLoaded', async () => {
    const loggedIn = await auth.init();
    if (!loggedIn) return;

    document.getElementById('app').style.display = 'block';

    router.init();

    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            const page = link.dataset.page;
            router.navigate(page);
        });
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
        if (confirm('Vuoi uscire dal portafoglio?')) {
            auth.logout();
        }
    });
});
