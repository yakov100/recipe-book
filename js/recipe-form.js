// Add/edit recipe form + CRUD: the form popup, ingredient rows, image preview,
// AI image (re)generation, save/update, delete, and the URL-import status UI.
// The actual URL fetch (importRecipeFromUrl) lives in import-export and is
// reached via window in openFormPopup; this module exposes the small form
// helpers (setImportUrlStatus/resetImportUrlUI/setFormCategoryValue/
// populateIngredientRows) that import-export imports — a one-way dependency.
import { invokeEdgeFunction } from './supabase.js';
import {
    recipes,
    editingIndex, setEditingIndex,
    formSelectedRating, setFormSelectedRating,
    formSelectedDifficulty, setFormSelectedDifficulty,
    formRegeneratedImage, setFormRegeneratedImage,
    aiGeneratedImage, setAiGeneratedImage,
} from './state.js';
import { saveRecipeToDB, deleteRecipeFromDB } from './data/recipes-repo.js';
import {
    uploadImageToStorage,
    deleteRecipeImageFromStorage,
    getDisplayUrl,
    getImageUrl,
    getDefaultImageUrl,
} from './images.js';
import {
    populateCategorySelectAndDropdown,
    updateCategoryTriggerDisplay,
    toggleCategoryDropdown,
    closeCategoryDropdown,
    updateCategoryList,
    updateCategoryButtons,
    getCategoryColorClass,
    getCategoryIconHtml,
} from './categories.js';
import { closePopup, showRecipe, DIFFICULTY_LABELS } from './recipe-view.js';
import { filterRecipes } from './filters.js';
import { chefImageUrl } from './utils.js';

export async function regenerateImage(index) {
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

export async function regenerateImageForForm() {
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

export function setFormDifficulty(level) {
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

export function updateFormRatingStars(rating) {
    const stars = document.querySelectorAll('#formRatingStars .form-star');
    stars.forEach((star) => {
        const r = parseInt(star.dataset.rating, 10);
        star.classList.toggle('filled', r <= rating);
    });
}

// עדכון הקטגוריות בעת פתיחת הטופס
export function openFormPopup() {
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
                window.importRecipeFromUrl();
            }
        });
    }
}

export function closeFormPopup() {
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
export function addIngredientRow() {
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

export function removeIngredientRow(btn) {
    const row = btn.closest('.form-ingredient-row');
    const container = document.getElementById('ingredientsTableRows');
    // Keep at least one row
    if (container && container.querySelectorAll('.form-ingredient-row').length > 1) {
        row.remove();
    }
    syncIngredientsToTextarea();
}

export function syncIngredientsToTextarea() {
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
export function populateIngredientRows(text) {
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
export function previewFormImage(event) {
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

export function confirmDeleteRecipe(index) {
    const confirmPopup = document.getElementById('confirmPopup');
    confirmPopup.style.display = 'flex';
    confirmPopup.setAttribute('data-index', index);
}

export async function deleteRecipe() {
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

export function closeConfirmPopup() {
    document.getElementById('confirmPopup').style.display = 'none';
}

export function setImportUrlStatus(type, message) {
    const el = document.getElementById('importRecipeUrlStatus');
    if (!el) return;
    el.hidden = !message;
    el.className = 'form-add-recipe-import-url-status' + (type ? ' is-' + type : '');
    el.textContent = message || '';
}

export function resetImportUrlUI() {
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

export function setFormCategoryValue(category) {
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

export function editRecipe(index) {
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
    // Reset the "new category" toggle to dropdown mode (in case it was left open)
    const editNewCategory = document.getElementById('newCategory');
    const editCategoryWrap = document.getElementById('categoryDropdownWrap');
    const editToggleBtn = document.getElementById('toggleNewCategory');
    const editCategorySelect = document.getElementById('category');
    if (editNewCategory) { editNewCategory.style.display = 'none'; editNewCategory.required = false; editNewCategory.value = ''; }
    if (editCategoryWrap) editCategoryWrap.style.display = '';
    if (editToggleBtn) editToggleBtn.innerHTML = '<span class="material-symbols-outlined">add</span>';
    if (editCategorySelect) editCategorySelect.required = true;
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

export async function saveRecipe(recipe) {
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

export function toggleCategoryInput() {
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
