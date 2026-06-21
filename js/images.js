// Image helpers: client-side resizing, Supabase Storage upload/delete, and
// URL resolution for recipe images. Pure utilities — no shared app state.
// (Recipe-aware image flows like migration/reupload stay in main.js because
// they mutate the recipes collection.)
import { supabase, supabaseUrl } from './supabase.js';
import { chefImageUrl } from './utils.js';

const defaultImagesByCategory = {
    'מנות ראשונות': '/default-images/appetizers/1.webp',
    'מנות עיקריות': '/default-images/main-dishes/1.webp',
    'מנה עיקרית': '/default-images/main-dishes/1.webp',
    'תוספות': '/default-images/sides/1.webp',
    'סלטים': '/default-images/salads/1.webp',
    'מרקים': '/default-images/soups/1.webp',
    'מאפים': '/default-images/pastries/1.webp',
    'פסטות ואורז': '/default-images/pasta/1.webp',
    'בשרים': '/default-images/meat/1.webp',
    'דגים': '/default-images/fish/1.webp',
    'ירקות': '/default-images/vegetables/1.webp',
    'עוגות': '/default-images/cakes/1.webp',
    'עוגיות': '/default-images/cookies/1.webp',
    'ממתקים': '/default-images/sweets/1.webp',
    'קינוחים': '/default-images/desserts/1.webp',
    'לחמים': '/default-images/breads/1.webp',
    'שונות': '/default-images/other/1.webp',
    'פינוקים': '/default-images/treats/1.webp',
};

const DEFAULT_IMAGE_OTHER = '/default-images/other/1.webp';

/** Returns a default image URL for the given category (single entry point for default images). */
export function getDefaultImageUrl(category) {
    const path = (category && defaultImagesByCategory[category]) || DEFAULT_IMAGE_OTHER;
    return chefImageUrl(path);
}

export function resizeImage(file, maxWidth, maxHeight, callback) {
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

// Convert image file to optimized blob (Promise-based)
export function resizeImageToBlob(file, maxWidth, maxHeight, quality) {
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
export async function uploadImageToStorage(file) {
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

/** Builds public Storage URL from the object key stored in image_path. */
export function getStoragePublicUrl(storagePath) {
    if (!storagePath || typeof storagePath !== 'string') return '';
    return `${supabaseUrl}/storage/v1/object/public/recipe-images/${storagePath}`;
}

/** Returns Storage object key, or null if path is not a bucket file. */
export function normalizeStorageKey(imagePath) {
    if (!imagePath || typeof imagePath !== 'string') return null;
    if (imagePath.startsWith('http') || imagePath.startsWith('data:') || imagePath.includes('/default-images/')) {
        return null;
    }
    return imagePath;
}

export async function deleteRecipeImageFromStorage(imagePath) {
    const key = normalizeStorageKey(imagePath);
    if (!key || !supabase) return;
    const { error } = await supabase.storage.from('recipe-images').remove([key]);
    if (error) console.warn('⚠️ [deleteRecipeImageFromStorage] Failed:', key, error.message);
}

/** Single entry point for recipe image display: image_path (Storage key or full URL) or legacy image; else default. */
export function getDisplayUrl(recipe) {
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
export function getImageUrl(imagePathOrUrl, options = {}) {
    if (!imagePathOrUrl) return null;
    if (typeof imagePathOrUrl === 'string' &&
        (imagePathOrUrl.startsWith('http') || imagePathOrUrl.startsWith('data:') || imagePathOrUrl.includes('/default-images/')))
        return imagePathOrUrl;
    return getStoragePublicUrl(imagePathOrUrl);
}

// Helper: Get responsive image srcset
// Without Supabase Image Transformations, srcset uses the same URL
// (no server-side resizing available on free plan)
export function getImageSrcSet(imagePath) {
    // No srcset needed - single URL for all sizes
    return '';
}
