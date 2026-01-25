(() => {
    let recipes = [];
    let editingIndex = -1;
    let selectedCategory = null;
    let backupReminderTimeout;
    let aiChatMessages = [];
    let aiChatAbortController = null;

    // קונפיגורציית Supabase מתוך .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
    const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL;
    const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY;
    const _supa = (typeof window !== 'undefined' && window.supabase) ? window.supabase : null;
    const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY && _supa && typeof _supa.createClient === 'function')
        ? _supa.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
        : null;

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
            video_url: r.videoUrl || null
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
            videoUrl: row.video_url
        };
    }

    // שמירת מתכונים ל-Supabase
    async function saveRecipesToDB(recipesToSave) {
        if (!supabase) throw new Error('Supabase לא אותחל. ודא שסקריפט Supabase נטען.');

        const idsToKeep = recipesToSave.map(r => r.id).filter(Boolean);

        // מחיקת רשומות שנמחקו מהמערך
        const { data: existing } = await supabase.from('recipes').select('id');
        const toDelete = (existing || []).filter(e => !idsToKeep.includes(e.id)).map(e => e.id);
        for (const id of toDelete) {
            await supabase.from('recipes').delete().eq('id', id);
        }

        for (const recipe of recipesToSave) {
            const row = recipeToRow(recipe);
            if (recipe.id) {
                await supabase.from('recipes').update(row).eq('id', recipe.id);
            } else {
                const { data, error } = await supabase.from('recipes').insert(row).select('id').single();
                if (error) throw error;
                recipe.id = data.id;
            }
        }
    }

    // טעינת מתכונים מ-Supabase
    async function loadRecipesFromDB() {
        if (!supabase) throw new Error('Supabase לא אותחל. ודא שסקריפט Supabase נטען.');

        const { data, error } = await supabase
            .from('recipes')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) throw error;
        return (data || []).map(rowToRecipe);
    }

    // טעינת והגדרת ההגדרות (מחליף localStorage)
    async function loadSettings() {
        if (!supabase) return { lastBackup: null, recipesPerRow: 6, timerVisible: false };

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
            recipesPerRow: m.recipesPerRow || 6,
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
            recipes = await loadRecipesFromDB();
            if (!Array.isArray(recipes)) recipes = [];
            const settings = await loadSettings();

            displayRecipes(recipes);
            updateCategoryList();
            updateCategoryButtons();
            document.getElementById('filterRating').innerHTML = generateFilterStars();
            setupBackupReminder(settings.lastBackup);
            setRecipesPerRow(settings.recipesPerRow || 6);
            drawGridIcons();
            applyTimerVisibility(settings.timerVisible);
            initializeTimer();
            setupPopupCloseOnOverlayClick();
            handleInitialRoute();
            window.addEventListener('popstate', function() {
              var p = document.getElementById('popup');
              if (p && p.style.display === 'flex') closePopup();
            });
        } catch (error) {
            console.error('שגיאה בטעינת מתכונים:', error);
            recipes = [];
            displayRecipes([]);
            updateCategoryList();
            updateCategoryButtons();
            var fr = document.getElementById('filterRating');
            if (fr) fr.innerHTML = generateFilterStars();
            setupBackupReminder(null);
            setRecipesPerRow(6);
            drawGridIcons();
            applyTimerVisibility(false);
            initializeTimer();
            setupPopupCloseOnOverlayClick();
            handleInitialRoute();
            window.addEventListener('popstate', function() {
                var p = document.getElementById('popup');
                if (p && p.style.display === 'flex') closePopup();
            });
        }
    }

    // אובייקט המכיל את תמונות ברירת המחדל לפי קטגוריות
    const defaultImagesByCategory = {
        'לחמים': [
            'assets/default-images/breads/1.jpg',
            'assets/default-images/breads/2.jpg',
            'assets/default-images/breads/3.jpg'
        ],
        'מרקים': [
            'assets/default-images/soups/1.jpg',
            'assets/default-images/soups/2.jpg',
            'assets/default-images/soups/3.jpg'
        ],
        'מנה עיקרית': [
            'assets/default-images/main-dishes/1.jpg',
            'assets/default-images/main-dishes/2.jpg',
            'assets/default-images/main-dishes/3.jpg'
        ],
        'תוספות': [
            'assets/default-images/sides/1.jpg',
            'assets/default-images/sides/2.jpg',
            'assets/default-images/sides/3.jpg'
        ],
        'סלטים': [
            'assets/default-images/salads/1.jpg',
            'assets/default-images/salads/2.jpg',
            'assets/default-images/salads/3.jpg'
        ],
        'שונות': [
            'assets/default-images/other/1.jpg',
            'assets/default-images/other/2.jpg',
            'assets/default-images/other/3.jpg'
        ],
        'עוגות': [
            'assets/default-images/cakes/1.jpg',
            'assets/default-images/cakes/2.jpg',
            'assets/default-images/cakes/3.jpg'
        ],
        'קינוחים': [
            'assets/default-images/desserts/1.jpg',
            'assets/default-images/desserts/2.jpg',
            'assets/default-images/desserts/3.jpg'
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
            'assets/default-images/other/1.jpg',
            'assets/default-images/other/2.jpg',
            'assets/default-images/other/3.jpg'
        ];
        return otherImages[Math.floor(Math.random() * otherImages.length)];
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
            if (!newRecipe.image || !newRecipe.image.startsWith('data:image')) {
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
        if (recipe.image && recipe.image.startsWith('data:image')) {
          img.src = recipe.image;
        } else {
          img.src = getRandomDefaultImageForCategory(recipe.category);
          // שמור את התמונה החדשה במתכון
          recipe.image = img.src;
        }
        img.alt = recipe.name;
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
      
      popupBody.innerHTML = `
        <div class="recipe-full" style="background-image: linear-gradient(rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.1)), url('${recipe.image || getRandomDefaultImageForCategory(recipe.category)}');">
          <div class="recipe-content-overlay">
            <div class="recipe-header">
              <h2 class="recipe-title">${recipe.name}</h2>
              <span class="recipe-source">${recipe.source}</span>
            </div>
            <div class="recipe-flex-container">
              <div class="recipe-right-side">
                <p><strong>קטגוריה:</strong> ${recipe.category}</p>
                <div class="recipe-main-content">
                  <div class="ingredients-section">
                    <p><strong>מצרכים:</strong></p>
                    <ul class="ingredients-list">
                      ${recipe.ingredients.split('\n').map(ingredient => `<li>${ingredient}</li>`).join('')}
                    </ul>
                  </div>
                  <div class="instructions-section">
                    <p><strong>הוראות הכנה:</strong></p>
                    <ul class="instructions-list">
                      ${recipe.instructions.split('\n').map(instruction => `<li>${instruction}</li>`).join('')}
                    </ul>
                  </div>
                </div>
              </div>
              <div class="recipe-left-side">
                <div class="recipe-rating">
                  ${generateStars(recipe.rating || 0, index)}
                </div>
                ${recipe.videoUrl ? `
                  <div class="recipe-video">
                    <iframe width="560" height="315" src="${getYoutubeEmbed(recipe.videoUrl)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                  </div>` : ''}
                ${recipe.recipeLink ? `<div class="recipe-link"><strong>קישור למתכון:</strong><br><a href="${recipe.recipeLink}" target="_blank">${recipe.recipeLink}</a></div>` : ''}
                ${recipe.notes ? `<div class="recipe-notes"><strong>הערות:</strong><br>${recipe.notes}</div>` : ''}
                <div class="action-buttons">
                  <button class="action-btn" onclick="editRecipe(${index})" data-tooltip="ערוך">
                    <i class="fas fa-edit"></i>
                  </button>
                  <button class="action-btn" onclick="confirmDeleteRecipe(${index})" data-tooltip="מחק">
                    <i class="fas fa-trash"></i>
                  </button>
                  <button class="action-btn" onclick="shareRecipe(${index})" data-tooltip="שתף">
                    <i class="fas fa-share"></i>
                  </button>
                  <button class="action-btn" onclick="copyRecipeLink(${index})" data-tooltip="העתק קישור">
                    <i class="fas fa-link"></i>
                  </button>
                  <button class="action-btn" onclick="downloadRecipe(${index})" data-tooltip="הורד">
                    <i class="fas fa-download"></i>
                  </button>
                </div>
              </div>
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

    // עדכון הקטגוריות בעת פתיחת הטופס
    function openFormPopup() {
        document.getElementById('formPopup').style.display = 'flex';
        document.getElementById('newCategory').style.display = 'none';
        document.getElementById('toggleNewCategory').textContent = '+ קטגוריה חדשה';
        document.getElementById('category').style.display = 'block';
        
        // איפוס הטופס
        document.getElementById('recipeForm').reset();
        editingIndex = -1;
        
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
      recipes.splice(index, 1);
      try {
        await saveRecipesToDB(recipes);
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
        await saveRecipesToDB(recipes);
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
        starElement.classList.remove('selected');
        starElement.style.color = 'gray';
        starElement.textContent = '☆';
      }
      if (rating > 0) {
        for (let i = 1; i <= rating; i++) {
          const starElement = document.getElementById(`filterStar${i}`);
          starElement.classList.add('selected');
          starElement.style.color = 'green';
          starElement.textContent = '★';
        }
      }
      filterRecipes();
    }

    function getSelectedRating() {
      const stars = document.querySelectorAll('.filter-rating .selected');
      return stars.length;
    }

    function resetFilterStars() {
      const stars = document.querySelectorAll('.filter-rating span');
      stars.forEach(star => {
        star.classList.remove('selected');
        star.textContent = '☆';
        star.style.color = 'gray';
      });
    }

    function resetSearch() {
      document.getElementById('searchName').value = '';
      document.getElementById('searchIngredients').value = '';
      selectedCategory = '';
      resetFilterStars();
      displayRecipes(recipes);
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
            if (!newRecipe.image || !newRecipe.image.startsWith('data:image')) {
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
      document.getElementById('grid6').classList.remove('active');
      document.getElementById('grid8').classList.remove('active');
      document.getElementById('grid' + number).classList.add('active');
      saveSetting('recipesPerRow', number);
    }

    // ציור אייקוני הגריד
    function drawGridIcons() {
      const grids = [
        { id: 'grid6', cols: 6 },
        { id: 'grid8', cols: 8 }
      ];

      grids.forEach(grid => {
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

        document.getElementById(grid.id).appendChild(canvas);
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
        d.textContent = m.content || '';
        el.appendChild(d);
      });
      el.scrollTop = el.scrollHeight;
    }

    function openAiChat() {
      var ov = document.getElementById('aiChatOverlay');
      if (ov) ov.style.display = 'flex';
      if (aiChatMessages.length === 0) {
        aiChatMessages.push({ role: 'assistant', content: 'שלום! אני כאן כדי לעזור עם מתכונים. תכתוב לי מה תרצה – לחפש מתכון, לקבל רעיונות, או לספר מתכון ואוסיף אותו עבורך. במה אוכל לעזור?' });
      }
      renderAiChatMessages();
      document.getElementById('aiChatInput').value = '';
      document.getElementById('aiChatInput').focus();
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
    }

    function sendAiMessage() {
      var input = document.getElementById('aiChatInput');
      var sendBtn = document.getElementById('aiChatSend');
      var msg = (input && input.value) ? input.value.trim() : '';
      if (!msg) return;

      if (aiChatAbortController) {
        aiChatAbortController.abort();
      }
      aiChatAbortController = new AbortController();

      aiChatMessages.push({ role: 'user', content: msg });
      if (input) input.value = '';
      renderAiChatMessages();
      if (sendBtn) sendBtn.disabled = true;

      var loading = document.createElement('div');
      loading.className = 'ai-chat-msg loading';
      loading.id = 'aiChatLoading';
      loading.textContent = 'מחפש...';
      var msgsEl = document.getElementById('aiChatMessages');
      if (msgsEl) msgsEl.appendChild(loading);

      var url = SUPABASE_URL + '/functions/v1/recipe-ai';
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
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
          aiChatMessages.push({ role: 'assistant', content: reply });
          renderAiChatMessages();

          var recipeIds = (data && Array.isArray(data.recipeIds)) ? data.recipeIds : [];
          if (data && data.insertedRecipeId) {
            closeAiChat();
            recipes = await loadRecipesFromDB();
            if (!Array.isArray(recipes)) recipes = [];
            displayRecipes(recipes);
            updateCategoryList();
            updateCategoryButtons();
            var idx = recipes.findIndex(function(r) { return r && r.id === data.insertedRecipeId; });
            if (idx >= 0) showRecipe(idx);
          } else if (recipeIds.length > 0) {
            var filtered = recipes.filter(function(r) { return r.id && recipeIds.indexOf(r.id) !== -1; });
            displayRecipes(filtered);
          } else if (data && data.suggestedRecipe) {
            applySuggestedRecipe(data.suggestedRecipe);
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

    // פונקציות לפתיחת וסגירת תפריט הצד
    function openMenu() {
      document.getElementById('sideMenu').style.width = '250px';
    }

    function closeMenu() {
      document.getElementById('sideMenu').style.width = '0';
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
    window.setRecipesPerRow = setRecipesPerRow;
    window.openAiChat = openAiChat;
    window.closeAiChat = closeAiChat;
    window.sendAiMessage = sendAiMessage;

    // Timer functionality
    let timerInterval;
    let currentBeepInterval;
    let timerPaused = false;
    let pausedTimeRemaining = 0;
    let timerEndTime = 0;

    function beep(duration, frequency, volume, type) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = type;
        oscillator.frequency.value = frequency;
        gainNode.gain.value = volume;

        oscillator.start();
        setTimeout(() => {
            oscillator.stop();
            audioContext.close();
        }, duration);
    }

    function formatTime(totalSeconds) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    function getTimeInSeconds() {
        const seconds = parseInt(document.getElementById('timer-seconds').value) || 0;
        const minutes = parseInt(document.getElementById('timer-minutes').value) || 0;
        const hours = parseInt(document.getElementById('timer-hours').value) || 0;
        return (hours * 3600) + (minutes * 60) + seconds;
    }

    function setTimeInputs(totalSeconds) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        document.getElementById('timer-seconds').value = seconds;
        document.getElementById('timer-minutes').value = minutes;
        document.getElementById('timer-hours').value = hours;
    }

    function startTimer() {
        const totalSeconds = timerPaused ? Math.ceil(pausedTimeRemaining / 1000) : getTimeInSeconds();
        if (totalSeconds <= 0) return;

        const startBtn = document.getElementById('start-timer');
        const pauseBtn = document.getElementById('pause-timer');
        const stopBtn = document.getElementById('stop-timer');
        const display = document.getElementById('timer-display');

        startBtn.style.display = 'none';
        pauseBtn.style.display = 'flex';
        stopBtn.style.display = 'flex';
        display.classList.add('active');

        timerEndTime = Date.now() + (timerPaused ? pausedTimeRemaining : totalSeconds * 1000);
        timerPaused = false;
        pausedTimeRemaining = 0;

        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            const now = Date.now();
            const remaining = Math.max(0, timerEndTime - now);

            if (remaining === 0) {
                clearInterval(timerInterval);
                // צפצוף למשך דקה - צליל נעים יותר
                let beepCount = 0;
                const totalBeeps = 30; // פחות צפצופים עם הפסקות ארוכות יותר
                currentBeepInterval = setInterval(() => {
                    if (beepCount < totalBeeps) {
                        beep(800, 330, 0.2, 'sine'); // צליל ארוך יותר, תדר נמוך יותר, גל סינוס
                        beepCount++;
                    } else {
                        clearInterval(currentBeepInterval);
                        currentBeepInterval = null;
                        // רק כשהצפצוף מסתיים, נסתיר את כפתור העצירה
                        startBtn.style.display = 'flex';
                        pauseBtn.style.display = 'none';
                        stopBtn.style.display = 'none';
                        display.classList.remove('active');
                        display.textContent = '';
                    }
                }, 2000); // הפסקה של 2 שניות בין הצפצופים

                // כשהטיימר מסתיים, נציג את כפתור ההתחלה ונסתיר את כפתור ההשהיה
                startBtn.style.display = 'flex';
                pauseBtn.style.display = 'none';
                // נשאיר את כפתור העצירה מוצג כדי שאפשר יהיה לעצור את הצפצוף
                stopBtn.style.display = 'flex';
                display.classList.remove('active');
                display.textContent = '';
                return;
            }

            display.textContent = formatTime(Math.ceil(remaining / 1000));
        }, 1000);
    }

    function pauseTimer() {
        const startBtn = document.getElementById('start-timer');
        const pauseBtn = document.getElementById('pause-timer');
        const display = document.getElementById('timer-display');

        clearInterval(timerInterval);
        timerPaused = true;
        pausedTimeRemaining = Math.max(0, timerEndTime - Date.now());

        startBtn.style.display = 'flex';
        pauseBtn.style.display = 'none';
        display.classList.remove('active');
    }

    function stopTimer() {
        const startBtn = document.getElementById('start-timer');
        const pauseBtn = document.getElementById('pause-timer');
        const stopBtn = document.getElementById('stop-timer');
        const display = document.getElementById('timer-display');

        clearInterval(timerInterval);
        if (currentBeepInterval) {
            clearInterval(currentBeepInterval);
            currentBeepInterval = null;
        }

        timerPaused = false;
        pausedTimeRemaining = 0;

        startBtn.style.display = 'flex';
        pauseBtn.style.display = 'none';
        stopBtn.style.display = 'none';
        display.classList.remove('active');
        display.textContent = '';
    }

    function togglePresetMenu() {
        const menu = document.getElementById('timer-preset-menu');
        menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
    }

    function initializeTimer() {
        const startButton = document.getElementById('start-timer');
        const pauseButton = document.getElementById('pause-timer');
        const stopButton = document.getElementById('stop-timer');
        const presetButton = document.getElementById('timer-preset');
        const showTimerButton = document.getElementById('show-timer-btn');
        const timerContainer = document.querySelector('.timer-container');

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
                document.getElementById('timer-preset-menu').style.display = 'none';
            });
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
      const searchIngredients = document.getElementById('searchIngredients').value.toLowerCase().trim();
      const selectedRating = getSelectedRating();

      // וודא שיש מתכונים לסנן
      if (!Array.isArray(recipes) || recipes.length === 0) {
        console.log('No recipes to filter');
        displayRecipes([]);
        return;
      }

      // אם אין פילטרים פעילים, הצג את כל המתכונים
      if (!searchName && !searchIngredients && !selectedCategory && !selectedRating) {
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

        return nameMatch && ingredientsMatch && categoryMatch && ratingMatch;
      });
      
      console.log('Filtered recipes:', filteredRecipes.length, 'out of', recipes.length);
      displayRecipes(filteredRecipes);
    }

    function filterByCategory(category) {
      selectedCategory = category;
      filterRecipes();
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

    function updateCategoryButtons() {
      const categories = getUniqueCategories();
      const categoryFilter = document.getElementById('categoryFilter');
      categoryFilter.innerHTML = '';

      const allButton = document.createElement('button');
      allButton.className = 'category-button';
      allButton.innerHTML = 'כל הקטגוריות';
      allButton.onclick = resetSearch;
      categoryFilter.appendChild(allButton);

      categories.forEach(category => {
        const button = document.createElement('button');
        button.className = 'category-button';
        button.innerHTML = `<span>${category}</span>`;
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
        if (editingIndex === -1) {
          // מתכון חדש
          recipe.rating = 0;
          recipes.push(recipe);
        } else {
          // עריכת מתכון קיים - שומרים על המידע הקיים
          const existingRecipe = recipes[editingIndex];
          recipes[editingIndex] = {
            ...existingRecipe,  // שמירת כל המידע הקיים
            ...recipe,          // עדכון המידע החדש
            rating: editingIndex >= 0 ? recipes[editingIndex].rating || 0 : 0  // שמירת הדירוג הקיים
          };
        }

        await saveRecipesToDB(recipes);
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
      }

      const recipe = {
        name,
        source,
        ingredients,
        instructions,
        category,
        notes,
        rating: editingIndex >= 0 ? recipes[editingIndex].rating || 0 : 0,
        image: imageData,
        recipeLink,
        videoUrl: recipeVideo
      };

      if (editingIndex >= 0) {
        recipes[editingIndex] = { ...recipes[editingIndex], ...recipe };
        editingIndex = -1;
      } else {
        recipes.push(recipe);
      }

      await saveRecipesToDB(recipes);
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