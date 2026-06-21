// Persistence layer: maps between app recipe objects and DB rows, the
// localStorage cache, Supabase CRUD for recipes, and user settings.
import { supabase } from '../supabase.js';
import { getCurrentUser, isAuthenticated } from '../auth.js';
import { recipes } from '../state.js';
import { deleteRecipeImageFromStorage } from '../images.js';

export function recipeToRow(r) {
    const user = getCurrentUser();
    if (!user) {
        throw new Error('נדרש להתחבר עם Google לפני שמירת מתכונים');
    }
    const row = {
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
    if (!r.id) {
        row.user_id = user.id;
    }
    return row;
}

export function rowToRecipe(row) {
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

// Cache keys and version (scoped per user)
const CACHE_VERSION_KEY = 'recipes_cache_version';
const CURRENT_CACHE_VERSION = '2.0.0';
const CACHE_MAX_AGE = 30 * 60 * 1000; // 30 דקות

export function getCacheStorageKeys() {
    const userId = getCurrentUser()?.id || 'guest';
    return {
        cacheKey: `recipes_cache_${userId}`,
        metaKey: `recipes_cache_meta_${userId}`,
    };
}

// Clear old cache if version changed (runs once on module load)
(function clearOldCacheIfNeeded() {
    const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY);
    if (cachedVersion !== CURRENT_CACHE_VERSION) {
        console.log('Cache version changed, clearing old cache...');
        Object.keys(localStorage).forEach((k) => {
            if (k.startsWith('recipes_cache_') || k === 'recipes_cache' || k === 'recipes_cache_meta') {
                localStorage.removeItem(k);
            }
        });
        localStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);
    }
})();

// טעינת מתכונים מ-cache
export function loadRecipesFromCache() {
    try {
        const { cacheKey } = getCacheStorageKeys();
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (e) {
        console.warn('Failed to load from cache:', e);
    }
    return null;
}

// שמירת מתכונים ל-cache
export function saveRecipesToCache(recipesToCache) {
    try {
        const { cacheKey, metaKey } = getCacheStorageKeys();
        // שמירה ללא תמונות base64 כדי לחסוך מקום, אבל שומרים imagePath
        const lightRecipes = recipesToCache.map(r => ({
            ...r,
            imagePath: r.imagePath || r.image_path
        }));
        localStorage.setItem(cacheKey, JSON.stringify(lightRecipes));
        localStorage.setItem(metaKey, JSON.stringify({
            timestamp: Date.now(),
            count: recipesToCache.length
        }));
    } catch (e) {
        console.warn('Failed to save to cache:', e);
        try {
            const { cacheKey, metaKey } = getCacheStorageKeys();
            localStorage.removeItem(cacheKey);
            localStorage.removeItem(metaKey);
        } catch (e2) { /* ignore */ }
    }
}

// בדיקה אם ה-cache עדיין תקף
export function isCacheValid() {
    try {
        const { metaKey } = getCacheStorageKeys();
        const meta = localStorage.getItem(metaKey);
        if (meta) {
            const { timestamp } = JSON.parse(meta);
            return (Date.now() - timestamp) < CACHE_MAX_AGE;
        }
    } catch (e) { /* ignore */ }
    return false;
}

// מחיקת מתכון בודד מ-Supabase
export async function deleteRecipeFromDB(recipeId) {
    if (!supabase) throw new Error('Supabase לא אותחל. ודא שסקריפט Supabase נטען.');
    const { error } = await supabase.from('recipes').delete().eq('id', recipeId);
    if (error) throw error;
    // עדכון cache
    saveRecipesToCache(recipes);
}

// שמירת/עדכון מתכון בודד ב-Supabase
export async function saveRecipeToDB(recipe) {
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
export async function saveRecipesToDB(recipesToSave) {
    if (!supabase) throw new Error('Supabase לא אותחל. ודא שסקריפט Supabase נטען.');

    const idsToKeep = recipesToSave.map(r => r.id).filter(Boolean);

    // מחיקת רשומות שנמחקו מהמערך
    const { data: existing } = await supabase.from('recipes').select('id, image_path');
    const toDeleteRows = (existing || []).filter(e => !idsToKeep.includes(e.id));
    const toDelete = toDeleteRows.map(e => e.id);

    // מחיקה במקבץ
    if (toDelete.length > 0) {
        for (const row of toDeleteRows) {
            await deleteRecipeImageFromStorage(row.image_path);
        }
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

// טעינת מתכון בודד מ-Supabase לפי ID (authenticated — own recipes via RLS)
export async function loadSingleRecipeFromDB(recipeId) {
    if (!supabase) throw new Error('Supabase לא אותחל. ודא שסקריפט Supabase נטען.');

    try {
        const { data, error } = await supabase
            .from('recipes')
            .select('id,name,source,ingredients,instructions,category,dietary_type,notes,rating,difficulty,recipe_link,video_url,preparation_time,image_path,created_at')
            .eq('id', recipeId)
            .single();

        if (error) throw error;
        return data ? rowToRecipe(data) : null;
    } catch (err) {
        console.warn('Failed to load single recipe:', err);
        return null;
    }
}

/** Public share link — no auth required */
export async function loadPublicRecipeFromDB(recipeId) {
    if (!supabase) throw new Error('Supabase לא אותחל. ודא שסקריפט Supabase נטען.');

    try {
        const { data, error } = await supabase.rpc('get_public_recipe', { recipe_id: recipeId });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        return row ? rowToRecipe(row) : null;
    } catch (err) {
        console.warn('Failed to load public recipe:', err);
        return null;
    }
}

// טעינת מתכונים מ-Supabase
export async function loadRecipesFromDB() {
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
export async function loadSettings() {
    if (!supabase || !isAuthenticated()) {
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

export async function saveSetting(key, value) {
    const user = getCurrentUser();
    if (!supabase || !user) return;
    await supabase.from('recipe_book_settings').upsert(
        { user_id: user.id, key, value, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,key' }
    );
}
