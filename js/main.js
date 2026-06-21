import { supabase, supabaseUrl, edgeFunctionUrl, edgeFunctionHeaders, invokeEdgeFunction } from './supabase.js';
import {
    initAuth,
    getCurrentUser,
    isAuthenticated,
    onAuthChange,
    signInWithGoogle,
    signInWithEmailPassword,
    signUpWithEmailPassword,
    sendPasswordResetEmail,
    updateAuthHeaderUI,
} from './auth.js';
import {
    recipeToRow,
    rowToRecipe,
    getCacheStorageKeys,
    loadRecipesFromCache,
    saveRecipesToCache,
    isCacheValid,
    deleteRecipeFromDB,
    saveRecipeToDB,
    saveRecipesToDB,
    loadSingleRecipeFromDB,
    loadPublicRecipeFromDB,
    loadRecipesFromDB,
    loadSettings,
    saveSetting,
} from './data/recipes-repo.js';
import {
    chefImageUrl,
    escapeHtml,
    getYoutubeEmbed,
    compactRecipes,
    formatMessageTime,
    formatRelativeDate,
    blobToBase64,
} from './utils.js';
import { initializeTimer, applyTimerVisibility } from './timer.js';
import {
    getDefaultImageUrl,
    resizeImage,
    resizeImageToBlob,
    uploadImageToStorage,
    getStoragePublicUrl,
    normalizeStorageKey,
    deleteRecipeImageFromStorage,
    getDisplayUrl,
    getImageUrl,
    getImageSrcSet,
} from './images.js';
import {
    PREDEFINED_CATEGORIES,
    updateCategoryList,
    populateCategorySelectAndDropdown,
    updateCategoryTriggerDisplay,
    openCategoryDropdown,
    closeCategoryDropdown,
    toggleCategoryDropdown,
    getCategoryIcon,
    getCategoryIconHtml,
    getCategoryColorClass,
    getCategoryBgColor,
    updateCategoryButtons,
    getUniqueCategories,
} from './categories.js';
import {
    DIFFICULTY_LABELS,
    showRecipesLoadingSkeleton,
    clearRecipesLoadingState,
    displayRecipes,
    showRecipe,
    closePopup,
    displaySharedRecipeCard,
    generateStars,
    rateRecipe,
} from './recipe-view.js';
import {
    generateFilterStars,
    setFilterRating,
    getSelectedRating,
    resetFilterStars,
    getActiveFiltersFromUI,
    hasAnyActiveFilters,
    updateFilterHeaderUI,
    resetSearch,
    updateDietarySelectTrigger,
    initDietaryDropdown,
    mountFilterPanel,
    closeFilterPanel,
    openFilterPanel,
    toggleFilterPanel,
    filterRecipes,
    filterByCategory,
} from './filters.js';
import {
    regenerateImage,
    regenerateImageForForm,
    setFormDifficulty,
    updateFormRatingStars,
    openFormPopup,
    closeFormPopup,
    addIngredientRow,
    removeIngredientRow,
    syncIngredientsToTextarea,
    populateIngredientRows,
    previewFormImage,
    confirmDeleteRecipe,
    deleteRecipe,
    closeConfirmPopup,
    setImportUrlStatus,
    resetImportUrlUI,
    setFormCategoryValue,
    editRecipe,
    saveRecipe,
    toggleCategoryInput,
} from './recipe-form.js';
import {
    copyRecipeLink,
    downloadRecipe,
    exportRecipes,
    importRecipes,
    processOCR,
    importRecipeFromUrl,
    shareRecipe,
    setupBackupReminder,
    closeBackupReminder,
    downloadAllRecipes,
} from './import-export.js';
import {
    addSuggestedRecipeDirectly,
    editSuggestedRecipeFromMsg,
    dismissSuggestedRecipe,
    toggleChatMenu,
    openAiChat,
    closeAiChat,
    sendAiMessage,
    startNewConversation,
    goBackToChatHome,
    handleChatFileSelect,
} from './ai-chat.js';
import { toggleVoiceRecording } from './voice.js';
import {
    recipes, setRecipes,
    editingIndex, setEditingIndex,
    formSelectedRating, setFormSelectedRating,
    formSelectedDifficulty, setFormSelectedDifficulty,
    selectedCategory, setSelectedCategory,
    backupReminderTimeout, setBackupReminderTimeout,
    aiChatMessages, setAiChatMessages,
    aiChatAbortController, setAiChatAbortController,
    aiGeneratedImage, setAiGeneratedImage,
    formRegeneratedImage, setFormRegeneratedImage,
    currentConversationId, setCurrentConversationId,
    conversationHistory, setConversationHistory,
    chatAttachments, setChatAttachments,
    chatClosedAt, setChatClosedAt,
    pendingSuggestedRecipe, setPendingSuggestedRecipe,
    isSharedRecipeMode, setIsSharedRecipeMode,
    CHAT_RESUME_THRESHOLD_MS,
} from './state.js';

