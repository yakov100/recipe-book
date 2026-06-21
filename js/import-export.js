// Import / export / share: JSON backup import+export, single- and all-recipe
// HTML export, OCR, URL import (via the recipe-ai edge function), native share,
// copy-link, and the periodic backup reminder.
// setAuthGateVisible lives in main.js (auth gate) and is reached via window to
// avoid a cycle with the not-yet-extracted auth module.
import { invokeEdgeFunction, edgeFunctionHeaders } from './supabase.js';
import { recipes, isSharedRecipeMode, backupReminderTimeout, setBackupReminderTimeout } from './state.js';
import { saveRecipesToDB, loadSettings, saveSetting } from './data/recipes-repo.js';
import { getDisplayUrl } from './images.js';
import { populateIngredientRows, setFormCategoryValue, setImportUrlStatus } from './recipe-form.js';
import { updateCategoryList, updateCategoryButtons } from './categories.js';
import { filterRecipes } from './filters.js';
import { closePopup } from './recipe-view.js';
import { escapeHtml, getYoutubeEmbed } from './utils.js';

export function copyRecipeLink(index) {
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

export function downloadRecipe(index) {
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

export function exportRecipes() {
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

export async function importRecipes(event) {
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

export function processOCR(event) {
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

export async function importRecipeFromUrl() {
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
        window.setAuthGateVisible(true);
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
                window.setAuthGateVisible(true);
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

export function shareRecipe(index) {
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

export function setupBackupReminder(lastBackupFromDb) {
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

export async function closeBackupReminder() {
    const backupReminder = document.getElementById('backupReminder');
    backupReminder.style.display = 'none';
    await saveSetting('lastBackup', new Date().getTime());
    clearTimeout(backupReminderTimeout);
}

// פונקציה להורדת כל המתכונים כקובץ HTML
export function downloadAllRecipes() {
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
