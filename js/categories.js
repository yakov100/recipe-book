// Category model + UI: the single source of truth for category names, icons
// and colors, plus the form's category dropdown and the category filter bar.
// resetSearch / filterByCategory live in filters.js and are reached via window
// (they are also inline handlers), which keeps these two core modules decoupled.
import { recipes, selectedCategory } from './state.js';

// אייקון SVG לסוכריה עטופה (ממתקים) – גוף אליפסה, קצוות מפותלים בולטים, פסים אלכסוניים
const CANDY_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><ellipse cx="12" cy="12" rx="5" ry="3" fill="currentColor"/><circle cx="5.5" cy="12" r="2.8" fill="currentColor"/><circle cx="18.5" cy="12" r="2.8" fill="currentColor"/><line x1="8" y1="14.5" x2="11" y2="9.5" stroke="currentColor" stroke-width=".8" opacity=".85"/><line x1="12" y1="14.2" x2="15" y2="9.8" stroke="currentColor" stroke-width=".8" opacity=".85"/><line x1="16" y1="13.8" x2="19" y2="10.2" stroke="currentColor" stroke-width=".8" opacity=".85"/></svg>';
// אייקון SVG לסלט – קערה רחבה למעלה + עלים (לא משולש)
const SALAD_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M5 11h14v1c0 4-2 8-7 8s-7-4-7-8v-1z" fill="currentColor" opacity=".9"/><ellipse cx="12" cy="11.5" rx="7" ry="2" fill="none" stroke="currentColor" stroke-width="1"/><path d="M10 9v2M14 9v2M12 7.5v1.5M8 10.5q1.5-1.5 2-2M16 10.5q-1.5-1.5-2-2" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>';
// אייקון SVG לדגים – דג ברור: גוף אליפסה, זנב מפוצל (V), עין
const FISH_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M20 12a6 4 0 0 1-12 0 6 4 0 0 1 12 0z" fill="currentColor" opacity=".92"/><path d="M8 10L4 12l4 2.5V10z" fill="currentColor" opacity=".92"/><circle cx="16" cy="11.5" r="1.3" fill="currentColor"/></svg>';

// מקור אמת יחיד לקטגוריות – שם, אייקון Material Symbols, צבע
const CATEGORY_DEFINITIONS = [
    { name: 'מנות ראשונות', icon: 'tapas', color: 'purple' },
    { name: 'מנות עיקריות', icon: 'dinner_dining', color: 'red' },
    { name: 'תוספות', icon: 'lunch_dining', color: 'purple' },
    { name: 'סלטים', icon: 'lunch_dining', color: 'emerald' },      // מוצג כ-SALAD_ICON_SVG
    { name: 'מרקים', icon: 'soup_kitchen', color: 'blue' },
    { name: 'מאפים', icon: 'bakery_dining', color: 'amber' },
    { name: 'פסטות ואורז', icon: 'ramen_dining', color: 'orange' },
    { name: 'בשרים', icon: 'kebab_dining', color: 'red' },
    { name: 'דגים', icon: 'fish', color: 'blue' },
    { name: 'ירקות', icon: 'eco', color: 'emerald' },
    { name: 'עוגות', icon: 'cake', color: 'amber' },
    { name: 'עוגיות', icon: 'cookie', color: 'orange' },
    { name: 'ממתקים', icon: 'cookie', color: 'rose' },              // מוצג כ-CANDY_ICON_SVG
    { name: 'קינוחים', icon: 'icecream', color: 'rose' },
    { name: 'לחמים', icon: 'bakery_dining', color: 'amber' },
    { name: 'שונות', icon: 'restaurant_menu', color: 'blue' },
    { name: 'פינוקים', icon: 'brunch_dining', color: 'orange' },
];

export const PREDEFINED_CATEGORIES = CATEGORY_DEFINITIONS.map(c => c.name);

const categoryIcons = Object.fromEntries(
    [['כל הקטגוריות', 'restaurant'], ['מנה עיקרית', 'dinner_dining'], ...CATEGORY_DEFINITIONS.map(c => [c.name, c.icon])]
);

const categoryColors = Object.fromEntries(
    [['כל הקטגוריות', 'teal'], ['מנה עיקרית', 'red'], ...CATEGORY_DEFINITIONS.map(c => [c.name, c.color])]
);

export function updateCategoryList() {
    const select = document.getElementById('category');
    // שמירת הערך הנוכחי והרענון עם הרשימה המעודכנת
    const currentValue = select.value;
    populateCategorySelectAndDropdown();
    if (currentValue) {
        select.value = currentValue;
        updateCategoryTriggerDisplay();
    }
}

