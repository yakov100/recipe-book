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
import { toggleVoiceRecording, initVoiceButton } from './voice.js';
import { setAuthGateVisible, resetAppStateForSignOut, setupAuthGateUI } from './auth-gate.js';
import { setRecipesPerRow, toggleGridSelector, setupGridSelector } from './grid.js';
import { migrateLegacyBase64ToStorage, debugRecipeImage, reuploadRecipeImage } from './image-maintenance.js';
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

// --- App orchestration (entry module) ---


    

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

    // Exposed for import-export.js (URL import shows the auth gate when not signed in)
    window.setAuthGateVisible = setAuthGateVisible;


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
      const index = recipes.findIndex(r => r.id === recipeId);
      if (index >= 0) {
        closeAiChat();
        showRecipe(index);
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
    
    
    
    // Make debug functions globally available
    window.debugRecipeImage = debugRecipeImage;
    window.reuploadRecipeImage = reuploadRecipeImage;


    window.toggleCategoryDropdown = toggleCategoryDropdown;
    window.closeCategoryDropdown = closeCategoryDropdown;
    window.updateCategoryTriggerDisplay = updateCategoryTriggerDisplay;

    window.toggleCategoryInput = toggleCategoryInput;
