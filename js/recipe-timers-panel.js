// Floating panel that shows all active recipe timers.
import { formatTime } from './utils.js';

export function formatRemaining(state) {
    if (state.beeping) return '00:00:00';
    const ms = state.paused ? state.pausedRemaining : Math.max(0, state.endTime - Date.now());
    return formatTime(Math.ceil(ms / 1000));
}

export function updateTimerRow(id, state) {
    const row = document.getElementById(`rct-row-${id}`);
    if (!row || !state) return;
    const timeEl = row.querySelector('.rct-time');
    if (timeEl) timeEl.textContent = formatRemaining(state);
}

export function renderPanel(timers) {
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

export function ensurePanel() {
    if (!document.getElementById('recipe-timers-panel')) {
        const panel = document.createElement('div');
        panel.id = 'recipe-timers-panel';
        panel.className = 'recipe-timers-panel';
        document.body.appendChild(panel);
    }
}
