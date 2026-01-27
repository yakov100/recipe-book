import { supabase, supabaseUrl, supabaseAnonKey } from './supabase.js';

(() => {
    let recipes = [];
    let editingIndex = -1;
    let selectedCategory = null;
    let backupReminderTimeout;
    let aiChatMessages = [];
    let aiChatAbortController = null;
    let aiGeneratedImage = null; // Stores AI-generated image for suggested recipes
    let currentConversationId = null;
    let conversationHistory = [];
    let chatAttachments = [];
    let pendingSuggestedRecipe = null; // Stores recipe waiting for user confirmation
    let imagesDeferred = false;

    function recipeToRow(r) {
        return {
            name: r.name,
            source: r.source || null,
            ingredients: r.ingredients || '',
            instructions: r.instructions || '',
            category: r.category || 'שונות',
            notes: r.notes || null,
            rating: r.rating ?? 0,
            image: r.image || null,
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
            notes: row.notes,
            rating: row.rating,
            image: row.image,
            recipeLink: row.recipe_link,
            videoUrl: row.video_url,
            preparationTime: row.preparation_time
        };
    }

    // Cache keys
    const CACHE_KEY = 'recipes_cache';
    const CACHE_META_KEY = 'recipes_cache_meta';
    const CACHE_MAX_AGE = 5 * 60 * 1000; // 5 דקות

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
            // שמירה ללא תמונות כדי לחסוך מקום
            const lightRecipes = recipesToCache.map(r => ({
                ...r,
                image: null // התמונות ייטענו בנפרד
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
            if (error) throw error;
        } else {
            const { data, error } = await supabase.from('recipes').insert(row).select('id').single();
            if (error) throw error;
            recipe.id = data.id;
        }
        // עדכון cache
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

    // טעינת מתכונים מ-Supabase
    async function loadRecipesFromDB() {
        if (!supabase) throw new Error('Supabase לא אותחל. ודא שסקריפט Supabase נטען.');

        try {
            imagesDeferred = false;
            const { data, error } = await supabase
                .from('recipes')
                .select('*')
                .order('created_at', { ascending: true });

            if (error) throw error;
            const loadedRecipes = (data || []).map(rowToRecipe);
            saveRecipesToCache(loadedRecipes);
            return loadedRecipes;
        } catch (err) {
            // Fallback: if payload contains invalid JSON (often from large/invalid images),
            // reload without the image column so recipes still appear.
            console.warn('Failed to load full recipes, retrying without images:', err);
            imagesDeferred = true;
            const { data, error } = await supabase
                .from('recipes')
                .select('id,name,source,ingredients,instructions,category,notes,rating,recipe_link,video_url,preparation_time')
                .order('created_at', { ascending: true });

            if (error) throw error;
            const loadedRecipes = (data || []).map(row => ({ ...rowToRecipe(row), image: null }));
            saveRecipesToCache(loadedRecipes);
            return loadedRecipes;
        }
    }

    async function fetchImagesByIds(ids, imageMap) {
        if (!supabase || !ids || ids.length === 0) return;
        const { data, error } = await supabase
            .from('recipes')
            .select('id,image')
            .in('id', ids);

        if (error) throw error;
        (data || []).forEach(row => {
            if (row && row.id) imageMap.set(row.id, row.image || null);
        });
    }

    async function fetchImagesIndividually(ids, imageMap) {
        for (const id of ids) {
            try {
                const { data, error } = await supabase
                    .from('recipes')
                    .select('id,image')
                    .eq('id', id)
                    .single();
                if (!error && data && data.id) {
                    imageMap.set(data.id, data.image || null);
                } else if (error) {
                    console.warn('Failed to load image for recipe id:', id, error);
                }
            } catch (e) {
                console.warn('Failed to load image for recipe id:', id, e);
            }
        }
    }

    async function loadImagesForRecipes() {
        if (!supabase || !Array.isArray(recipes) || recipes.length === 0) return;
        const ids = recipes.map(r => r && r.id).filter(Boolean);
        if (ids.length === 0) return;

        const imageMap = new Map();
        const chunkSize = 25;
        for (let i = 0; i < ids.length; i += chunkSize) {
            const chunk = ids.slice(i, i + chunkSize);
            try {
                await fetchImagesByIds(chunk, imageMap);
            } catch (e) {
                // If a chunk fails, try per-record to isolate any bad rows.
                console.warn('Chunk image load failed, retrying individually:', e);
                await fetchImagesIndividually(chunk, imageMap);
            }
        }

        let updated = false;
        recipes = recipes.map(r => {
            if (!r || !r.id) return r;
            if (imageMap.has(r.id)) {
                updated = true;
                return { ...r, image: imageMap.get(r.id) };
            }
            return r;
        });

        if (updated) {
            displayRecipes(recipes);
        }
    }

    // טעינת והגדרת ההגדרות (מחליף localStorage)
    async function loadSettings() {
        if (!supabase) return { lastBackup: null, recipesPerRow: 4, timerVisible: false };

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
            timerVisible: m.timerVisible === true
        };
    }

    async function saveSetting(key, value) {
        if (!supabase) return;
        await supabase.from('recipe_book_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    }

    function applyTimerVisibility(visible) {
        const tc = document.querySelector('.timer-container');
        const btn = document.getElementById('show-timer-btn');
        if (!tc || !btn) return;
        if (visible) { tc.style.display = 'block'; btn.style.display = 'none'; }
        else { tc.style.display = 'none'; btn.style.display = 'flex'; }
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
            // שלב 1: טעינה מיידית מ-cache
            const cachedRecipes = loadRecipesFromCache();
            const settings = await loadSettings();
            
            if (cachedRecipes && cachedRecipes.length > 0) {
                recipes = cachedRecipes;
                displayRecipes(recipes);
                updateCategoryList();
                updateCategoryButtons();
                console.log('Loaded', recipes.length, 'recipes from cache');
            }

            // אתחול UI
            document.getElementById('filterRating').innerHTML = generateFilterStars();
            setupBackupReminder(settings.lastBackup);
            setRecipesPerRow(settings.recipesPerRow || 4);
            drawGridIcons();
            applyTimerVisibility(settings.timerVisible);
            initializeTimer();
            setupPopupCloseOnOverlayClick();
            handleInitialRoute();

            // שלב 2: טעינה מהשרת ברקע (או מיידית אם אין cache)
            const loadFromServer = async () => {
                try {
                    const freshRecipes = await loadRecipesFromDB();
                    if (!Array.isArray(freshRecipes)) return;
                    
                    // עדכון רק אם יש שינויים
                    const hasChanges = freshRecipes.length !== recipes.length ||
                        JSON.stringify(freshRecipes.map(r => r.id)) !== JSON.stringify(recipes.map(r => r.id));
                    
                    if (hasChanges || !cachedRecipes) {
                        recipes = freshRecipes;
                        displayRecipes(recipes);
                        updateCategoryList();
                        updateCategoryButtons();
                        console.log('Updated with', recipes.length, 'recipes from server');
                    }
                    
                    if (imagesDeferred) {
                        await loadImagesForRecipes();
                    }
                } catch (err) {
                    console.error('Failed to load from server:', err);
                }
            };

            if (cachedRecipes && cachedRecipes.length > 0 && isCacheValid()) {
                // אם יש cache תקף, טען מהשרת ברקע
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
            displayRecipes([]);
            updateCategoryList();
            updateCategoryButtons();
            var fr = document.getElementById('filterRating');
            if (fr) fr.innerHTML = generateFilterStars();
            setupBackupReminder(null);
            setRecipesPerRow(4);
            drawGridIcons();
            applyTimerVisibility(false);
            initializeTimer();
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

    // פונקציה שמחזירה תמונת ברירת מחדל אקראית לפי קטגוריה
    function getRandomDefaultImageForCategory(category) {
        if (category && defaultImagesByCategory[category]) {
            const images = defaultImagesByCategory[category];
            const randomIndex = Math.floor(Math.random() * images.length);
            return images[randomIndex];
        }
        
        // אם אין קטגוריה או שהקטגוריה לא קיימת, השתמש בתיקיית 'other'
        const otherImages = [
            '/default-images/other/1.jpg',
            '/default-images/other/2.jpg',
            '/default-images/other/3.jpg'
        ];
        return otherImages[Math.floor(Math.random() * otherImages.length)];
    }

    // פונקציה שמתקנת נתיב תמונה - אם זה רק שם קובץ, מוסיפה את הנתיב המלא לפי קטגוריה
    function fixImagePath(imagePath, category) {
        if (!imagePath || imagePath.trim() === '') {
            return getRandomDefaultImageForCategory(category);
        }
        
        // אם זה נתיב מלא (מתחיל ב-http, data:), החזר כפי שהוא
        if (imagePath.startsWith('http://') || 
            imagePath.startsWith('https://') || 
            imagePath.startsWith('data:')) {
            return imagePath;
        }
        
        // אם זה נתיב מוחלט שמתחיל ב-/, החזר כפי שהוא
        if (imagePath.startsWith('/')) {
            return imagePath;
        }
        
        // אם זה נתיב יחסי שמתחיל ב-assets/default-images/, המר ל-default-images/
        if (imagePath.startsWith('assets/default-images/')) {
            return '/' + imagePath.replace('assets/', '');
        }
        
        // אם זה נתיב יחסי שמתחיל ב-default-images/, הוסף /
        if (imagePath.startsWith('default-images/')) {
            return '/' + imagePath;
        }
        
        // אם זה רק שם קובץ (כמו "1.jpg" ללא נתיב), מצא את הנתיב המלא לפי קטגוריה
        const fileName = imagePath;
        if (category && defaultImagesByCategory[category]) {
            const images = defaultImagesByCategory[category];
            // חפש תמונה עם אותו שם קובץ
            const matchingImage = images.find(img => img.endsWith('/' + fileName) || img.endsWith(fileName));
            if (matchingImage) {
                return matchingImage;
            }
        }
        
        // אם לא נמצא, נסה לחפש בכל הקטגוריות
        for (const cat in defaultImagesByCategory) {
            const images = defaultImagesByCategory[cat];
            const matchingImage = images.find(img => img.endsWith('/' + fileName) || img.endsWith(fileName));
            if (matchingImage) {
                return matchingImage;
            }
        }
        
        // אם לא נמצא בכלל, השתמש בתמונת ברירת מחדל
        return getRandomDefaultImageForCategory(category);
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
            // וודא שאין מפתח id קיים בעת ייבוא
            if (newRecipe.id !== undefined) {
              delete newRecipe.id;
            }
            // וודא שיש תמונה תקינה או תמונת ברירת מחדל
            if (!newRecipe.image || newRecipe.image.trim() === '') {
              newRecipe.image = getRandomDefaultImageForCategory(newRecipe.category);
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
          displayRecipes(recipes);
          
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

      console.log('Displaying recipes:', recipesToShow);

      if (!Array.isArray(recipesToShow)) {
        console.error('Invalid recipes array:', recipesToShow);
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

        // תמונת המתכון
        const img = document.createElement('img');
        img.src = fixImagePath(recipe.image, recipe.category);
        img.alt = recipe.name;
        let errorCount = 0;
        img.onerror = function() {
          errorCount++;
          // אם התמונה נכשלה בטעינה, השתמש בתמונת ברירת מחדל
          // אבל רק פעם אחת כדי למנוע לולאה אינסופית
          if (errorCount === 1) {
            const fallbackImage = getRandomDefaultImageForCategory(recipe.category);
            // בדוק שהתמונה החדשה שונה מהקודמת כדי למנוע לולאה
            if (this.src !== fallbackImage) {
              this.src = fallbackImage;
            } else {
              // אם גם תמונת ברירת המחדל נכשלה, השתמש בתמונה ריקה או תמונת placeholder
              this.style.display = 'none';
              this.onerror = null; // עצור את הלולאה
            }
          } else {
            // אם כבר ניסינו פעם אחת, עצור את הלולאה
            this.style.display = 'none';
            this.onerror = null;
          }
        };
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

        // Create overlay container for action buttons on hover
        const overlayButtons = document.createElement('div');
        overlayButtons.className = 'action-buttons-overlay';
        overlayButtons.innerHTML = `
           <button class="action-btn" onclick="event.stopPropagation(); editRecipe(${actualIndex})" data-tooltip="ערוך">
             <i class="fas fa-edit"></i>
           </button>
           <button class="action-btn" onclick="event.stopPropagation(); shareRecipe(${actualIndex})" data-tooltip="שתף">
             <i class="fas fa-share"></i>
           </button>
           <button class="action-btn" onclick="event.stopPropagation(); downloadRecipe(${actualIndex})" data-tooltip="הורד">
             <i class="fas fa-download"></i>
           </button>
           <button class="action-btn" onclick="event.stopPropagation(); confirmDeleteRecipe(${actualIndex})" data-tooltip="מחק">
             <i class="fas fa-trash"></i>
           </button>
        `;
        card.appendChild(overlayButtons);

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
            <img src="${fixImagePath(recipe.image, recipe.category)}" alt="${recipe.name}" onerror="this.src=getRandomDefaultImageForCategory('${recipe.category}')">
            <div class="recipe-image-overlay"></div>
            <div class="recipe-image-content">
              <span class="recipe-category-badge">${recipe.category}</span>
              <h2 class="recipe-image-title">הצצה למנה המושלמת</h2>
            </div>
          </div>

          <!-- Content Section (Right) -->
          <div class="recipe-content-section">
            <!-- Sticky Header -->
            <div class="recipe-content-header">
              <div class="recipe-header-info">
                <h1 class="recipe-main-title">${recipe.name}</h1>
                <p class="recipe-source-link">מקור: <a href="${recipe.recipeLink || '#'}" target="_blank">${recipe.source || 'לא ידוע'}</a></p>
              </div>
              <div class="recipe-header-actions">
                <button class="recipe-create-image-btn" onclick="regenerateImage(${index})">
                    צור תמונה חדשה
                </button>
                <div class="recipe-actions-row">
                    <button class="recipe-action-btn" onclick="editRecipe(${index})" title="ערוך">
                        <span class="material-symbols-outlined">edit</span>
                    </button>
                    <button class="recipe-action-btn" onclick="confirmDeleteRecipe(${index})" title="מחק">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                    <button class="recipe-action-btn" onclick="shareRecipe(${index})" title="שתף">
                        <span class="material-symbols-outlined">share</span>
                    </button>
                    <button class="recipe-action-btn" onclick="downloadRecipe(${index})" title="הורד">
                        <span class="material-symbols-outlined">download</span>
                    </button>
                </div>
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
                  <div class="flex">
                    <span class="material-symbols-outlined text-[14px] text-orange-400 fill-current">star</span>
                    <span class="material-symbols-outlined text-[14px] text-orange-400 fill-current">star</span>
                    <span class="material-symbols-outlined text-[14px] text-gray-300">star</span>
                  </div>
                </div>
                <div class="meta-item">
                  <span class="material-symbols-outlined meta-icon" style="color: #60a5fa;">category</span>
                  <span class="meta-label">קטגוריה</span>
                  <span class="meta-value">${recipe.category}</span>
                </div>
                <div class="meta-item">
                  <div class="flex mb-1">
                    ${ratingStars}
                  </div>
                  <span class="meta-label">דירוג</span>
                  <span class="meta-value">${currentRating.toFixed(1)}</span>
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
      if (typeof location !== 'undefined' && location.pathname && location.pathname.startsWith('/recipe/') && typeof history !== 'undefined' && history.replaceState) {
        history.replaceState({}, '', '/');
      }
      popup.classList.remove('visible');
      popup.style.display = 'none';
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
    }

    function copyRecipeLink(index) {
      if (!recipes[index] || !recipes[index].id) {
        alert('לא ניתן להעתיק קישור למתכון שלא נשמר.');
        return;
      }
      var url = (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : '') + '/recipe/' + recipes[index].id;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() { alert('הקישור הועתק'); }).catch(function() { alert('הקישור: ' + url); });
      } else {
        alert('הקישור: ' + url);
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

      // Create loading indicator
      const loadingDiv = document.createElement('div');
      loadingDiv.id = 'regenerateLoading';
      loadingDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 20px 40px; border-radius: 10px; z-index: 10000; font-size: 18px;';
      loadingDiv.textContent = 'מייצר תמונה חדשה...';
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

        if (data.success && data.image) {
          // Update local recipe data
          recipes[index].image = data.image;

          // Refresh the display
          displayRecipes(recipes);
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

    // עדכון הקטגוריות בעת פתיחת הטופס
    function openFormPopup() {
        document.getElementById('formPopup').style.display = 'flex';
        document.getElementById('newCategory').style.display = 'none';
        document.getElementById('toggleNewCategory').textContent = '+ קטגוריה חדשה';
        document.getElementById('category').style.display = 'block';

        // איפוס הטופס
        document.getElementById('recipeForm').reset();
        editingIndex = -1;
        aiGeneratedImage = null; // איפוס תמונה שנוצרה ע"י AI
        
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
    }

    function closeFormPopup() {
      document.getElementById('formPopup').style.display = 'none';
      document.getElementById('recipeForm').reset();
      editingIndex = -1;
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
        displayRecipes(recipes);
        
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
              ${recipe.image ? `<img src="${recipe.image}" alt="תמונה של ${recipe.name}">` : ''}
              <p><strong>קטגוריה:</strong> ${recipe.category}</p>
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
        displayRecipes(recipes);
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

    function resetSearch() {
      document.getElementById('searchName').value = '';
      const searchIngredientsEl = document.getElementById('searchIngredients');
      if (searchIngredientsEl) searchIngredientsEl.value = '';
      const searchPrepTimeEl = document.getElementById('searchPrepTime');
      if (searchPrepTimeEl) searchPrepTimeEl.value = '';
      selectedCategory = null;
      resetFilterStars();
      displayRecipes(recipes);
      // Update active state of category buttons
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
            // וודא שיש תמונה תקינה או תמונת ברירת מחדל
            if (!newRecipe.image || newRecipe.image.trim() === '') {
              newRecipe.image = getRandomDefaultImageForCategory(newRecipe.category);
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
          displayRecipes(recipes);
          
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
                ${recipe.image ? `<img src="${recipe.image}" alt="תמונה של ${recipe.name}">` : ''}
                <p><strong>קטגוריה:</strong> ${recipe.category}</p>
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
                ${recipe.image ? `<img src="${recipe.image}" alt="תמונה של ${recipe.name}">` : ''}
                <p><strong>קטגוריה:</strong> ${recipe.category}</p>
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
      document.getElementById('grid4').classList.remove('active');
      document.getElementById('grid5').classList.remove('active');
      document.getElementById('grid6').classList.remove('active');
      document.getElementById('grid' + number).classList.add('active');
      saveSetting('recipesPerRow', number);
    }

    // ציור אייקוני הגריד
    function drawGridIcons() {
      const grids = [
        { id: 'grid4', cols: 4 },
        { id: 'grid5', cols: 5 },
        { id: 'grid6', cols: 6 }
      ];

      grids.forEach(grid => {
        const element = document.getElementById(grid.id);
        if (!element) return;
        
        // נקה את התוכן הקיים
        element.innerHTML = '';
        
        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 40;
        const ctx = canvas.getContext('2d');

        const cols = grid.cols;
        const rows = 1;
        const cellWidth = canvas.width / cols;
        const cellHeight = canvas.height / rows;

        for (let i = 0; i < cols; i++) {
          ctx.strokeStyle = '#333';
          ctx.strokeRect(i * cellWidth, 0, cellWidth, cellHeight);
        }

        element.appendChild(canvas);
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

    function renderAiChatMessages() {
      const el = document.getElementById('aiChatMessages');
      if (!el) return;
      el.innerHTML = '';
      aiChatMessages.forEach(function(m) {
        const d = document.createElement('div');
        d.className = 'ai-chat-msg ' + (m.role === 'user' ? 'user' : 'assistant');

        if (m.role !== 'user') {
          const chefIcon = document.createElement('img');
          chefIcon.src = '/icons/chef-speaking.svg';
          chefIcon.onerror = function() {
            this.onerror = null;
            this.src = '/assets/icons/chef-speaking.svg';
          };
          chefIcon.alt = 'שף';
          chefIcon.className = 'chef-msg-icon';
          d.appendChild(chefIcon);
        }

        // Add text content
        const textSpan = document.createElement('span');
        textSpan.textContent = m.content || '';
        d.appendChild(textSpan);

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

        el.appendChild(d);
      });

      // Show pending recipe confirmation buttons if there's a suggested recipe waiting
      if (pendingSuggestedRecipe) {
        const confirmDiv = document.createElement('div');
        confirmDiv.className = 'ai-chat-recipe-confirm';
        confirmDiv.innerHTML = `
          <div class="recipe-preview">
            <strong>${pendingSuggestedRecipe.name}</strong>
            <p>קטגוריה: ${pendingSuggestedRecipe.category || 'שונות'}</p>
          </div>
          <div class="recipe-confirm-buttons">
            <button class="confirm-add-btn" onclick="confirmAddSuggestedRecipe()">
              <i class="fas fa-plus"></i> הוסף לספר
            </button>
            <button class="confirm-edit-btn" onclick="editSuggestedRecipe()">
              <i class="fas fa-edit"></i> ערוך לפני הוספה
            </button>
            <button class="confirm-cancel-btn" onclick="cancelSuggestedRecipe()">
              <i class="fas fa-times"></i> לא תודה
            </button>
          </div>
        `;
        el.appendChild(confirmDiv);
      }

      el.scrollTop = el.scrollHeight;
    }

    // Add suggested recipe to the book after user confirmation
    async function confirmAddSuggestedRecipe() {
      if (!pendingSuggestedRecipe) return;

      // Send confirmation message to AI
      var input = document.getElementById('aiChatInput');
      if (input) input.value = 'כן, תוסיף את המתכון לספר';
      await sendAiMessage();
    }

    // Open form to edit recipe before adding
    function editSuggestedRecipe() {
      if (!pendingSuggestedRecipe) return;
      applySuggestedRecipe(pendingSuggestedRecipe);
      pendingSuggestedRecipe = null;
    }

    // Cancel adding the suggested recipe
    function cancelSuggestedRecipe() {
      pendingSuggestedRecipe = null;
      aiChatMessages.push({
        role: 'assistant',
        content: 'בסדר, לא הוספתי את המתכון. אם תרצה משהו אחר, אני כאן!'
      });
      renderAiChatMessages();
    }

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
        const { data, error } = await supabase
          .from('chat_conversations')
          .select('id, title, updated_at, last_message_preview')
          .order('updated_at', { ascending: false })
          .limit(30);
        if (error) {
          console.error('Error loading conversations:', error);
          return [];
        }
        return data || [];
      } catch (e) {
        console.error('Error loading conversations:', e);
        return [];
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
    }

    async function startNewConversation() {
      currentConversationId = await createNewConversation();
      aiChatMessages = [];
      chatAttachments = [];

      aiChatMessages.push({
        role: 'assistant',
        content: 'שיחה חדשה! אני יכול לחפש מתכונים, להמציא מתכונים חדשים, או לעזור לך להוסיף מתכון. במה אוכל לעזור?'
      });

      conversationHistory = await loadConversationHistory();
      renderConversationHistory();
      renderAiChatMessages();
      clearAttachmentPreview();
      var input = document.getElementById('aiChatInput');
      if (input) input.focus();
    }

    function toggleChatHistory() {
      const history = document.getElementById('aiChatHistory');
      if (history) {
        history.classList.toggle('collapsed');
      }
    }

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
        content: 'שלום! אני יכול לחפש מתכונים קיימים, להמציא מתכונים חדשים מהדמיון שלי, או לעזור לך להוסיף מתכון משלך. במה אוכל לעזור?'
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
      // Store AI-generated image for use when saving
      aiGeneratedImage = suggestedRecipe.image || null;
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
        attachments: chatAttachments.slice() // copy array
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

      var loading = document.createElement('div');
      loading.className = 'ai-chat-msg loading chef-typing-container';
      loading.id = 'aiChatLoading';
      loading.setAttribute('aria-label', 'השף כותב...');
      loading.innerHTML = '<img src="/icons/chef-typing.svg" alt="השף כותב..." class="chef-typing" onerror="this.onerror=null; this.src=\'/assets/icons/chef-typing.svg\';">';
      var msgsEl = document.getElementById('aiChatMessages');
      if (msgsEl) msgsEl.appendChild(loading);

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
          var loadEl = document.getElementById('aiChatLoading');
          if (loadEl) loadEl.remove();
          if (sendBtn) sendBtn.disabled = false;

          var reply = (data && data.reply) ? data.reply : (data && data.error) ? data.error : 'לא התקבלה תשובה.';
          if (!reply && res && !res.ok) reply = 'שגיאה מהשרת (' + (res.status || '') + '). נא לבדוק GEMINI_API_KEY ב-Supabase Secrets.';

          var assistantMessage = { role: 'assistant', content: reply };
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
            displayRecipes(recipes);
            updateCategoryList();
            updateCategoryButtons();
            var idx = recipes.findIndex(function(r) { return r && r.id === data.insertedRecipeId; });
            if (idx >= 0) showRecipe(idx);
          } else if (data && data.regenerateImageForRecipeId && data.regeneratedImage) {
            // Handle image regeneration from AI
            closeAiChat();
            var idx = recipes.findIndex(function(r) { return r && r.id === data.regenerateImageForRecipeId; });
            if (idx >= 0) {
              recipes[idx].image = data.regeneratedImage;
              displayRecipes(recipes);
              showRecipe(idx);
            }
          } else if (recipeIds.length > 0) {
            var filtered = recipes.filter(function(r) { return r.id && recipeIds.indexOf(r.id) !== -1; });
            displayRecipes(filtered);
          } else if (data && data.suggestedRecipe) {
            // Store suggested recipe for user confirmation (don't auto-add)
            pendingSuggestedRecipe = data.suggestedRecipe;
            renderAiChatMessages(); // Re-render to show confirmation buttons
          }
        })
        .catch(function(err) {
          if (err && err.name === 'AbortError') return;
          var loadEl = document.getElementById('aiChatLoading');
          if (loadEl) loadEl.remove();
          if (sendBtn) sendBtn.disabled = false;
          aiChatMessages.push({ role: 'assistant', content: 'לא ניתן להתחבר ל-AI. נא לבדוק חיבור וכו\'.' });
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

    // פונקציות לפתיחת וסגירת תפריט הצד
    function openMenu() {
      document.getElementById('sideMenu').style.width = '250px';
    }

    function closeMenu() {
      document.getElementById('sideMenu').style.width = '0';
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
        searchContainer.style.display = 'none';
        if (filterIcon) {
          filterIcon.style.color = '#64748b';
          filterIcon.classList.remove('active');
        }
      } else {
        // Use 'block' display for the main filter panel container
        searchContainer.style.display = 'block';
        if (filterIcon) {
          filterIcon.style.color = 'var(--secondary)';
          filterIcon.classList.add('active');
        }
      }
    }

    // חשיפת הפונקציות לחלון הגלובלי כדי שהן יהיו נגישות מ-onclick
    window.openFormPopup = openFormPopup;
    window.closeFormPopup = closeFormPopup;
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
    window.openMenu = openMenu;
    window.closeMenu = closeMenu;
    window.toggleFilterPanel = toggleFilterPanel;
    window.setRecipesPerRow = setRecipesPerRow;
    window.openAiChat = openAiChat;
    window.closeAiChat = closeAiChat;
    window.sendAiMessage = sendAiMessage;
    window.toggleVoiceRecording = toggleVoiceRecording;
    window.regenerateImage = regenerateImage;
    window.startNewConversation = startNewConversation;
    window.toggleChatHistory = toggleChatHistory;
    window.handleChatFileSelect = handleChatFileSelect;
    window.confirmAddSuggestedRecipe = confirmAddSuggestedRecipe;
    window.editSuggestedRecipe = editSuggestedRecipe;
    window.cancelSuggestedRecipe = cancelSuggestedRecipe;

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

    function playMelodyOnce() {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        currentMelodyContext = audioContext;
        const masterGain = audioContext.createGain();
        masterGain.gain.value = 0.12;
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
            gainNode.gain.linearRampToValueAtTime(0.18, t + 0.02);
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
        const timerContainer = document.querySelector('.timer-container');

        if (!startBtn || !pauseBtn || !stopBtn || !display || !timerContainer) return;

        startBtn.style.display = 'none';
        pauseBtn.style.display = 'flex';
        stopBtn.style.display = 'flex';
        display.classList.add('active');
        timerContainer.classList.add('is-running');

        timerEndTime = Date.now() + (timerPaused ? pausedTimeRemaining : totalSeconds * 1000);
        timerPaused = false;
        pausedTimeRemaining = 0;

        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            const now = Date.now();
            const remaining = Math.max(0, timerEndTime - now);

            if (remaining === 0) {
                clearInterval(timerInterval);
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
                        display.textContent = '';
                        timerContainer.classList.remove('is-running');
                    }
                }, 4000);

                // כשהטיימר מסתיים, נציג את כפתור ההתחלה ונסתיר את כפתור ההשהיה
                startBtn.style.display = 'flex';
                pauseBtn.style.display = 'none';
                // נשאיר את כפתור העצירה מוצג כדי שאפשר יהיה לעצור את הצפצוף
                stopBtn.style.display = 'flex';
                display.classList.remove('active');
                display.textContent = '';
                timerContainer.classList.remove('is-running');
                return;
            }

            display.textContent = formatTime(Math.ceil(remaining / 1000));
        }, 1000);
    }

    function pauseTimer() {
        const startBtn = document.getElementById('start-timer');
        const pauseBtn = document.getElementById('pause-timer');
        const display = document.getElementById('timer-display');
        const timerContainer = document.querySelector('.timer-container');

        if (!startBtn || !pauseBtn || !display || !timerContainer) return;

        clearInterval(timerInterval);
        timerPaused = true;
        pausedTimeRemaining = Math.max(0, timerEndTime - Date.now());

        startBtn.style.display = 'flex';
        pauseBtn.style.display = 'none';
        display.classList.remove('active');
        timerContainer.classList.remove('is-running');
    }

    function stopTimer() {
        const startBtn = document.getElementById('start-timer');
        const pauseBtn = document.getElementById('pause-timer');
        const stopBtn = document.getElementById('stop-timer');
        const display = document.getElementById('timer-display');
        const timerContainer = document.querySelector('.timer-container');

        if (!startBtn || !pauseBtn || !stopBtn || !display || !timerContainer) return;

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
        display.textContent = '';
        timerContainer.classList.remove('is-running');
    }

    function togglePresetMenu() {
        const menu = document.getElementById('timer-preset-menu');
        if (!menu) return;
        menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
    }

    function initializeTimer() {
        const startButton = document.getElementById('start-timer');
        const pauseButton = document.getElementById('pause-timer');
        const stopButton = document.getElementById('stop-timer');
        const presetButton = document.getElementById('timer-preset');
        const showTimerButton = document.getElementById('show-timer-btn');
        const timerContainer = document.querySelector('.timer-container');
        const hoursInput = document.getElementById('timer-hours');
        const minutesInput = document.getElementById('timer-minutes');
        const secondsInput = document.getElementById('timer-seconds');

        // בדיקה שכל האלמנטים קיימים לפני הוספת event listeners
        if (!startButton || !pauseButton || !stopButton || !presetButton || !showTimerButton || !timerContainer || !hoursInput || !minutesInput || !secondsInput) {
            console.warn('Timer elements not found, skipping timer initialization');
            return;
        }

        // טיימר טוגל
        showTimerButton.addEventListener('click', () => {
            const isVisible = timerContainer.style.display !== 'none';
            timerContainer.style.display = isVisible ? 'none' : 'block';
            showTimerButton.style.display = isVisible ? 'flex' : 'none';
            saveSetting('timerVisible', !isVisible);
        });

        // אתחול הטיימר
        startButton.addEventListener('click', startTimer);
        pauseButton.addEventListener('click', pauseTimer);
        stopButton.addEventListener('click', stopTimer);
        presetButton.addEventListener('click', togglePresetMenu);

        // הגדרת זמנים מראש
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const seconds = parseInt(btn.dataset.time);
                setTimeInputs(seconds);
                const presetMenu = document.getElementById('timer-preset-menu');
                if (presetMenu) {
                    presetMenu.style.display = 'none';
                }
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

    function filterRecipes() {
      const searchName = document.getElementById('searchName').value.toLowerCase().trim();
      const searchIngredientsEl = document.getElementById('searchIngredients');
      const searchIngredients = searchIngredientsEl ? searchIngredientsEl.value.toLowerCase().trim() : '';
      const searchPrepTimeEl = document.getElementById('searchPrepTime');
      const searchPrepTime = searchPrepTimeEl ? parseInt(searchPrepTimeEl.value) || 0 : 0;
      const selectedRating = getSelectedRating();

      // וודא שיש מתכונים לסנן
      if (!Array.isArray(recipes) || recipes.length === 0) {
        console.log('No recipes to filter');
        displayRecipes([]);
        return;
      }

      // אם אין פילטרים פעילים, הצג את כל המתכונים
      if (!searchName && !searchIngredients && !selectedCategory && !selectedRating && !searchPrepTime) {
        console.log('No filters active, showing all recipes:', recipes.length);
        displayRecipes(recipes);
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

        return nameMatch && ingredientsMatch && categoryMatch && ratingMatch && prepTimeMatch;
      });
      
      console.log('Filtered recipes:', filteredRecipes.length, 'out of', recipes.length);
      displayRecipes(filteredRecipes);
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

    // Category icon mapping
    const categoryIcons = {
      'כל הקטגוריות': 'restaurant',
      'לחמים': 'bakery_dining',
      'מרקים': 'soup_kitchen',
      'מנה עיקרית': 'dinner_dining',
      'תוספות': 'lunch_dining',
      'סלטים': 'eco',
      'שונות': 'restaurant_menu',
      'עוגות': 'cake',
      'קינוחים': 'icecream'
    };

    // Category color mapping for icons and backgrounds (matching the design example)
    const categoryColors = {
      'כל הקטגוריות': 'teal',    // Teal/green for "All"
      'לחמים': 'amber',           // Amber/yellow for bakery
      'מרקים': 'blue',            // Blue for soups
      'מנה עיקרית': 'red',        // Red for main dishes
      'תוספות': 'purple',         // Purple for sides
      'סלטים': 'emerald',         // Bright green for salads/healthy
      'שונות': 'blue',            // Blue for other
      'עוגות': 'amber',           // Amber/yellow for cakes
      'קינוחים': 'rose'           // Bright pink for desserts
    };

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
      const categories = getUniqueCategories();
      const categoryFilter = document.getElementById('categoryFilter');
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
      document.getElementById('instructions').value = recipe.instructions || '';
      document.getElementById('preparationTime').value = recipe.preparationTime || '';
      document.getElementById('category').value = recipe.category || 'שונות';
      document.getElementById('notes').value = recipe.notes || '';
      document.getElementById('recipeVideo').value = recipe.videoUrl || '';
      document.getElementById('recipeLink').value = recipe.recipeLink || '';

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
        displayRecipes(recipes);
        
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
      
      const name = document.getElementById('recipeName').value;
      const source = document.getElementById('recipeSource').value;
      const ingredients = document.getElementById('ingredients').value;
      const instructions = document.getElementById('instructions').value;
      const preparationTime = document.getElementById('preparationTime').value ? parseInt(document.getElementById('preparationTime').value) : null;
      const notes = document.getElementById('notes').value;
      const recipeLink = document.getElementById('recipeLink').value;
      const recipeVideo = document.getElementById('recipeVideo').value;
      const imageFile = document.getElementById('image').files[0];
      
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

      let imageData = null;
      if (imageFile) {
        await new Promise(resolve => {
          resizeImage(imageFile, 800, 800, function(dataUrl) {
            imageData = dataUrl;
            resolve();
          });
        });
      } else if (editingIndex >= 0 && recipes[editingIndex].image) {
        // אם אין תמונה חדשה ואנחנו במצב עריכה, נשמור את התמונה הקיימת
        imageData = recipes[editingIndex].image;
      } else if (aiGeneratedImage) {
        // אם יש תמונה שנוצרה ע"י AI, נשתמש בה
        imageData = aiGeneratedImage;
      }
      // Reset AI generated image after use
      aiGeneratedImage = null;

      const recipe = {
        name,
        source,
        ingredients,
        instructions,
        category,
        notes,
        preparationTime,
        rating: editingIndex >= 0 ? recipes[editingIndex].rating || 0 : 0,
        image: imageData,
        recipeLink,
        videoUrl: recipeVideo
      };

      let recipeToSave;
      if (editingIndex >= 0) {
        recipes[editingIndex] = { ...recipes[editingIndex], ...recipe };
        recipeToSave = recipes[editingIndex];
        editingIndex = -1;
      } else {
        recipes.push(recipe);
        recipeToSave = recipe;
      }

      await saveRecipeToDB(recipeToSave);
      displayRecipes(recipes);
      updateCategoryList();
      updateCategoryButtons();
      closeFormPopup();
    });

    function toggleCategoryInput() {
        const select = document.getElementById('category');
        const newCategoryInput = document.getElementById('newCategory');
        const toggleButton = document.getElementById('toggleNewCategory');

        if (newCategoryInput.style.display === 'none') {
            select.style.display = 'none';
            newCategoryInput.style.display = 'block';
            toggleButton.textContent = 'חזור לרשימת הקטגוריות';
            select.required = false;
            newCategoryInput.required = true;
        } else {
            select.style.display = 'block';
            newCategoryInput.style.display = 'none';
            toggleButton.textContent = '+ קטגוריה חדשה';
            select.required = true;
            newCategoryInput.required = false;
            newCategoryInput.value = '';
        }
    }

    window.toggleCategoryInput = toggleCategoryInput;
})();