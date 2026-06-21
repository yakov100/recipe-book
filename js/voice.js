// Voice input for the AI chat: Web Speech API when available, otherwise
// MediaRecorder + server-side transcription via the recipe-ai edge function.
// Writes the transcript into #aiChatInput. setAuthGateVisible is reached via
// window (defined in main.js) to keep this a leaf module.
import { edgeFunctionHeaders, edgeFunctionUrl } from './supabase.js';
import { blobToBase64 } from './utils.js';

var voiceRecognition = null;
var voiceMediaRecorder = null;
var voiceMediaStream = null;
var voiceAudioChunks = [];
var voiceRecorderMimeType = 'audio/webm';
var voiceMode = null; // 'speech' | 'recorder'
var voiceInputPrefix = '';
var voiceFinalTranscript = '';
var voiceSpeechStopping = false;
var isRecording = false;
var voiceHelperDefaultText = '';
var voiceStarting = false;

function setVoiceHelperText(text) {
    var helper = document.getElementById('aiChatInputHelper');
    if (!helper) return;
    if (!voiceHelperDefaultText) voiceHelperDefaultText = helper.textContent || '';
    helper.textContent = text || voiceHelperDefaultText;
}

function releaseVoiceMediaStream() {
    if (voiceMediaStream) {
        voiceMediaStream.getTracks().forEach(function(track) { track.stop(); });
        voiceMediaStream = null;
    }
}

export function toggleVoiceRecording() {
    if (voiceStarting) return;
    if (isRecording) {
        stopVoiceRecording();
    } else {
        startVoiceRecording();
    }
}

async function transcribeVoiceRecording(mimeType) {
    setVoiceHelperText('מתמלל...');
    updateVoiceButton(false);

    var blob = new Blob(voiceAudioChunks, { type: mimeType });
    voiceAudioChunks = [];

    if (blob.size < 200) {
        setVoiceHelperText('ההקלטה קצרה מדי. נסה שוב.');
        return;
    }

    try {
        var authHeaders = await edgeFunctionHeaders();
        if (!authHeaders) {
            window.setAuthGateVisible(true);
            alert('נא להתחבר עם Google כדי להשתמש בהקלטה קולית');
            setVoiceHelperText('');
            return;
        }
        var base64 = await blobToBase64(blob);
        var res = await fetch(edgeFunctionUrl('recipe-ai'), {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                transcribeAudio: true,
                audioBase64: base64,
                audioMimeType: (mimeType || 'audio/webm').split(';')[0],
            }),
        });
        var data = await res.json().catch(function() { return {}; });
        if (res.status === 401) {
            window.setAuthGateVisible(true);
            throw new Error('נא להתחבר עם Google כדי להשתמש בהקלטה קולית');
        }
        if (!res.ok) {
            throw new Error((data && data.error) || 'שגיאה מהשרת (' + res.status + ')');
        }
        if (data && typeof data === 'object' && data.transcript) {
            var input = document.getElementById('aiChatInput');
            if (input) {
                var prev = input.value.trim();
                input.value = prev ? prev + ' ' + data.transcript : data.transcript;
            }
            setVoiceHelperText('');
        } else {
            alert((data && data.error) || 'לא הצלחתי לתמלל את ההקלטה.');
            setVoiceHelperText('');
        }
    } catch (err) {
        console.error('Transcription failed:', err);
        alert('שגיאה בתמלול: ' + (err && err.message ? err.message : 'נסה שוב'));
        setVoiceHelperText('');
    }
}

function startWebSpeechRecording(SpeechRecognition) {
    voiceMode = 'speech';
    voiceSpeechStopping = false;
    voiceFinalTranscript = '';
    var input = document.getElementById('aiChatInput');
    voiceInputPrefix = input ? input.value.trim() : '';

    voiceRecognition = new SpeechRecognition();
    voiceRecognition.lang = 'he-IL';
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true;

    voiceRecognition.onresult = function(event) {
        var interim = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
            var piece = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                voiceFinalTranscript += piece;
            } else {
                interim += piece;
            }
        }
        if (input) {
            var spoken = (voiceFinalTranscript + interim).trim();
            input.value = voiceInputPrefix && spoken
                ? voiceInputPrefix + ' ' + spoken
                : (voiceInputPrefix || spoken);
        }
    };

    voiceRecognition.onerror = function(event) {
        console.error('Voice recognition error:', event.error);
        if (event.error === 'not-allowed') {
            alert('אנא אשר גישה למיקרופון בדפדפן.');
            stopVoiceRecording();
            return;
        }
        if (event.error === 'network' || event.error === 'service-not-available') {
            alert('תמלול הדפדפן לא זמין (בעיית רשת). נסה Chrome/Edge עם חיבור אינטרנט יציב.');
            stopVoiceRecording();
            return;
        }
        if (event.error === 'audio-capture') {
            alert('לא ניתן לגשת למיקרופון. בדוק הרשאות בדפדפן.');
            stopVoiceRecording();
            return;
        }
        stopVoiceRecording();
    };

    voiceRecognition.onend = function() {
        if (voiceSpeechStopping) {
            voiceSpeechStopping = false;
            return;
        }
        // Chrome stops after silence; keep listening until the user clicks stop
        if (voiceMode === 'speech' && isRecording && voiceRecognition) {
            try {
                voiceRecognition.start();
            } catch (err) {
                stopVoiceRecording();
            }
            return;
        }
        if (voiceMode === 'speech') {
            stopVoiceRecording();
        }
    };

    try {
        voiceRecognition.start();
        isRecording = true;
        updateVoiceButton(true);
        setVoiceHelperText('מקשיב... לחץ stop לסיום');
    } catch (err) {
        console.error('SpeechRecognition start failed:', err);
        voiceRecognition = null;
        voiceMode = null;
        alert('לא ניתן להפעיל תמלול דפדפן. נסה Chrome או Edge.');
    }
}

