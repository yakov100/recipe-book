// Timer setup dialog — shown when user clicks the timer button on a recipe card.
import { startRecipeTimer } from './recipe-timers.js';

export function openRecipeTimerDialog(recipeName) {
    document.getElementById('rct-dialog')?.remove();

    const dialog = document.createElement('div');
    dialog.id = 'rct-dialog';
    dialog.className = 'rct-dialog-overlay';
    dialog.innerHTML = `
        <div class="rct-dialog-box" role="dialog" aria-modal="true" aria-label="הגדר טיימר">
            <div class="rct-dialog-header">
                <span class="material-symbols-outlined" style="font-size:1.1rem">timer</span>
                <span>טיימר: <strong>${recipeName}</strong></span>
                <button class="rct-dialog-close" onclick="document.getElementById('rct-dialog').remove()" title="סגור">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div class="rct-dialog-body">
                <p class="rct-dialog-label">הגדר זמן</p>
                <div class="rct-dialog-inputs">
                    <div class="rct-inp-wrap">
                        <input id="rct-h" class="rct-inp" type="number" min="0" max="23" value="0">
                        <label class="rct-inp-lbl">שע׳</label>
                    </div>
                    <span class="rct-sep">:</span>
                    <div class="rct-inp-wrap">
                        <input id="rct-m" class="rct-inp" type="number" min="0" max="59" value="0">
                        <label class="rct-inp-lbl">דק׳</label>
                    </div>
                    <span class="rct-sep">:</span>
                    <div class="rct-inp-wrap">
                        <input id="rct-s" class="rct-inp" type="number" min="0" max="59" value="0">
                        <label class="rct-inp-lbl">שנ׳</label>
                    </div>
                </div>
                <div class="rct-presets">
                    <button class="rct-preset" data-s="300">5 דק׳</button>
                    <button class="rct-preset" data-s="600">10 דק׳</button>
                    <button class="rct-preset" data-s="900">15 דק׳</button>
                    <button class="rct-preset" data-s="1800">30 דק׳</button>
                    <button class="rct-preset" data-s="3600">שעה</button>
                </div>
                <button class="rct-start-btn" id="rct-start-btn">
                    <span class="material-symbols-outlined">play_arrow</span>
                    התחל טיימר
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);
    setTimeout(() => document.getElementById('rct-m')?.focus(), 50);

    dialog.querySelectorAll('.rct-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const total = parseInt(btn.dataset.s);
            document.getElementById('rct-h').value = Math.floor(total / 3600);
            document.getElementById('rct-m').value = Math.floor((total % 3600) / 60);
            document.getElementById('rct-s').value = total % 60;
        });
    });

    dialog.querySelector('#rct-start-btn').addEventListener('click', () => {
        const h = parseInt(document.getElementById('rct-h').value) || 0;
        const m = parseInt(document.getElementById('rct-m').value) || 0;
        const s = parseInt(document.getElementById('rct-s').value) || 0;
        const total = h * 3600 + m * 60 + s;
        if (total <= 0) { document.getElementById('rct-m').focus(); return; }
        startRecipeTimer(recipeName, total);
        dialog.remove();
    });

    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.remove(); });

    const onKey = e => {
        if (e.key === 'Escape') { dialog.remove(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
}
