// Melody playback for recipe timer alerts.

function getVolume() {
    const el = document.getElementById('timer-volume');
    if (!el) return 0.8;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v / 100)) : 0.8;
}

export function playMelody(onEnd) {
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