function startVoiceRecording() {
    if (!window.isSecureContext) {
        alert('הקלטה קולית דורשת חיבור מאובטח (HTTPS או localhost).');
        return;
    }
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        startWebSpeechRecording(SpeechRecognition);
        return;
    }
    startMediaRecorderRecording();
}

function startMediaRecorderRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('לא ניתן להקליט – הדפדפן לא תומך במיקרופון.');
        return;
    }
    if (typeof MediaRecorder === 'undefined') {
        alert('הדפדפן לא תומך בהקלטת אודיו. נסה Chrome או Edge.');
        return;
    }

    voiceMode = 'recorder';
    voiceStarting = true;
    voiceAudioChunks = [];
    setVoiceHelperText('מבקש גישה למיקרופון...');
    updateVoiceButton(true);

    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
        voiceStarting = false;
        releaseVoiceMediaStream();
        voiceMediaStream = stream;
        voiceRecorderMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4');

        try {
            voiceMediaRecorder = new MediaRecorder(stream, { mimeType: voiceRecorderMimeType });
        } catch (recErr) {
            voiceRecorderMimeType = 'audio/webm';
            voiceMediaRecorder = new MediaRecorder(stream);
        }

        voiceMediaRecorder.ondataavailable = function(e) {
            if (e.data && e.data.size > 0) voiceAudioChunks.push(e.data);
        };
        voiceMediaRecorder.onerror = function(e) {
            console.error('MediaRecorder error:', e);
            alert('שגיאה בהקלטה. נסה שוב.');
            stopVoiceRecording();
        };
        voiceMediaRecorder.onstop = function() {
            releaseVoiceMediaStream();
            voiceMediaRecorder = null;
            transcribeVoiceRecording(voiceRecorderMimeType);
        };

        voiceMediaRecorder.start(250);
        isRecording = true;
        updateVoiceButton(true);
        setVoiceHelperText('מקליט... לחץ stop לסיום ותמלול');
    }).catch(function(err) {
        voiceStarting = false;
        isRecording = false;
        console.error('getUserMedia failed:', err);
        var name = err && err.name ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            alert('אנא אשר גישה למיקרופון (לחץ על המנעול ליד ה-URL בדפדפן).');
        } else if (name === 'NotFoundError') {
            alert('לא נמצא מיקרופון. חבר מיקרופון ונסה שוב.');
        } else {
            alert('לא ניתן להפעיל מיקרופון: ' + (err.message || name || 'שגיאה לא ידועה'));
        }
        setVoiceHelperText('');
        updateVoiceButton(false);
    });
}

function stopVoiceRecording() {
    voiceStarting = false;

    if (voiceMode === 'speech' && voiceRecognition) {
        voiceSpeechStopping = true;
        try { voiceRecognition.stop(); } catch (err) { /* already stopped */ }
        voiceRecognition = null;
        voiceMode = null;
        voiceFinalTranscript = '';
        isRecording = false;
        updateVoiceButton(false);
        setVoiceHelperText('');
        return;
    }

    isRecording = false;
    updateVoiceButton(false);

    if (voiceMediaRecorder && voiceMediaRecorder.state === 'recording') {
        setVoiceHelperText('מסיים הקלטה...');
        try {
            if (typeof voiceMediaRecorder.requestData === 'function') {
                voiceMediaRecorder.requestData();
            }
            voiceMediaRecorder.stop();
        } catch (err) {
            console.error('MediaRecorder stop failed:', err);
            releaseVoiceMediaStream();
            voiceMediaRecorder = null;
            voiceAudioChunks = [];
            setVoiceHelperText('');
            alert('שגיאה בעצירת ההקלטה.');
        }
        return;
    }

    releaseVoiceMediaStream();
    voiceMediaRecorder = null;
    voiceAudioChunks = [];
    voiceMode = null;
    setVoiceHelperText('');
}

export function initVoiceButton() {
    var btn = document.getElementById('aiChatVoice');
    if (!btn || btn.dataset.voiceBound === '1') return;
    btn.dataset.voiceBound = '1';
    btn.addEventListener('click', function(e) {
        e.preventDefault();
        toggleVoiceRecording();
    });
}

function updateVoiceButton(recording) {
    var btn = document.getElementById('aiChatVoice');
    if (!btn) return;
    if (recording) {
        btn.classList.add('recording');
        btn.innerHTML = '<span class="material-symbols-outlined">stop</span>';
        btn.title = 'עצור הקלטה';
    } else {
        btn.classList.remove('recording');
        btn.innerHTML = '<span class="material-symbols-outlined">mic</span>';
        btn.title = 'הקלט קול';
    }
}
