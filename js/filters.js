// Search / filtering: reads the filter UI, filters the recipe list, drives the
// rating filter, the dietary dropdown, and the slide-down filter panel.
// Mutually recursive with recipe-view (filterRecipes -> displayRecipes and
// displayRecipes -> updateFilterHeaderUI); the ESM cycle is safe because every
// cross-call happens at runtime, never at module-evaluation time.
import { recipes, selectedCategory, setSelectedCategory } from './state.js';
import { updateCategoryButtons } from './categories.js';
import { displayRecipes } from './recipe-view.js';

export function generateFilterStars() {
    let stars = '';
    for (let i = 1; i <= 5; i++) {
        stars += `<span onclick="setFilterRating(${i})" id="filterStar${i}">☆</span>`;
    }
    return stars;
}

export function setFilterRating(rating) {
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

export function getSelectedRating() {
    const filterRatingEl = document.getElementById('filterRating');
    if (!filterRatingEl) return 0;
    const stars = filterRatingEl.querySelectorAll('.selected');
    return stars.length;
}

export function resetFilterStars() {
    const filterRatingEl = document.getElementById('filterRating');
    if (!filterRatingEl) return;
    const stars = filterRatingEl.querySelectorAll('span');
    stars.forEach(star => {
        star.classList.remove('selected');
        star.textContent = '☆';
        star.style.color = 'gray';
    });
}

export function getActiveFiltersFromUI() {
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

export function hasAnyActiveFilters(filters) {
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

export function updateFilterHeaderUI(filters, filteredCount) {
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

export function resetSearch() {
    document.getElementById('searchName').value = '';
    const searchIngredientsEl = document.getElementById('searchIngredients');
    if (searchIngredientsEl) searchIngredientsEl.value = '';
    const searchPrepTimeEl = document.getElementById('searchPrepTime');
    if (searchPrepTimeEl) searchPrepTimeEl.value = '';
    const searchDietaryTypeEl = document.getElementById('searchDietaryType');
    if (searchDietaryTypeEl) searchDietaryTypeEl.value = '';
    updateDietarySelectTrigger();
    setSelectedCategory(null);
    resetFilterStars();
    filterRecipes();
    updateCategoryButtons();
}

export function updateDietarySelectTrigger() {
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

export function initDietaryDropdown() {
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

// פאנל סינון – fixed מתחת ל-header + סגירה חכמה
let filterPanelCloseOnClick = null;
let filterPanelCloseOnKey = null;
let filterPanelCloseOnResize = null;
let filterPanelCloseOnScroll = null;
let filterPanelBackdrop = null;

function ensureFilterPanelBackdrop() {
    if (filterPanelBackdrop) return filterPanelBackdrop;
    filterPanelBackdrop = document.getElementById('filterPanelBackdrop');
    if (!filterPanelBackdrop) {
        filterPanelBackdrop = document.createElement('div');
        filterPanelBackdrop.id = 'filterPanelBackdrop';
        filterPanelBackdrop.className = 'filter-panel-backdrop';
        filterPanelBackdrop.setAttribute('aria-hidden', 'true');
        document.body.appendChild(filterPanelBackdrop);
    }
    return filterPanelBackdrop;
}

export function mountFilterPanel() {
    const searchContainer = document.getElementById('searchContainer');
    if (searchContainer && searchContainer.parentElement !== document.body) {
        document.body.appendChild(searchContainer);
    }
    ensureFilterPanelBackdrop();
}

function isFilterPanelOpen() {
    const searchContainer = document.getElementById('searchContainer');
    if (!searchContainer) return false;
    const computedStyle = window.getComputedStyle(searchContainer);
    return searchContainer.style.display !== 'none' &&
        computedStyle.display !== 'none';
}

function updateFilterIconState() {
    const filterIcon = document.querySelector('.header-filter-icon');
    if (!filterIcon) return;
    const panelOpen = isFilterPanelOpen();
    const anyActive = hasAnyActiveFilters(getActiveFiltersFromUI());
    if (panelOpen || anyActive) {
        filterIcon.style.color = 'var(--secondary)';
        filterIcon.classList.add('active');
    } else {
        filterIcon.style.color = '#64748b';
        filterIcon.classList.remove('active');
    }
}

function positionFilterPanel() {
    const header = document.querySelector('.header');
    const searchContainer = document.getElementById('searchContainer');
    if (!header || !searchContainer) return;
    const rect = header.getBoundingClientRect();
    searchContainer.style.top = `${Math.round(rect.bottom + 8)}px`;
    const maxHeight = Math.max(160, window.innerHeight - rect.bottom - 16);
    searchContainer.style.maxHeight = `${maxHeight}px`;
}

function teardownFilterPanelListeners() {
    if (filterPanelCloseOnClick) {
        document.removeEventListener('click', filterPanelCloseOnClick);
        filterPanelCloseOnClick = null;
    }
    if (filterPanelCloseOnKey) {
        document.removeEventListener('keydown', filterPanelCloseOnKey);
        filterPanelCloseOnKey = null;
    }
    if (filterPanelCloseOnResize) {
        window.removeEventListener('resize', filterPanelCloseOnResize);
        filterPanelCloseOnResize = null;
    }
    if (filterPanelCloseOnScroll) {
        window.removeEventListener('scroll', filterPanelCloseOnScroll);
        filterPanelCloseOnScroll = null;
    }
}

export function closeFilterPanel() {
    const searchContainer = document.getElementById('searchContainer');
    if (!searchContainer || !isFilterPanelOpen()) return;

    searchContainer.classList.remove('is-open');
    searchContainer.setAttribute('aria-hidden', 'true');
    const backdrop = ensureFilterPanelBackdrop();
    backdrop.classList.remove('is-open');
    backdrop.style.display = 'none';
    backdrop.setAttribute('aria-hidden', 'true');
    teardownFilterPanelListeners();

    window.setTimeout(function() {
        if (!searchContainer.classList.contains('is-open')) {
            searchContainer.style.display = 'none';
        }
    }, 220);

    updateFilterIconState();
}

export function openFilterPanel() {
    const searchContainer = document.getElementById('searchContainer');
    if (!searchContainer) return;

    mountFilterPanel();
    positionFilterPanel();
    const backdrop = ensureFilterPanelBackdrop();
    backdrop.style.display = 'block';
    backdrop.setAttribute('aria-hidden', 'false');
    searchContainer.style.display = 'block';
    searchContainer.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(function() {
        backdrop.classList.add('is-open');
        searchContainer.classList.add('is-open');
    });

    updateFilterIconState();
    teardownFilterPanelListeners();

    filterPanelCloseOnClick = function(e) {
        if (e.target.closest('#searchContainer') || e.target.closest('.header-filter-icon')) {
            return;
        }
        closeFilterPanel();
    };
    filterPanelCloseOnKey = function(e) {
        if (e.key === 'Escape') closeFilterPanel();
    };
    filterPanelCloseOnResize = function() {
        positionFilterPanel();
    };
    filterPanelCloseOnScroll = function() {
        positionFilterPanel();
    };

    window.setTimeout(function() {
        document.addEventListener('click', filterPanelCloseOnClick);
        document.addEventListener('keydown', filterPanelCloseOnKey);
        window.addEventListener('resize', filterPanelCloseOnResize);
        window.addEventListener('scroll', filterPanelCloseOnScroll, { passive: true });
    }, 0);
}

export function toggleFilterPanel() {
    if (isFilterPanelOpen()) {
        closeFilterPanel();
    } else {
        openFilterPanel();
    }
}

export function filterRecipes() {
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
        const cat = recipe.category && recipe.category.trim();
        const sel = selectedCategory && selectedCategory.trim();
        const categoryMatch = !sel || (cat && (cat === sel || (sel === 'מנות עיקריות' && cat === 'מנה עיקרית')));
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

export function filterByCategory(category) {
    setSelectedCategory(category);
    filterRecipes();
    // Update active state of category buttons
    updateCategoryButtons();
}
