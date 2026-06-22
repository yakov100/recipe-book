// Recipe display: the grid of cards, the full-recipe popup, the shared-recipe
// card, loading skeleton, and inline rating. Mutually recursive with filters
// (see the note in filters.js) — cross-calls are runtime-only, so the cycle
// is safe. Card/popup action buttons call edit/delete/share via window.
import { recipes, isSharedRecipeMode } from './state.js';
import { getDisplayUrl, getDefaultImageUrl } from './images.js';
import { getYoutubeEmbed } from './utils.js';
import { saveRecipeToDB } from './data/recipes-repo.js';
import { updateFilterHeaderUI, getActiveFiltersFromUI, filterRecipes } from './filters.js';

const RECIPES_LOADING_SKELETON_COUNT = 8;

export const DIFFICULTY_LABELS = { 1: 'קל', 2: 'בינוני', 3: 'קשה' };

export function showRecipesLoadingSkeleton() {
    const container = document.getElementById('recipesContainer');
    if (!container) return;
    const skeletonCards = Array.from({ length: RECIPES_LOADING_SKELETON_COUNT }, () =>
        '<div class="recipe-card recipe-card-skeleton" aria-hidden="true"></div>'
    ).join('');
    container.innerHTML =
        '<p class="recipes-loading-label" role="status" aria-live="polite">טוען מתכונים...</p>' +
        skeletonCards;
    container.setAttribute('aria-busy', 'true');
}

export function clearRecipesLoadingState() {
    const container = document.getElementById('recipesContainer');
    if (container) container.removeAttribute('aria-busy');
}

export function displayRecipes(recipesToShow) {
    const container = document.getElementById('recipesContainer');
    clearRecipesLoadingState();
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
        if (!recipe.imagePath && !(typeof recipe.image === 'string' && recipe.image.trim())) {
            card.classList.add('using-default-image');
        }
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

        // כפתורי פעולה על הכרטיס (מוצגים במרחף) – stopPropagation כדי שלחיצה על כפתור לא תפתח את המתכון
        const actionsOverlay = document.createElement('div');
        actionsOverlay.className = 'action-buttons-overlay';
        const escapedName = recipe.name.replace(/'/g, "\\'");
        actionsOverlay.innerHTML = `
          <button type="button" class="recipe-action-btn" onclick="event.stopPropagation(); editRecipe(${actualIndex})" title="ערוך">
            <span class="material-symbols-outlined">edit</span>
          </button>
          <button type="button" class="recipe-action-btn" onclick="event.stopPropagation(); confirmDeleteRecipe(${actualIndex})" title="מחק">
            <span class="material-symbols-outlined">delete</span>
          </button>
          <button type="button" class="recipe-action-btn" onclick="event.stopPropagation(); copyRecipeLink(${actualIndex})" title="העתק קישור">
            <span class="material-symbols-outlined">link</span>
          </button>
          <button type="button" class="recipe-action-btn" onclick="event.stopPropagation(); shareRecipe(${actualIndex})" title="שתף">
            <span class="material-symbols-outlined">share</span>
          </button>
          <button type="button" class="recipe-action-btn" onclick="event.stopPropagation(); downloadRecipe(${actualIndex})" title="הורד">
            <span class="material-symbols-outlined">download</span>
          </button>
        `;
        card.appendChild(actionsOverlay);

        // הוספת הכרטיס למיכל
        container.appendChild(card);
        console.log('Added recipe card:', recipe.name);
    });
}

export function showRecipe(index) {
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
              <button class="recipe-action-btn" onclick="openRecipeTimerDialog('${recipe.name.replace(/'/g, "\\'")}')" title="הגדר טיימר">
                <span class="material-symbols-outlined">timer</span>
              </button>
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

export function closePopup() {
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

export function displaySharedRecipeCard() {
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

export function generateStars(rating, index) {
    let stars = '';
    for (let i = 1; i <= 5; i++) {
        stars += `<span onclick="rateRecipe(${index}, ${i})">${i <= rating ? '★' : '☆'}</span>`;
    }
    return stars;
}

export async function rateRecipe(index, rating) {
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
