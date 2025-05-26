// Timer functionality
export function setupTimer() {
    const timerDisplay = document.getElementById('timer-display');
    const startButton = document.getElementById('start-timer');
    const pauseButton = document.getElementById('pause-timer');
    const stopButton = document.getElementById('stop-timer');
    const presetButton = document.getElementById('timer-preset');
    const presetMenu = document.getElementById('timer-preset-menu');
    
    let timeLeft = 0;
    let timerId = null;
    
    function updateDisplay() {
        const hours = Math.floor(timeLeft / 3600);
        const minutes = Math.floor((timeLeft % 3600) / 60);
        const seconds = timeLeft % 60;
        timerDisplay.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    function startTimer() {
        if (timerId === null) {
            const hours = parseInt(document.getElementById('timer-hours').value) || 0;
            const minutes = parseInt(document.getElementById('timer-minutes').value) || 0;
            const seconds = parseInt(document.getElementById('timer-seconds').value) || 0;
            
            timeLeft = hours * 3600 + minutes * 60 + seconds;
            
            if (timeLeft > 0) {
                updateDisplay();
                timerId = setInterval(() => {
                    timeLeft--;
                    updateDisplay();
                    
                    if (timeLeft <= 0) {
                        clearInterval(timerId);
                        timerId = null;
                        alert('הטיימר הסתיים!');
                        startButton.style.display = 'flex';
                        pauseButton.style.display = 'none';
                        stopButton.style.display = 'none';
                    }
                }, 1000);
                
                startButton.style.display = 'none';
                pauseButton.style.display = 'flex';
                stopButton.style.display = 'flex';
            }
        }
    }

    function pauseTimer() {
        if (timerId !== null) {
            clearInterval(timerId);
            timerId = null;
            startButton.style.display = 'flex';
            pauseButton.style.display = 'none';
        }
    }

    function stopTimer() {
        if (timerId !== null) {
            clearInterval(timerId);
            timerId = null;
        }
        timeLeft = 0;
        updateDisplay();
        startButton.style.display = 'flex';
        pauseButton.style.display = 'none';
        stopButton.style.display = 'none';
    }

    startButton.addEventListener('click', startTimer);
    pauseButton.addEventListener('click', pauseTimer);
    stopButton.addEventListener('click', stopTimer);
    
    presetButton.addEventListener('click', () => {
        presetMenu.style.display = presetMenu.style.display === 'none' ? 'flex' : 'none';
    });

    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const time = parseInt(btn.dataset.time);
            document.getElementById('timer-hours').value = Math.floor(time / 3600);
            document.getElementById('timer-minutes').value = Math.floor((time % 3600) / 60);
            document.getElementById('timer-seconds').value = time % 60;
            presetMenu.style.display = 'none';
            startTimer();
        });
    });

    document.addEventListener('click', (e) => {
        if (!presetMenu.contains(e.target) && e.target !== presetButton) {
            presetMenu.style.display = 'none';
        }
    });
}