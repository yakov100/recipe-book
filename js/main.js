import { supabase, supabaseUrl, supabaseAnonKey } from './supabase.js';

console.log('🚀 [main.js] Script loaded successfully!');
console.log('🔗 [main.js] Supabase URL:', supabaseUrl?.substring(0, 30) + '...');

(() => {
    let recipes = [];
    let editingIndex = -1;
    let formSelectedRating = 0;
    let formSelectedDifficulty = 2; // 1=קל, 2=בינוני, 3=קשה
    let selectedCategory = null;
    let backupReminderTimeout;
    let aiChatMessages = [];
    let aiChatAbortController = null;
    let aiGeneratedImage = null; // Stores AI-generated image for suggested recipes
    let formRegeneratedImage = null; // { imagePath } or { image } - from "צור תמונה חדשה" in add/edit form
    let currentConversationId = null;
    let conversationHistory = [];
    let chatAttachments = [];
    let pendingSuggestedRecipe = null; // Stores recipe waiting for user confirmation
    let isSharedRecipeMode = false; // Track if loaded via shared link

    // Base URL for static assets (works with Vite base path, e.g. GitHub Pages)
    function chefImageUrl(filename) {
        const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL)
            ? import.meta.env.BASE_URL.replace(/\/$/, '')
            : '';
        return base + '/' + (filename.startsWith('/') ? filename.slice(1) : filename);
    }

    function recipeToRow(r) {
        return {
            name: r.name,
            source: r.source || null,
            ingredients: r.ingredients || '',
            instructions: r.instructions || '',
            category: r.category || 'שונות',
            dietary_type: r.dietaryType || null,
            notes: r.notes || null,
            rating: r.rating ?? 0,
            difficulty: r.difficulty ?? null,
            image_path: r.imagePath || null,
            recipe_link: r.recipeLink || null,
            video_url: r.videoUrl || null,
            preparation_time: r.preparationTime || null
        };
    }

    function rowToRecipe(row) {
        return {
            id: row.id,
            name: row.name,
            source: row.source,
            ingredients: row.ingredients,
            instructions: row.instructions,
            category: row.category,
            dietaryType: row.dietary_type ?? null,
            notes: row.notes,
            rating: row.rating,
            difficulty: row.difficulty ?? null,
            imagePath: row.image_path,
            image: row.image ?? null,
            recipeLink: row.recipe_link,
            videoUrl: row.video_url,
            preparationTime: row.preparation_time
        };
    }

    // Cache keys and version
    const CACHE_KEY = 'recipes_cache';
    const CACHE_META_KEY = 'recipes_cache_meta';
    const CACHE_VERSION_KEY = 'recipes_cache_version';
    const CURRENT_CACHE_VERSION = '1.0.2'; // Update this when cache structure changes
    const CACHE_MAX_AGE = 5 * 60 * 1000; // 5 דקות

    // Category icon and color mappings (must be initialized early so updateCategoryButtons can run)
    const categoryIcons = {
        'כל הקטגוריות': 'restaurant',
        'לחמים': 'bakery_dining',
        'מרקים': 'soup_kitchen',
        'מנה עיקרית': 'dinner_dining',
        'תוספות': 'lunch_dining',
        'סלטים': 'eco',
        'שונות': 'restaurant_menu',
        'עוגות': 'cake',
        'קינוחים': 'icecream',
        'פינוקים': 'cookie'
    };
    const categoryColors = {
        'כל הקטגוריות': 'teal',
        'לחמים': 'amber',
        'מרקים': 'blue',
        'מנה עיקרית': 'red',
        'תוספות': 'purple',
        'סלטים': 'emerald',
        'שונות': 'blue',
        'עוגות': 'amber',
        'קינוחים': 'rose',
        'פינוקים': 'orange'
    };
    
    // Clear old cache if version changed
    (function clearOldCacheIfNeeded() {
        const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY);
        if (cachedVersion !== CURRENT_CACHE_VERSION) {
            console.log('Cache version changed, clearing old cache...');
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(CACHE_META_KEY);
            localStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);
        }
    })();

    // טעינת מתכונים מ-cache
    function loadRecipesFromCache() {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (e) {
            console.warn('Failed to load from cache:', e);
        }
        return null;
    }

    // שמירת מתכונים ל-cache
    function saveRecipesToCache(recipesToCache) {
        try {
            // שמירה ללא תמונות base64 כדי לחסוך מקום, אבל שומרים imagePath
            const lightRecipes = recipesToCache.map(r => ({
                ...r,
                imagePath: r.imagePath || r.image_path
            }));
            localStorage.setItem(CACHE_KEY, JSON.stringify(lightRecipes));
            localStorage.setItem(CACHE_META_KEY, JSON.stringify({ 
                timestamp: Date.now(),
                count: recipesToCache.length 
            }));
        } catch (e) {
            console.warn('Failed to save to cache:', e);
            // אם נכשל (מקום מלא), ננסה לנקות cache ישן
            try {
                localStorage.removeItem(CACHE_KEY);
                localStorage.removeItem(CACHE_META_KEY);
            } catch (e2) { /* ignore */ }
        }
    }

    // בדיקה אם ה-cache עדיין תקף
    function isCacheValid() {
        try {
            const meta = localStorage.getItem(CACHE_META_KEY);
            if (meta) {
                const { timestamp } = JSON.parse(meta);
                return (Date.now() - timestamp) < CACHE_MAX_AGE;
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    // מחיקת מתכון בודד מ-Supabase
    async function deleteRecipeFromDB(recipeId) {
        if (!supabase) throw new Error('Supabase לא אותחל. ודא שסקריפט Supabase נטען.');
        const { error } = await supabase.from('recipes').delete().eq('id', recipeId);
        if (error) throw error;
        // עדכון cache
        saveRecipesToCache(recipes);
    }

    // שמירת/עדכון מתכון בודד ב-Supabase
    async function saveRecipeToDB(recipe) {
        if (!supabase) throw new Error('Supabase לא אותחל. ודא שסקריפט Supabase נטען.');
        
        const row = recipeToRow(recipe);
        if (recipe.id) {
            const { error } = await supabase.from('recipes').update(row).eq('id', recipe.id);
            if (error) {
                console.error('❌ [saveRecipeToDB] Update failed:', error);
                throw error;
            }
        } else {
            const { data, error } = await supabase.from('recipes').insert(row).select('id').single();
            if (error) {
                console.error('❌ [saveRecipeToDB] Insert failed:', error);
                throw error;
            }
            recipe.id = data.id;
        }
        try {
            const { data: savedRecipe, error: fetchError } = await supabase
                .from('recipes')
                .select('id,image_path')
                .eq('id', recipe.id)
                .single();
            if (!fetchError && savedRecipe?.image_path && !recipe.imagePath) {
                recipe.imagePath = savedRecipe.image_path;
            }
        } catch (_) {}
        saveRecipesToCache(recipes);
    }

    // שמירת מתכונים מרובים ל-Supabase (לייבוא/סנכרון מלא)
    async function saveRecipesToDB(recipesToSave) {
        if (!supabase) throw new Error('Supabase לא אותחל. ודא שסקריפט Supabase נטען.');

        const idsToKeep = recipesToSave.map(r => r.id).filter(Boolean);

        // מחיקת רשומות שנמחקו מהמערך
        const { data: existing } = await supabase.from('recipes').select('id');
        const toDelete = (existing || []).filter(e => !idsToKeep.includes(e.id)).map(e => e.id);
        
        // מחיקה במקבץ
        if (toDelete.length > 0) {
            const { error: deleteError } = await supabase.from('recipes').delete().in('id', toDelete);
            if (deleteError) throw deleteError;
        }

        // הפרדה למתכונים קיימים וחדשים
        const toUpdate = recipesToSave.filter(r => r.id);
        const toInsert = recipesToSave.filter(r => !r.id);

        // עדכון במקבץ (אם יש)
        for (const recipe of toUpdate) {
            const row = recipeToRow(recipe);
            await supabase.from('recipes').update(row).eq('id', recipe.id);
        }

        // הוספה במקבץ (אם יש)
        if (toInsert.length > 0) {
            const rows = toInsert.map(recipeToRow);
            const { data, error } = await supabase.from('recipes').insert(rows).select('id');
            if (error) throw error;
            // עדכון ה-IDs החדשים
            data.forEach((row, i) => {
                toInsert[i].id = row.id;
            });
        }
        // עדכון cache
        saveRecipesToCache(recipesToSave);
    }

    // טעינת מתכון בודד מ-Supabase לפי ID
    async function loadSingleRecipeFromDB(recipeId) {
        if (!supabase) throw new Error('Supabase לא אותחל. ודא שסקריפט Supabase נטען.');

        try {
            const { data, error } = await supabase
                .from('recipes')
                .select('*')
                .eq('id', recipeId)
                .single();

            if (error) throw error;
            return data ? rowToRecipe(data) : null;
        } catch (err) {
            console.warn('Failed to load single recipe:', err);
            return null;
        }
    }

    // טעינת מתכונים מ-Supabase
    async function loadRecipesFromDB() {
        if (!supabase) throw new Error('Supabase לא אותחל. ודא שסקריפט Supabase נטען.');

        const { data, error } = await supabase
            .from('recipes')
            .select('id,name,source,ingredients,instructions,category,dietary_type,notes,rating,difficulty,recipe_link,video_url,preparation_time,image_path,created_at')
            .order('created_at', { ascending: true });

        if (error) {
            console.error('❌ [loadRecipesFromDB] Failed to load:', error);
            throw error;
        }
        const loadedRecipes = (data || []).map(rowToRecipe);
        saveRecipesToCache(loadedRecipes);
        return loadedRecipes;
    }

    // טעינת והגדרת ההגדרות (מחליף localStorage)
    async function loadSettings() {
        if (!supabase) {
            const storedVol = localStorage.getItem('timerVolume');
            const v = storedVol != null ? parseFloat(storedVol) : 80;
            return { lastBackup: null, recipesPerRow: 4, timerVisible: false, timerVolume: Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 80 };
        }

        const { data } = await supabase.from('recipe_book_settings').select('key, value');
        const m = (data || []).reduce((a, r) => { a[r.key] = r.value; return a; }, {});

        // מיגרציה: lastBackup מ-localStorage ל-DB
        if (m.lastBackup == null) {
            const v = localStorage.getItem('lastBackup');
            if (v) {
                const num = parseInt(v, 10);
                if (!isNaN(num)) { m.lastBackup = num; await saveSetting('lastBackup', num); localStorage.removeItem('lastBackup'); }
            }
        }

        return {
            lastBackup: m.lastBackup ?? null,
            recipesPerRow: m.recipesPerRow || 4,
            timerVisible: m.timerVisible === true,
            timerVolume: Math.min(100, Math.max(0, parseFloat(m.timerVolume)) || 80)
        };
    }

    async function saveSetting(key, value) {
        if (!supabase) return;
        await supabase.from('recipe_book_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    }

    function applyTimerVisibility(visible) {
        const widget = document.getElementById('timer-widget');
        if (!widget) return;
        if (visible) {
            widget.classList.add('is-open');
        } else {
            widget.classList.remove('is-open');
        }
    }

    function getRecipeIdFromPath() {
        const p = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '';
        if (!p || !p.startsWith('/recipe/')) return null;
        const id = p.slice('/recipe/'.length).split('/')[0].trim();
        return id || null;
    }

    function handleInitialRoute() {
        const id = getRecipeIdFromPath();
        if (!id) return;
        const index = recipes.findIndex(function(r) { return r && r.id === id; });
        if (index >= 0) showRecipe(index);
    }

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            await loadRecipesAndDisplay();
        } catch (error) {
            console.error('שגיאה באתחול:', error);
            alert('שגיאה בטעינת המתכונים. נא לרענן את הדף.');
        }
    });

    async function loadRecipesAndDisplay() {
        try {
            // בדיקה אם נכנסים דרך קישור משותף למתכון ספציפי
            const sharedRecipeId = getRecipeIdFromPath();
            
            if (sharedRecipeId) {
                // מצב קישור משותף - טען רק את המתכון הספציפי
                console.log('Loading shared recipe:', sharedRecipeId);
                isSharedRecipeMode = true; // סמן שזה מצב קישור משותף
                const settings = await loadSettings();
                
                // אתחול UI בסיסי
                document.getElementById('filterRating').innerHTML = generateFilterStars();
                setRecipesPerRow(settings.recipesPerRow || 4);
                setupGridSelector();
                applyTimerVisibility(settings.timerVisible);
                initializeTimer(settings);
                setupPopupCloseOnOverlayClick();
                
                // הסתר את רשימת המתכונים והפילטרים
                const recipesContainer = document.getElementById('recipesContainer');
                if (recipesContainer) recipesContainer.style.display = 'none';
                const searchContainer = document.getElementById('searchContainer');
                if (searchContainer) searchContainer.style.display = 'none';
                const categoryFilter = document.querySelector('.category-filter-row');
                if (categoryFilter) categoryFilter.style.display = 'none';
                const floatingActions = document.querySelector('.floating-actions');
                if (floatingActions) floatingActions.style.display = 'none';
                const gridSelector = document.querySelector('.grid-selector-wrapper');
                if (gridSelector) gridSelector.style.display = 'none';
                
                // טען את המתכון הספציפי
                const recipe = await loadSingleRecipeFromDB(sharedRecipeId);
                if (recipe) {
                    recipes = [recipe];
                    await migrateLegacyBase64ToStorage();
                    displaySharedRecipeCard();
                } else {
                    alert('המתכון לא נמצא');
                    window.location.href = '/';
                }
                
                return; // סיים כאן - לא צריך לטעון את כל המתכונים
            }
            
            // מצב רגיל - טען את כל המתכונים
            // שלב 1: טעינה מיידית מ-cache (להצגה מהירה)
            const cachedRecipes = loadRecipesFromCache();
            const settings = await loadSettings();
            
            if (cachedRecipes && cachedRecipes.length > 0) {
                recipes = cachedRecipes;
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
            initializeTimer(settings);
            setupPopupCloseOnOverlayClick();
            initDietaryDropdown();

            // שלב 2: טעינה מהשרת (תמיד, כדי לקבל תמונות ועדכונים)
            const loadFromServer = async () => {
                try {
                    const freshRecipes = await loadRecipesFromDB();
                    if (!Array.isArray(freshRecipes)) return;
                    
                    // Merge server data with locally-saved recipes (avoid race: user saved after our SELECT started)
                    const serverIds = new Set((freshRecipes || []).map(r => r && r.id).filter(Boolean));
                    const localOnly = (recipes || []).filter(r => r && r.id && !serverIds.has(r.id));
                    recipes = [...(freshRecipes || []), ...localOnly];
                    console.log('[loadFromServer] Merged: ' + (freshRecipes || []).length + ' from server, ' + localOnly.length + ' local-only preserved. Total: ' + recipes.length);
                    await migrateLegacyBase64ToStorage();
                    filterRecipes();
                    updateCategoryList();
                    updateCategoryButtons();
                } catch (err) {
                    console.error('Failed to load from server:', err);
                }
            };

            if (cachedRecipes && cachedRecipes.length > 0) {
                // אם יש cache, טען מהשרת ברקע
                loadFromServer();
            } else {
                // אם אין cache, חכה לטעינה מהשרת
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
            recipes = [];
            filterRecipes();
            updateCategoryList();
            updateCategoryButtons();
            var fr = document.getElementById('filterRating');
            if (fr) fr.innerHTML = generateFilterStars();
            setupBackupReminder(null);
            setRecipesPerRow(4);
            setupGridSelector();
            applyTimerVisibility(false);
            initDietaryDropdown();
            initializeTimer({ timerVisible: false, timerVolume: 80 });
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
    const defaultImagesByCategory = {
        'לחמים': [
            '/default-images/breads/1.jpg',
            '/default-images/breads/2.jpg',
            '/default-images/breads/3.jpg'
        ],
        'מרקים': [
            '/default-images/soups/1.jpg',
            '/default-images/soups/2.jpg',
            '/default-images/soups/3.jpg'
        ],
        'מנה עיקרית': [
            '/default-images/main-dishes/1.jpg',
            '/default-images/main-dishes/2.jpg',
            '/default-images/main-dishes/3.jpg'
        ],
        'תוספות': [
            '/default-images/sides/1.jpg',
            '/default-images/sides/2.jpg',
            '/default-images/sides/3.jpg'
        ],
        'סלטים': [
            '/default-images/salads/1.jpg',
            '/default-images/salads/2.jpg',
            '/default-images/salads/3.jpg'
        ],
        'שונות': [
            '/default-images/other/1.jpg',
            '/default-images/other/2.jpg',
            '/default-images/other/3.jpg'
        ],
        'עוגות': [
            '/default-images/cakes/1.jpg',
            '/default-images/cakes/2.jpg',
            '/default-images/cakes/3.jpg'
        ],
        'קינוחים': [
            '/default-images/desserts/1.jpg',
            '/default-images/desserts/2.jpg',
            '/default-images/desserts/3.jpg'
        ]
    };

    const DEFAULT_IMAGES_OTHER = ['/default-images/other/1.jpg', '/default-images/other/2.jpg', '/default-images/other/3.jpg'];

    /** Returns a default image URL for the given category (single entry point for default images). */
    function getDefaultImageUrl(category) {
        const list = (category && defaultImagesByCategory[category]) ? defaultImagesByCategory[category] : DEFAULT_IMAGES_OTHER;
        const path = list[Math.floor(Math.random() * list.length)];
        return chefImageUrl(path);
    }

    function getYoutubeEmbed(videoUrl) {
        if (!videoUrl) return '';
        var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        var match = videoUrl.match(regExp);
        if (match && match[7].length === 11) {
          return 'https://www.youtube.com/embed/' + match[7];
        }
        return '';
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

    function displayRecipes(recipesToShow) {
      const container = document.getElementById('recipesContainer');
      container.innerHTML = '';

      updateFilterHeaderUI(getActiveFiltersFromUI(), Array.isArray(recipesToShow) ? recipesToShow.length : 0);

      console.log('📚 [displayRecipes] Called with', recipesToShow?.length || 0, 'recipes');

      if (!Array.isArray(recipesToShow)) {
        console.error('❌ [displayRecipes] Invalid recipes array:', recipesToShow);
        return;
      }

      if (recipesToShow.length === 0) {
        console.warn('⚠️ [displayRecipes] No recipes to display');
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #666;">אין מתכונים להצגה</div>';
        return;
      }

      recipesToShow.forEach((recipe, index) => {
        if (!recipe || !recipe.name) {
          console.error('Invalid recipe at index', index, recipe);
          return;
        }

        // מצא את האינדקס האמיתי במערך המקורי
        const actualIndex = recipes.indexOf(recipe);
        console.log('Recipe:', recipe.name, 'filtered index:', index, 'actual index:', actualIndex);

        const card = document.createElement('div');
        card.className = 'recipe-card';
        card.onclick = () => showRecipe(actualIndex);

        // תמונת המתכון – נקודת כניסה אחת: getDisplayUrl(recipe)
        const img = document.createElement('img');
        img.className = 'recipe-card-image';
        img.loading = 'lazy';
        const imageUrl = getDisplayUrl(recipe);
        console.log(`🖼️ [${recipe.name}] Image URL:`, imageUrl, 'imagePath:', recipe.imagePath);
        img.src = imageUrl;
        img.alt = recipe.name;
        card.classList.add('image-loading');
        img.onload = function() {
            card.classList.remove('image-loading');
            card.classList.add('image-loaded');
        };
        img.onerror = function() {
            card.classList.remove('image-loading');
            const fallback = getDefaultImageUrl(recipe.category);
            if (this.src !== fallback) {
                this.src = fallback;
                card.classList.add('using-default-image');
            } else {
                this.style.display = 'none';
                this.onerror = null;
            }
        };
        
        // Add load event for fade-in animation
        img.addEventListener('load', function() {
            this.classList.add('loaded');
        });
        
        card.appendChild(img);

        // Create recipe info overlay
        const infoOverlay = document.createElement('div');
        infoOverlay.className = 'recipe-info-overlay';
        
        // Add recipe name
        const recipeName = document.createElement('h3');
        recipeName.className = 'recipe-name';
        recipeName.textContent = recipe.name;
        infoOverlay.appendChild(recipeName);
        
        // Add recipe source if exists
        if (recipe.source) {
            const recipeSource = document.createElement('p');
            recipeSource.className = 'recipe-source';
            recipeSource.textContent = recipe.source;
            infoOverlay.appendChild(recipeSource);
        }
        
        card.appendChild(infoOverlay);

        // כפתורי הפעולה (ערוך, שתף, מחק וכו') מוצגים רק בחלון המתכון (popup) – לא על הכרטיס בדף הראשי

        // הוספת הכרטיס למיכל
        container.appendChild(card);
        console.log('Added recipe card:', recipe.name);
      });
    }

    function showRecipe(index) {
      const recipe = recipes[index];
      const popup = document.getElementById('popup');
      const popupBody = document.getElementById('popupBody');
      
      popup.classList.add('visible');
      document.documentElement.classList.add('modal-open');
      document.body.classList.add('modal-open');
      
      // Calculate rating display
      const currentRating = recipe.rating || 0;
      let ratingStars = '';
      for (let i = 1; i <= 5; i++) {
        const starClass = i <= currentRating ? 'text-yellow-500 fill-current' : 'text-gray-300';
        ratingStars += `<span class="material-symbols-outlined text-[16px] ${starClass}" onclick="rateRecipe(${index}, ${i})">star</span>`;
      }

      // Difficulty display (1=קל, 2=בינוני, 3=קשה)
      const currentDifficulty = recipe.difficulty >= 1 && recipe.difficulty <= 3 ? recipe.difficulty : 2;
      const difficultyLabel = DIFFICULTY_LABELS[currentDifficulty] || 'בינוני';
      let difficultyBarsHtml = '';
      for (let i = 1; i <= 3; i++) {
        const barClass = i <= currentDifficulty ? 'text-orange-400 fill-current' : 'text-gray-300';
        difficultyBarsHtml += `<span class="material-symbols-outlined text-[14px] ${barClass}">star</span>`;
      }

      // Generate ingredients list with checkboxes
      const ingredientsList = recipe.ingredients.split('\n').map((ingredient, i) => {
        if (!ingredient.trim()) return '';
        return `
          <label class="custom-checkbox-item">
            <input class="hidden peer" type="checkbox"/>
            <div class="checkbox-box">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" stroke-width="4"></path></svg>
            </div>
            <span class="ingredient-text">${ingredient}</span>
          </label>
        `;
      }).join('');

      // Generate steps list
      const stepsList = recipe.instructions.split('\n').map((step, i) => {
        if (!step.trim()) return '';
        return `
          <div class="step-item">
            <span class="step-number">${i + 1}</span>
            <p class="step-text">${step}</p>
          </div>
        `;
      }).join('');

      popupBody.innerHTML = `
        <button class="close-popup-floating" onclick="closePopup()">
            <span class="material-symbols-outlined">close</span>
        </button>
        <div class="recipe-full">
          <!-- Image Section (Left) -->
          <div class="recipe-image-section">
            <div class="recipe-actions-row recipe-actions-above-image">
              <button class="recipe-action-btn" onclick="editRecipe(${index})" title="ערוך">
                <span class="material-symbols-outlined">edit</span>
              </button>
              <button class="recipe-action-btn" onclick="confirmDeleteRecipe(${index})" title="מחק">
                <span class="material-symbols-outlined">delete</span>
              </button>
              <button class="recipe-action-btn" onclick="copyRecipeLink(${index})" title="העתק קישור">
                <span class="material-symbols-outlined">link</span>
              </button>
              <button class="recipe-action-btn" onclick="shareRecipe(${index})" title="שתף">
                <span class="material-symbols-outlined">share</span>
              </button>
              <button class="recipe-action-btn" onclick="downloadRecipe(${index})" title="הורד">
                <span class="material-symbols-outlined">download</span>
              </button>
            </div>
            <img 
              loading="lazy"
              class="recipe-popup-image"
              src="${getDisplayUrl(recipe)}" 
              alt="${recipe.name}" 
              onerror="this.src=getDefaultImageUrl('${recipe.category}'); this.removeAttribute('srcset');"
              onload="this.classList.add('loaded')">
            <div class="recipe-image-overlay"></div>
            <div class="recipe-image-content">
              <span class="recipe-category-badge">${recipe.category}</span>
            </div>
          </div>

          <!-- Content Section (Right) -->
          <div class="recipe-content-section">
            <!-- Sticky Header -->
            <div class="recipe-content-header">
              <div class="recipe-header-info">
                <div class="recipe-title-row">
                  <h1 class="recipe-main-title">${recipe.name}</h1>
                  <div class="recipe-title-rating recipe-rating-stars" title="דירוג ${currentRating.toFixed(1)}">
                    ${ratingStars}
                  </div>
                </div>
                <p class="recipe-source-link">מקור: <a href="${recipe.recipeLink || '#'}" target="_blank">${recipe.source || 'לא ידוע'}</a></p>
              </div>
            </div>

            <!-- Scrollable Content -->
            <div class="recipe-scroll-content">
              <!-- Meta Grid -->
              <div class="recipe-meta-grid">
                <div class="meta-item">
                  <span class="material-symbols-outlined meta-icon">schedule</span>
                  <span class="meta-label">זמן הכנה</span>
                  <span class="meta-value">${recipe.preparationTime || '--'} דקות</span>
                </div>
                <div class="meta-item">
                  <span class="material-symbols-outlined meta-icon" style="color: #fb923c;">star</span>
                  <span class="meta-label">רמת קושי</span>
                  <div class="flex items-center gap-0.5" title="${difficultyLabel}">
                    ${difficultyBarsHtml}
                  </div>
                  <span class="meta-value meta-value-difficulty">${difficultyLabel}</span>
                </div>
                <div class="meta-item">
                  <span class="material-symbols-outlined meta-icon" style="color: #60a5fa;">category</span>
                  <span class="meta-label">קטגוריה</span>
                  <span class="meta-value">${recipe.category}</span>
                </div>
                <div class="meta-item">
                  <span class="material-symbols-outlined meta-icon" style="color: #10b981;">restaurant</span>
                  <span class="meta-label">סוג תזונה</span>
                  <span class="meta-value">${recipe.dietaryType || '--'}</span>
                </div>
              </div>

              <!-- Main Grid Layout -->
              <div class="recipe-grid-layout">
                <!-- Ingredients -->
                <section>
                  <h3 class="section-title">
                    <span class="material-symbols-outlined">shopping_basket</span>
                    מצרכים
                  </h3>
                  <div class="ingredients-list-styled">
                    ${ingredientsList}
                  </div>
                </section>

                <!-- Steps -->
                <section>
                  <h3 class="section-title">
                    <span class="material-symbols-outlined">cooking</span>
                    שלבי הכנה
                  </h3>
                  <div class="steps-list-styled">
                    ${stepsList}
                  </div>
                </section>
              </div>

              <!-- Video Section -->
              ${recipe.videoUrl ? `
              <section class="video-section">
                <h3 class="section-title">
                  <span class="material-symbols-outlined" style="color: #ef4444;">play_circle</span>
                  מדריך וידאו
                </h3>
                <div class="video-container-styled">
                  <iframe src="${getYoutubeEmbed(recipe.videoUrl)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                </div>
              </section>
              ` : ''}

              <!-- Notes Section -->
              ${recipe.notes ? `
              <section class="notes-section">
                <h3 class="notes-title">
                  <span class="material-symbols-outlined">description</span>
                  הערות השף (Notes)
                </h3>
                <div class="notes-text">
                  ${recipe.notes.replace(/\n/g, '<br>')}
                </div>
              </section>
              ` : ''}

              <!-- External Link -->
              ${recipe.recipeLink ? `
              <section class="original-link-section">
                <div class="link-box">
                  <span class="material-symbols-outlined text-gray-400">link</span>
                  <span class="text-sm font-medium text-gray-600 dark:text-gray-300">למתכון המלא באתר המקור:</span>
                  <a href="${recipe.recipeLink}" target="_blank" class="text-sm font-bold text-primary hover:underline" style="color: var(--primary-color);">קישור למקור</a>
                </div>
              </section>
              ` : ''}
              
              <div class="h-12"></div>
            </div>

          </div>
        </div>
      `;
      
      popup.style.display = 'flex';
      if (recipe && recipe.id && typeof history !== 'undefined' && history.pushState) {
        history.pushState({}, '', '/recipe/' + recipe.id);
      }
    }

    function closePopup() {
      const popup = document.getElementById('popup');
      
      // אם נכנסנו דרך קישור משותף, הצג את המתכון בכרטיס
      if (isSharedRecipeMode) {
        popup.classList.remove('visible');
        popup.style.display = 'none';
        document.documentElement.classList.remove('modal-open');
        document.body.classList.remove('modal-open');
        displaySharedRecipeCard();
        return;
      }
      
      // מצב רגיל - סגירת פופאפ
      if (typeof location !== 'undefined' && location.pathname && location.pathname.startsWith('/recipe/') && typeof history !== 'undefined' && history.replaceState) {
        history.replaceState({}, '', '/');
      }
      popup.classList.remove('visible');
      popup.style.display = 'none';
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
    }

    function displaySharedRecipeCard() {
      if (!recipes || recipes.length === 0) return;
      const recipe = recipes[0];
      const container = document.getElementById('recipesContainer');
      if (!container) return;
      
      container.style.display = 'flex';
      container.style.justifyContent = 'center';
      container.style.alignItems = 'center';
      container.style.minHeight = '80vh';
      container.style.padding = '2rem';
      
      // Generate ingredients list
      const ingredientsList = recipe.ingredients.split('\n').map((ingredient) => {
        if (!ingredient.trim()) return '';
        return `<li class="text-gray-700 dark:text-gray-300">${ingredient}</li>`;
      }).join('');

      // Generate steps list
      const stepsList = recipe.instructions.split('\n').map((step, i) => {
        if (!step.trim()) return '';
        return `<li class="text-gray-700 dark:text-gray-300 mb-3"><strong>${i + 1}.</strong> ${step}</li>`;
      }).join('');
      
      container.innerHTML = `
        <div class="max-w-4xl w-full bg-white dark:bg-card-dark rounded-2xl shadow-2xl overflow-hidden">
          <!-- Header -->
          <div class="bg-gradient-to-r from-primary to-accent p-8 text-center relative overflow-hidden">
            <div class="absolute inset-0 opacity-20">
              <div class="absolute top-0 left-0 w-32 h-32 bg-white rounded-full -translate-x-1/2 -translate-y-1/2"></div>
              <div class="absolute bottom-0 right-0 w-48 h-48 bg-white rounded-full translate-x-1/3 translate-y-1/3"></div>
            </div>
            <div class="relative z-10">
              <span class="material-symbols-outlined text-6xl mb-4 text-slate-800">restaurant_menu</span>
              <h1 class="text-4xl font-bold text-slate-800 mb-2">${recipe.name}</h1>
              <p class="text-lg text-slate-700">מקור: ${recipe.source || 'לא ידוע'}</p>
              <div class="mt-4 inline-block bg-white/30 backdrop-blur-sm px-6 py-2 rounded-full">
                <span class="text-sm font-semibold text-slate-800">📤 מתכון משותף</span>
              </div>
            </div>
          </div>
          
          <!-- Image Section -->
          ${(recipe.imagePath || recipe.image) ? `
          <div class="w-full h-80 overflow-hidden">
            <img src="${getDisplayUrl(recipe)}" 
                 alt="${recipe.name}" 
                 onerror="this.src=getDefaultImageUrl('${recipe.category}')"
                 class="w-full h-full object-cover">
          </div>
          ` : ''}
          
          <!-- Content -->
          <div class="p-8">
            <!-- Meta Info -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div class="text-center p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
                <span class="material-symbols-outlined text-primary text-3xl">schedule</span>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">זמן הכנה</p>
                <p class="font-bold text-gray-800 dark:text-gray-200">${recipe.preparationTime || '--'} דקות</p>
              </div>
              <div class="text-center p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
                <span class="material-symbols-outlined text-accent text-3xl">category</span>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">קטגוריה</p>
                <p class="font-bold text-gray-800 dark:text-gray-200">${recipe.category}</p>
              </div>
              <div class="text-center p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
                <span class="material-symbols-outlined text-green-600 text-3xl">restaurant</span>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">סוג תזונה</p>
                <p class="font-bold text-gray-800 dark:text-gray-200">${recipe.dietaryType || '--'}</p>
              </div>
              <div class="text-center p-4 bg-gray-50 dark:bg-gray-800 rounded-xl col-span-2 md:col-span-1">
                <span class="material-symbols-outlined text-yellow-500 text-3xl">star</span>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">דירוג</p>
                <p class="font-bold text-gray-800 dark:text-gray-200">${(recipe.rating || 0).toFixed(1)} ⭐</p>
              </div>
            </div>
            
            <!-- Ingredients -->
            <div class="mb-8">
              <h2 class="text-2xl font-bold mb-4 flex items-center text-gray-800 dark:text-gray-200">
                <span class="material-symbols-outlined ml-2 text-green-600">shopping_basket</span>
                מצרכים
              </h2>
              <ul class="list-disc list-inside space-y-2 bg-green-50 dark:bg-green-900/20 p-6 rounded-xl">
                ${ingredientsList}
              </ul>
            </div>
            
            <!-- Instructions -->
            <div class="mb-8">
              <h2 class="text-2xl font-bold mb-4 flex items-center text-gray-800 dark:text-gray-200">
                <span class="material-symbols-outlined ml-2 text-orange-500">cooking</span>
                שלבי הכנה
              </h2>
              <ol class="space-y-3 bg-orange-50 dark:bg-orange-900/20 p-6 rounded-xl">
                ${stepsList}
              </ol>
            </div>
            
            ${recipe.notes ? `
            <div class="mb-8">
              <h2 class="text-2xl font-bold mb-4 flex items-center text-gray-800 dark:text-gray-200">
                <span class="material-symbols-outlined ml-2 text-yellow-500">lightbulb</span>
                הערות
              </h2>
              <div class="bg-yellow-50 dark:bg-yellow-900/20 p-6 rounded-xl">
                <p class="text-gray-700 dark:text-gray-300">${recipe.notes.replace(/\n/g, '<br>')}</p>
              </div>
            </div>
            ` : ''}
            
            <!-- Action Buttons -->
            <div class="flex flex-wrap gap-4 justify-center pt-6 border-t border-gray-200 dark:border-gray-700">
              <button onclick="downloadRecipe(0)" class="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-slate-800 font-semibold rounded-lg transition-all shadow-md hover:shadow-lg">
                <span class="material-symbols-outlined">download</span>
                הורד מתכון
              </button>
              <button onclick="window.print()" class="flex items-center gap-2 px-6 py-3 bg-accent hover:bg-purple-400 text-slate-800 font-semibold rounded-lg transition-all shadow-md hover:shadow-lg">
                <span class="material-symbols-outlined">print</span>
                הדפס
              </button>
              <button onclick="shareRecipe(0)" class="flex items-center gap-2 px-6 py-3 bg-secondary hover:bg-pink-400 text-slate-800 font-semibold rounded-lg transition-all shadow-md hover:shadow-lg">
                <span class="material-symbols-outlined">share</span>
                שתף
              </button>
            </div>
            
            <div class="text-center mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
              <p class="text-sm text-gray-500 dark:text-gray-400">
                💡 רוצה לנהל גם אתה ספר מתכונים דיגיטלי כזה? צור קשר עם שולח המתכון!
              </p>
            </div>
          </div>
        </div>
      `;
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
        const url = supabaseUrl + '/functions/v1/regenerate-image';
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + supabaseAnonKey
          },
          body: JSON.stringify({
            recipeId: recipe.id,
            recipeName: recipe.name,
            category: recipe.category
          })
        });

        const data = await response.json();

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
          if (imagePath) {
            recipes[index].imagePath = imagePath;
            recipes[index].image = null;
          } else if (data.image) {
            recipes[index].imagePath = null;
            recipes[index].image = data.image;
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
        const url = supabaseUrl + '/functions/v1/regenerate-image';
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + supabaseAnonKey
          },
          body: JSON.stringify({
            recipeId: recipeId,
            recipeName: name,
            category: category
          })
        });

        const data = await response.json();

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
          formRegeneratedImage = imagePath ? { imagePath } : (data.image ? { image: data.image } : null);

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

    const DIFFICULTY_LABELS = { 1: 'קל', 2: 'בינוני', 3: 'קשה' };

    function setFormDifficulty(level) {
        formSelectedDifficulty = level >= 1 && level <= 3 ? level : 2;
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
        document.getElementById('category').style.display = 'block';

        // איפוס הטופס
        document.getElementById('recipeForm').reset();
        editingIndex = -1;
        formSelectedRating = 0;
        setFormDifficulty(2);
        updateFormRatingStars(0);
        aiGeneratedImage = null; // איפוס תמונה שנוצרה ע"י AI
        formRegeneratedImage = null; // איפוס תמונה שנוצרה ב"צור תמונה חדשה" בטופס
        
        // עדכון רשימת הקטגוריות
        const select = document.getElementById('category');
        select.innerHTML = '<option value="" disabled selected>בחר קטגוריה</option>';
        
        // הקטגוריות הקבועות
        const fixedCategories = ['לחמים', 'מרקים', 'מנה עיקרית', 'תוספות', 'סלטים', 'שונות', 'עוגות', 'קינוחים'];
        
        // הוספת הקטגוריות הקבועות
        fixedCategories.forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            select.appendChild(option);
        });
        
        // הוספת קטגוריות נוספות מהמתכונים הקיימים
        const existingCategories = [...new Set(recipes.map(recipe => recipe.category))];
        existingCategories.forEach(category => {
            if (category && !fixedCategories.includes(category)) {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                select.appendChild(option);
            }
        });

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
    }

    function closeFormPopup() {
      document.getElementById('formPopup').style.display = 'none';
      document.getElementById('recipeForm').reset();
      editingIndex = -1;
      formRegeneratedImage = null;
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

    function downloadRecipe(index) {
      const recipe = recipes[index];
      const content = `
          <!DOCTYPE html>
          <html lang="he" dir="rtl">
          <head>
              <meta charset="UTF-8">
              <title>${recipe.name}</title>
              <style>
                  body {
                      font-family: Arial, sans-serif;
                      direction: rtl;
                      padding: 20px;
                      max-width: 400px;
                      margin: auto;
                      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                      border: 1px solid #ccc;
                      border-radius: 8px;
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
              <h1>${recipe.name} / ${recipe.source}</h1>
              <img src="${getDisplayUrl(recipe)}" alt="תמונה של ${recipe.name}" onerror="this.style.display='none'">
              <p><strong>קטגוריה:</strong> ${recipe.category}</p>
              ${recipe.dietaryType ? `<p><strong>סוג תזונה:</strong> ${recipe.dietaryType}</p>` : ''}
              <p><strong>מצרכים:</strong></p>
              <ul class="ingredients-list">
                  ${recipe.ingredients.split('\n').map(ingredient => `<li>${ingredient}</li>`).join('')}
              </ul>
              <p><strong>הוראות:</strong></p>
              <ul class="instructions-list">
                  ${recipe.instructions.split('\n').map(instruction => `<li>${instruction}</li>`).join('')}
              </ul>
              ${recipe.videoUrl ? `<div class="recipe-video">
                <iframe width="560" height="315" src="${getYoutubeEmbed(recipe.videoUrl)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
              </div>` : ''}
              ${recipe.recipeLink ? `<div class="recipe-link"><strong>קישור למתכון:</strong><br><a href="${recipe.recipeLink}" target="_blank">${recipe.recipeLink}</a></div>` : ''}
              ${recipe.notes ? `<div class="recipe-notes"><strong>הערות:</strong><br>${recipe.notes}</div>` : ''}
          </body>
          </html>
      `;
      const blob = new Blob([content], { type: 'text/html' });
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

    function generateStars(rating, index) {
      let stars = '';
      for (let i = 1; i <= 5; i++) {
        stars += `<span onclick="rateRecipe(${index}, ${i})">${i <= rating ? '★' : '☆'}</span>`;
      }
      return stars;
    }

    async function rateRecipe(index, rating) {
      recipes[index].rating = rating;
      try {
        await saveRecipeToDB(recipes[index]);
        showRecipe(index);
        filterRecipes();
      } catch (e) {
        console.error('Error saving recipe rating:', e);
        alert('שגיאה בשמירת הדירוג. נא לנסות שוב.');
      }
    }

    function generateFilterStars() {
      let stars = '';
      for (let i = 1; i <= 5; i++) {
        stars += `<span onclick="setFilterRating(${i})" id="filterStar${i}">☆</span>`;
      }
      return stars;
    }

    function setFilterRating(rating) {
      for (let i = 1; i <= 5; i++) {
        const starElement = document.getElementById(`filterStar${i}`);
        if (starElement) {
          starElement.classList.remove('selected');
          starElement.style.color = 'gray';
          starElement.textContent = '☆';
        }
      }
      if (rating > 0) {
        for (let i = 1; i <= rating; i++) {
          const starElement = document.getElementById(`filterStar${i}`);
          if (starElement) {
            starElement.classList.add('selected');
            starElement.style.color = 'green';
            starElement.textContent = '★';
          }
        }
      }
      filterRecipes();
    }

    function getSelectedRating() {
      const filterRatingEl = document.getElementById('filterRating');
      if (!filterRatingEl) return 0;
      const stars = filterRatingEl.querySelectorAll('.selected');
      return stars.length;
    }

    function resetFilterStars() {
      const filterRatingEl = document.getElementById('filterRating');
      if (!filterRatingEl) return;
      const stars = filterRatingEl.querySelectorAll('span');
      stars.forEach(star => {
        star.classList.remove('selected');
        star.textContent = '☆';
        star.style.color = 'gray';
      });
    }

    function getActiveFiltersFromUI() {
      const searchNameEl = document.getElementById('searchName');
      const searchName = (searchNameEl && typeof searchNameEl.value === 'string') ? searchNameEl.value.toLowerCase().trim() : '';
      const searchIngredientsEl = document.getElementById('searchIngredients');
      const searchIngredients = (searchIngredientsEl && typeof searchIngredientsEl.value === 'string') ? searchIngredientsEl.value.toLowerCase().trim() : '';
      const searchPrepTimeEl = document.getElementById('searchPrepTime');
      const searchPrepTime = (searchPrepTimeEl && searchPrepTimeEl.value != null) ? (parseInt(searchPrepTimeEl.value) || 0) : 0;
      const searchDietaryTypeEl = document.getElementById('searchDietaryType');
      const searchDietaryType = (searchDietaryTypeEl && typeof searchDietaryTypeEl.value === 'string') ? searchDietaryTypeEl.value.trim() : '';
      const selectedRating = getSelectedRating();

      return {
        searchName,
        searchIngredients,
        searchPrepTime,
        searchDietaryType,
        selectedRating,
        selectedCategory
      };
    }

    function hasAnyActiveFilters(filters) {
      if (!filters) return false;
      return Boolean(
        (filters.searchName && filters.searchName.length > 0) ||
        (filters.searchIngredients && filters.searchIngredients.length > 0) ||
        (filters.searchPrepTime && filters.searchPrepTime > 0) ||
        (filters.searchDietaryType && filters.searchDietaryType.length > 0) ||
        (filters.selectedRating && filters.selectedRating > 0) ||
        filters.selectedCategory != null
      );
    }

    function setFilterItemActive(inputOrContainerEl, active) {
      if (!inputOrContainerEl) return;
      const item = inputOrContainerEl.closest ? inputOrContainerEl.closest('.search-filter-item') : null;
      if (!item) return;
      if (active) item.classList.add('has-value');
      else item.classList.remove('has-value');
    }

    function updateFilterHeaderUI(filters, filteredCount) {
      const total = Array.isArray(recipes) ? recipes.length : 0;
      const resultsEl = document.getElementById('filterResultsCount');
      if (resultsEl) {
        if (total === 0) {
          resultsEl.textContent = '';
        } else {
          const count = (typeof filteredCount === 'number') ? filteredCount : total;
          resultsEl.textContent = `מציג ${count} מתוך ${total}`;
        }
      }

      const searchNameEl = document.getElementById('searchName');
      const headerSearchWrapper = document.querySelector('.header-search-wrapper');
      const hasName = Boolean(filters && filters.searchName);
      if (searchNameEl) {
        if (hasName) searchNameEl.classList.add('has-value');
        else searchNameEl.classList.remove('has-value');
      }
      if (headerSearchWrapper) {
        if (hasName) headerSearchWrapper.classList.add('has-value');
        else headerSearchWrapper.classList.remove('has-value');
      }

      const clearBtn = document.getElementById('clearFiltersBtn');
      if (clearBtn) {
        const anyActive = hasAnyActiveFilters(filters);
        if (anyActive) clearBtn.classList.remove('is-hidden');
        else clearBtn.classList.add('is-hidden');
      }

      const ingredientsEl = document.getElementById('searchIngredients');
      setFilterItemActive(ingredientsEl, Boolean(filters && filters.searchIngredients));

      const prepTimeEl = document.getElementById('searchPrepTime');
      setFilterItemActive(prepTimeEl, Boolean(filters && filters.searchPrepTime));

      const dietaryEl = document.getElementById('searchDietaryType');
      setFilterItemActive(dietaryEl, Boolean(filters && filters.searchDietaryType));

      const ratingEl = document.getElementById('filterRating');
      setFilterItemActive(ratingEl, Boolean(filters && filters.selectedRating));
    }

    function resetSearch() {
      document.getElementById('searchName').value = '';
      const searchIngredientsEl = document.getElementById('searchIngredients');
      if (searchIngredientsEl) searchIngredientsEl.value = '';
      const searchPrepTimeEl = document.getElementById('searchPrepTime');
      if (searchPrepTimeEl) searchPrepTimeEl.value = '';
      const searchDietaryTypeEl = document.getElementById('searchDietaryType');
      if (searchDietaryTypeEl) searchDietaryTypeEl.value = '';
      updateDietarySelectTrigger();
      selectedCategory = null;
      resetFilterStars();
      filterRecipes();
      updateCategoryButtons();
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

    function shareRecipe(index) {
      const recipe = recipes[index];
      if (navigator.share) {
        const content = `
            <!DOCTYPE html>
            <html lang="he" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>${recipe.name}</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        direction: rtl;
                        padding: 20px;
                        max-width: 400px;
                        margin: auto;
                        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                        border: 1px solid #ccc;
                        border-radius: 8px;
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
                <h1>${recipe.name} / ${recipe.source}</h1>
                <img src="${getDisplayUrl(recipe)}" alt="תמונה של ${recipe.name}" onerror="this.style.display='none'">
                <p><strong>קטגוריה:</strong> ${recipe.category}</p>
                ${recipe.dietaryType ? `<p><strong>סוג תזונה:</strong> ${recipe.dietaryType}</p>` : ''}
                <p><strong>מצרכים:</strong></p>
                <ul class="ingredients-list">
                    ${recipe.ingredients.split('\n').map(ingredient => `<li>${ingredient}</li>`).join('')}
                </ul>
                <p><strong>הוראות:</strong></p>
                <ul class="instructions-list">
                    ${recipe.instructions.split('\n').map(instruction => `<li>${instruction}</li>`).join('')}
                </ul>
                ${recipe.videoUrl ? `<div class="recipe-video">
                  <iframe width="560" height="315" src="${getYoutubeEmbed(recipe.videoUrl)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                </div>` : ''}
                ${recipe.recipeLink ? `<div class="recipe-link"><strong>קישור למתכון:</strong><br><a href="${recipe.recipeLink}" target="_blank">${recipe.recipeLink}</a></div>` : ''}
                ${recipe.notes ? `<div class="recipe-notes"><strong>הערות:</strong><br>${recipe.notes}</div>` : ''}
            </body>
            </html>
        `;
        const blob = new Blob([content], { type: 'text/html' });
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

      backupReminderTimeout = setTimeout(async () => {
        const s = await loadSettings();
        setupBackupReminder(s.lastBackup);
      }, twoWeeks);
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
    function compactRecipes(list) {
      return (list || []).map(function(r) {
        return {
          id: r.id,
          name: r.name || '',
          category: r.category || 'שונות',
          ingredients: (r.ingredients || '').slice(0, 250),
          instructions: (r.instructions || '').slice(0, 250),
          rating: r.rating ?? 0
        };
      });
    }

    function formatMessageTime(timestamp) {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    }

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
            <img src="${getDisplayUrl(m.recipeCard) || chefImageUrl('/default-images/other/1.jpg')}" alt="${m.recipeCard.name}" onerror="this.src=getDefaultImageUrl('שונות')">
            <div class="ai-chat-recipe-card-footer" onclick="viewRecipeFromChat('${m.recipeCard.id || ''}')">
              <span>צפה במתכון המלא</span>
              <span class="material-symbols-outlined">arrow_back</span>
            </div>
          `;
          d.appendChild(recipeCard);
        }

        // Add inline suggested recipe preview (inside the message bubble)
        if (m.suggestedRecipe && typeof m.suggestedRecipe === 'object') {
          var sr = m.suggestedRecipe;
          var srImg = getDisplayUrl({ imagePath: sr.image_path, image: sr.image });
          var srIngredients = (sr.ingredients || '').replace(/\n/g, '<br>');
          var srInstructions = (sr.instructions || '').replace(/\n/g, '<br>');
          var srCategory = sr.category || 'שונות';
          var isAdded = !!m.recipeAdded;
          const srCard = document.createElement('div');
          srCard.className = 'ai-chat-suggested-recipe-card';
          srCard.innerHTML = `
            ${srImg ? `<div class="sr-card-image"><img src="${srImg}" alt="${sr.name || ''}" onerror="this.parentElement.style.display='none'"><div class="sr-card-badge">${srCategory}</div></div>` : ''}
            <div class="sr-card-body">
              <div class="sr-card-title">${sr.name || ''}</div>
              ${!srImg ? `<span class="sr-card-category">${srCategory}</span>` : ''}
              ${srIngredients ? `
                <div class="sr-card-section open">
                  <div class="sr-card-section-header" onclick="this.parentElement.classList.toggle('open')">
                    <span><i class="fas fa-list-ul"></i> מצרכים</span>
                    <i class="fas fa-chevron-down sr-card-chevron"></i>
                  </div>
                  <div class="sr-card-section-content">${srIngredients}</div>
                </div>` : ''}
              ${srInstructions ? `
                <div class="sr-card-section">
                  <div class="sr-card-section-header" onclick="this.parentElement.classList.toggle('open')">
                    <span><i class="fas fa-utensils"></i> הוראות הכנה</span>
                    <i class="fas fa-chevron-down sr-card-chevron"></i>
                  </div>
                  <div class="sr-card-section-content">${srInstructions}</div>
                </div>` : ''}
            </div>
            <div class="sr-card-actions">
              ${isAdded ? `
                <div class="sr-card-added"><i class="fas fa-check-circle"></i> המתכון נוסף לספר!</div>
              ` : `
                <button class="sr-card-add-btn" onclick="addSuggestedRecipeDirectly(${msgIndex})">
                  <i class="fas fa-plus"></i> הוסף לספר
                </button>
                <button class="sr-card-edit-btn" onclick="editSuggestedRecipeFromMsg(${msgIndex})">
                  <i class="fas fa-edit"></i> ערוך
                </button>
                <button class="sr-card-dismiss-btn" onclick="dismissSuggestedRecipe(${msgIndex})">
                  <i class="fas fa-times"></i>
                </button>
              `}
            </div>
          `;
          d.appendChild(srCard);
        }

        contentContainer.appendChild(d);

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
        var url = supabaseUrl + '/functions/v1/recipe-ai';
        var res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + supabaseAnonKey },
          body: JSON.stringify(payload)
        });
        var data = res.ok ? (await res.json().catch(function() { return {}; })) : {};

        if (data && data.insertedRecipeId) {
          removeAddingIndicator();
          recipes = await loadRecipesFromDB();
          if (!Array.isArray(recipes)) recipes = [];
          m.recipeAdded = true;
          m.addedRecipeId = data.insertedRecipeId;
          pendingSuggestedRecipe = null;
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
        pendingSuggestedRecipe = null;
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
    function editSuggestedRecipeFromMsg(msgIndex) {
      var m = aiChatMessages[msgIndex];
      if (!m || !m.suggestedRecipe) return;
      applySuggestedRecipe(m.suggestedRecipe);
      m.suggestedRecipe = null;
      pendingSuggestedRecipe = null;
      renderAiChatMessages();
    }
    window.editSuggestedRecipeFromMsg = editSuggestedRecipeFromMsg;

    // Dismiss suggested recipe from chat message
    function dismissSuggestedRecipe(msgIndex) {
      var m = aiChatMessages[msgIndex];
      if (!m) return;
      m.suggestedRecipe = null;
      pendingSuggestedRecipe = null;
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
      if (!supabase) return null;
      try {
        const { data, error } = await supabase
          .from('chat_conversations')
          .insert({ title: 'שיחה חדשה' })
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

    async function loadConversationMessages(conversationId) {
      if (!supabase) return [];
      try {
        const { data, error } = await supabase
          .from('chat_messages')
          .select('role, content, attachments')
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

    async function saveMessageToDb(conversationId, role, content, attachments) {
      if (!supabase || !conversationId) return;
      try {
        await supabase.from('chat_messages').insert({
          conversation_id: conversationId,
          role: role,
          content: content,
          attachments: attachments || []
        });
      } catch (e) {
        console.error('Error saving message:', e);
      }
    }

    function formatRelativeDate(dateStr) {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'עכשיו';
      if (diffMins < 60) return 'לפני ' + diffMins + ' דקות';
      if (diffHours < 24) return 'לפני ' + diffHours + ' שעות';
      if (diffDays < 7) return 'לפני ' + diffDays + ' ימים';
      return date.toLocaleDateString('he-IL');
    }

    function renderConversationHistory() {
      // Update the select dropdown
      const selectEl = document.getElementById('aiChatHistorySelect');
      if (!selectEl) return;

      // Clear existing options except the first one (new chat)
      selectEl.innerHTML = '<option value="new">שיחה חדשה - מה מבשלים היום?</option>';

      conversationHistory.forEach(function(conv) {
        const option = document.createElement('option');
        option.value = conv.id;
        option.textContent = (conv.title || 'שיחה ללא כותרת') + ' (' + formatRelativeDate(conv.updated_at) + ')';
        if (conv.id === currentConversationId) {
          option.selected = true;
        }
        selectEl.appendChild(option);
      });
    }

    // Load conversation from select dropdown
    async function loadSelectedConversation(value) {
      if (value === 'new') {
        await startNewConversation();
      } else {
        await loadPastConversation(value);
      }
    }
    window.loadSelectedConversation = loadSelectedConversation;

    function renderConversationHistoryOld() {
      const listEl = document.getElementById('aiChatHistoryList');
      if (!listEl) return;

      listEl.innerHTML = '';

      if (conversationHistory.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'history-empty';
        empty.textContent = 'אין שיחות קודמות';
        listEl.appendChild(empty);
        return;
      }

      conversationHistory.forEach(function(conv) {
        const item = document.createElement('div');
        item.className = 'history-item' + (conv.id === currentConversationId ? ' active' : '');
        item.onclick = function() { loadPastConversation(conv.id); };

        const title = document.createElement('div');
        title.className = 'history-item-title';
        title.textContent = conv.title || 'שיחה ללא כותרת';

        const preview = document.createElement('div');
        preview.className = 'history-item-preview';
        preview.textContent = conv.last_message_preview || '';

        const date = document.createElement('div');
        date.className = 'history-item-date';
        date.textContent = formatRelativeDate(conv.updated_at);

        item.appendChild(title);
        item.appendChild(preview);
        item.appendChild(date);
        listEl.appendChild(item);
      });
    }

    async function loadPastConversation(conversationId) {
      currentConversationId = conversationId;
      const messages = await loadConversationMessages(conversationId);
      aiChatMessages = messages.map(function(m) {
        return {
          role: m.role,
          content: m.content,
          attachments: m.attachments || []
        };
      });
      renderAiChatMessages();
      renderConversationHistory();

      // Hide history dropdown after selecting conversation
      const history = document.getElementById('aiChatHistory');
      if (history) history.style.display = 'none';
    }

    async function startNewConversation() {
      currentConversationId = await createNewConversation();
      aiChatMessages = [];
      chatAttachments = [];

      aiChatMessages.push({
        role: 'assistant',
        content: 'היי! איך אוכל לעזור לך לבשל היום? אני יכול להציע מתכונים, לחפש לפי מצרכים שיש לך בבית, או להמציא מתכון חדש.',
        timestamp: new Date()
      });

      conversationHistory = await loadConversationHistory();
      renderConversationHistory();
      renderAiChatMessages();
      clearAttachmentPreview();

      // Hide history dropdown after starting new conversation
      const history = document.getElementById('aiChatHistory');
      if (history) history.style.display = 'none';

      var input = document.getElementById('aiChatInput');
      if (input) input.focus();
    }

    function toggleChatHistory() {
      const history = document.getElementById('aiChatHistory');
      if (history) {
        // Toggle display for dropdown style
        if (history.style.display === 'none' || !history.style.display) {
          history.style.display = 'block';
          loadChatHistory();
        } else {
          history.style.display = 'none';
        }
      }
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
      chatAttachments = [];
      renderAttachmentPreviews();
    }

    async function openAiChat() {
      var ov = document.getElementById('aiChatOverlay');
      if (ov) ov.style.display = 'flex';

      // Always start a new conversation when opening
      currentConversationId = await createNewConversation();
      aiChatMessages = [];
      chatAttachments = [];

      aiChatMessages.push({
        role: 'assistant',
        content: 'שלום! אני יכול לחפש מתכונים קיימים, להמציא מתכונים חדשים מהדמיון שלי, או לעזור לך להוסיף מתכון משלך. במה אוכל לעזור?',
        timestamp: new Date()
      });

      // Load conversation history for sidebar
      conversationHistory = await loadConversationHistory();
      renderConversationHistory();

      renderAiChatMessages();
      clearAttachmentPreview();
      var input = document.getElementById('aiChatInput');
      if (input) {
        input.value = '';
        input.focus();
      }
      var sendBtn = document.getElementById('aiChatSend');
      if (sendBtn) sendBtn.disabled = false;
    }

    function closeAiChat() {
      if (aiChatAbortController) {
        aiChatAbortController.abort();
        aiChatAbortController = null;
      }
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
        if (![].slice.call(sel.options).some(function(o) { return o.value === cat; })) {
          var opt = document.createElement('option');
          opt.value = cat;
          opt.textContent = cat;
          sel.appendChild(opt);
        }
        sel.value = cat;
      }
      // Store AI-generated image/path for use when saving
      aiGeneratedImage = suggestedRecipe.image_path ? { imagePath: suggestedRecipe.image_path } : (suggestedRecipe.image ? suggestedRecipe.image : null);

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

      if (aiChatAbortController) {
        aiChatAbortController.abort();
      }
      aiChatAbortController = new AbortController();

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
        await saveMessageToDb(currentConversationId, 'user', userMessage.content, userMessage.attachments);
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

      var url = supabaseUrl + '/functions/v1/recipe-ai';
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + supabaseAnonKey },
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
          if (!reply && res && !res.ok) reply = 'שגיאה מהשרת (' + (res.status || '') + '). נא לבדוק GEMINI_API_KEY ב-Supabase Secrets.';

          var assistantMessage = { role: 'assistant', content: reply, timestamp: new Date() };

          // Attach suggested recipe data to the message for inline display
          if (data && data.suggestedRecipe && typeof data.suggestedRecipe === 'object') {
            assistantMessage.suggestedRecipe = data.suggestedRecipe;
          }

          aiChatMessages.push(assistantMessage);

          // Save assistant message to database
          if (currentConversationId) {
            await saveMessageToDb(currentConversationId, 'assistant', reply, []);
          }

          renderAiChatMessages();

          var recipeIds = (data && Array.isArray(data.recipeIds)) ? data.recipeIds : [];
          if (data && data.insertedRecipeId) {
            // Recipe was confirmed and inserted to DB
            pendingSuggestedRecipe = null;
            closeAiChat();
            recipes = await loadRecipesFromDB();
            if (!Array.isArray(recipes)) recipes = [];
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
              if (path) {
                recipes[idx].imagePath = path;
                recipes[idx].image = null;
              } else if (data.regeneratedImage) {
                recipes[idx].imagePath = null;
                recipes[idx].image = data.regeneratedImage;
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
            pendingSuggestedRecipe = data.suggestedRecipe;
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

    // --- הקלטה קולית ---
    var voiceRecognition = null;
    var isRecording = false;

    function toggleVoiceRecording() {
      if (isRecording) {
        stopVoiceRecording();
      } else {
        startVoiceRecording();
      }
    }

    function startVoiceRecording() {
      var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert('הדפדפן שלך לא תומך בהקלטה קולית. נסה Chrome או Edge.');
        return;
      }

      voiceRecognition = new SpeechRecognition();
      voiceRecognition.lang = 'he-IL'; // עברית
      voiceRecognition.continuous = true;
      voiceRecognition.interimResults = true;

      voiceRecognition.onresult = function(event) {
        var transcript = '';
        for (var i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        document.getElementById('aiChatInput').value = transcript;
      };

      voiceRecognition.onerror = function(event) {
        console.error('Voice recognition error:', event.error);
        if (event.error === 'not-allowed') {
          alert('אנא אשר גישה למיקרופון בדפדפן.');
        }
        stopVoiceRecording();
      };

      voiceRecognition.onend = function() {
        stopVoiceRecording();
      };

      voiceRecognition.start();
      isRecording = true;
      updateVoiceButton(true);
    }

    function stopVoiceRecording() {
      if (voiceRecognition) {
        voiceRecognition.stop();
        voiceRecognition = null;
      }
      isRecording = false;
      updateVoiceButton(false);
    }

    function updateVoiceButton(recording) {
      var btn = document.getElementById('aiChatVoice');
      if (!btn) return;
      if (recording) {
        btn.classList.add('recording');
        btn.innerHTML = '<i class="fas fa-stop"></i>';
      } else {
        btn.classList.remove('recording');
        btn.innerHTML = '<i class="fas fa-microphone"></i>';
      }
    }

    // Dropdown מותאם לסוג תזונה – סנכרון עם ה-select והצגת טקסט
    function updateDietarySelectTrigger() {
      const sel = document.getElementById('searchDietaryType');
      const triggerText = document.querySelector('.filter-select-trigger-text');
      const options = document.querySelectorAll('.filter-select-option');
      if (!sel || !triggerText || !options.length) return;
      const value = (sel.value || '').trim();
      triggerText.textContent = Array.from(sel.options).find(o => (o.value || '').trim() === value)?.textContent || 'הכל (חלבי/בשרי/פרווה)';
      options.forEach(opt => {
        if ((opt.getAttribute('data-value') || '').trim() === value) opt.classList.add('is-selected');
        else opt.classList.remove('is-selected');
      });
    }

    function initDietaryDropdown() {
      const wrap = document.getElementById('dietarySelectWrap');
      const trigger = document.getElementById('dietarySelectTrigger');
      const dropdown = document.getElementById('dietarySelectDropdown');
      const sel = document.getElementById('searchDietaryType');
      if (!wrap || !trigger || !dropdown || !sel) return;
      updateDietarySelectTrigger();

      trigger.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const open = wrap.classList.toggle('is-open');
        dropdown.classList.toggle('is-open', open);
        trigger.setAttribute('aria-expanded', open);
        dropdown.setAttribute('aria-hidden', !open);
      });

      dropdown.querySelectorAll('.filter-select-option').forEach(opt => {
        opt.addEventListener('click', function(e) {
          e.preventDefault();
          const value = (opt.getAttribute('data-value') || '').trim();
          sel.value = value;
          wrap.classList.remove('is-open');
          dropdown.classList.remove('is-open');
          trigger.setAttribute('aria-expanded', 'false');
          dropdown.setAttribute('aria-hidden', 'true');
          updateDietarySelectTrigger();
          filterRecipes();
        });
      });

      document.addEventListener('click', function closeOnOutside(e) {
        if (!wrap.contains(e.target)) {
          wrap.classList.remove('is-open');
          dropdown.classList.remove('is-open');
          trigger.setAttribute('aria-expanded', 'false');
          dropdown.setAttribute('aria-hidden', 'true');
        }
      });
    }

    // פונקציה לפתיחה/סגירה של פאנל הסינון
    function toggleFilterPanel() {
      const searchContainer = document.getElementById('searchContainer');
      const filterIcon = document.querySelector('.header-filter-icon');
      
      if (!searchContainer) return;
      
      const computedStyle = window.getComputedStyle(searchContainer);
      const isVisible = searchContainer.style.display !== 'none' && 
                       computedStyle.display !== 'none';
      
      if (isVisible) {
        searchContainer.classList.remove('is-open');
        window.setTimeout(function() {
          if (!searchContainer.classList.contains('is-open')) {
            searchContainer.style.display = 'none';
          }
        }, 220);

        const anyActive = hasAnyActiveFilters(getActiveFiltersFromUI());
        if (filterIcon) {
          if (anyActive) {
            filterIcon.style.color = 'var(--secondary)';
            filterIcon.classList.add('active');
          } else {
            filterIcon.style.color = '#64748b';
            filterIcon.classList.remove('active');
          }
        }
      } else {
        searchContainer.style.display = 'block';
        window.requestAnimationFrame(function() {
          searchContainer.classList.add('is-open');
        });

        if (filterIcon) {
          filterIcon.style.color = 'var(--secondary)';
          filterIcon.classList.add('active');
        }
      }
    }

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
    window.toggleChatHistory = toggleChatHistory;
    window.handleChatFileSelect = handleChatFileSelect;

    // Timer functionality
    let timerInterval;
    let currentBeepInterval;
    let currentMelodyContext;
    let timerPaused = false;
    let pausedTimeRemaining = 0;
    let timerEndTime = 0;
    const TIMER_MAX_HOURS = 99;
    const TIMER_MAX_MINUTES = 59;
    const TIMER_MAX_SECONDS = 59;

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

    function formatTime(totalSeconds) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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

    function initializeTimer(settings) {
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

    // פונקציה לשינוי גודל התמונה
    function resizeImage(file, maxWidth, maxHeight, callback) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width *= ratio;
                    height *= ratio;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                const dataUrl = canvas.toDataURL(file.type);
                callback(dataUrl);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    window.resizeImage = resizeImage;

    // ============================================
    // NEW: Supabase Storage Image Functions
    // ============================================

    // Convert image file to optimized blob (Promise-based)
    function resizeImageToBlob(file, maxWidth, maxHeight, quality) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.onload = function() {
                    let width = img.width;
                    let height = img.height;
                    
                    if (width > maxWidth || height > maxHeight) {
                        const ratio = Math.min(maxWidth / width, maxHeight / height);
                        width *= ratio;
                        height *= ratio;
                    }
                    
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    canvas.toBlob((blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('Failed to create blob'));
                        }
                    }, file.type, quality);
                };
                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }

    // Upload image to Supabase Storage
    async function uploadImageToStorage(file) {
        try {
            const resized = await resizeImageToBlob(file, 1200, 1200, 0.85);
            const uuid = crypto.randomUUID();
            const fileExt = file.name.split('.').pop().toLowerCase();
            const fileName = `${uuid}.${fileExt}`;
            const { error } = await supabase.storage
                .from('recipe-images')
                .upload(fileName, resized, {
                    cacheControl: '31536000',
                    upsert: false
                });
            if (error) {
                console.error('❌ [uploadImageToStorage]', error);
                throw error;
            }
            return fileName;
            
        } catch (error) {
            console.error('❌ [uploadImageToStorage] Upload failed:', error);
            console.warn('  ⚠️ Will use default image instead');
            
            // Return null to trigger default image usage
            // This is better than base64 because:
            // 1. Saves storage space in database
            // 2. Faster page loads
            // 3. User can easily reupload later using reuploadRecipeImage()
            return null;
        }
    }

    /** Builds public Storage URL. Handle different path formats correctly. */
    function getStoragePublicUrl(storagePath) {
        if (!storagePath || typeof storagePath !== 'string') return '';
        
        // Handle different path formats:
        // 1. Full path with bucket: "recipe-images/filename.png" -> extract "filename.png"
        // 2. Path with recipe ID: "recipe-id/timestamp-recipe-id.png" -> use as-is
        // 3. Just filename: "filename.png" -> use as-is
        
        let key = storagePath;
        
        // Remove bucket prefix if present to avoid double prefix
        if (key.startsWith('recipe-images/')) {
            key = key.slice(14);
        }
        
        const finalUrl = `${supabaseUrl}/storage/v1/object/public/recipe-images/${key}`;
        console.log(`🔗 [getStoragePublicUrl] Input: "${storagePath}" -> Key: "${key}" -> URL: "${finalUrl}"`);
        return finalUrl;
    }

    /** Single entry point for recipe image display: image_path (Storage key or full URL) or legacy image; else default. */
    function getDisplayUrl(recipe) {
        if (!recipe) return getDefaultImageUrl();
        if (recipe.imagePath) {
            if (typeof recipe.imagePath === 'string' && (recipe.imagePath.startsWith('http') || recipe.imagePath.startsWith('data:')))
                return recipe.imagePath;
            return getStoragePublicUrl(recipe.imagePath);
        }
        if (typeof recipe.image === 'string' && (recipe.image.startsWith('http') || recipe.image.startsWith('data:')))
            return recipe.image;
        return getDefaultImageUrl(recipe.category);
    }

    /** Legacy: resolve raw path/URL to display URL. Used where only path is available (e.g. inline preview). */
    function getImageUrl(imagePathOrUrl, options = {}) {
        if (!imagePathOrUrl) return null;
        if (typeof imagePathOrUrl === 'string' &&
            (imagePathOrUrl.startsWith('http') || imagePathOrUrl.startsWith('data:') || imagePathOrUrl.includes('/default-images/')))
            return imagePathOrUrl;
        return getStoragePublicUrl(imagePathOrUrl);
    }

    // Helper: Get responsive image srcset
    // Without Supabase Image Transformations, srcset uses the same URL
    // (no server-side resizing available on free plan)
    function getImageSrcSet(imagePath) {
        // No srcset needed - single URL for all sizes
        return '';
    }

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

    function filterRecipes() {
      const filters = getActiveFiltersFromUI();
      const searchName = filters.searchName;
      const searchIngredients = filters.searchIngredients;
      const searchPrepTime = filters.searchPrepTime;
      const searchDietaryType = filters.searchDietaryType;
      const selectedRating = filters.selectedRating;

      // וודא שיש מתכונים לסנן
      if (!Array.isArray(recipes) || recipes.length === 0) {
        console.log('No recipes to filter');
        displayRecipes([]);
        updateFilterHeaderUI(filters, 0);
        return;
      }

      // אם אין פילטרים פעילים, הצג את כל המתכונים
      if (!searchName && !searchIngredients && !selectedCategory && !selectedRating && !searchPrepTime && !searchDietaryType) {
        console.log('No filters active, showing all recipes:', recipes.length);
        displayRecipes(recipes);
        updateFilterHeaderUI(filters, recipes.length);

        const filterIcon = document.querySelector('.header-filter-icon');
        if (filterIcon) {
          filterIcon.classList.remove('active');
          filterIcon.style.color = '#64748b';
        }
        return;
      }

      const filteredRecipes = recipes.filter(recipe => {
        // וודא שהמתכון תקין
        if (!recipe || !recipe.name || !recipe.ingredients) {
          console.log('Skipping invalid recipe:', recipe);
          return false;
        }
        
        const nameMatch = !searchName || recipe.name.toLowerCase().includes(searchName);
        const ingredientsMatch = !searchIngredients || recipe.ingredients.toLowerCase().includes(searchIngredients);
        // אם אין קטגוריה נבחרת או שהקטגוריה תואמת
        const categoryMatch = !selectedCategory || (recipe.category && recipe.category.trim() === selectedCategory.trim());
        const ratingMatch = !selectedRating || (recipe.rating && recipe.rating === selectedRating);
        // סינון לפי זמן הכנה - אם יש זמן הכנה במתכון והוא קטן או שווה לזמן המבוקש
        const prepTimeMatch = !searchPrepTime || !recipe.preparationTime || recipe.preparationTime <= searchPrepTime;
        const dietaryMatch = !searchDietaryType || (recipe.dietaryType && recipe.dietaryType.trim() === searchDietaryType);

        return nameMatch && ingredientsMatch && categoryMatch && ratingMatch && prepTimeMatch && dietaryMatch;
      });
      
      console.log('Filtered recipes:', filteredRecipes.length, 'out of', recipes.length);
      displayRecipes(filteredRecipes);

      updateFilterHeaderUI(filters, filteredRecipes.length);

      const filterIcon = document.querySelector('.header-filter-icon');
      if (filterIcon) {
        filterIcon.classList.add('active');
        filterIcon.style.color = 'var(--secondary)';
      }
    }

    function filterByCategory(category) {
      selectedCategory = category;
      filterRecipes();
      // Update active state of category buttons
      updateCategoryButtons();
    }

    function updateCategoryList() {
        const select = document.getElementById('category');
        // שמירת הערך הנוכחי
        const currentValue = select.value;
        // ניקוי האפשרויות הקיימות
        select.innerHTML = '<option value="" disabled selected>בחר קטגוריה</option>';
        
        // הקטגוריות המוגדרות מראש
        const predefinedCategories = ['לחמים', 'מרקים', 'מנה עיקרית', 'תוספות', 'סלטים', 'שונות', 'עוגות', 'קינוחים'];
        
        // הוספת הקטגוריות המוגדרות מראש
        predefinedCategories.forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            select.appendChild(option);
        });

        // הוספת קטגוריות קיימות מהמתכונים
        const existingCategories = [...new Set(recipes.map(recipe => recipe.category))];
        existingCategories.forEach(category => {
            if (category && !predefinedCategories.includes(category)) {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                select.appendChild(option);
            }
        });

        // החזרת הערך הנוכחי אם הוא קיים
        if (currentValue) {
            select.value = currentValue;
        }
    }

    function getCategoryIcon(category) {
      return categoryIcons[category] || 'restaurant_menu';
    }

    function getCategoryColorClass(category) {
      const color = categoryColors[category] || '';
      return color ? `category-icon-${color}` : '';
    }

    function getCategoryBgColor(category) {
      const color = categoryColors[category] || 'blue';
      return color;
    }

    function updateCategoryButtons() {
      const categoryFilter = document.getElementById('categoryFilter');
      if (!categoryFilter) return;
      const categories = getUniqueCategories();
      categoryFilter.innerHTML = '';

      const allButton = document.createElement('button');
      const allIsActive = selectedCategory === null;
      const allColorClass = getCategoryColorClass('כל הקטגוריות');
      const allBgColor = getCategoryBgColor('כל הקטגוריות');
      allButton.className = `category-button ${allIsActive ? 'active' : ''}`;
      allButton.setAttribute('data-category', 'all');
      allButton.innerHTML = `
        <div class="glass-btn-3d category-bg-${allBgColor} ${allIsActive ? 'active' : ''}">
          <span class="material-symbols-outlined ${allColorClass}">${getCategoryIcon('כל הקטגוריות')}</span>
        </div>
        <span>כל הקטגוריות</span>
      `;
      allButton.onclick = resetSearch;
      categoryFilter.appendChild(allButton);

      categories.forEach(category => {
        const button = document.createElement('button');
        const isActive = selectedCategory === category;
        button.className = `category-button ${isActive ? 'active' : ''}`;
        button.setAttribute('data-category', category);
        const colorClass = getCategoryColorClass(category);
        const bgColor = getCategoryBgColor(category);
        button.innerHTML = `
          <div class="glass-btn-3d category-bg-${bgColor} ${isActive ? 'active' : ''}">
            <span class="material-symbols-outlined ${colorClass}">${getCategoryIcon(category)}</span>
          </div>
          <span>${category}</span>
        `;
        button.onclick = () => filterByCategory(category);
        categoryFilter.appendChild(button);
      });
    }

    function getUniqueCategories() {
      const categories = recipes.map(recipe => recipe.category);
      return [...new Set(categories)];
    }

    function editRecipe(index) {
      if (!recipes[index]) return;
      
      closePopup();  // סוגרים את חלון הצפייה במתכון
      formRegeneratedImage = null; // איפוס תמונה שנוצרה ב"צור תמונה חדשה"
      
      const recipe = recipes[index];
      editingIndex = index;

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
      document.getElementById('category').value = recipe.category || 'שונות';
      document.getElementById('notes').value = recipe.notes || '';
      document.getElementById('recipeVideo').value = recipe.videoUrl || '';
      document.getElementById('recipeLink').value = recipe.recipeLink || '';
      const dietaryTypeEl = document.getElementById('dietaryType');
      if (dietaryTypeEl) dietaryTypeEl.value = recipe.dietaryType || '';

      formSelectedRating = recipe.rating || 0;
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
        editingIndex = -1;
        
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
        formRegeneratedImage = null;
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
      aiGeneratedImage = null;

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
        editingIndex = -1;
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
            formSelectedRating = r;
            updateFormRatingStars(r);
          }
        });
      }
    })();

    function toggleCategoryInput() {
        const select = document.getElementById('category');
        const newCategoryInput = document.getElementById('newCategory');
        const toggleButton = document.getElementById('toggleNewCategory');

        if (newCategoryInput.style.display === 'none') {
            select.style.display = 'none';
            newCategoryInput.style.display = 'block';
            if (toggleButton) toggleButton.innerHTML = 'חזור לרשימת הקטגוריות';
            select.required = false;
            newCategoryInput.required = true;
        } else {
            select.style.display = 'block';
            newCategoryInput.style.display = 'none';
            if (toggleButton) toggleButton.innerHTML = '<span class="material-symbols-outlined">add</span>';
            select.required = true;
            newCategoryInput.required = false;
            newCategoryInput.value = '';
        }
    }

    window.toggleCategoryInput = toggleCategoryInput;
})();