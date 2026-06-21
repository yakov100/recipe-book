// Recipe image maintenance: one-time migration of legacy base64 images to
// Supabase Storage, plus debug/reupload helpers exposed on window.
import { supabase } from './supabase.js';
import { recipes } from './state.js';
import { saveRecipeToDB, saveRecipesToCache } from './data/recipes-repo.js';
import {
    uploadImageToStorage,
    deleteRecipeImageFromStorage,
    getImageUrl,
    getDefaultImageUrl,
} from './images.js';
import { filterRecipes } from './filters.js';
import { showRecipe } from './recipe-view.js';

    export async function migrateLegacyBase64ToStorage() {
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
    export async function debugRecipeImage(recipeId) {
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
    export async function reuploadRecipeImage(recipeId) {
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

                const previousImagePath = recipe.imagePath || null;
                if (previousImagePath && previousImagePath !== imagePath) {
                    await deleteRecipeImageFromStorage(previousImagePath);
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
