// Auth gate: the login/signup modal (email+password, Google, password reset)
// and the state reset on sign-out. The orchestration (bootstrap, routing,
// onAuthChange) stays in main.js, which calls setAuthGateVisible/setupAuthGateUI.
import {
    setRecipes,
    setEditingIndex,
    setAiChatMessages,
    setCurrentConversationId,
    setConversationHistory,
    setChatClosedAt,
    setPendingSuggestedRecipe,
    setIsSharedRecipeMode,
} from './state.js';
import {
    isAuthenticated,
    signInWithGoogle,
    signInWithEmailPassword,
    signUpWithEmailPassword,
    sendPasswordResetEmail,
} from './auth.js';

    export function setAuthGateVisible(visible) {
        const gate = document.getElementById('authGate');
        if (gate) {
            gate.style.display = visible ? 'flex' : 'none';
            gate.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }
        document.body.classList.toggle('auth-locked', visible);
    }
    export function resetAppStateForSignOut() {
        setRecipes([]);
        setEditingIndex(-1);
        setAiChatMessages([]);
        setCurrentConversationId(null);
        setConversationHistory([]);
        setChatClosedAt(null);
        setPendingSuggestedRecipe(null);
        setIsSharedRecipeMode(false);
        const container = document.getElementById('recipesContainer');
        if (container) container.innerHTML = '';
    }

    /** @param {import('@supabase/supabase-js').AuthError | Error} err */
    function authErrorMessageHe(err) {
        const msg = (err && err.message) ? String(err.message) : '';
        if (msg.includes('Invalid login credentials')) {
            return 'אימייל או סיסמה שגויים. אם נרשמת בעבר עם Google — השתמש בכפתור Google. אפשר גם לאפס סיסמה למטה.';
        }
        if (msg.includes('User already registered')) {
            return 'האימייל כבר רשום. התחבר עם הסיסמה הקיימת, עם Google, או אפס סיסמה — הרשמה חוזרת לא מחליפה סיסמה.';
        }
        if (msg.includes('Password should be at least')) {
            return 'הסיסמה חייבת להכיל לפחות 6 תווים.';
        }
        if (msg.includes('Unable to validate email address')) {
            return 'כתובת אימייל לא תקינה.';
        }
        if (msg.includes('Email not confirmed')) {
            return 'נשלח אליך מייל לאימות. פתח את הקישור בתיבת הדואר ואז התחבר שוב.';
        }
        if (msg.includes('Signup requires a valid password')) {
            return 'נא להזין סיסמה תקינה (לפחות 6 תווים).';
        }
        return msg || 'שגיאה בהתחברות. נסה שוב.';
    }

    function setAuthFormError(message, options) {
        const el = document.getElementById('authFormError');
        const textEl = el && el.querySelector('.auth-form-banner-text');
        const iconEl = el && el.querySelector('.auth-form-banner-icon');
        if (!el || !textEl) return;

        const opts = options || {};
        let variant = 'error';
        if (opts.success) {
            variant = 'success';
        } else if (opts.variant === 'info' || opts.variant === 'success' || opts.variant === 'error') {
            variant = opts.variant;
        }

        const iconByVariant = {
            success: 'check_circle',
            info: 'mail',
            error: 'error',
        };

        if (message) {
            el.dataset.variant = variant;
            textEl.textContent = message;
            if (iconEl) {
                iconEl.textContent = iconByVariant[variant] || 'error';
            }
            el.hidden = false;
        } else {
            textEl.textContent = '';
            el.hidden = true;
        }
    }

    function setAuthGateBusy(busy) {
        const submitBtn = document.getElementById('authSubmitBtn');
        const googleBtn = document.getElementById('googleSignInBtn');
        const toggleBtn = document.getElementById('authToggleMode');
        const forgotBtn = document.getElementById('authForgotPassword');
        const emailInput = document.getElementById('authEmail');
        const passwordInput = document.getElementById('authPassword');
        const displayNameInput = document.getElementById('authDisplayName');
        if (submitBtn) submitBtn.disabled = busy;
        if (googleBtn) googleBtn.disabled = busy;
        if (toggleBtn) toggleBtn.disabled = busy;
        if (forgotBtn) forgotBtn.disabled = busy;
        if (emailInput) emailInput.disabled = busy;
        if (passwordInput) passwordInput.disabled = busy;
        if (displayNameInput) displayNameInput.disabled = busy;
    }

    function setAuthGateMode(mode) {
        const panel = document.getElementById('authGatePanel');
        const submitBtn = document.getElementById('authSubmitBtn');
        const toggleBtn = document.getElementById('authToggleMode');
        const togglePrompt = document.getElementById('authTogglePrompt');
        const forgotBtn = document.getElementById('authForgotPassword');
        const displayNameField = document.getElementById('authDisplayNameField');
        const passwordInput = document.getElementById('authPassword');
        if (!panel || !submitBtn || !toggleBtn) return;

        const isSignup = mode === 'signup';
        panel.dataset.mode = isSignup ? 'signup' : 'login';
        submitBtn.textContent = isSignup ? 'צור חשבון' : 'התחבר';
        if (togglePrompt) {
            togglePrompt.textContent = isSignup ? 'כבר יש לך חשבון?' : 'אין לך חשבון?';
        }
        toggleBtn.textContent = isSignup ? 'התחבר' : 'הירשם';
        if (forgotBtn) {
            forgotBtn.hidden = isSignup;
        }
        if (displayNameField) {
            displayNameField.hidden = !isSignup;
        }
        if (passwordInput) {
            passwordInput.autocomplete = isSignup ? 'new-password' : 'current-password';
        }
        setAuthFormError('');
    }

    export function setupAuthGateUI() {
        const googleBtn = document.getElementById('googleSignInBtn');
        const form = document.getElementById('authEmailForm');
        const toggleBtn = document.getElementById('authToggleMode');
        const forgotBtn = document.getElementById('authForgotPassword');
        if (!googleBtn || googleBtn.dataset.bound === '1') return;
        googleBtn.dataset.bound = '1';

        setAuthGateMode('login');

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const panel = document.getElementById('authGatePanel');
                const nextMode = panel && panel.dataset.mode === 'signup' ? 'login' : 'signup';
                setAuthGateMode(nextMode);
            });
        }

        if (forgotBtn) {
            forgotBtn.addEventListener('click', async () => {
                setAuthFormError('');
                const emailEl = document.getElementById('authEmail');
                const email = emailEl && emailEl.value ? emailEl.value.trim() : '';
                if (!email) {
                    setAuthFormError('הזן אימייל ואז לחץ שוב על "שכחתי סיסמה".');
                    return;
                }
                setAuthGateBusy(true);
                try {
                    await sendPasswordResetEmail(email);
                    setAuthFormError('נשלח קישור לאיפוס סיסמה לאימייל שלך.', { success: true });
                } catch (err) {
                    console.error('[auth] password reset failed:', err);
                    setAuthFormError(authErrorMessageHe(err));
                } finally {
                    setAuthGateBusy(false);
                }
            });
        }

        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                setAuthFormError('');

                const panel = document.getElementById('authGatePanel');
                const isSignup = panel && panel.dataset.mode === 'signup';
                const emailEl = document.getElementById('authEmail');
                const passwordEl = document.getElementById('authPassword');
                const displayNameEl = document.getElementById('authDisplayName');
                const email = emailEl && emailEl.value ? emailEl.value.trim() : '';
                const password = passwordEl ? passwordEl.value : '';
                const displayName = displayNameEl ? displayNameEl.value.trim() : '';

                if (!email) {
                    setAuthFormError('נא להזין כתובת אימייל.');
                    return;
                }
                if (!password || password.length < 6) {
                    setAuthFormError('הסיסמה חייבת להכיל לפחות 6 תווים.');
                    return;
                }

                setAuthGateBusy(true);
                try {
                    if (isSignup) {
                        await signUpWithEmailPassword(email, password, displayName);
                    } else {
                        await signInWithEmailPassword(email, password);
                    }
                } catch (err) {
                    console.error('[auth] email sign-in failed:', err);
                    const errMsg = (err && err.message) ? String(err.message) : '';
                    const variant = errMsg.includes('Email not confirmed') ? 'info' : 'error';
                    setAuthFormError(authErrorMessageHe(err), { variant });
                } finally {
                    if (!isAuthenticated()) {
                        setAuthGateBusy(false);
                    }
                }
            });
        }

        googleBtn.addEventListener('click', async () => {
            setAuthFormError('');
            setAuthGateBusy(true);
            try {
                await signInWithGoogle();
            } catch (e) {
                console.error('[auth] Google sign-in failed:', e);
                setAuthFormError('שגיאה בהתחברות עם Google. נסה שוב.');
                setAuthGateBusy(false);
            }
        });
    }
