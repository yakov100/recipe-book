// Manages multiple parallel recipe timers. Each timer is keyed by a unique id,
// carries the recipe name for labelling, and runs independently.

import { formatTime } from './utils.js';

// Map of timerId → timer state object
const timers = new Map();
let nextId = 1;

// ─── Audio ───────────────────────────────────────────────────────────────────

function getVolume() {
    const el = document.getElementById('timer-volume');
    if (!el) return 0.8;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v / 100)) : 0.8;
}

function playMelody(onEnd) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const masterGain = audioContext.createGain();
    masterGain.gain.value = getVolume() * 1.8;
    masterGain.connect(audioContext.destination);

    const notes = [
        { freq: 523.25, dur: 0.25 },
        { freq: 659.25, dur: 0.25 },
        { freq: 783.99, dur: 0.25 },
        { freq: 659.25, dur: 0.25 },
        { freq: 587.33, dur: 0.3  },
        { freq: 523.25, dur: 0.4  },
        { freq: 659.25, dur: 0.25 },
        { freq: 523.25, dur: 0.35 },
    ];

    let t = audioContext.currentTime;
    notes.forEach(note => {
        const osc  = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.value = note.freq;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.7, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + note.dur);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(t);
        osc.stop(t + note.dur);
        t += note.dur + 0.05;
    });

    const ms = (t - audioContext.currentTime + 0.1) * 1000;
    setTimeout(() => { audioContext.close(); if (onEnd) onEnd(); }, ms);
}

function startBeeping(timerId) {
    const state = timers.get(timerId);
    if (!state) return;
    let count = 0;
    const max = 8;
    function ring() {
        const s = timers.get(timerId);
        if (!s || count >= max) {
            stopTimer(timerId);
            return;
        }
        count++;
        playMelody(ring);
    }
    ring();
}

// ─── Timer lifecycle ──────────────────────────────────────────────────────────

export function startRecipeTimer(recipeName, totalSeconds) {
    const id = nextId++;
    const state = {
        id,
        recipeName,
        endTime: Date.now() + totalSeconds * 1000,
        paused: false,
        pausedRemaining: 0,
        interval: null,
        beeping: false,
    };
    timers.set(id, state);
    state.interval = setInterval(() => tick(id), 500);
    renderPanel();
    return id;
}

function tick(id) {
    const state = timers.get(id);
    if (!state || state.paused || state.beeping) return;
    const remaining = Math.max(0, state.endTime - Date.now());
    if (remaining === 0) {
        clearInterval(state.interval);
        state.interval = null;
        state.beeping = true;
        renderPanel();
        startBeeping(id);
        return;
    }
    renderTimerRow(id);
}

export function pauseTimer(id) {
    const state = timers.get(id);
    if (!state || state.paused || state.beeping) return;
    clearInterval(state.interval);
    state.interval = null;
    state.paused = true;
    state.pausedRemaining = Math.max(0, state.endTime - Date.now());
    renderPanel();
}

export function resumeTimer(id) {
    const state = timers.get(id);
    if (!state || !state.paused) return;
    state.endTime = Date.now() + state.pausedRemaining;
    state.pausedRemaining = 0;
    state.paused = false;
    state.interval = setInterval(() => tick(id), 500);
    renderPanel();
}