console.log('🚀 [main.js] Script loaded successfully!');
console.log('🔗 [main.js] Supabase URL:', supabaseUrl?.substring(0, 30) + '...');

(() => {


    

    function getRecipeIdFromPath() {
        const p = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '';
        if (!p || !p.startsWith('/recipe/')) return null;
        const id = p.slice('/recipe/'.length).split('/')[0].trim();
        return id || null;
    }

    function removeAppChromeForSharedRecipe() {
        document.querySelector('header.header')?.remove();
        document.getElementById('headerUser')?.remove();
        document.getElementById('searchContainer')?.remove();
        document.querySelector('.category-filter-row')?.remove();
        document.querySelector('.floating-actions')?.remove();
        document.querySelector('.grid-selector-wrapper')?.remove();
        document.body.style.paddingTop = '0';
    }

    function handleInitialRoute() {
        const id = getRecipeIdFromPath();
        if (!id) return;
        const index = recipes.findIndex(function(r) { return r && r.id === id; });
        if (index >= 0) showRecipe(index);
    }

    function setAuthGateVisible(visible) {
        const gate = document.getElementById('authGate');
        if (gate) {
            gate.style.display = visible ? 'flex' : 'none';
            gate.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }
        document.body.classList.toggle('auth-locked', visible);
    }
    // Exposed for import-export.js (URL import shows the auth gate when not signed in)
    window.setAuthGateVisible = setAuthGateVisible;

    function resetAppStateForSignOut() {
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

    function setupAuthGateUI() {
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

    let appBootstrapped = false;

    async function bootstrapAuthenticatedApp() {
        if (appBootstrapped) return;
        appBootstrapped = true;
        setAuthGateVisible(false);
        updateAuthHeaderUI(getCurrentUser());
        await loadRecipesAndDisplay();
        initVoiceButton();
    }

    function handleSignedOut() {
        appBootstrapped = false;
        resetAppStateForSignOut();
        updateAuthHeaderUI(null);
        if (!getRecipeIdFromPath()) {
            setAuthGateVisible(true);
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            setupAuthGateUI();
            const sharedRecipeIdEarly = getRecipeIdFromPath();
            if (sharedRecipeIdEarly) removeAppChromeForSharedRecipe();

            await initAuth();

            const sharedRecipeId = getRecipeIdFromPath();
            if (sharedRecipeId) {
                setAuthGateVisible(false);
                await loadRecipesAndDisplay();
                initVoiceButton();
                return;
            }

            if (isAuthenticated()) {
                await bootstrapAuthenticatedApp();
            } else {
                setAuthGateVisible(true);
                updateAuthHeaderUI(null);
            }

            onAuthChange(async (user) => {
                if (getRecipeIdFromPath()) return;
                if (user) {
                    await bootstrapAuthenticatedApp();
                } else {
                    handleSignedOut();
                }
            });
        } catch (error) {
            console.error('שגיאה באתחול:', error);
            alert('שגיאה בטעינת האפליקציה. נא לרענן את הדף.');
        }
    });

    async function loadRecipesAndDisplay() {
        try {
            // בדיקה אם נכנסים דרך קישור משותף למתכון ספציפי
            const sharedRecipeId = getRecipeIdFromPath();
            
            if (sharedRecipeId) {
                // מצב קישור משותף - טען רק את המתכון הספציפי
                console.log('Loading shared recipe:', sharedRecipeId);
                setIsSharedRecipeMode(true); // סמן שזה מצב קישור משותף
                removeAppChromeForSharedRecipe();
                setupPopupCloseOnOverlayClick();

                const recipesContainer = document.getElementById('recipesContainer');
                if (recipesContainer) recipesContainer.style.display = 'none';

                // טען את המתכון הספציפי
                const recipe = await loadPublicRecipeFromDB(sharedRecipeId);
                if (recipe) {
                    setRecipes([recipe]);
                    await migrateLegacyBase64ToStorage();
                    displaySharedRecipeCard();
                } else {
                    alert('המתכון לא נמצא');
                    window.location.href = '/';
                }
                
                return;
            }

            if (!isAuthenticated()) {
                setAuthGateVisible(true);
                return;
            }

            // מצב רגיל - טען את כל המתכונים
            // שלב 1: טעינה מיידית מ-cache (להצגה מהירה)
            const cachedRecipes = loadRecipesFromCache();
            if (!cachedRecipes || cachedRecipes.length === 0) {
                showRecipesLoadingSkeleton();
            }
            const settings = await loadSettings();
            
            if (cachedRecipes && cachedRecipes.length > 0) {
                setRecipes(cachedRecipes);
                filterRecipes();
                updateCategoryList();
                updateCategoryButtons();
                console.log('Loaded', recipes.length, 'recipes from cache');
            }

            // אתחול UI
            document.getElementById('filterRating').innerHTML = generateFilterStars();
            setupBackupReminder(settings.lastBackup);
            setRecipesPerRow(settings.recipesPerRow || 4);
            setupGridSelector();
            applyTimerVisibility(settings.timerVisible);
            initializeTimer(settings, saveSetting);
            setupPopupCloseOnOverlayClick();
            mountFilterPanel();
            initDietaryDropdown();

            // שלב 2: טעינה מהשרת רק אם ה-cache לא תקף
            const loadFromServer = async () => {
                try {
                    const freshRecipes = await loadRecipesFromDB();
                    if (!Array.isArray(freshRecipes)) return;
                    
                    // Merge server data with locally-saved recipes (avoid race: user saved after our SELECT started)
                    const serverIds = new Set((freshRecipes || []).map(r => r && r.id).filter(Boolean));
                    const localOnly = (recipes || []).filter(r => r && r.id && !serverIds.has(r.id));
                    setRecipes([...(freshRecipes || []), ...localOnly]);
                    console.log('[loadFromServer] Merged: ' + (freshRecipes || []).length + ' from server, ' + localOnly.length + ' local-only preserved. Total: ' + recipes.length);
                    await migrateLegacyBase64ToStorage();
                    filterRecipes();
                    updateCategoryList();
                    updateCategoryButtons();
                } catch (err) {
                    console.error('Failed to load from server:', err);
                    const container = document.getElementById('recipesContainer');
                    if (container?.querySelector('.recipe-card-skeleton')) {
                        container.innerHTML =
                            '<div style="text-align:center;padding:2rem;color:#666;">שגיאה בטעינת המתכונים. נא לרענן את הדף.</div>';
                        clearRecipesLoadingState();
                    }
                }
            };

            if (cachedRecipes && cachedRecipes.length > 0 && isCacheValid()) {
                // cache תקף – אין צורך לפנות לשרת
                console.log('[loadRecipesAndDisplay] Cache is fresh, skipping server fetch');
                migrateLegacyBase64ToStorage();
            } else if (cachedRecipes && cachedRecipes.length > 0) {
                // cache קיים אך פג תוקפו – רענן ברקע
                loadFromServer();
            } else {
                // אין cache – חכה לטעינה מהשרת
                await loadFromServer();
            }

            // הוסף event listener רק פעם אחת כדי למנוע הוספה חוזרת
            if (!window.popstateHandlerAdded) {
              window.addEventListener('popstate', function() {
                var p = document.getElementById('popup');
                if (p && p.style.display === 'flex') closePopup();
              });
              window.popstateHandlerAdded = true;
            }
        } catch (error) {
            console.error('שגיאה בטעינת מתכונים:', error);
            setRecipes([]);
            filterRecipes();
            updateCategoryList();
            updateCategoryButtons();
            var fr = document.getElementById('filterRating');
            if (fr) fr.innerHTML = generateFilterStars();
            setupBackupReminder(null);
            setRecipesPerRow(4);
            setupGridSelector();
            applyTimerVisibility(false);
            mountFilterPanel();
            initDietaryDropdown();
            initializeTimer({ timerVisible: false, timerVolume: 80 }, saveSetting);
            setupPopupCloseOnOverlayClick();
            handleInitialRoute();
            // הוסף event listener רק פעם אחת כדי למנוע הוספה חוזרת
            if (!window.popstateHandlerAdded) {
              window.addEventListener('popstate', function() {
                var p = document.getElementById('popup');
                if (p && p.style.display === 'flex') closePopup();
              });
              window.popstateHandlerAdded = true;
            }
        }
    }

    // אובייקט המכיל את תמונות ברירת המחדל לפי קטגוריות
    // ב-Vercel (עם Vite build), התמונות מועתקות מ-assets ל-dist ישירות, אז הנתיב הוא /default-images/...
    window.regenerateImageForForm = regenerateImageForForm;
    window.addIngredientRow = addIngredientRow;
    window.removeIngredientRow = removeIngredientRow;


    // פונקציה לשינוי מספר המתכונים בשורה
    function setRecipesPerRow(number) {
      document.documentElement.style.setProperty('--columns', number);
      // Update grid selector menu active state
      const gridOptions = document.querySelectorAll('.grid-option');
      gridOptions.forEach(option => {
        option.classList.remove('active');
        if (parseInt(option.dataset.cols) === number) {
          option.classList.add('active');
        }
      });
      saveSetting('recipesPerRow', number);
    }

    // פתיחה/סגירה של תפריט בחירת גריד
    function toggleGridSelector() {
      const menu = document.getElementById('grid-selector-menu');
      if (!menu) return;
      
      const isVisible = menu.style.display !== 'none';
      menu.style.display = isVisible ? 'none' : 'flex';
      
      // סגירה בלחיצה מחוץ לתפריט
      if (!isVisible) {
        const closeOnClickOutside = (e) => {
          if (!e.target.closest('.grid-selector-wrapper')) {
            menu.style.display = 'none';
            document.removeEventListener('click', closeOnClickOutside);
          }
        };
        // Delay to prevent immediate close
        setTimeout(() => {
          document.addEventListener('click', closeOnClickOutside);
        }, 0);
      }
    }

    // הגדרת event listeners לכפתורי הגריד
    function setupGridSelector() {
      const gridOptions = document.querySelectorAll('.grid-option');
      gridOptions.forEach(option => {
        option.addEventListener('click', () => {
          const cols = parseInt(option.dataset.cols);
          setRecipesPerRow(cols);
          document.getElementById('grid-selector-menu').style.display = 'none';
        });
      });
    }

    // פונקציה לסגירת חלונות בעת לחיצה על ה-overlay
    function setupPopupCloseOnOverlayClick() {
      const popups = ['popup', 'formPopup', 'confirmPopup', 'aiChatOverlay'];
      popups.forEach(popupId => {
        const popup = document.getElementById(popupId);
        if (!popup) return;
        popup.addEventListener('click', function(event) {
          if (event.target === popup) {
            if (popupId === 'popup') closePopup();
            if (popupId === 'formPopup') closeFormPopup();
            if (popupId === 'confirmPopup') closeConfirmPopup();
            if (popupId === 'aiChatOverlay') closeAiChat();
          }
        });
      });
    }

    // --- צ'אט AI ---
    window.addSuggestedRecipeDirectly = addSuggestedRecipeDirectly;
    window.editSuggestedRecipeFromMsg = editSuggestedRecipeFromMsg;
    window.dismissSuggestedRecipe = dismissSuggestedRecipe;
    // View recipe from chat card
    window.viewRecipeFromChat = function(recipeId) {
      if (!recipeId) return;
      const recipe = recipes.find(r => r.id === recipeId);
      if (recipe) {
        closeAiChat();
        openPopup(recipe);
      }
    };
    window.toggleChatMenu = toggleChatMenu;

    // Dropdown מותאם לסוג תזונה – סנכרון עם ה-select והצגת טקסט

    // חשיפת הפונקציות לחלון הגלובלי כדי שהן יהיו נגישות מ-onclick
    window.openFormPopup = openFormPopup;
    window.closeFormPopup = closeFormPopup;
    window.previewFormImage = previewFormImage;
    window.closePopup = closePopup;
    window.editRecipe = editRecipe;
    window.confirmDeleteRecipe = confirmDeleteRecipe;
    window.deleteRecipe = deleteRecipe;
    window.closeConfirmPopup = closeConfirmPopup;
    window.downloadRecipe = downloadRecipe;
    window.shareRecipe = shareRecipe;
    window.copyRecipeLink = copyRecipeLink;
    window.closeBackupReminder = closeBackupReminder;
    window.filterRecipes = filterRecipes;
    window.filterByCategory = filterByCategory;
    window.resetSearch = resetSearch;
    window.rateRecipe = rateRecipe;
    window.setFilterRating = setFilterRating;
    window.processOCR = processOCR;
    window.importRecipeFromUrl = importRecipeFromUrl;
    window.exportRecipes = exportRecipes;
    window.importRecipes = importRecipes;
    window.downloadAllRecipes = downloadAllRecipes;
    window.toggleFilterPanel = toggleFilterPanel;
    window.toggleGridSelector = toggleGridSelector;
    window.setRecipesPerRow = setRecipesPerRow;
    window.openAiChat = openAiChat;
    window.closeAiChat = closeAiChat;
    window.sendAiMessage = sendAiMessage;
    window.toggleVoiceRecording = toggleVoiceRecording;
    window.regenerateImage = regenerateImage;
    window.startNewConversation = startNewConversation;
    window.goBackToChatHome = goBackToChatHome;
    window.handleChatFileSelect = handleChatFileSelect;

    window.resizeImage = resizeImage;

    // ============================================
    // NEW: Supabase Storage Image Functions
    // ============================================

    // Migrate legacy base64 recipe images to Supabase Storage (one-time per recipe)
    async function migrateLegacyBase64ToStorage() {
        if (!supabase) return;
        const legacy = recipes.filter(r =>
            r && r.id &&
            typeof r.image === 'string' && r.image.startsWith('data:') &&
            !r.imagePath
        );
        if (legacy.length === 0) return;
        console.log(`🔄 [migrateLegacyBase64ToStorage] Migrating ${legacy.length} recipe(s) with base64 images to Storage...`);
        for (const recipe of legacy) {
            try {
                const res = await fetch(recipe.image);
                const blob = await res.blob();
                const mime = blob.type || (recipe.image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg');
                const ext = mime === 'image/png' ? 'png' : 'jpg';
                const file = new File([blob], `migrated-${recipe.id}.${ext}`, { type: mime });
                const imagePath = await uploadImageToStorage(file);
                if (imagePath) {
                    recipe.imagePath = imagePath;
                    recipe.image = null;
                    await saveRecipeToDB(recipe);
                    saveRecipesToCache(recipes);
                    console.log(`  ✅ Migrated image for recipe "${recipe.name}" (id: ${recipe.id})`);
                } else {
                    console.warn(`  ⚠️ Upload failed for recipe "${recipe.name}", keeping base64`);
                }
            } catch (err) {
                console.warn(`  ⚠️ Migration failed for recipe "${recipe.name}":`, err);
            }
        }
    }

    // Make functions available globally (getDefaultImageUrl used in inline onerror in templates)
    window.uploadImageToStorage = uploadImageToStorage;
    window.resizeImageToBlob = resizeImageToBlob;
    window.getImageUrl = getImageUrl;
    window.getImageSrcSet = getImageSrcSet;
    window.getDisplayUrl = getDisplayUrl;
    window.getDefaultImageUrl = getDefaultImageUrl;
    window.migrateLegacyBase64ToStorage = migrateLegacyBase64ToStorage;

    // ============================================
    // END: Supabase Storage Image Functions
    // ============================================

    // ============================================
    // DEBUG: Recipe Image Diagnostics
    // ============================================
    
    async function debugRecipeImage(recipeId) {
        console.log('🔍 Debugging Recipe Image...');
        const recipe = recipes.find(r => r.id === recipeId);
        
        if (!recipe) {
            console.error('❌ Recipe not found with ID:', recipeId);
            return;
        }
        
        console.log('📋 Recipe Info:', {
            id: recipe.id,
            name: recipe.name,
            category: recipe.category
        });
        
        console.log('🖼️ Image Data:');
        console.log('  - imagePath (Storage):', recipe.imagePath || 'None');
        console.log('  - image (legacy):', recipe.image ? `${recipe.image.substring(0, 50)}...` : 'None');
        
        // Check if image exists in Storage
        if (recipe.imagePath) {
            const url = getImageUrl(recipe.imagePath);
            console.log('  - Full URL:', url);
            
            try {
                const response = await fetch(url, { method: 'HEAD' });
                console.log('  - Storage Status:', response.status, response.ok ? '✅ OK' : '❌ Failed');
                
                if (!response.ok) {
                    console.error('  - Image file not found in Storage!');
                    console.log('  - 💡 Solution: Use reuploadRecipeImage() to upload a new image');
                }
            } catch (error) {
                console.error('  - Fetch Error:', error);
            }
        } else if (recipe.image && recipe.image.startsWith('data:')) {
            console.log('  - Using base64 image (legacy format)');
        } else {
            console.log('  - Using default category image');
            console.log('  - Default image:', getDefaultImageUrl(recipe.category));
        }
        
        console.log('✅ Debug complete');
    }
    
    // Function to reupload image for a specific recipe
    async function reuploadRecipeImage(recipeId) {
        const recipe = recipes.find(r => r.id === recipeId);
        if (!recipe) {
            alert('מתכון לא נמצא');
            return;
        }
        
        // Create file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                // Show loading message
                const loadingMsg = document.createElement('div');
                loadingMsg.id = 'upload-loading';
                loadingMsg.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 20px 40px; border-radius: 10px; z-index: 10000; font-size: 18px;';
                loadingMsg.textContent = 'מעלה תמונה...';
                document.body.appendChild(loadingMsg);
                
                // Upload to Storage
                const imagePath = await uploadImageToStorage(file);
                
                if (!imagePath || imagePath.startsWith('data:')) {
                    throw new Error('Upload failed');
                }

                const previousImagePath = recipe.imagePath || null;
                if (previousImagePath && previousImagePath !== imagePath) {
                    await deleteRecipeImageFromStorage(previousImagePath);
                }
                
                // Update recipe
                recipe.imagePath = imagePath;
                recipe.image = null; // Clear legacy base64
                
                // Save to DB
                await saveRecipeToDB(recipe);
                
                // Remove loading and show success
                document.body.removeChild(loadingMsg);
                
                // Refresh display
                filterRecipes();
                
                // If popup is open, refresh it
                const popup = document.getElementById('popup');
                if (popup && popup.style.display === 'flex') {
                    const index = recipes.findIndex(r => r.id === recipeId);
                    if (index >= 0) {
                        showRecipe(index);
                    }
                }
                
                alert('✅ התמונה הועלתה בהצלחה!');
                
            } catch (error) {
                console.error('Error reuploading image:', error);
                const loadingMsg = document.getElementById('upload-loading');
                if (loadingMsg) document.body.removeChild(loadingMsg);
                alert('❌ שגיאה בהעלאת התמונה. נא לנסות שוב.');
            }
        };
        
        input.click();
    }
    
    // Make debug functions globally available
    window.debugRecipeImage = debugRecipeImage;
    window.reuploadRecipeImage = reuploadRecipeImage;


    window.toggleCategoryDropdown = toggleCategoryDropdown;
    window.closeCategoryDropdown = closeCategoryDropdown;
    window.updateCategoryTriggerDisplay = updateCategoryTriggerDisplay;

    window.toggleCategoryInput = toggleCategoryInput;
})();