/** ממלא את ה-select הנסתר ואת ה-dropdown של הקטגוריה (עם אייקונים) */
export function populateCategorySelectAndDropdown() {
    const select = document.getElementById('category');
    const dropdown = document.getElementById('categoryDropdownList');
    if (!select) return;

    select.innerHTML = '<option value="" disabled selected>בחר קטגוריה</option>';
    const allCategories = [...PREDEFINED_CATEGORIES];
    const existingCategories = [...new Set(recipes.map(recipe => recipe.category).filter(Boolean))];
    existingCategories.forEach(cat => {
        if (!allCategories.includes(cat)) allCategories.push(cat);
    });

    allCategories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        select.appendChild(option);
    });

    if (dropdown) {
        dropdown.innerHTML = '';
        allCategories.forEach(category => {
            const colorClass = getCategoryColorClass(category);
            const iconHtml = getCategoryIconHtml(category, 'form-category-option-icon ' + colorClass);
            const item = document.createElement('div');
            item.className = 'form-category-option';
            item.setAttribute('data-value', category);
            item.setAttribute('role', 'option');
            item.innerHTML = `
                <span class="form-category-option-icon-wrap">${iconHtml}</span>
                <span class="form-category-option-text">${category}</span>
            `;
            item.onclick = () => {
                select.value = category;
                updateCategoryTriggerDisplay();
                closeCategoryDropdown();
            };
            dropdown.appendChild(item);
        });
    }
}

/** מעדכן את התצוגה של כפתור בחירת הקטגוריה (אייקון + טקסט) */
export function updateCategoryTriggerDisplay() {
    const select = document.getElementById('category');
    const triggerIcon = document.getElementById('categoryTriggerIcon');
    const triggerText = document.getElementById('categoryTriggerText');
    if (!select || !triggerIcon || !triggerText) return;
    const value = select.value;
    if (value) {
        triggerIcon.innerHTML = getCategoryIconHtml(value, 'form-category-trigger-icon ' + (getCategoryColorClass(value) || ''));
        triggerText.textContent = value;
    } else {
        triggerIcon.innerHTML = '<span class="material-symbols-outlined form-category-trigger-icon">category</span>';
        triggerText.textContent = 'בחירת קטגוריה';
    }
}

export function openCategoryDropdown() {
    const wrap = document.getElementById('categoryDropdownWrap');
    if (wrap) {
        wrap.classList.add('open');
        const trigger = document.getElementById('categoryTrigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
        setTimeout(() => {
            const onDocClick = (e) => {
                if (wrap.contains(e.target)) return;
                closeCategoryDropdown();
                document.removeEventListener('click', onDocClick);
            };
            document.addEventListener('click', onDocClick);
        }, 0);
    }
}

export function closeCategoryDropdown() {
    const wrap = document.getElementById('categoryDropdownWrap');
    if (wrap) {
        wrap.classList.remove('open');
        const trigger = document.getElementById('categoryTrigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
}

export function toggleCategoryDropdown() {
    const wrap = document.getElementById('categoryDropdownWrap');
    if (wrap && wrap.classList.contains('open')) closeCategoryDropdown();
    else openCategoryDropdown();
}

export function getCategoryIcon(category) {
    return categoryIcons[category] || 'restaurant_menu';
}

/** מחזיר HTML לאייקון הקטגוריה – לממתקים/סלטים/דגים SVG מותאם, לשאר Material icon */
export function getCategoryIconHtml(category, colorClass) {
    const cls = colorClass || getCategoryColorClass(category) || '';
    if (category === 'ממתקים') {
        return `<span class="category-icon-candy ${cls}">${CANDY_ICON_SVG}</span>`;
    }
    if (category === 'סלטים') {
        return `<span class="category-icon-salad ${cls}">${SALAD_ICON_SVG}</span>`;
    }
    if (category === 'דגים') {
        return `<span class="category-icon-fish ${cls}">${FISH_ICON_SVG}</span>`;
    }
    return `<span class="material-symbols-outlined ${cls}">${getCategoryIcon(category)}</span>`;
}

export function getCategoryColorClass(category) {
    const color = categoryColors[category] || '';
    return color ? `category-icon-${color}` : '';
}

export function getCategoryBgColor(category) {
    const color = categoryColors[category] || 'blue';
    return color;
}

export function updateCategoryButtons() {
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
          ${getCategoryIconHtml('כל הקטגוריות', allColorClass)}
        </div>
        <span>כל הקטגוריות</span>
      `;
    allButton.onclick = () => window.resetSearch();
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
            ${getCategoryIconHtml(category, colorClass)}
          </div>
          <span>${category}</span>
        `;
        button.onclick = () => window.filterByCategory(category);
        categoryFilter.appendChild(button);
    });
}

export function getUniqueCategories() {
    const normalized = recipes.map(recipe => (recipe.category === 'מנה עיקרית' ? 'מנות עיקריות' : recipe.category));
    return [...new Set(normalized)];
}
