// Cooking timer widget. Self-contained: owns its own state, talks to the DOM,
// and persists volume/visibility through an injected saveSetting (provided by
// initializeTimer) so it doesn't depend on the data layer directly.
import { supabase } from './supabase.js';
import { formatTime } from './utils.js';

let timerInterval;
let currentBeepInterval;
let currentMelodyContext;
let timerPaused = false;
let pausedTimeRemaining = 0;
let timerEndTime = 0;
const TIMER_MAX_HOURS = 99;
const TIMER_MAX_MINUTES = 59;
const TIMER_MAX_SECONDS = 59;

// Injected by initializeTimer(). No-op until the timer is initialized.
let saveSetting = () => {};

export function applyTimerVisibility(visible) {
    const widget = document.getElementById('timer-widget');
    if (!widget) return;
    if (visible) {
        widget.classList.add('is-open');
    } else {
        widget.classList.remove('is-open');
    }
}

function getTimerVolumePercent() {
    const el = document.getElementById('timer-volume');
    if (!el) return 80;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 80;
}

function playMelodyOnce() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    currentMelodyContext = audioContext;
    const masterGain = audioContext.createGain();
    const volPct = getTimerVolumePercent();
    masterGain.gain.value = (volPct / 100) * 1.8;
    masterGain.connect(audioContext.destination);

    const notes = [
        { freq: 523.25, dur: 0.25 }, // C5
        { freq: 659.25, dur: 0.25 }, // E5
        { freq: 783.99, dur: 0.25 }, // G5
        { freq: 659.25, dur: 0.25 }, // E5
        { freq: 587.33, dur: 0.3 },  // D5
        { freq: 523.25, dur: 0.4 },  // C5
        { freq: 659.25, dur: 0.25 }, // E5
        { freq: 523.25, dur: 0.35 }  // C5
    ];

    let t = audioContext.currentTime;
    notes.forEach(note => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.value = note.freq;
        gainNode.gain.setValueAtTime(0, t);
        gainNode.gain.linearRampToValueAtTime(0.7, t + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, t + note.dur);

        oscillator.connect(gainNode);
        gainNode.connect(masterGain);

        oscillator.start(t);
        oscillator.stop(t + note.dur);
        t += note.dur + 0.05;
    });

    const totalDurationMs = (t - audioContext.currentTime + 0.1) * 1000;
    setTimeout(() => {
        if (currentMelodyContext === audioContext) {
            currentMelodyContext = null;
        }
        audioContext.close();
    }, totalDurationMs);
}

function stopMelody() {
    if (currentMelodyContext) {
        currentMelodyContext.close();
        currentMelodyContext = null;
    }
}

function normalizeTimerInputs() {
    const secondsEl = document.getElementById('timer-seconds');
    const minutesEl = document.getElementById('timer-minutes');
    const hoursEl = document.getElementById('timer-hours');
    if (!secondsEl || !minutesEl || !hoursEl) return;

    let seconds = parseInt(secondsEl.value, 10);
    let minutes = parseInt(minutesEl.value, 10);
    let hours = parseInt(hoursEl.value, 10);

    seconds = Number.isFinite(seconds) ? seconds : 0;
    minutes = Number.isFinite(minutes) ? minutes : 0;
    hours = Number.isFinite(hours) ? hours : 0;

    seconds = Math.max(0, seconds);
    minutes = Math.max(0, minutes);
    hours = Math.max(0, hours);

    if (seconds > TIMER_MAX_SECONDS) {
        minutes += Math.floor(seconds / 60);
        seconds = seconds % 60;
    }

    if (minutes > TIMER_MAX_MINUTES) {
        hours += Math.floor(minutes / 60);
        minutes = minutes % 60;
    }

    if (hours > TIMER_MAX_HOURS) {
        hours = TIMER_MAX_HOURS;
        minutes = TIMER_MAX_MINUTES;
        seconds = TIMER_MAX_SECONDS;
    }

    secondsEl.value = seconds;
    minutesEl.value = minutes;
    hoursEl.value = hours;
}

function getTimeInSeconds() {
    normalizeTimerInputs();
    const secondsEl = document.getElementById('timer-seconds');
    const minutesEl = document.getElementById('timer-minutes');
    const hoursEl = document.getElementById('timer-hours');
    if (!secondsEl || !minutesEl || !hoursEl) return 0;

    const seconds = parseInt(secondsEl.value) || 0;
    const minutes = parseInt(minutesEl.value) || 0;
    const hours = parseInt(hoursEl.value) || 0;
    return (hours * 3600) + (minutes * 60) + seconds;
}