export function stopTimer(id) {
    const state = timers.get(id);
    if (!state) return;
    clearInterval(state.interval);
    timers.delete(id);
    renderPanel();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function formatRemaining(state) {
    if (state.beeping) return '00:00:00';
    const ms = state.paused ? state.pausedRemaining : Math.max(0, state.endTime - Date.now());
    return formatTime(Math.ceil(ms / 1000));
}

function renderTimerRow(id) {
    const row = document.getElementById(`rct-row-${id}`);
    const state = timers.get(id);
    if (!row || !state) return;
    const timeEl = row.querySelector('.rct-time');
    if (timeEl) timeEl.textContent = formatRemaining(state);
}

function renderPanel() {
    const panel = document.getElementById('recipe-timers-panel');
    if (!panel) return;

    if (timers.size === 0) {
        panel.classList.remove('rct-visible');
        panel.innerHTML = '';
        return;
    }

    panel.classList.add('rct-visible');

    panel.innerHTML = `
        <div class="rct-header">
            <span class="material-symbols-outlined" style="font-size:1rem">timer</span>
            <span>טיימרי בישול</span>
            <span class="rct-count">${timers.size}</span>
        </div>
        <div class="rct-list" id="rct-list"></div>
    `;

    const list = panel.querySelector('#rct-list');
    timers.forEach((state) => {
        const row = document.createElement('div');
        row.className = 'rct-row' + (state.beeping ? ' rct-beeping' : '') + (state.paused ? ' rct-paused' : '');
        row.id = `rct-row-${state.id}`;
        row.innerHTML = `
            <div class="rct-info">
                <span class="rct-name">${state.recipeName}</span>
                <span class="rct-time">${formatRemaining(state)}</span>
            </div>
            <div class="rct-actions">
                ${state.beeping ? '' : state.paused
                    ? `<button class="rct-btn rct-btn-resume" onclick="window._recipeTimers.resume(${state.id})" title="המשך">
                           <span class="material-symbols-outlined">play_arrow</span>
                       </button>`
                    : `<button class="rct-btn rct-btn-pause" onclick="window._recipeTimers.pause(${state.id})" title="השהה">
                           <span class="material-symbols-outlined">pause</span>
                       </button>`
                }
                <button class="rct-btn rct-btn-stop" onclick="window._recipeTimers.stop(${state.id})" title="עצור">
                    <span class="material-symbols-outlined">stop</span>
                </button>
            </div>
        `;
        list.appendChild(row);
    });
}

// ─── Timer dialog ─────────────────────────────────────────────────────────────

export function openRecipeTimerDialog(recipeName) {
    const existing = document.getElementById('rct-dialog');
    if (existing) existing.remove();

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
                        <input id="rct-h" class="rct-inp" type="number" min="0" max="23" value="0" placeholder="0">
                        <label class="rct-inp-lbl">שע׳</label>
                    </div>
                    <span class="rct-sep">:</span>
                    <div class="rct-inp-wrap">
                        <input id="rct-m" class="rct-inp" type="number" min="0" max="59" value="0" placeholder="0">
                        <label class="rct-inp-lbl">דק׳</label>
                    </div>
                    <span class="rct-sep">:</span>
                    <div class="rct-inp-wrap">
                        <input id="rct-s" class="rct-inp" type="number" min="0" max="59" value="0" placeholder="0">
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

    // Focus first input
    setTimeout(() => document.getElementById('rct-m')?.focus(), 50);

    // Preset buttons
    dialog.querySelectorAll('.rct-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const total = parseInt(btn.dataset.s);
            document.getElementById('rct-h').value = Math.floor(total / 3600);
            document.getElementById('rct-m').value = Math.floor((total % 3600) / 60);
            document.getElementById('rct-s').value = total % 60;
        });
    });

    // Start button
    dialog.querySelector('#rct-start-btn').addEventListener('click', () => {
        const h = parseInt(document.getElementById('rct-h').value) || 0;
        const m = parseInt(document.getElementById('rct-m').value) || 0;
        const s = parseInt(document.getElementById('rct-s').value) || 0;
        const total = h * 3600 + m * 60 + s;
        if (total <= 0) {
            document.getElementById('rct-m').focus();
            return;
        }
        startRecipeTimer(recipeName, total);
        dialog.remove();
    });

    // Close on backdrop click
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.remove(); });

    // Close on Escape
    const onKey = e => { if (e.key === 'Escape') { dialog.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initRecipeTimers() {
    // Create the floating panel
    if (!document.getElementById('recipe-timers-panel')) {
        const panel = document.createElement('div');
        panel.id = 'recipe-timers-panel';
        panel.className = 'recipe-timers-panel';
        document.body.appendChild(panel);
    }

    // Expose controls globally for inline onclick handlers
    window._recipeTimers = {
        pause: pauseTimer,
        resume: resumeTimer,
        stop: stopTimer,
    };

    // Expose dialog opener globally for recipe-view.js onclick
    window.openRecipeTimerDialog = openRecipeTimerDialog;
}
