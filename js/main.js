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
    async function importRecipes(event) {
      const file = event.target.files[0];
      const reader = new FileReader();
      reader.onload = async function(e) {
        try {
          const importedRecipes = JSON.parse(e.target.result);
          let newRecipesCount = 0;
          
          // מיזוג המתכונים החדשים עם הקיימים
          for (const newRecipe of importedRecipes) {
            // Normalization for dietary type (supports dietary_type or dietaryType)
            if (newRecipe && newRecipe.dietaryType == null && typeof newRecipe.dietary_type === 'string') {
              newRecipe.dietaryType = newRecipe.dietary_type;
            }

            // וודא שאין מפתח id קיים בעת ייבוא
            if (newRecipe.id !== undefined) {
              delete newRecipe.id;
            }
            // אין תמונה – getDisplayUrl יתן ברירת מחדל בהצגה; לא שומרים URL ברירת מחדל ב-object
            if (!newRecipe.imagePath && (!newRecipe.image || (typeof newRecipe.image === 'string' && !newRecipe.image.trim()))) {
              newRecipe.image = null;
              newRecipe.imagePath = null;
            }
            
            // בדיקת כפילויות מתקדמת - בודק אם מתכון זהה כבר קיים
            const isDuplicate = recipes.some(existingRecipe => {
              // בדיקת שם
              if (existingRecipe.name !== newRecipe.name) return false;
              
              // בדיקת מצרכים - האם הם זהים ב-100%
              const existingIngredients = existingRecipe.ingredients || '';
              const newIngredients = newRecipe.ingredients || '';
              if (existingIngredients !== newIngredients) return false;
              
              // בדיקת אופן הכנה - האם הוא זהה ב-100%
              const existingInstructions = existingRecipe.instructions || '';
              const newInstructions = newRecipe.instructions || '';
              if (existingInstructions !== newInstructions) return false;
              
              // אם הגענו לכאן, המתכון זהה ב-100%
              return true;
            });
            
            // הוספת המתכון רק אם הוא לא קיים
            if (!isDuplicate) {
              recipes.push(newRecipe);
              newRecipesCount++;
            }
          }

          await saveRecipesToDB(recipes);
          updateCategoryList();
          updateCategoryButtons();
          filterRecipes();
          
          alert(`יובאו ${newRecipesCount} מתכונים חדשים בהצלחה`);
        } catch (e) {
          console.error('Error importing recipes:', e);
          alert('שגיאה בייבוא המתכונים. נא לוודא שהקובץ תקין ולנסות שוב.');
        }
      };
      reader.readAsText(file);
    }

    function copyRecipeLink(index) {
      if (!recipes[index] || !recipes[index].id) {
        alert('לא ניתן להעתיק קישור למתכון שלא נשמר.');
        return;
      }
      var url = (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : '') + '/recipe/' + recipes[index].id;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() { 
          alert('✓ הקישור הועתק ללוח!\n\nעכשיו אפשר לשתף את המתכון עם מישהו אחר.'); 
        }).catch(function() { 
          alert('הקישור למתכון:\n' + url + '\n\nניתן להעתיק ולשתף אותו.'); 
        });
      } else {
        alert('הקישור למתכון:\n' + url + '\n\nניתן להעתיק ולשתף אותו.');
      }
    }

    async function regenerateImage(index) {
      const recipe = recipes[index];
      if (!recipe || !recipe.id) {
        alert('לא ניתן לחדש תמונה למתכון שלא נשמר.');
        return;
      }

      // Show loading state
      const actionButtons = document.querySelectorAll('.action-btn');
      actionButtons.forEach(btn => btn.disabled = true);

      // Create loading indicator with chef character
      const loadingDiv = document.createElement('div');
      loadingDiv.id = 'regenerateLoading';
      loadingDiv.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        gap: 2rem;
      `;
      loadingDiv.innerHTML = `
        <img src="${chefImageUrl('chef-cooking.png')}" alt="שף מבשל" style="width: 250px; max-width: 80vw; height: auto; border-radius: 1.5rem; box-shadow: 0 15px 50px rgba(0,0,0,0.5); animation: bounce 1s ease-in-out infinite;">
        <span style="color: white; font-size: 1.5rem; font-weight: 500; text-align: center;">מייצר תמונה חדשה...</span>
        <style>@keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }</style>
      `;
      document.body.appendChild(loadingDiv);

      try {
        const { data, error: fnError } = await invokeEdgeFunction('regenerate-image', {
          recipeId: recipe.id,
          recipeName: recipe.name,
          category: recipe.category
        });
        if (fnError) {
          throw fnError;
        }

        if (data.success && (data.image_path || data.image)) {
          let imagePath = data.image_path || null;
          if (!imagePath && data.image) {
            try {
              const imgResponse = await fetch(data.image);
              const blob = await imgResponse.blob();
              const ext = blob.type === 'image/png' ? 'png' : 'jpg';
              const file = new File([blob], `regenerated.${ext}`, { type: blob.type });
              imagePath = await uploadImageToStorage(file);
            } catch (uploadErr) {
              console.warn('Failed to upload regenerated image to Storage:', uploadErr);
            }
          }
          const previousImagePath = recipes[index].imagePath;
          if (imagePath) {
            recipes[index].imagePath = imagePath;
            recipes[index].image = null;
          } else if (data.image) {
            recipes[index].imagePath = null;
            recipes[index].image = data.image;
          }

          if (imagePath && previousImagePath && previousImagePath !== imagePath) {
            await deleteRecipeImageFromStorage(previousImagePath);
          }

          // Persist to database
          await saveRecipeToDB(recipes[index]);

          // Refresh the display
          filterRecipes();
          showRecipe(index);

          alert('התמונה עודכנה בהצלחה!');
        } else {
          alert('שגיאה ביצירת תמונה: ' + (data.error || 'שגיאה לא ידועה'));
        }
      } catch (error) {
        console.error('Error regenerating image:', error);
        alert('שגיאה ביצירת תמונה. נסה שוב.');
      } finally {
        // Remove loading indicator
        const loading = document.getElementById('regenerateLoading');
        if (loading) loading.remove();

        // Re-enable buttons
        actionButtons.forEach(btn => btn.disabled = false);
      }
    }

    async function regenerateImageForForm() {
      const name = document.getElementById('recipeName')?.value?.trim();
      const categoryEl = document.getElementById('category');
      const category = (categoryEl && categoryEl.value) ? categoryEl.value : 'שונות';
      if (!name) {
        alert('נא להזין שם מתכון לפני יצירת תמונה.');
        return;
      }

      const recipeId = editingIndex >= 0 && recipes[editingIndex]?.id ? recipes[editingIndex].id : null;

      const loadingDiv = document.createElement('div');
      loadingDiv.id = 'regenerateLoading';
      loadingDiv.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        gap: 2rem;
      `;
      loadingDiv.innerHTML = `
        <img src="${chefImageUrl('chef-cooking.png')}" alt="שף מבשל" style="width: 250px; max-width: 80vw; height: auto; border-radius: 1.5rem; box-shadow: 0 15px 50px rgba(0,0,0,0.5); animation: bounce 1s ease-in-out infinite;">
        <span style="color: white; font-size: 1.5rem; font-weight: 500; text-align: center;">מייצר תמונה חדשה...</span>
        <style>@keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }</style>
      `;
      document.body.appendChild(loadingDiv);

      try {
        const { data, error: fnError } = await invokeEdgeFunction('regenerate-image', {
          recipeId: recipeId,
          recipeName: name,
          category: category
        });
        if (fnError) {
          throw fnError;
        }

        if (data.success && (data.image_path || data.image)) {
          let imagePath = data.image_path || null;
          if (!imagePath && data.image) {
            try {
              const imgResponse = await fetch(data.image);
              const blob = await imgResponse.blob();
              const ext = blob.type === 'image/png' ? 'png' : 'jpg';
              const file = new File([blob], `regenerated.${ext}`, { type: blob.type });
              imagePath = await uploadImageToStorage(file);
            } catch (uploadErr) {
              console.warn('Failed to upload regenerated image to Storage:', uploadErr);
            }
          }
          setFormRegeneratedImage(imagePath ? { imagePath } : (data.image ? { image: data.image } : null));

          const inlinePreview = document.getElementById('inlineImagePreview');
          const inlineImg = document.getElementById('inlinePreviewImg');
          const inlineContent = document.getElementById('inlineImageUploadContent');
          const uploadArea = document.querySelector('.image-upload-area');
          const imageInput = document.getElementById('image');
          const imageUrl = imagePath ? getImageUrl(imagePath) : (data.image || getDefaultImageUrl(category));
          if (inlineImg) inlineImg.src = imageUrl;
          if (inlinePreview) inlinePreview.style.display = 'block';
          if (inlineContent) inlineContent.style.display = 'none';
          if (uploadArea) uploadArea.classList.add('has-image');
          if (imageInput) imageInput.value = '';

          alert('התמונה נוצרה. שמור את המתכון כדי לשמור את התמונה.');
        } else {
          alert('שגיאה ביצירת תמונה: ' + (data.error || 'שגיאה לא ידועה'));
        }
      } catch (error) {
        console.error('Error regenerating image:', error);
        alert('שגיאה ביצירת תמונה. נסה שוב.');
      } finally {
        const loading = document.getElementById('regenerateLoading');
        if (loading) loading.remove();
      }
    }
    window.regenerateImageForForm = regenerateImageForForm;

    function setFormDifficulty(level) {
        setFormSelectedDifficulty(level >= 1 && level <= 3 ? level : 2);
        const bars = document.querySelectorAll('#formDifficultyBars .form-diff-bar');
        const textEl = document.getElementById('formDifficultyText');
        if (!bars.length || !textEl) return;
        bars.forEach((bar, i) => {
            const barLevel = i + 1;
            bar.classList.toggle('form-diff-empty', barLevel > formSelectedDifficulty);
        });
        textEl.textContent = DIFFICULTY_LABELS[formSelectedDifficulty] || 'בינוני';
    }

    function updateFormRatingStars(rating) {
        const stars = document.querySelectorAll('#formRatingStars .form-star');
        stars.forEach((star) => {
            const r = parseInt(star.dataset.rating, 10);
            star.classList.toggle('filled', r <= rating);
        });
    }

    // עדכון הקטגוריות בעת פתיחת הטופס
    function openFormPopup() {
        document.getElementById('formPopup').style.display = 'flex';
        document.getElementById('newCategory').style.display = 'none';
        const toggleBtn = document.getElementById('toggleNewCategory');
        if (toggleBtn) toggleBtn.innerHTML = '<span class="material-symbols-outlined">add</span>';
        // איפוס הטופס
        document.getElementById('recipeForm').reset();
        setEditingIndex(-1);
        setFormSelectedRating(0);
        setFormDifficulty(2);
        updateFormRatingStars(0);
        setAiGeneratedImage(null); // איפוס תמונה שנוצרה ע"י AI
        setFormRegeneratedImage(null); // איפוס תמונה שנוצרה ב"צור תמונה חדשה" בטופס
        
        // עדכון רשימת הקטגוריות (select + dropdown עם אייקונים)
        populateCategorySelectAndDropdown();
        updateCategoryTriggerDisplay();

        // קישור כפתור בחירת קטגוריה – וידוא שהרשימה נפתחת בלחיצה
        const categoryTrigger = document.getElementById('categoryTrigger');
        if (categoryTrigger) {
            categoryTrigger.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                toggleCategoryDropdown();
            };
        }

        // Reset ingredient rows
        const ingContainer = document.getElementById('ingredientsTableRows');
        if (ingContainer) {
          ingContainer.querySelectorAll('.form-ingredient-row').forEach(r => r.remove());
          addIngredientRow();
        }

        // Reset inline image preview
        const inlinePreview = document.getElementById('inlineImagePreview');
        const inlineContent = document.getElementById('inlineImageUploadContent');
        if (inlinePreview) inlinePreview.style.display = 'none';
        if (inlineContent) inlineContent.style.display = '';
        resetImportUrlUI();

        // קישור Enter בשדה ייבוא URL
        const importUrlInput = document.getElementById('importRecipeUrl');
        if (importUrlInput && !importUrlInput.dataset.boundEnter) {
          importUrlInput.dataset.boundEnter = '1';
          importUrlInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              importRecipeFromUrl();
            }
          });
        }
    }

    function closeFormPopup() {
      document.getElementById('formPopup').style.display = 'none';
      document.getElementById('recipeForm').reset();
      setEditingIndex(-1);
      setFormRegeneratedImage(null);
      // Reset image preview
      const previewContainer = document.getElementById('imagePreviewContainer');
      const uploadArea = document.querySelector('.image-upload-area');
      if (previewContainer) {
        previewContainer.style.display = 'none';
        document.getElementById('imagePreview').src = '';
      }
      if (uploadArea) {
        uploadArea.classList.remove('has-image');
      }
    }

    // === Ingredient Row Helpers ===
    const INGREDIENT_UNIT_OPTIONS = ['כפות', 'כוסות', 'גרם', 'יחידה'];
    function addIngredientRow() {
      const container = document.getElementById('ingredientsTableRows');
      if (!container) return;
      const row = document.createElement('div');
      row.className = 'form-ingredient-row';
      row.draggable = true;
      const unitOptions = INGREDIENT_UNIT_OPTIONS.map(u => `<option>${u}</option>`).join('');
      row.innerHTML = `
        <span class="material-symbols-outlined ing-drag-handle">drag_indicator</span>
        <input type="number" class="ing-input ing-input-qty" placeholder="כמות">
        <select class="ing-input ing-input-unit">${unitOptions}</select>
        <input type="text" class="ing-input ing-input-name" placeholder="שמן זית כתית מעולה">
        <button type="button" class="ing-remove-btn" onclick="removeIngredientRow(this)" title="הסר">
          <span class="material-symbols-outlined">delete</span>
        </button>
      `;
      container.appendChild(row);
      row.querySelector('.ing-input-name').focus();
      syncIngredientsToTextarea();
    }
    window.addIngredientRow = addIngredientRow;

    function removeIngredientRow(btn) {
      const row = btn.closest('.form-ingredient-row');
      const container = document.getElementById('ingredientsTableRows');
      // Keep at least one row
      if (container && container.querySelectorAll('.form-ingredient-row').length > 1) {
        row.remove();
      }
      syncIngredientsToTextarea();
    }
    window.removeIngredientRow = removeIngredientRow;

    function syncIngredientsToTextarea() {
      const container = document.getElementById('ingredientsTableRows');
      if (!container) return; // No table UI – keep textarea as-is (user types in textarea)
      const rows = container.querySelectorAll('.form-ingredient-row');
      const lines = [];
      rows.forEach(row => {
        const name = row.querySelector('.ing-input-name')?.value?.trim() || '';
        const unit = row.querySelector('.ing-input-unit')?.value?.trim() || '';
        const qty = row.querySelector('.ing-input-qty')?.value?.trim() || '';
        if (name || unit || qty) {
          let line = '';
          if (qty) line += qty + ' ';
          if (unit) line += unit + ' ';
          line += name;
          lines.push(line.trim());
        }
      });
      const ta = document.getElementById('ingredients');
      if (ta) ta.value = lines.join('\n');
    }

    // Sync on any input/change in ingredient rows
    document.addEventListener('input', function(e) {
      if (e.target.closest && e.target.closest('.form-ingredient-row')) {
        syncIngredientsToTextarea();
      }
    });
    document.addEventListener('change', function(e) {
      if (e.target.closest && e.target.closest('.form-ingredient-row')) {
        syncIngredientsToTextarea();
      }
    });

    // Populate ingredient rows from textarea (for editing existing recipes)
    function populateIngredientRows(text) {
      const container = document.getElementById('ingredientsTableRows');
      if (!container) return;
      // Remove all existing rows
      container.querySelectorAll('.form-ingredient-row').forEach(r => r.remove());
      const lines = (text || '').split('\n').filter(l => l.trim());
      if (lines.length === 0) {
        addIngredientRow();
        return;
      }
      lines.forEach(line => {
        const row = document.createElement('div');
        row.className = 'form-ingredient-row';
        row.draggable = true;
        const unitOptions = INGREDIENT_UNIT_OPTIONS.map(u => `<option>${u}</option>`).join('');
        row.innerHTML = `
          <span class="material-symbols-outlined ing-drag-handle">drag_indicator</span>
          <input type="number" class="ing-input ing-input-qty" placeholder="כמות">
          <select class="ing-input ing-input-unit">${unitOptions}</select>
          <input type="text" class="ing-input ing-input-name" placeholder="שמן זית כתית מעולה">
          <button type="button" class="ing-remove-btn" onclick="removeIngredientRow(this)" title="הסר">
            <span class="material-symbols-outlined">delete</span>
          </button>
        `;
        // Try to parse "qty unit name" pattern
        const match = line.trim().match(/^(\d+[\d\/\.]*\s*)?(\S+\s+)?(.+)$/);
        if (match) {
          row.querySelector('.ing-input-qty').value = (match[1] || '').trim();
          const unitEl = row.querySelector('.ing-input-unit');
          const unitVal = (match[2] || '').trim();
          if (unitVal && INGREDIENT_UNIT_OPTIONS.includes(unitVal)) {
            unitEl.value = unitVal;
          } else if (unitVal) {
            const opt = document.createElement('option');
            opt.value = unitVal;
            opt.textContent = unitVal;
            unitEl.appendChild(opt);
            unitEl.value = unitVal;
          }
          row.querySelector('.ing-input-name').value = (match[3] || '').trim();
        } else {
          row.querySelector('.ing-input-name').value = line.trim();
        }
        container.appendChild(row);
      });
    }

    // Preview image in the form upload area
    function previewFormImage(event) {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
          const previewContainer = document.getElementById('imagePreviewContainer');
          const imagePreview = document.getElementById('imagePreview');
          const uploadArea = document.querySelector('.image-upload-area');

          if (previewContainer && imagePreview) {
            imagePreview.src = e.target.result;
            previewContainer.style.display = 'block';
            if (uploadArea) {
              uploadArea.classList.add('has-image');
            }
          }

          // Also update inline image preview
          const inlinePreview = document.getElementById('inlineImagePreview');
          const inlineImg = document.getElementById('inlinePreviewImg');
          const inlineContent = document.getElementById('inlineImageUploadContent');
          if (inlinePreview && inlineImg) {
            inlineImg.src = e.target.result;
            inlinePreview.style.display = 'block';
            if (inlineContent) inlineContent.style.display = 'none';
          }
        };
        reader.readAsDataURL(file);
      }
    }

    function confirmDeleteRecipe(index) {
      const confirmPopup = document.getElementById('confirmPopup');
      confirmPopup.style.display = 'flex';
      confirmPopup.setAttribute('data-index', index);
    }

    async function deleteRecipe() {
      const confirmPopup = document.getElementById('confirmPopup');
      const index = confirmPopup.getAttribute('data-index');
      const recipeToDelete = recipes[index];
      const recipeId = recipeToDelete?.id;
      
      recipes.splice(index, 1);
      try {
        if (recipeId) {
          await deleteRecipeImageFromStorage(recipeToDelete?.imagePath);
          await deleteRecipeFromDB(recipeId);
        }
        updateCategoryList();
        updateCategoryButtons();
        filterRecipes();
        
        closeConfirmPopup();
      } catch (e) {
        console.error('Error deleting recipe:', e);
        alert('שגיאה במחיקת המתכון. נא לנסות שוב.');
      }
    }

    function closeConfirmPopup() {
      document.getElementById('confirmPopup').style.display = 'none';
    }

    function getExportImageUrl(recipe) {
      const url = getDisplayUrl(recipe);
      if (!url) return '';
      if (url.startsWith('http') || url.startsWith('data:')) return url;
      if (typeof window !== 'undefined' && window.location && window.location.origin) {
        const base = window.location.origin.replace(/\/$/, '');
        return url.startsWith('/') ? base + url : base + '/' + url;
      }
      return url;
    }

    function buildStyledRecipeExportHtml(recipe, options = {}) {
      const showSharedBadge = !!options.showSharedBadge;
      const name = escapeHtml(recipe.name);
      const source = escapeHtml(recipe.source || 'לא ידוע');
      const category = escapeHtml(recipe.category || '--');
      const dietaryType = escapeHtml(recipe.dietaryType || '--');
      const prepTime = recipe.preparationTime ? escapeHtml(recipe.preparationTime) : '--';
      const rating = (recipe.rating || 0).toFixed(1);
      const imageUrl = getExportImageUrl(recipe);
      const defaultImageUrl = getExportImageUrl({ category: recipe.category });

      const ingredientsList = (recipe.ingredients || '').split('\n')
        .filter((line) => line.trim())
        .map((ingredient) => `<li>${escapeHtml(ingredient)}</li>`)
        .join('');

      const stepsList = (recipe.instructions || '').split('\n')
        .filter((line) => line.trim())
        .map((step, i) => `<li><strong>${i + 1}.</strong> ${escapeHtml(step)}</li>`)
        .join('');

      const notesBlock = recipe.notes ? `
            <section class="section">
              <h2 class="section-title notes-title"><span class="icon">💡</span> הערות</h2>
              <div class="section-box notes-box">
                <p>${escapeHtml(recipe.notes).replace(/\n/g, '<br>')}</p>
              </div>
            </section>` : '';

      const linksBlock = [
        recipe.recipeLink ? `<p class="extra-link"><strong>קישור למתכון:</strong> <a href="${escapeHtml(recipe.recipeLink)}">${escapeHtml(recipe.recipeLink)}</a></p>` : '',
        recipe.videoUrl ? `<p class="extra-link"><strong>סרטון:</strong> <a href="${escapeHtml(recipe.videoUrl)}">${escapeHtml(recipe.videoUrl)}</a></p>` : '',
      ].filter(Boolean).join('');

      const linksSection = linksBlock ? `<section class="section links-section">${linksBlock}</section>` : '';

      const sharedBadge = showSharedBadge
        ? '<div class="badge">📤 מתכון משותף</div>'
        : '<div class="badge brand-badge">ספר המתכונים</div>';

      const imageSection = (recipe.imagePath || recipe.image || imageUrl) ? `
          <div class="hero-image">
            <img src="${escapeHtml(imageUrl)}" alt="${name}" onerror="this.onerror=null;this.src='${escapeHtml(defaultImageUrl)}'">
          </div>` : '';

      return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #a7f3d0;
      --accent: #c4b5fd;
      --text: #1e293b;
      --muted: #64748b;
      --bg: #fdfbf7;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 2rem 1rem;
      font-family: 'Outfit', 'Segoe UI', Tahoma, sans-serif;
      background: var(--bg);
      color: var(--text);
      direction: rtl;
    }
    .card {
      max-width: 56rem;
      margin: 0 auto;
      background: #fff;
      border-radius: 1rem;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
    }
    .hero {
      position: relative;
      overflow: hidden;
      padding: 2.5rem 2rem;
      text-align: center;
      background: linear-gradient(90deg, var(--primary), var(--accent));
    }
    .hero::before,
    .hero::after {
      content: '';
      position: absolute;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
    }
    .hero::before {
      width: 8rem;
      height: 8rem;
      top: 0;
      left: 0;
      transform: translate(-50%, -50%);
    }
    .hero::after {
      width: 12rem;
      height: 12rem;
      bottom: 0;
      right: 0;
      transform: translate(33%, 33%);
    }
    .hero-content { position: relative; z-index: 1; }
    .hero-icon { font-size: 3rem; display: block; margin-bottom: 1rem; }
    .hero h1 {
      margin: 0 0 0.5rem;
      font-size: 2.25rem;
      font-weight: 700;
      color: #1e293b;
    }
    .hero .source {
      margin: 0;
      font-size: 1.125rem;
      color: #334155;
    }
    .badge {
      display: inline-block;
      margin-top: 1rem;
      padding: 0.5rem 1.5rem;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.35);
      font-size: 0.875rem;
      font-weight: 600;
      color: #1e293b;
    }
    .hero-image {
      width: 100%;
      height: 20rem;
      overflow: hidden;
    }
    .hero-image img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .content { padding: 2rem; }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    @media (min-width: 640px) {
      .meta-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }
    .meta-card {
      text-align: center;
      padding: 1rem;
      border-radius: 0.75rem;
      background: #f9fafb;
    }
    .meta-card .icon { font-size: 1.75rem; display: block; margin-bottom: 0.5rem; }
    .meta-card .label {
      margin: 0.5rem 0 0.25rem;
      font-size: 0.875rem;
      color: var(--muted);
    }
    .meta-card .value {
      margin: 0;
      font-size: 1rem;
      font-weight: 700;
      color: #1f2937;
    }
    .section { margin-bottom: 2rem; }
    .section-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0 0 1rem;
      font-size: 1.5rem;
      font-weight: 700;
      color: #1f2937;
    }
    .section-box {
      padding: 1.5rem;
      border-radius: 0.75rem;
    }
    .ingredients-box {
      background: #ecfdf5;
      list-style: disc;
      margin: 0;
      padding: 1.5rem 2rem;
    }
    .ingredients-box li { margin-bottom: 0.35rem; color: #374151; }
    .steps-box {
      background: #fff7ed;
      list-style: none;
      margin: 0;
      padding: 1.5rem;
    }
    .steps-box li {
      margin-bottom: 0.75rem;
      color: #374151;
      line-height: 1.6;
    }
    .notes-box { background: #fefce8; }
    .notes-box p { margin: 0; color: #374151; line-height: 1.6; }
    .links-section { padding-top: 0.5rem; border-top: 1px solid #e5e7eb; }
    .extra-link { margin: 0.5rem 0; color: #374151; word-break: break-word; }
    .extra-link a { color: #0f766e; }
    @media print {
      body { padding: 0; background: #fff; }
      .card { box-shadow: none; border-radius: 0; }
    }
  </style>
</head>
<body>
  <article class="card">
    <header class="hero">
      <div class="hero-content">
        <span class="hero-icon" aria-hidden="true">🍽️</span>
        <h1>${name}</h1>
        <p class="source">מקור: ${source}</p>
        ${sharedBadge}
      </div>
    </header>
    ${imageSection}
    <div class="content">
      <div class="meta-grid">
        <div class="meta-card">
          <span class="icon">⏱️</span>
          <p class="label">זמן הכנה</p>
          <p class="value">${prepTime} דקות</p>
        </div>
        <div class="meta-card">
          <span class="icon">📂</span>
          <p class="label">קטגוריה</p>
          <p class="value">${category}</p>
        </div>
        <div class="meta-card">
          <span class="icon">🥗</span>
          <p class="label">סוג תזונה</p>
          <p class="value">${dietaryType}</p>
        </div>
        <div class="meta-card">
          <span class="icon">⭐</span>
          <p class="label">דירוג</p>
          <p class="value">${rating} ⭐</p>
        </div>
      </div>
      <section class="section">
        <h2 class="section-title"><span class="icon">🛒</span> מצרכים</h2>
        <ul class="section-box ingredients-box">${ingredientsList}</ul>
      </section>
      <section class="section">
        <h2 class="section-title"><span class="icon">👨‍🍳</span> שלבי הכנה</h2>
        <ol class="section-box steps-box">${stepsList}</ol>
      </section>
      ${notesBlock}
      ${linksSection}
    </div>
  </article>
</body>
</html>`;
    }

    function downloadRecipe(index) {
      const recipe = recipes[index];
      const content = buildStyledRecipeExportHtml(recipe, { showSharedBadge: isSharedRecipeMode });
      const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${recipe.name}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      closePopup();
    }


    function exportRecipes() {
      const today = new Date();
      const dateStr = today.getFullYear() + '-' + 
                     String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                     String(today.getDate()).padStart(2, '0');
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(recipes));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `גיבוי-מתכונים-${dateStr}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    }

    async function importRecipes(event) {
      const file = event.target.files[0];
      const reader = new FileReader();
      reader.onload = async function(e) {
        try {
          const importedRecipes = JSON.parse(e.target.result);
          let newRecipesCount = 0;
          
          // מיזוג המתכונים החדשים עם הקיימים
          for (const newRecipe of importedRecipes) {
            // וודא שאין מפתח id קיים בעת ייבוא
            if (newRecipe.id !== undefined) {
              delete newRecipe.id;
            }
            // אין תמונה – getDisplayUrl יתן ברירת מחדל בהצגה; לא שומרים URL ברירת מחדל ב-object
            if (!newRecipe.imagePath && (!newRecipe.image || (typeof newRecipe.image === 'string' && !newRecipe.image.trim()))) {
              newRecipe.image = null;
              newRecipe.imagePath = null;
            }
            
            // בדיקת כפילויות מתקדמת - בודק אם מתכון זהה כבר קיים
            const isDuplicate = recipes.some(existingRecipe => {
              // בדיקת שם
              if (existingRecipe.name !== newRecipe.name) return false;
              
              // בדיקת מצרכים - האם הם זהים ב-100%
              const existingIngredients = existingRecipe.ingredients || '';
              const newIngredients = newRecipe.ingredients || '';
              if (existingIngredients !== newIngredients) return false;
              
              // בדיקת אופן הכנה - האם הוא זהה ב-100%
              const existingInstructions = existingRecipe.instructions || '';
              const newInstructions = newRecipe.instructions || '';
              if (existingInstructions !== newInstructions) return false;
              
              // אם הגענו לכאן, המתכון זהה ב-100%
              return true;
            });
            
            // הוספת המתכון רק אם הוא לא קיים
            if (!isDuplicate) {
              recipes.push(newRecipe);
              newRecipesCount++;
            }
          }

          await saveRecipesToDB(recipes);
          updateCategoryList();
          updateCategoryButtons();
          filterRecipes();
          
          alert(`יובאו ${newRecipesCount} מתכונים חדשים בהצלחה`);
        } catch (e) {
          console.error('Error importing recipes:', e);
          alert('שגיאה בייבוא המתכונים. נא לוודא שהקובץ תקין ולנסות שוב.');
        }
      };
      reader.readAsText(file);
    }

    function processOCR(event) {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
          Tesseract.recognize(e.target.result, 'heb', {
            logger: m => console.log(m)
          }).then(({ data: { text } }) => {
            parseOCRText(text);
          });
        };
        reader.readAsDataURL(file);
      }
    }

    function parseOCRText(text) {
      const lines = text.split('\n');
      let ingredients = '';

      lines.forEach(line => {
        ingredients += line.trim() + '\n';
      });

      document.getElementById('ingredients').value = ingredients.trim();
      populateIngredientRows(ingredients.trim());
    }

    function setImportUrlStatus(type, message) {
      const el = document.getElementById('importRecipeUrlStatus');
      if (!el) return;
      el.hidden = !message;
      el.className = 'form-add-recipe-import-url-status' + (type ? ' is-' + type : '');
      el.textContent = message || '';
    }

    function resetImportUrlUI() {
      const urlInput = document.getElementById('importRecipeUrl');
      const btn = document.getElementById('importRecipeUrlBtn');
      if (urlInput) urlInput.value = '';
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        const icon = btn.querySelector('.import-url-btn-icon');
        if (icon) icon.textContent = 'download';
      }
      setImportUrlStatus('', '');
    }

    function setFormCategoryValue(category) {
      if (!category) return;
      populateCategorySelectAndDropdown();
      const select = document.getElementById('category');
      if (!select) return;
      let value = String(category).trim();
      if (!value) return;
      const exists = Array.from(select.options).some(function(opt) { return opt.value === value; });
      if (!exists) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
        const dropdown = document.getElementById('categoryDropdownList');
        if (dropdown) {
          const colorClass = getCategoryColorClass(value);
          const iconHtml = getCategoryIconHtml(value, 'form-category-option-icon ' + colorClass);
          const item = document.createElement('div');
          item.className = 'form-category-option';
          item.setAttribute('data-value', value);
          item.setAttribute('role', 'option');
          item.innerHTML = '<span class="form-category-option-icon-wrap">' + iconHtml + '</span><span class="form-category-option-text">' + value + '</span>';
          item.onclick = function() {
            select.value = value;
            updateCategoryTriggerDisplay();
            closeCategoryDropdown();
          };
          dropdown.appendChild(item);
        }
      }
      select.value = value;
      updateCategoryTriggerDisplay();
    }

    function applyImportedRecipeToForm(recipe) {
      if (!recipe) return;
      document.getElementById('recipeName').value = recipe.name || '';
      document.getElementById('recipeSource').value = recipe.source || '';
      document.getElementById('ingredients').value = recipe.ingredients || '';
      populateIngredientRows(recipe.ingredients || '');
      document.getElementById('instructions').value = recipe.instructions || '';
      document.getElementById('notes').value = recipe.notes || '';
      if (recipe.preparationTime != null && recipe.preparationTime > 0) {
        document.getElementById('preparationTime').value = String(recipe.preparationTime);
      }
      if (recipe.recipeLink) {
        document.getElementById('recipeLink').value = recipe.recipeLink;
      }
      if (recipe.videoUrl) {
        document.getElementById('recipeVideo').value = recipe.videoUrl;
      }
      setFormCategoryValue(recipe.category || 'שונות');

      if (recipe.imageUrl) {
        const inlinePreview = document.getElementById('inlineImagePreview');
        const inlineContent = document.getElementById('inlineImageUploadContent');
        const inlineImg = document.getElementById('inlinePreviewImg');
        const uploadArea = document.querySelector('.form-add-recipe-upload-zone.image-upload-area');
        if (inlineImg && inlinePreview && inlineContent) {
          inlineImg.src = recipe.imageUrl;
          inlinePreview.style.display = 'block';
          inlineContent.style.display = 'none';
          if (uploadArea) uploadArea.classList.add('has-image');
        }
      }

      const basics = document.querySelector('.form-add-recipe-section-basics');
      if (basics && typeof basics.scrollIntoView === 'function') {
        basics.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    function normalizeImportUrl(raw) {
      let value = (raw || '').trim();
      if (!value) return null;
      if (!/^https?:\/\//i.test(value)) {
        value = 'https://' + value.replace(/^\/+/, '');
      }
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return parsed;
      } catch (_) {
        return null;
      }
    }

    async function importRecipeFromUrl() {
      const urlInput = document.getElementById('importRecipeUrl');
      const btn = document.getElementById('importRecipeUrlBtn');
      const rawUrl = (urlInput && urlInput.value ? urlInput.value : '').trim();

      if (!rawUrl) {
        setImportUrlStatus('error', 'הזינו קישור למתכון.');
        if (urlInput) urlInput.focus();
        return;
      }

      const parsed = normalizeImportUrl(rawUrl);
      if (!parsed) {
        setImportUrlStatus('error', 'כתובת לא תקינה. הדביקו קישור מלא, למשל https://example.com/recipe');
        return;
      }
      if (urlInput && urlInput.value.trim() !== parsed.toString()) {
        urlInput.value = parsed.toString();
      }

      const authHeaders = await edgeFunctionHeaders();
      if (!authHeaders) {
        setAuthGateVisible(true);
        setImportUrlStatus('error', 'נא להתחבר כדי לייבא מתכון מאתר.');
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.classList.add('is-loading');
        const icon = btn.querySelector('.import-url-btn-icon');
        if (icon) icon.textContent = 'progress_activity';
      }
      setImportUrlStatus('loading', 'טוען את האתר ומחלץ את המתכון — זה עלול לקחת עד דקה...');

      try {
        const { data, error: fnError } = await invokeEdgeFunction('recipe-ai', {
          importRecipeFromUrl: true,
          url: parsed.toString(),
        });

        if (fnError) {
          console.error('Import recipe from URL – edge function error:', fnError);
          const status = fnError.context?.status ?? fnError.status;
          if (status === 401 || /jwt|unauthorized|401/i.test(fnError.message || '')) {
            setAuthGateVisible(true);
            setImportUrlStatus('error', 'ההתחברות פגה או שאין הרשאה. התחברו מחדש עם Google ונסו שוב.');
          } else {
            setImportUrlStatus('error', fnError.message || 'שגיאה בשרת. נסו שוב בעוד רגע.');
          }
          return;
        }

        if (data && data.success && data.recipe) {
          applyImportedRecipeToForm(data.recipe);
          setImportUrlStatus('success', 'המתכון יובא בהצלחה! בדקו את הפרטים ולחצו "שמירת מתכון".');
        } else {
          setImportUrlStatus('error', (data && data.error) || 'לא הצלחנו לייבא את המתכון. נסו קישור אחר או העתיקו את הטקסט ידנית.');
        }
      } catch (err) {
        console.error('Import recipe from URL failed:', err);
        setImportUrlStatus('error', 'שגיאה בייבוא. בדקו את החיבור ונסו שוב.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('is-loading');
          const icon = btn.querySelector('.import-url-btn-icon');
          if (icon) icon.textContent = 'download';
        }
      }
    }

    function shareRecipe(index) {
      const recipe = recipes[index];
      if (navigator.share) {
        const content = buildStyledRecipeExportHtml(recipe, { showSharedBadge: isSharedRecipeMode });
        const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
        const file = new File([blob], `${recipe.name}.html`, { type: 'text/html' });

        const shareData = {
          title: recipe.name,
          text: `${recipe.name} - ${recipe.source}`,
          files: [file]
        };
        if (recipe.id && typeof window !== 'undefined' && window.location && window.location.origin) {
          shareData.url = window.location.origin + '/recipe/' + recipe.id;
        }

        navigator.share(shareData).then(() => {
          console.log('Shared successfully');
        }).catch((error) => {
          console.error('Error sharing:', error);
        });
      } else {
        alert('שיתוף לא נתמך בדפדפן זה.');
      }
    }

    function setupBackupReminder(lastBackupFromDb) {
      const now = new Date().getTime();
      const twoWeeks = 14 * 24 * 60 * 60 * 1000;
      const lastBackup = lastBackupFromDb != null ? lastBackupFromDb : null;

      if (!lastBackup || now - lastBackup > twoWeeks) showBackupReminder();

      setBackupReminderTimeout(setTimeout(async () => {
        const s = await loadSettings();
        setupBackupReminder(s.lastBackup);
      }, twoWeeks));
    }

    function showBackupReminder() {
      const backupReminder = document.getElementById('backupReminder');
      backupReminder.style.display = 'flex';
    }

    async function closeBackupReminder() {
      const backupReminder = document.getElementById('backupReminder');
      backupReminder.style.display = 'none';
      await saveSetting('lastBackup', new Date().getTime());
      clearTimeout(backupReminderTimeout);
    }

    // פונקציה להורדת כל המתכונים כקובץ HTML
    function downloadAllRecipes() {
      let content = `
          <!DOCTYPE html>
          <html lang="he" dir="rtl">
          <head>
              <meta charset="UTF-8">
              <title>כל המתכונים</title>
              <style>
                  body {
                      font-family: Arial, sans-serif;
                      direction: rtl;
                      padding: 20px;
                      margin: auto;
                      max-width: 800px;
                  }
                  h1 {
                      text-align: center;
                      margin-bottom: 40px;
                  }
                  .recipe {
                      border-bottom: 1px solid #ccc;
                      padding-bottom: 20px;
                      margin-bottom: 20px;
                  }
                  .recipe h2 {
                      margin-top: 0;
                  }
                  img {
                      max-width: 100%;
                      height: auto;
                      border-radius: 8px;
                      display: block;
                      margin: 10px auto;
                  }
                  ul {
                      padding-left: 20px;
                  }
              </style>
          </head>
          <body>
              <h1>כל המתכונים</h1>
      `;

      recipes.forEach(recipe => {
        content += `
            <div class="recipe">
                <h2>${recipe.name} / ${recipe.source}</h2>
                <img src="${getDisplayUrl(recipe)}" alt="תמונה של ${recipe.name}" onerror="this.style.display='none'">
                <p><strong>קטגוריה:</strong> ${recipe.category}</p>
                ${recipe.dietaryType ? `<p><strong>סוג תזונה:</strong> ${recipe.dietaryType}</p>` : ''}
                <p><strong>מצרכים:</strong></p>
                <ul>
                    ${recipe.ingredients.split('\n').map(ingredient => `<li>${ingredient}</li>`).join('')}
                </ul>
                <p><strong>הוראות:</strong></p>
                <ul>
                    ${recipe.instructions.split('\n').map(instruction => `<li>${instruction}</li>`).join('')}
                </ul>
                ${recipe.videoUrl ? `<div class="recipe-video">
                  <iframe width="560" height="315" src="${getYoutubeEmbed(recipe.videoUrl)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                </div>` : ''}
                ${recipe.recipeLink ? `<div class="recipe-link"><strong>קישור למתכון:</strong><br><a href="${recipe.recipeLink}" target="_blank">${recipe.recipeLink}</a></div>` : ''}
                ${recipe.notes ? `<div class="recipe-notes"><strong>הערות:</strong><br>${recipe.notes}</div>` : ''}
            </div>
        `;
      });

      content += `
          </body>
          </html>
      `;

      const blob = new Blob([content], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `כל המתכונים.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

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

    function editRecipe(index) {
      if (!recipes[index]) return;
      
      closePopup();  // סוגרים את חלון הצפייה במתכון
      setFormRegeneratedImage(null); // איפוס תמונה שנוצרה ב"צור תמונה חדשה"
      
      const recipe = recipes[index];
      setEditingIndex(index);

      // עדכון כותרת הטופס
      const formTitle = document.querySelector('.form-popup-content h2');
      if (formTitle) {
        formTitle.textContent = 'עריכת מתכון';
      }

      // מילוי כל השדות מהמתכון הקיים
      document.getElementById('recipeName').value = recipe.name || '';
      document.getElementById('recipeSource').value = recipe.source || '';
      document.getElementById('ingredients').value = recipe.ingredients || '';
      populateIngredientRows(recipe.ingredients || '');
      document.getElementById('instructions').value = recipe.instructions || '';
      document.getElementById('preparationTime').value = recipe.preparationTime || '';
      populateCategorySelectAndDropdown();
      document.getElementById('category').value = recipe.category || 'שונות';
      updateCategoryTriggerDisplay();
      const categoryTriggerEdit = document.getElementById('categoryTrigger');
      if (categoryTriggerEdit) {
          categoryTriggerEdit.onclick = function(e) {
              e.preventDefault();
              e.stopPropagation();
              toggleCategoryDropdown();
          };
      }
      document.getElementById('notes').value = recipe.notes || '';
      document.getElementById('recipeVideo').value = recipe.videoUrl || '';
      document.getElementById('recipeLink').value = recipe.recipeLink || '';
      const dietaryTypeEl = document.getElementById('dietaryType');
      if (dietaryTypeEl) dietaryTypeEl.value = recipe.dietaryType || '';

      setFormSelectedRating(recipe.rating || 0);
      updateFormRatingStars(formSelectedRating);
      setFormDifficulty(recipe.difficulty ?? 2);

      // הצגת התמונה הקיימת בתצוגה מקדימה
      const previewContainer = document.getElementById('imagePreviewContainer');
      const imagePreview = document.getElementById('imagePreview');
      const uploadArea = document.querySelector('.image-upload-area');
      const inlinePreview = document.getElementById('inlineImagePreview');
      const inlineImg = document.getElementById('inlinePreviewImg');
      const inlineContent = document.getElementById('inlineImageUploadContent');

      const imageUrl = getDisplayUrl(recipe);
      if (imagePreview) imagePreview.src = imageUrl;
      if (inlineImg) inlineImg.src = imageUrl;
      if (previewContainer) previewContainer.style.display = 'block';
      if (uploadArea) uploadArea.classList.add('has-image');
      if (inlinePreview) inlinePreview.style.display = 'block';
      if (inlineContent) inlineContent.style.display = 'none';

      // פתיחת הטופס
      document.getElementById('formPopup').style.display = 'flex';
    }

    async function saveRecipe(recipe) {
      if (!recipe || !recipe.name || !recipe.ingredients) {
        console.error('Invalid recipe:', recipe);
        alert('שגיאה: לא ניתן לשמור מתכון ללא שם או מצרכים');
        return;
      }

      try {
        let recipeToSave;
        if (editingIndex === -1) {
          // מתכון חדש
          recipe.rating = 0;
          recipes.push(recipe);
          recipeToSave = recipe;
        } else {
          // עריכת מתכון קיים - שומרים על המידע הקיים
          const existingRecipe = recipes[editingIndex];
          recipes[editingIndex] = {
            ...existingRecipe,  // שמירת כל המידע הקיים
            ...recipe,          // עדכון המידע החדש
            rating: editingIndex >= 0 ? recipes[editingIndex].rating || 0 : 0  // שמירת הדירוג הקיים
          };
          recipeToSave = recipes[editingIndex];
        }

        await saveRecipeToDB(recipeToSave);
        updateCategoryList();
        updateCategoryButtons();
        filterRecipes();
        
        // סגירת הטופס ואיפוס
        document.getElementById('formPopup').style.display = 'none';
        document.getElementById('recipeForm').reset();
        setEditingIndex(-1);
        
        // החזרת כותרת הטופס למצב ההתחלתי
        const formTitle = document.querySelector('.form-popup-content h2');
        if (formTitle) {
          formTitle.textContent = 'הוספת מתכון חדש';
        }
      } catch (e) {
        console.error('Error saving recipe:', e);
        alert('שגיאה: לא ניתן לשמור את הנתונים. נא לנסות שוב או ליצור גיבוי של המתכונים.');
      }
    }

    document.getElementById('recipeForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      console.log('📝 [Form] Submit triggered');

      try {
      // Sync ingredient rows to textarea before reading
      syncIngredientsToTextarea();

      const name = document.getElementById('recipeName').value;
      const source = document.getElementById('recipeSource').value;
      const ingredients = document.getElementById('ingredients').value;
      const instructions = document.getElementById('instructions').value;
      const preparationTime = document.getElementById('preparationTime').value ? parseInt(document.getElementById('preparationTime').value) : null;
      const notes = document.getElementById('notes').value;
      const recipeLink = document.getElementById('recipeLink').value;
      const recipeVideo = document.getElementById('recipeVideo').value;
      const imageFile = document.getElementById('image').files[0];
      const dietaryType = document.getElementById('dietaryType') ? document.getElementById('dietaryType').value : '';
      
      // בדיקת הקטגוריה - מהשדה הרגיל או מהשדה החדש
      let category;
      const newCategoryInput = document.getElementById('newCategory');
      if (newCategoryInput.style.display === 'block') {
        category = newCategoryInput.value.trim();
        if (!category) {
          alert('נא להזין שם קטגוריה');
          return;
        }
      } else {
        category = document.getElementById('category').value;
        if (!category) {
          alert('נא לבחור קטגוריה');
          return;
        }
      }

      if (!name) {
        alert('נא להזין שם מתכון');
        return;
      }

      // Step 1: Handle image upload FIRST (before saving recipe)
      let imagePath = null;
      let imageData = null;
      
      if (imageFile) {
        // New image uploaded - save to Storage
        try {
          console.log('📤 Uploading image to Storage...');
          imagePath = await uploadImageToStorage(imageFile);
          console.log('✅ Image uploaded to Storage:', imagePath);
          
          // Verify upload was successful
          if (!imagePath || imagePath.startsWith('data:')) {
            throw new Error('Upload returned base64 instead of storage path');
          }
        } catch (error) {
          console.error('❌ Failed to upload to Storage:', error);
          
          // Show user-friendly error message
          const shouldContinue = confirm(
            '⚠️ שגיאה בהעלאת התמונה\n\n' +
            'התמונה לא הועלתה בהצלחה לשרת.\n' +
            'המתכון יישמר עם תמונת ברירת מחדל.\n\n' +
            'האם להמשיך בשמירת המתכון?\n' +
            '(תוכל להעלות תמונה מאוחר יותר בעריכת המתכון)'
          );
          
          if (!shouldContinue) {
            return; // Cancel recipe save
          }
          
          imagePath = null; // Will use default image
          console.log('ℹ️ Continuing with default image');
        }
      } else if (editingIndex >= 0 && !formRegeneratedImage) {
        // Editing existing recipe - keep existing image (unless user generated new one in form)
        if (recipes[editingIndex].imagePath) {
          imagePath = recipes[editingIndex].imagePath;
        } else if (recipes[editingIndex].image) {
          imageData = recipes[editingIndex].image;
        }
      } else if (formRegeneratedImage) {
        // תמונה שנוצרה ב"צור תמונה חדשה" בטופס
        if (formRegeneratedImage.imagePath) {
          imagePath = formRegeneratedImage.imagePath;
        } else if (formRegeneratedImage.image) {
          imageData = formRegeneratedImage.image;
        }
        setFormRegeneratedImage(null);
      } else if (aiGeneratedImage) {
        if (typeof aiGeneratedImage === 'object' && aiGeneratedImage.imagePath) {
          imagePath = aiGeneratedImage.imagePath;
        } else if (typeof aiGeneratedImage === 'string') {
          if (aiGeneratedImage.startsWith('http') || aiGeneratedImage.startsWith('data:')) {
            if (aiGeneratedImage.startsWith('http')) {
              imagePath = aiGeneratedImage;
            } else {
              imageData = aiGeneratedImage;
            }
          }
        }
      }
      if (imageData && !imagePath) {
        try {
          const res = await fetch(imageData);
          const blob = await res.blob();
          const file = new File([blob], 'ai-image.png', { type: blob.type || 'image/png' });
          imagePath = await uploadImageToStorage(file);
          if (imagePath) imageData = null;
        } catch (_) {}
      }
      setAiGeneratedImage(null);

      const previousImagePath = editingIndex >= 0 ? (recipes[editingIndex].imagePath || null) : null;
      if (imagePath && previousImagePath && previousImagePath !== imagePath) {
        await deleteRecipeImageFromStorage(previousImagePath);
      }

      const recipe = {
        name,
        source,
        ingredients,
        instructions,
        category,
        dietaryType: dietaryType || null,
        notes,
        preparationTime,
        rating: formSelectedRating,
        difficulty: formSelectedDifficulty,
        image: imageData,
        imagePath: imagePath,
        recipeLink,
        videoUrl: recipeVideo
      };

      // Step 3: Save recipe to DB ONCE
      if (editingIndex >= 0) {
        // Editing existing recipe - merge with existing data
        recipes[editingIndex] = { ...recipes[editingIndex], ...recipe };
        await saveRecipeToDB(recipes[editingIndex]);
        console.log('✅ Recipe updated in DB');
        setEditingIndex(-1);
      } else {
        // New recipe - add to array
        recipes.push(recipe);
        await saveRecipeToDB(recipe);
        console.log('✅ Recipe saved to DB with ID:', recipe.id);
      }

      filterRecipes();
      updateCategoryList();
      updateCategoryButtons();
      closeFormPopup();
      } catch (err) {
        console.error('Error in recipe form submit:', err);
        alert('שגיאה: ' + (err?.message || String(err)));
      }
    });

    // Event listeners for difficulty bars and rating stars in the add/edit form
    (function initFormDifficultyAndRating() {
      const bars = document.getElementById('formDifficultyBars');
      if (bars) {
        bars.addEventListener('click', function(e) {
          const bar = e.target.closest('.form-diff-bar');
          if (!bar) return;
          const level = parseInt(bar.dataset.level, 10);
          if (level >= 1 && level <= 3) setFormDifficulty(level);
        });
      }
      const starsContainer = document.getElementById('formRatingStars');
      if (starsContainer) {
        starsContainer.addEventListener('click', function(e) {
          const star = e.target.closest('.form-star');
          if (!star) return;
          const r = parseInt(star.dataset.rating, 10);
          if (r >= 1 && r <= 5) {
            setFormSelectedRating(r);
            updateFormRatingStars(r);
          }
        });
      }
    })();

    function toggleCategoryInput() {
        const categoryWrap = document.getElementById('categoryDropdownWrap');
        const newCategoryInput = document.getElementById('newCategory');
        const toggleButton = document.getElementById('toggleNewCategory');
        const select = document.getElementById('category');

        if (newCategoryInput.style.display === 'none') {
            if (categoryWrap) categoryWrap.style.display = 'none';
            newCategoryInput.style.display = 'block';
            if (toggleButton) toggleButton.innerHTML = 'חזור לרשימת הקטגוריות';
            if (select) select.required = false;
            newCategoryInput.required = true;
        } else {
            if (categoryWrap) categoryWrap.style.display = '';
            newCategoryInput.style.display = 'none';
            if (toggleButton) toggleButton.innerHTML = '<span class="material-symbols-outlined">add</span>';
            if (select) select.required = true;
            newCategoryInput.required = false;
            newCategoryInput.value = '';
        }
    }

    window.toggleCategoryInput = toggleCategoryInput;
})();