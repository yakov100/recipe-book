import { supabase, setCachedAccessToken } from './supabase.js';

/** Primary production URL (Vercel). Must be in Supabase Redirect URLs. */
export const RECIPE_BOOK_PRODUCTION_URL = 'https://recipe-book-gh-pages.vercel.app/';

/**
 * Copy-paste into Supabase → Authentication → URL Configuration → Redirect URLs.
 * If redirectTo is missing from this list, Supabase falls back to Site URL (e.g. Housing_units).
 */
export const RECIPE_BOOK_OAUTH_REDIRECT_URLS = [
    'http://localhost:3000/',
    'http://localhost:3000/**',
    'http://localhost:3001/',
    'http://localhost:3001/**',
    'https://recipe-book-gh-pages.vercel.app/',
    'https://recipe-book-gh-pages.vercel.app/**',
    'https://recipe-book-gh-pages-git-main-yaakovs-projects-c8a05261.vercel.app/',
    'https://recipe-book-gh-pages-git-main-yaakovs-projects-c8a05261.vercel.app/**',
    'https://yakov100.github.io/recipe-book/',
    'https://yakov100.github.io/recipe-book/**',
];

/** @type {import('@supabase/supabase-js').User | null} */
let currentUser = null;

/** @type {Set<(user: import('@supabase/supabase-js').User | null) => void>} */
const authListeners = new Set();

/** @returns {import('@supabase/supabase-js').User | null} */
export function getCurrentUser() {
    return currentUser;
}

/** @returns {boolean} */
export function isAuthenticated() {
    return currentUser != null;
}

/**
 * URL Supabase should return to after Google OAuth (must be in Supabase Redirect URLs).
 * Uses current origin + path so recipe-book works on localhost and GitHub Pages subpath.
 * @returns {string}
 */
export function getOAuthRedirectUrl() {
    if (typeof window === 'undefined') return RECIPE_BOOK_PRODUCTION_URL;
    const { origin, pathname, search, hostname } = window.location;
    const params = new URLSearchParams(search);
    for (const key of ['code', 'error', 'error_description', 'error_code']) {
        params.delete(key);
    }
    const qs = params.toString();

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        const path = pathname && pathname.length > 0 ? pathname : '/';
        return origin + path + (qs ? `?${qs}` : '');
    }

    if (hostname.endsWith('.vercel.app') && hostname.includes('recipe-book')) {
        return origin + '/' + (qs ? `?${qs}` : '');
    }

    if (hostname === 'yakov100.github.io' && pathname.startsWith('/recipe-book')) {
        return 'https://yakov100.github.io/recipe-book/' + (qs ? `?${qs}` : '');
    }

    const path = pathname && pathname.length > 0 ? pathname : '/';
    return origin + path + (qs ? `?${qs}` : '');
}

/**
 * @param {(user: import('@supabase/supabase-js').User | null) => void} callback
 * @returns {() => void}
 */
export function onAuthChange(callback) {
    authListeners.add(callback);
    return () => authListeners.delete(callback);
}

/**
 * @param {import('@supabase/supabase-js').User | null} user
 * @param {string | null | undefined} accessToken
 */
function notifyAuthChange(user, accessToken) {
    currentUser = user;
    setCachedAccessToken(accessToken ?? null);
    updateAuthHeaderUI(user);
    authListeners.forEach((cb) => {
        try {
            cb(user);
        } catch (e) {
            console.error('[auth] listener error:', e);
        }
    });
}

/** @returns {string | null} */
function consumeAuthErrorFromUrl() {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error_description') || params.get('error');
    if (!err) return null;
    const clean = getOAuthRedirectUrl();
    window.history.replaceState({}, document.title, clean);
    return err;
}

/** @returns {boolean} */
function hasOAuthCallbackInUrl() {
    if (typeof window === 'undefined') return false;
    const { hash, search } = window.location;
    return hash.includes('access_token=') || search.includes('code=');
}

/** @returns {Promise<void>} */
async function finishOAuthCallbackIfPresent() {
    if (!supabase || !hasOAuthCallbackInUrl()) return;
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        console.error('[auth] OAuth callback getSession failed:', error);
        return;
    }
    if (session) {
        notifyAuthChange(session.user, session.access_token);
        window.history.replaceState({}, document.title, getOAuthRedirectUrl());
    }
}