function setTimeInputs(totalSeconds) {
    const secondsEl = document.getElementById('timer-seconds');
    const minutesEl = document.getElementById('timer-minutes');
    const hoursEl = document.getElementById('timer-hours');
    if (!secondsEl || !minutesEl || !hoursEl) return;

    const maxTotalSeconds = (TIMER_MAX_HOURS * 3600) + (TIMER_MAX_MINUTES * 60) + TIMER_MAX_SECONDS;
    const safeSeconds = Math.min(Math.max(0, totalSeconds), maxTotalSeconds);

    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;

    secondsEl.value = seconds;
    minutesEl.value = minutes;
    hoursEl.value = hours;
}

function startTimer() {
    const totalSeconds = timerPaused ? Math.ceil(pausedTimeRemaining / 1000) : getTimeInSeconds();
    if (totalSeconds <= 0) return;

    const startBtn = document.getElementById('start-timer');
    const pauseBtn = document.getElementById('pause-timer');
    const stopBtn = document.getElementById('stop-timer');
    const display = document.getElementById('timer-display');
    const miniDisplay = document.getElementById('timer-mini-display');
    const timerWidget = document.getElementById('timer-widget');

    if (!startBtn || !pauseBtn || !stopBtn || !display || !timerWidget) return;

    startBtn.style.display = 'none';
    pauseBtn.style.display = 'flex';
    stopBtn.style.display = 'flex';
    display.classList.add('active');
    timerWidget.classList.add('is-running');

    timerEndTime = Date.now() + (timerPaused ? pausedTimeRemaining : totalSeconds * 1000);
    timerPaused = false;
    pausedTimeRemaining = 0;

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const now = Date.now();
        const remaining = Math.max(0, timerEndTime - now);

        if (remaining === 0) {
            clearInterval(timerInterval);
            display.classList.add('timer-ended');
            // מנגינה נעימה למשך כחצי דקה
            let melodyCount = 0;
            const totalMelodies = 8;
            currentBeepInterval = setInterval(() => {
                if (melodyCount < totalMelodies) {
                    playMelodyOnce();
                    melodyCount++;
                } else {
                    clearInterval(currentBeepInterval);
                    currentBeepInterval = null;
                    stopMelody();
                    // רק כשהצפצוף מסתיים, נסתיר את כפתור העצירה
                    startBtn.style.display = 'flex';
                    pauseBtn.style.display = 'none';
                    stopBtn.style.display = 'none';
                    display.classList.remove('active');
                    display.classList.remove('timer-ended');
                    display.textContent = '';
                    if (miniDisplay) miniDisplay.textContent = '';
                    timerWidget.classList.remove('is-running');
                }
            }, 4000);

            // כשהטיימר מסתיים, נציג את כפתור ההתחלה ונסתיר את כפתור ההשהיה
            startBtn.style.display = 'flex';
            pauseBtn.style.display = 'none';
            // נשאיר את כפתור העצירה מוצג כדי שאפשר יהיה לעצור את הצפצוף
            stopBtn.style.display = 'flex';
            display.classList.remove('active');
            display.textContent = '00:00:00';
            if (miniDisplay) miniDisplay.textContent = '00:00';
            timerWidget.classList.remove('is-running');
            return;
        }

        const timeStr = formatTime(Math.ceil(remaining / 1000));
        display.textContent = timeStr;
        // עדכון התצוגה המיני (רק דקות ושניות אם פחות משעה)
        if (miniDisplay) {
            const secs = Math.ceil(remaining / 1000);
            if (secs >= 3600) {
                miniDisplay.textContent = timeStr;
            } else {
                const m = Math.floor(secs / 60);
                const s = secs % 60;
                miniDisplay.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            }
        }
    }, 1000);
}

function pauseTimer() {
    const startBtn = document.getElementById('start-timer');
    const pauseBtn = document.getElementById('pause-timer');
    const display = document.getElementById('timer-display');
    const timerWidget = document.getElementById('timer-widget');

    if (!startBtn || !pauseBtn || !display || !timerWidget) return;

    clearInterval(timerInterval);
    timerPaused = true;
    pausedTimeRemaining = Math.max(0, timerEndTime - Date.now());

    startBtn.style.display = 'flex';
    pauseBtn.style.display = 'none';
    display.classList.remove('active');
    // Keep is-running class so mini display still shows
}

