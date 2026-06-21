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
    function renderAiChatMessages() {
      const el = document.getElementById('aiChatMessages');
      if (!el) return;
      el.innerHTML = '';
      
      // Add date separator at the beginning
      const dateSeparator = document.createElement('div');
      dateSeparator.className = 'ai-chat-date-separator';
      dateSeparator.innerHTML = '<span>היום</span>';
      el.appendChild(dateSeparator);
      
      aiChatMessages.forEach(function(m, msgIndex) {
        // Create wrapper for avatar layout
        const wrapper = document.createElement('div');
        wrapper.className = 'ai-chat-msg-wrapper ' + (m.role === 'user' ? 'user' : 'assistant');

        // Create avatar (only for assistant messages)
        if (m.role !== 'user') {
          const avatar = document.createElement('div');
          avatar.className = 'ai-chat-avatar chef';
          avatar.innerHTML = '<img src="' + chefImageUrl('chef-serving.png') + '" alt="שף" class="chef-avatar-img">';
          wrapper.appendChild(avatar);
        }

        // Create content container (message + timestamp)
        const contentContainer = document.createElement('div');
        contentContainer.className = 'ai-chat-msg-content';

        // Create message bubble
        const d = document.createElement('div');
        d.className = 'ai-chat-msg ' + (m.role === 'user' ? 'user' : 'assistant');

        // Add text content (with support for highlighted text)
        const textContent = m.content || '';
        d.innerHTML = '<p class="text-sm leading-relaxed">' + textContent.replace(/\n/g, '<br>') + '</p>';

        // Add attachment thumbnails if present
        if (m.attachments && m.attachments.length > 0) {
          const attachmentsDiv = document.createElement('div');
          attachmentsDiv.className = 'message-attachments';
          m.attachments.forEach(function(att) {
            if (att.type === 'image') {
              const imgContainer = document.createElement('div');
              imgContainer.className = 'message-attachment';
              const img = document.createElement('img');
              img.src = att.data;
              img.alt = att.name || 'תמונה';
              img.onclick = function() { window.open(att.data, '_blank'); };
              imgContainer.appendChild(img);
              attachmentsDiv.appendChild(imgContainer);
            }
          });
          d.appendChild(attachmentsDiv);
        }

        // Add recipe card if present (inside the message bubble)
        if (m.recipeCard) {
          const recipeCard = document.createElement('div');
          recipeCard.className = 'ai-chat-recipe-card';
          recipeCard.innerHTML = `
            <img src="${getDisplayUrl(m.recipeCard) || getDefaultImageUrl(m.recipeCard.category || 'שונות')}" alt="${m.recipeCard.name}" onerror="this.src=getDefaultImageUrl('שונות')">
            <div class="ai-chat-recipe-card-footer" onclick="viewRecipeFromChat('${m.recipeCard.id || ''}')">
              <span>צפה במתכון המלא</span>
              <span class="material-symbols-outlined">arrow_back</span>
            </div>
          `;
          d.appendChild(recipeCard);
        }

        contentContainer.appendChild(d);

        // Suggested recipe preview – standalone card below the message bubble
        if (m.suggestedRecipe && typeof m.suggestedRecipe === 'object') {
          var sr = m.suggestedRecipe;
          var srImg = getDisplayUrl({ imagePath: sr.image_path, image: sr.image });
          var srIngredients = (sr.ingredients || '').replace(/\n/g, '<br>');
          var srInstructions = (sr.instructions || '').replace(/\n/g, '<br>');
          var srCategory = sr.category || 'שונות';
          var isAdded = !!m.recipeAdded;
          const srCard = document.createElement('div');
          srCard.className = 'ai-chat-recipe-confirm';
          srCard.innerHTML = `
            ${srImg ? `<div class="recipe-card-image"><img src="${srImg}" alt="${sr.name || ''}" onerror="this.parentElement.style.display='none'"><div class="recipe-card-category-badge">${srCategory}</div></div>` : ''}
            <div class="recipe-card-body">
              <div class="recipe-card-title">${sr.name || ''}</div>
              ${!srImg ? `<span class="recipe-card-category-inline">${srCategory}</span>` : ''}
              ${srIngredients ? `
                <div class="recipe-card-section open">
                  <div class="recipe-card-section-header" onclick="this.parentElement.classList.toggle('open')">
                    <span><span class="material-symbols-outlined">shopping_basket</span> מצרכים</span>
                    <span class="material-symbols-outlined recipe-card-chevron">expand_more</span>
                  </div>
                  <div class="recipe-card-section-content">${srIngredients}</div>
                </div>` : ''}
              ${srInstructions ? `
                <div class="recipe-card-section">
                  <div class="recipe-card-section-header" onclick="this.parentElement.classList.toggle('open')">
                    <span><span class="material-symbols-outlined">cooking</span> הוראות הכנה</span>
                    <span class="material-symbols-outlined recipe-card-chevron">expand_more</span>
                  </div>
                  <div class="recipe-card-section-content">${srInstructions}</div>
                </div>` : ''}
            </div>
            ${isAdded ? `
              <div class="recipe-confirm-added">
                <span class="material-symbols-outlined">check_circle</span>
                המתכון נוסף לספר!
              </div>
            ` : `
              <div class="recipe-confirm-buttons">
                <button type="button" class="confirm-add-btn" onclick="addSuggestedRecipeDirectly(${msgIndex})">
                  <span class="material-symbols-outlined">add</span>
                  הוסף לספר
                </button>
                <button type="button" class="confirm-edit-btn" onclick="editSuggestedRecipeFromMsg(${msgIndex})">
                  <span class="material-symbols-outlined">edit</span>
                  ערוך
                </button>
                <button type="button" class="confirm-cancel-btn" onclick="dismissSuggestedRecipe(${msgIndex})" aria-label="סגור">
                  <span class="material-symbols-outlined">close</span>
                </button>
              </div>
            `}
          `;
          contentContainer.appendChild(srCard);
        }

        // Add timestamp
        const timeDiv = document.createElement('div');
        timeDiv.className = 'ai-chat-msg-time';
        timeDiv.textContent = formatMessageTime(m.timestamp || new Date());
        contentContainer.appendChild(timeDiv);

        // Assemble wrapper
        wrapper.appendChild(contentContainer);
        el.appendChild(wrapper);
      });

      // pendingSuggestedRecipe confirmation card removed - buttons are now inline in each message

      if (el.scrollTo) {
        requestAnimationFrame(function() {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    }

    // Add suggested recipe to book: try API (generate image + insert), fallback to local save without image
    async function addSuggestedRecipeDirectly(msgIndex) {
      var m = aiChatMessages[msgIndex];
      if (!m || !m.suggestedRecipe) return;
      var sr = m.suggestedRecipe;

      // Show chef cooking avatar while adding
      var msgsEl = document.getElementById('aiChatMessages');
      var addingWrapper = null;
      if (msgsEl) {
        addingWrapper = document.createElement('div');
        addingWrapper.className = 'ai-chat-msg-wrapper assistant';
        addingWrapper.id = 'aiChatAddingToBook';
        var addingAvatar = document.createElement('div');
        addingAvatar.className = 'ai-chat-avatar chef';
        addingAvatar.innerHTML = '<img src="' + chefImageUrl('chef-cooking.png') + '" alt="שף מבשל" class="chef-avatar-img">';
        var addingContent = document.createElement('div');
        addingContent.className = 'ai-chat-msg-content';
        var addingMsg = document.createElement('div');
        addingMsg.className = 'ai-chat-msg assistant loading';
        addingMsg.setAttribute('aria-label', 'מוסיף לספר');
        addingMsg.innerHTML = '<span class="typing-dots">מוסיף לספר...</span>';
        addingContent.appendChild(addingMsg);
        addingWrapper.appendChild(addingAvatar);
        addingWrapper.appendChild(addingContent);
        msgsEl.appendChild(addingWrapper);
        msgsEl.scrollTo({ top: msgsEl.scrollHeight, behavior: 'smooth' });
      }

      function removeAddingIndicator() {
        var el = document.getElementById('aiChatAddingToBook');
        if (el) el.remove();
      }

      var payload = {
        insertSuggestedRecipe: true,
        suggestedRecipe: {
          name: sr.name || '',
          ingredients: sr.ingredients || '',
          instructions: sr.instructions || '',
          category: sr.category || 'שונות',
          source: sr.source || 'נוצר על ידי AI'
        }
      };

      try {
        var addHeaders = await edgeFunctionHeaders();
        if (!addHeaders) {
          removeAddingIndicator();
          alert('נא להתחבר עם Google כדי להוסיף מתכון');
          setAuthGateVisible(true);
          return;
        }
        var res = await fetch(edgeFunctionUrl('recipe-ai'), {
          method: 'POST',
          headers: addHeaders,
          body: JSON.stringify(payload)
        });
        var data = res.ok ? (await res.json().catch(function() { return {}; })) : {};

        if (data && data.insertedRecipeId) {
          removeAddingIndicator();
          // Add the new recipe to the local array and update cache without a full DB refetch
          var newRecipeRow = data.suggestedRecipe || {};
          var newRecipe = {
            id: data.insertedRecipeId,
            name: newRecipeRow.name || sr.name || '',
            source: newRecipeRow.source || sr.source || 'נוצר על ידי AI',
            ingredients: newRecipeRow.ingredients || sr.ingredients || '',
            instructions: newRecipeRow.instructions || sr.instructions || '',
            category: newRecipeRow.category || sr.category || 'שונות',
            dietaryType: null,
            notes: null,
            rating: 0,
            difficulty: null,
            imagePath: newRecipeRow.image_path || null,
            image: null,
            recipeLink: null,
            videoUrl: null,
            preparationTime: null
          };
          if (!Array.isArray(recipes)) setRecipes([]);
          setRecipes(recipes.filter(function(r) { return r && r.id !== data.insertedRecipeId; }));
          recipes.push(newRecipe);
          saveRecipesToCache(recipes);
          m.recipeAdded = true;
          m.addedRecipeId = data.insertedRecipeId;
          if (m.dbId) {
            await updateMessageMetadataInDb(m.dbId, buildMessageMetadata(m));
          }
          setPendingSuggestedRecipe(null);
          renderAiChatMessages();
          filterRecipes();
          updateCategoryList();
          updateCategoryButtons();
          return;
        }
      } catch (apiErr) {
        console.warn('Recipe-ai insert failed, falling back to local save:', apiErr);
      }

      // Fallback: save without image so the recipe is not lost
      try {
        var newRecipe = {
          name: sr.name || '',
          source: sr.source || 'נוצר על ידי AI',
          ingredients: sr.ingredients || '',
          instructions: sr.instructions || '',
          category: sr.category || 'שונות',
          notes: null,
          rating: 0,
          imagePath: null,
          recipeLink: null,
          videoUrl: null
        };
        await saveRecipeToDB(newRecipe);
        recipes.push(newRecipe);
        m.recipeAdded = true;
        m.addedRecipeId = newRecipe.id;
        if (m.dbId) {
          await updateMessageMetadataInDb(m.dbId, buildMessageMetadata(m));
        }
        setPendingSuggestedRecipe(null);
        removeAddingIndicator();
        renderAiChatMessages();
        filterRecipes();
        updateCategoryList();
        updateCategoryButtons();
      } catch (err) {
        removeAddingIndicator();
        console.error('Failed to add recipe directly:', err);
        alert('שגיאה בהוספת המתכון: ' + (err.message || err));
      }
    }
    window.addSuggestedRecipeDirectly = addSuggestedRecipeDirectly;

    // Open form to edit recipe from chat message
    async function editSuggestedRecipeFromMsg(msgIndex) {
      var m = aiChatMessages[msgIndex];
      if (!m || !m.suggestedRecipe) return;
      applySuggestedRecipe(m.suggestedRecipe);
      m.suggestedRecipe = null;
      setPendingSuggestedRecipe(null);
      if (m.dbId) {
        await updateMessageMetadataInDb(m.dbId, buildMessageMetadata(m));
      }
      renderAiChatMessages();
    }
    window.editSuggestedRecipeFromMsg = editSuggestedRecipeFromMsg;

    // Dismiss suggested recipe from chat message
    async function dismissSuggestedRecipe(msgIndex) {
      var m = aiChatMessages[msgIndex];
      if (!m) return;
      m.suggestedRecipe = null;
      setPendingSuggestedRecipe(null);
      if (m.dbId) {
        await updateMessageMetadataInDb(m.dbId, buildMessageMetadata(m));
      }
      renderAiChatMessages();
    }
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

    // --- Chat Conversation Management ---
    async function createNewConversation() {
      const user = getCurrentUser();
      if (!supabase || !user) return null;
      try {
        const { data, error } = await supabase
          .from('chat_conversations')
          .insert({ title: 'שיחה חדשה', user_id: user.id })
          .select('id')
          .single();
        if (error) {
          console.error('Error creating conversation:', error);
          return null;
        }
        return data.id;
      } catch (e) {
        console.error('Error creating conversation:', e);
        return null;
      }
    }

    async function loadConversationHistory() {
      if (!supabase) return [];
      try {
        // Calculate the date 24 hours ago
        const oneDayAgo = new Date();
        oneDayAgo.setHours(oneDayAgo.getHours() - 24);
        const oneDayAgoISO = oneDayAgo.toISOString();

        // Load only conversations from the last 24 hours
        const { data, error } = await supabase
          .from('chat_conversations')
          .select('id, title, updated_at, last_message_preview')
          .gte('updated_at', oneDayAgoISO)
          .order('updated_at', { ascending: false })
          .limit(30);
        if (error) {
          console.error('Error loading conversations:', error);
          return [];
        }
        
        // Also clean up old conversations (older than 24 hours)
        deleteOldConversations();
        
        return data || [];
      } catch (e) {
        console.error('Error loading conversations:', e);
        return [];
      }
    }

    // Delete conversations older than 24 hours
    async function deleteOldConversations() {
      if (!supabase) return;
      try {
        const oneDayAgo = new Date();
        oneDayAgo.setHours(oneDayAgo.getHours() - 24);
        const oneDayAgoISO = oneDayAgo.toISOString();

        // Delete old messages first (due to foreign key constraint)
        await supabase
          .from('chat_messages')
          .delete()
          .lt('created_at', oneDayAgoISO);

        // Then delete old conversations
        await supabase
          .from('chat_conversations')
          .delete()
          .lt('updated_at', oneDayAgoISO);

        console.log('Old conversations cleaned up');
      } catch (e) {
        console.error('Error deleting old conversations:', e);
      }
    }

    function buildMessageMetadata(message) {
      if (!message || typeof message !== 'object') return {};
      var meta = {};
      if (message.suggestedRecipe && typeof message.suggestedRecipe === 'object') {
        meta.suggestedRecipe = message.suggestedRecipe;
      }
      if (message.recipeAdded) meta.recipeAdded = true;
      if (message.addedRecipeId) meta.addedRecipeId = message.addedRecipeId;
      if (message.recipeCard) meta.recipeCard = message.recipeCard;
      return meta;
    }

    function applyMessageMetadata(message, metadata) {
      if (!metadata || typeof metadata !== 'object') return message;
      if (metadata.suggestedRecipe && typeof metadata.suggestedRecipe === 'object') {
        message.suggestedRecipe = metadata.suggestedRecipe;
      }
      if (metadata.recipeAdded) message.recipeAdded = true;
      if (metadata.addedRecipeId) message.addedRecipeId = metadata.addedRecipeId;
      if (metadata.recipeCard) message.recipeCard = metadata.recipeCard;
      return message;
    }

    async function loadConversationMessages(conversationId) {
      if (!supabase) return [];
      try {
        const { data, error } = await supabase
          .from('chat_messages')
          .select('id, role, content, attachments, metadata, created_at')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true });
        if (error) {
          console.error('Error loading messages:', error);
          return [];
        }
        return data || [];
      } catch (e) {
        console.error('Error loading messages:', e);
        return [];
      }
    }

    async function saveMessageToDb(conversationId, role, content, attachments, metadata) {
      if (!supabase || !conversationId) return null;
      try {
        const { data, error } = await supabase.from('chat_messages').insert({
          conversation_id: conversationId,
          role: role,
          content: content,
          attachments: attachments || [],
          metadata: metadata || {}
        }).select('id').single();
        if (error) {
          console.error('Error saving message:', error);
          return null;
        }
        return data ? data.id : null;
      } catch (e) {
        console.error('Error saving message:', e);
        return null;
      }
    }

    async function updateMessageMetadataInDb(messageId, metadata) {
      if (!supabase || !messageId) return;
      try {
        const { error } = await supabase
          .from('chat_messages')
          .update({ metadata: metadata || {} })
          .eq('id', messageId);
        if (error) console.error('Error updating message metadata:', error);
      } catch (e) {
        console.error('Error updating message metadata:', e);
      }
    }

    function showChatView(view) {
      const homeView = document.getElementById('aiChatHomeView');
      const threadView = document.getElementById('aiChatThreadView');
      if (!homeView || !threadView) return;

      const isHome = view === 'home';
      homeView.classList.toggle('ai-chat-view-active', isHome);
      threadView.classList.toggle('ai-chat-view-active', !isHome);

      if (isHome) {
        homeView.setAttribute('aria-hidden', 'false');
        threadView.setAttribute('aria-hidden', 'true');
      } else {
        homeView.setAttribute('aria-hidden', 'true');
        threadView.setAttribute('aria-hidden', 'false');
        updateThreadTitle();
      }
    }

    function updateThreadTitle() {
      const titleEl = document.getElementById('aiChatThreadTitle');
      if (!titleEl) return;

      const conv = conversationHistory.find(function(c) { return c.id === currentConversationId; });
      titleEl.textContent = conv && conv.title ? conv.title : 'שיחה חדשה';
    }

    function renderConversationList() {
      const listEl = document.getElementById('aiChatHistoryList');
      if (!listEl) return;

      listEl.innerHTML = '';

      if (conversationHistory.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'history-empty';
        empty.textContent = 'אין שיחות עדיין — התחילו שיחה חדשה';
        listEl.appendChild(empty);
        return;
      }

      conversationHistory.forEach(function(conv) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'history-item' + (conv.id === currentConversationId ? ' active' : '');
        item.onclick = function() { loadPastConversation(conv.id); };

        const row = document.createElement('div');
        row.className = 'history-item-row';

        const main = document.createElement('div');
        main.className = 'history-item-main';

        const title = document.createElement('div');
        title.className = 'history-item-title';
        title.textContent = conv.title || 'שיחה ללא כותרת';

        const preview = document.createElement('div');
        preview.className = 'history-item-preview';
        preview.textContent = conv.last_message_preview || 'אין הודעות עדיין';

        main.appendChild(title);
        main.appendChild(preview);

        const date = document.createElement('div');
        date.className = 'history-item-date';
        date.textContent = formatRelativeDate(conv.updated_at);

        row.appendChild(main);
        row.appendChild(date);
        item.appendChild(row);
        listEl.appendChild(item);
      });
    }

    async function goBackToChatHome() {
      setConversationHistory(await loadConversationHistory());
      renderConversationList();
      showChatView('home');
    }

    async function loadPastConversation(conversationId) {
      setCurrentConversationId(conversationId);
      const messages = await loadConversationMessages(conversationId);
      setAiChatMessages(messages.map(function(m) {
        var message = {
          role: m.role,
          content: m.content,
          attachments: m.attachments || [],
          timestamp: m.created_at ? new Date(m.created_at) : new Date(),
          dbId: m.id || null
        };
        return applyMessageMetadata(message, m.metadata);
      }));
      renderAiChatMessages();
      renderConversationList();
      showChatView('thread');
      clearAttachmentPreview();

      var input = document.getElementById('aiChatInput');
      if (input) input.focus();
      var sendBtn = document.getElementById('aiChatSend');
      if (sendBtn) sendBtn.disabled = false;
    }

    async function startNewConversation() {
      setCurrentConversationId(await createNewConversation());
      setAiChatMessages([]);
      setChatAttachments([]);

      aiChatMessages.push({
        role: 'assistant',
        content: 'היי! איך אוכל לעזור לך לבשל היום? אני יכול להציע מתכונים, לחפש לפי מצרכים שיש לך בבית, או להמציא מתכון חדש.',
        timestamp: new Date()
      });

      setConversationHistory(await loadConversationHistory());
      renderConversationList();
      renderAiChatMessages();
      clearAttachmentPreview();
      showChatView('thread');

      var input = document.getElementById('aiChatInput');
      if (input) input.focus();
    }

    function toggleChatMenu() {
      // Placeholder for menu functionality
      console.log('Chat menu clicked');
    }
    window.toggleChatMenu = toggleChatMenu;

    // --- File Upload Handling ---
    function handleChatFileSelect(event) {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 5 * 1024 * 1024) {
          alert('הקובץ גדול מדי (מקסימום 5MB)');
          continue;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
          // Resize image before storing
          resizeImageFromDataUrl(e.target.result, 800, 800, function(resizedData) {
            chatAttachments.push({
              type: 'image',
              data: resizedData,
              name: file.name
            });
            renderAttachmentPreviews();
          });
        };
        reader.readAsDataURL(file);
      }

      event.target.value = '';
    }

    function resizeImageFromDataUrl(dataUrl, maxW, maxH, callback) {
      const img = new Image();
      img.onload = function() {
        let w = img.width;
        let h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        callback(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function() {
        callback(dataUrl); // fallback to original
      };
      img.src = dataUrl;
    }

    function renderAttachmentPreviews() {
      const container = document.getElementById('aiChatAttachments');
      if (!container) return;

      if (chatAttachments.length === 0) {
        container.style.display = 'none';
        return;
      }

      container.style.display = 'flex';
      container.innerHTML = '';

      chatAttachments.forEach(function(att, idx) {
        const preview = document.createElement('div');
        preview.className = 'attachment-preview';

        if (att.type === 'image') {
          const img = document.createElement('img');
          img.src = att.data;
          img.alt = att.name || 'תמונה';
          preview.appendChild(img);
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'attachment-remove';
        removeBtn.innerHTML = '&times;';
        removeBtn.onclick = function() {
          chatAttachments.splice(idx, 1);
          renderAttachmentPreviews();
        };
        preview.appendChild(removeBtn);

        container.appendChild(preview);
      });

      // Update attach button state
      const attachBtn = document.getElementById('aiChatAttach');
      if (attachBtn) {
        attachBtn.classList.toggle('has-attachments', chatAttachments.length > 0);
      }
    }

    function clearAttachmentPreview() {
      setChatAttachments([]);
      renderAttachmentPreviews();
    }

    async function openAiChat() {
      if (!isAuthenticated()) {
        setAuthGateVisible(true);
        alert('נא להתחבר עם Google כדי לשוחח עם ה-AI');
        return;
      }
      var ov = document.getElementById('aiChatOverlay');
      if (ov) ov.style.display = 'flex';
      initVoiceButton();

      const shouldResume =
        currentConversationId &&
        aiChatMessages.length > 0 &&
        chatClosedAt &&
        Date.now() - chatClosedAt < CHAT_RESUME_THRESHOLD_MS;

      if (shouldResume) {
        setConversationHistory(await loadConversationHistory());
        renderConversationList();
        showChatView('thread');
        renderAiChatMessages();
        clearAttachmentPreview();
        var resumedInput = document.getElementById('aiChatInput');
        if (resumedInput) resumedInput.focus();
        var resumedSendBtn = document.getElementById('aiChatSend');
        if (resumedSendBtn) resumedSendBtn.disabled = false;
        return;
      }

      setConversationHistory(await loadConversationHistory());
      renderConversationList();
      showChatView('home');
    }

    function closeAiChat() {
      if (aiChatAbortController) {
        aiChatAbortController.abort();
        setAiChatAbortController(null);
      }
      setChatClosedAt(Date.now());
      var ov = document.getElementById('aiChatOverlay');
      if (ov) ov.style.display = 'none';
    }

    // Fallback when Edge Function did not insert to DB: fill form for user to edit and save.
    function applySuggestedRecipe(suggestedRecipe) {
      if (!suggestedRecipe || typeof suggestedRecipe !== 'object') return;
      closeAiChat();
      openFormPopup();
      document.getElementById('recipeName').value = suggestedRecipe.name || '';
      document.getElementById('recipeSource').value = suggestedRecipe.source || '';
      document.getElementById('ingredients').value = suggestedRecipe.ingredients || '';
      populateIngredientRows(suggestedRecipe.ingredients || '');
      document.getElementById('instructions').value = suggestedRecipe.instructions || '';
      var cat = suggestedRecipe.category || 'שונות';
      var sel = document.getElementById('category');
      if (sel) {
        populateCategorySelectAndDropdown();
        if (![].slice.call(sel.options).some(function(o) { return o.value === cat; })) {
          var opt = document.createElement('option');
          opt.value = cat;
          opt.textContent = cat;
          sel.appendChild(opt);
        }
        sel.value = cat;
        updateCategoryTriggerDisplay();
      }
      // Store AI-generated image/path for use when saving
      setAiGeneratedImage(suggestedRecipe.image_path ? { imagePath: suggestedRecipe.image_path } : (suggestedRecipe.image ? suggestedRecipe.image : null));

      var dietary = (typeof suggestedRecipe.dietaryType === 'string' && suggestedRecipe.dietaryType.trim())
        ? suggestedRecipe.dietaryType.trim()
        : (typeof suggestedRecipe.dietary_type === 'string' && suggestedRecipe.dietary_type.trim())
          ? suggestedRecipe.dietary_type.trim()
          : '';
      var dietaryEl = document.getElementById('dietaryType');
      if (dietaryEl) dietaryEl.value = dietary;
    }

    async function sendAiMessage() {
      var input = document.getElementById('aiChatInput');
      var sendBtn = document.getElementById('aiChatSend');
      var msg = (input && input.value) ? input.value.trim() : '';

      // Allow sending with only attachments (no text required)
      if (!msg && chatAttachments.length === 0) return;

      if (!isAuthenticated()) {
        setAuthGateVisible(true);
        alert('נא להתחבר עם Google כדי לשוחח עם ה-AI');
        return;
      }

      var authHeaders = await edgeFunctionHeaders();
      if (!authHeaders) {
        setAuthGateVisible(true);
        alert('נא להתחבר עם Google כדי לשוחח עם ה-AI');
        return;
      }

      if (aiChatAbortController) {
        aiChatAbortController.abort();
      }
      setAiChatAbortController(new AbortController());

      // Build message with attachments
      var userMessage = {
        role: 'user',
        content: msg || (chatAttachments.length > 0 ? '[תמונה]' : ''),
        attachments: chatAttachments.slice(), // copy array
        timestamp: new Date()
      };

      aiChatMessages.push(userMessage);

      // Save user message to database
      if (currentConversationId) {
        var userDbId = await saveMessageToDb(
          currentConversationId,
          'user',
          userMessage.content,
          userMessage.attachments,
          buildMessageMetadata(userMessage)
        );
        if (userDbId) userMessage.dbId = userDbId;
      }

      // Clear inputs
      if (input) input.value = '';
      clearAttachmentPreview();
      renderAiChatMessages();
      if (sendBtn) sendBtn.disabled = true;

      var loadingWrapper = document.createElement('div');
      loadingWrapper.className = 'ai-chat-msg-wrapper assistant';
      loadingWrapper.id = 'aiChatLoading';

      var loadingAvatar = document.createElement('div');
      loadingAvatar.className = 'ai-chat-avatar chef';
      loadingAvatar.innerHTML = '<img src="' + chefImageUrl('chef-typing.png') + '" alt="שף מקליד" class="chef-avatar-img">';

      var loadingContent = document.createElement('div');
      loadingContent.className = 'ai-chat-msg-content';

      var loading = document.createElement('div');
      loading.className = 'ai-chat-msg assistant loading';
      loading.setAttribute('aria-label', 'חושב...');
      loading.innerHTML = '<span class="typing-dots">מעבד...</span>';

      loadingContent.appendChild(loading);
      loadingWrapper.appendChild(loadingAvatar);
      loadingWrapper.appendChild(loadingContent);
      var msgsEl = document.getElementById('aiChatMessages');
      if (msgsEl) {
        msgsEl.appendChild(loadingWrapper);
        msgsEl.scrollTo({ top: msgsEl.scrollHeight, behavior: 'smooth' });
      }

      fetch(edgeFunctionUrl('recipe-ai'), {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ messages: aiChatMessages, recipes: compactRecipes(recipes) }),
        signal: aiChatAbortController.signal
      })
        .then(function(res) { return res.json().then(function(data) { return { res: res, data: data }; }); })
        .then(async function(_ref) {
          var res = _ref.res;
          var data = _ref.data;
          console.log('[AI Chat] Response data:', JSON.stringify(data, null, 2));
          var loadEl = document.getElementById('aiChatLoading');
          if (loadEl) loadEl.remove();
          if (sendBtn) sendBtn.disabled = false;

          var reply = (data && data.reply) ? data.reply : (data && data.error) ? data.error : 'לא התקבלה תשובה.';
          if (res && res.status === 401) {
            reply = 'נא להתחבר עם Google כדי להשתמש ב-AI';
            setAuthGateVisible(true);
          } else if (!reply && res && !res.ok) {
            reply = 'שגיאה מהשרת (' + (res.status || '') + '). נא לבדוק GEMINI_API_KEY ב-Supabase Secrets.';
          }

          var assistantMessage = { role: 'assistant', content: reply, timestamp: new Date() };

          // Attach suggested recipe data to the message for inline display
          if (data && data.suggestedRecipe && typeof data.suggestedRecipe === 'object') {
            assistantMessage.suggestedRecipe = data.suggestedRecipe;
          }

          aiChatMessages.push(assistantMessage);

          // Save assistant message to database (including suggested recipe for history restore)
          if (currentConversationId) {
            var assistantDbId = await saveMessageToDb(
              currentConversationId,
              'assistant',
              reply,
              [],
              buildMessageMetadata(assistantMessage)
            );
            if (assistantDbId) assistantMessage.dbId = assistantDbId;
          }

          renderAiChatMessages();

          var recipeIds = (data && Array.isArray(data.recipeIds)) ? data.recipeIds : [];
          if (data && data.insertedRecipeId) {
            // Recipe was confirmed and inserted to DB
            setPendingSuggestedRecipe(null);
            closeAiChat();
            // Update local array and cache without a full DB refetch
            var aiNewRecipeRow = (data.suggestedRecipe && typeof data.suggestedRecipe === 'object') ? data.suggestedRecipe : {};
            var aiNewRecipe = {
              id: data.insertedRecipeId,
              name: aiNewRecipeRow.name || '',
              source: aiNewRecipeRow.source || 'נוצר על ידי AI',
              ingredients: aiNewRecipeRow.ingredients || '',
              instructions: aiNewRecipeRow.instructions || '',
              category: aiNewRecipeRow.category || 'שונות',
              dietaryType: null,
              notes: null,
              rating: 0,
              difficulty: null,
              imagePath: aiNewRecipeRow.image_path || null,
              image: null,
              recipeLink: null,
              videoUrl: null,
              preparationTime: null
            };
            if (!Array.isArray(recipes)) setRecipes([]);
            setRecipes(recipes.filter(function(r) { return r && r.id !== data.insertedRecipeId; }));
            recipes.push(aiNewRecipe);
            saveRecipesToCache(recipes);
            filterRecipes();
            updateCategoryList();
            updateCategoryButtons();
            var idx = recipes.findIndex(function(r) { return r && r.id === data.insertedRecipeId; });
            if (idx >= 0) showRecipe(idx);
          } else if (data && data.regenerateImageForRecipeId && (data.regeneratedImagePath || data.regeneratedImage)) {
            closeAiChat();
            var idx = recipes.findIndex(function(r) { return r && r.id === data.regenerateImageForRecipeId; });
            if (idx >= 0) {
              var aiImagePath = data.regeneratedImagePath || null;
              if (!aiImagePath && data.regeneratedImage) {
                try {
                  var imgResp = await fetch(data.regeneratedImage);
                  var imgBlob = await imgResp.blob();
                  var imgExt = imgBlob.type === 'image/png' ? 'png' : 'jpg';
                  var imgFile = new File([imgBlob], 'ai-regenerated.' + imgExt, { type: imgBlob.type });
                  aiImagePath = await uploadImageToStorage(imgFile);
                } catch (aiUploadErr) {
                  console.warn('Failed to upload AI regenerated image to Storage:', aiUploadErr);
                }
              }
              const path = data.regeneratedImagePath || aiImagePath;
              const previousImagePath = recipes[idx].imagePath || null;
              if (path) {
                recipes[idx].imagePath = path;
                recipes[idx].image = null;
              } else if (data.regeneratedImage) {
                recipes[idx].imagePath = null;
                recipes[idx].image = data.regeneratedImage;
              }

              if (path && previousImagePath && previousImagePath !== path) {
                await deleteRecipeImageFromStorage(previousImagePath);
              }

              await saveRecipeToDB(recipes[idx]);
              filterRecipes();
              showRecipe(idx);
            }
          } else if (recipeIds.length > 0) {
            var filtered = recipes.filter(function(r) { return r.id && recipeIds.indexOf(r.id) !== -1; });
            displayRecipes(filtered);
          } else if (data && data.suggestedRecipe) {
            // suggestedRecipe is already attached to the assistant message above
            // Re-render to show the inline recipe card with action buttons
            setPendingSuggestedRecipe(data.suggestedRecipe);
            renderAiChatMessages();
          }
        })
        .catch(function(err) {
          if (err && err.name === 'AbortError') return;
          var loadEl = document.getElementById('aiChatLoading');
          if (loadEl) loadEl.remove();
          if (sendBtn) sendBtn.disabled = false;
          aiChatMessages.push({ role: 'assistant', content: 'לא ניתן להתחבר ל-AI. נא לבדוק חיבור וכו\'.', timestamp: new Date() });
          renderAiChatMessages();
        });
    }

    // --- הקלטה קולית: Web Speech (עברית, מדויק) → Gemini fallback ---
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

    function toggleVoiceRecording() {
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
          setAuthGateVisible(true);
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
          setAuthGateVisible(true);
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

    function initVoiceButton() {
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