/** @returns {Promise<import('@supabase/supabase-js').User | null>} */
export async function initAuth() {
    setupUserMenu();

    if (!supabase) {
        notifyAuthChange(null, null);
        return null;
    }

    const urlError = consumeAuthErrorFromUrl();
    if (urlError) {
        console.error('[auth] OAuth error from URL:', urlError);
        window.setTimeout(() => {
            alert('שגיאה בהתחברות עם Google. ודא שכתובת האתר מופיעה ב-Supabase → Redirect URLs (ראה docs/GOOGLE_AUTH_SETUP.md).');
        }, 0);
    }

    await finishOAuthCallbackIfPresent();

    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        console.error('[auth] getSession failed:', error);
    }
    notifyAuthChange(session?.user ?? null, session?.access_token ?? null);

    supabase.auth.onAuthStateChange((event, nextSession) => {
        if (event === 'INITIAL_SESSION') return;
        notifyAuthChange(nextSession?.user ?? null, nextSession?.access_token ?? null);
        if (event === 'SIGNED_OUT') {
            setCachedAccessToken(null);
        }
        if (event === 'SIGNED_IN' && hasOAuthCallbackInUrl()) {
            window.history.replaceState({}, document.title, getOAuthRedirectUrl());
        }
    });

    return currentUser;
}

/** @returns {Promise<void>} */
export async function signInWithGoogle() {
    if (!supabase) {
        throw new Error('Supabase לא אותחל');
    }
    const redirectTo = getOAuthRedirectUrl();
    console.info('[auth] OAuth redirectTo (must be in Supabase Redirect URLs):', redirectTo);
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo,
            skipBrowserRedirect: false,
        },
    });
    if (error) {
        throw error;
    }
}

/** @returns {Promise<void>} */
export async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
        throw error;
    }
}

/** @returns {void} */
function closeUserMenu() {
    const profileEl = document.getElementById('headerUserProfile');
    const dropdownEl = document.getElementById('headerUserDropdown');
    if (!profileEl || !dropdownEl) return;
    dropdownEl.hidden = true;
    profileEl.setAttribute('aria-expanded', 'false');
    profileEl.classList.remove('is-open');
}

/** @returns {void} */
function toggleUserMenu() {
    const profileEl = document.getElementById('headerUserProfile');
    const dropdownEl = document.getElementById('headerUserDropdown');
    const userWrap = document.getElementById('headerUser');
    if (!profileEl || !dropdownEl || !userWrap || userWrap.style.display === 'none') return;

    const willOpen = dropdownEl.hidden;
    if (!willOpen) {
        closeUserMenu();
        return;
    }

    dropdownEl.hidden = false;
    profileEl.setAttribute('aria-expanded', 'true');
    profileEl.classList.add('is-open');

    /** @param {MouseEvent} e */
    const closeOnOutside = (e) => {
        if (!e.target.closest('.header-user-menu')) {
            closeUserMenu();
            document.removeEventListener('click', closeOnOutside);
        }
    };

    window.setTimeout(() => {
        document.addEventListener('click', closeOnOutside);
    }, 0);
}

let userMenuInitialized = false;

/** @returns {void} */
function setupUserMenu() {
    if (userMenuInitialized) return;
    userMenuInitialized = true;

    const profileEl = document.getElementById('headerUserProfile');
    if (!profileEl) return;

    profileEl.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleUserMenu();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeUserMenu();
        }
    });
}

/**
 * @param {import('@supabase/supabase-js').User | null} user
 */
export function updateAuthHeaderUI(user) {
    const userWrap = document.getElementById('headerUser');
    const profileEl = document.getElementById('headerUserProfile');
    const avatarEl = document.getElementById('headerUserAvatar');
    const iconEl = document.getElementById('headerUserIcon');
    const nameEl = document.getElementById('headerUserName');
    if (!userWrap || !profileEl || !avatarEl || !iconEl || !nameEl) return;

    if (!user) {
        userWrap.style.display = 'none';
        profileEl.title = '';
        nameEl.textContent = '';
        avatarEl.removeAttribute('src');
        avatarEl.alt = '';
        avatarEl.hidden = true;
        iconEl.hidden = false;
        closeUserMenu();
        return;
    }

    userWrap.style.display = 'block';
    const meta = user.user_metadata || {};
    const name = meta.full_name || meta.name || user.email || 'משתמש';
    profileEl.title = name;
    nameEl.textContent = name;
    const avatar = meta.avatar_url || meta.picture;
    if (avatar) {
        avatarEl.onerror = () => {
            avatarEl.hidden = true;
            iconEl.hidden = false;
            avatarEl.onerror = null;
        };
        avatarEl.src = avatar;
        avatarEl.alt = name;
        avatarEl.hidden = false;
        iconEl.hidden = true;
    } else {
        avatarEl.removeAttribute('src');
        avatarEl.onerror = null;
        avatarEl.alt = name;
        avatarEl.hidden = true;
        iconEl.hidden = false;
    }
}

/** @returns {Promise<void>} */
export async function handleSignOut() {
    closeUserMenu();
    try {
        await signOut();
    } catch (e) {
        console.error('[auth] signOut failed:', e);
        alert('שגיאה בהתנתקות. נסה שוב.');
    }
}

window.handleSignOut = handleSignOut;
