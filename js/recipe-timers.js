// Per-recipe parallel timers: state management and lifecycle.
import { playMelody } from './recipe-timers-audio.js';
import { renderPanel, updateTimerRow, ensurePanel } from './recipe-timers-panel.js';
import { openRecipeTimerDialog } from './recipe-timers-dialog.js';

const timers = new Map();
let nextId = 1;

// ─── Beeping ──────────────────────────────────────────────────────────────────

function startBeeping(id) {
    let count = 0;
    function ring() {
        if (!timers.has(id) || count >= 8) { stopTimer(id); return; }
        count++;
        playMelody(ring);
    }
    ring();
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export function startRecipeTimer(recipeName, totalSeconds) {
    const id = nextId++;
    const state = {
        id, recipeName,
        endTime: Date.now() + totalSeconds * 1000,
        paused: false, pausedRemaining: 0,
        interval: null, beeping: false,
    };
    timers.set(id, state);
    state.interval = setInterval(() => tick(id), 500);
    renderPanel(timers);
    return id;
}

function tick(id) {
    const state = timers.get(id);
    if (!state || state.paused || state.beeping) return;
    if (Math.max(0, state.endTime - Date.now()) === 0) {
        clearInterval(state.interval);
        state.interval = null;
        state.beeping = true;
        renderPanel(timers);
        startBeeping(id);
        return;
    }
    updateTimerRow(id, state);
}

export function pauseTimer(id) {
    const state = timers.get(id);
    if (!state || state.paused || state.beeping) return;
    clearInterval(state.interval);
    state.interval = null;
    state.paused = true;
    state.pausedRemaining = Math.max(0, state.endTime - Date.now());
    renderPanel(timers);
}

export function resumeTimer(id) {
    const state = timers.get(id);
    if (!state || !state.paused) return;
    state.endTime = Date.now() + state.pausedRemaining;
    state.pausedRemaining = 0;
    state.paused = false;
    state.interval = setInterval(() => tick(id), 500);
    renderPanel(timers);
}

export function stopTimer(id) {
    const state = timers.get(id);
    if (!state) return;
    clearInterval(state.interval);
    timers.delete(id);
    renderPanel(timers);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initRecipeTimers() {
    ensurePanel();
    window._recipeTimers = { pause: pauseTimer, resume: resumeTimer, stop: stopTimer };
    window.openRecipeTimerDialog = openRecipeTimerDialog;
}

export { openRecipeTimerDialog };