function stopTimer() {
    const startBtn = document.getElementById('start-timer');
    const pauseBtn = document.getElementById('pause-timer');
    const stopBtn = document.getElementById('stop-timer');
    const display = document.getElementById('timer-display');
    const miniDisplay = document.getElementById('timer-mini-display');
    const timerWidget = document.getElementById('timer-widget');

    if (!startBtn || !pauseBtn || !stopBtn || !display || !timerWidget) return;

    clearInterval(timerInterval);
    if (currentBeepInterval) {
        clearInterval(currentBeepInterval);
        currentBeepInterval = null;
    }
    stopMelody();

    timerPaused = false;
    pausedTimeRemaining = 0;

    startBtn.style.display = 'flex';
    pauseBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    display.classList.remove('active');
    display.classList.remove('timer-ended');
    display.textContent = '';
    if (miniDisplay) miniDisplay.textContent = '';
    timerWidget.classList.remove('is-running');
}

function toggleTimerWidget() {
    const timerWidget = document.getElementById('timer-widget');
    if (!timerWidget) return;
    const isOpen = timerWidget.classList.contains('is-open');
    if (isOpen) {
        timerWidget.classList.remove('is-open');
    } else {
        timerWidget.classList.add('is-open');
    }
    saveSetting('timerVisible', !isOpen);
}

export function initializeTimer(settings, saveSettingFn) {
    if (typeof saveSettingFn === 'function') saveSetting = saveSettingFn;

    const startButton = document.getElementById('start-timer');
    const pauseButton = document.getElementById('pause-timer');
    const stopButton = document.getElementById('stop-timer');
    const toggleButton = document.getElementById('timer-toggle-btn');
    const closeButton = document.getElementById('timer-close-btn');
    const timerWidget = document.getElementById('timer-widget');
    const hoursInput = document.getElementById('timer-hours');
    const minutesInput = document.getElementById('timer-minutes');
    const secondsInput = document.getElementById('timer-seconds');
    const volumeSlider = document.getElementById('timer-volume');
    const volumeValueEl = document.getElementById('timer-volume-value');

    // בדיקה שכל האלמנטים קיימים לפני הוספת event listeners
    if (!startButton || !pauseButton || !stopButton || !toggleButton || !timerWidget || !hoursInput || !minutesInput || !secondsInput) {
        console.warn('Timer elements not found, skipping timer initialization');
        return;
    }

    const timerVolume = (settings && settings.timerVolume != null) ? settings.timerVolume : 80;
    if (volumeSlider) {
        volumeSlider.value = timerVolume;
        if (volumeValueEl) volumeValueEl.textContent = Math.round(timerVolume) + '%';
        volumeSlider.addEventListener('input', () => {
            const v = Math.round(getTimerVolumePercent());
            if (volumeValueEl) volumeValueEl.textContent = v + '%';
            saveSetting('timerVolume', v);
            if (!supabase) localStorage.setItem('timerVolume', String(v));
        });
    }

    // טיימר טוגל - פתיחה וסגירה
    toggleButton.addEventListener('click', toggleTimerWidget);

    if (closeButton) {
        closeButton.addEventListener('click', () => {
            timerWidget.classList.remove('is-open');
            saveSetting('timerVisible', false);
        });
    }

    // סגירה בלחיצה מחוץ לטיימר
    document.addEventListener('click', (e) => {
        if (!timerWidget.contains(e.target) && timerWidget.classList.contains('is-open')) {
            timerWidget.classList.remove('is-open');
            saveSetting('timerVisible', false);
        }
    });

    // אתחול הטיימר
    startButton.addEventListener('click', startTimer);
    pauseButton.addEventListener('click', pauseTimer);
    stopButton.addEventListener('click', stopTimer);

    // הגדרת זמנים מראש
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const seconds = parseInt(btn.dataset.time);
            setTimeInputs(seconds);
        });
    });

    [hoursInput, minutesInput, secondsInput].forEach(input => {
        input.addEventListener('input', normalizeTimerInputs);
        input.addEventListener('change', normalizeTimerInputs);
    });
}
