/**
 * Migration Script: Move base64 images to Supabase Storage
 * 
 * This script migrates all existing recipe images from base64 (stored in database)
 * to Supabase Storage (file storage with CDN).
 * 
 * HOW TO RUN:
 * 1. Open your recipe book website in a browser
 * 2. Open the browser console (F12 → Console tab)
 * 3. Type: migrateAllImages()
 * 4. Press Enter and wait for completion
 * 
 * The migration is safe - it keeps the original base64 data until you verify
 * everything works correctly.
 */

import { supabase, supabaseUrl } from './supabase.js';

/**
 * Convert base64 data URL to Blob
 */
async function base64ToBlob(base64) {
    const response = await fetch(base64);
    return await response.blob();
}

/**
 * Migrate a single recipe's image
 */
async function migrateRecipeImage(recipe) {
    try {
        // Skip if no image or already migrated
        if (!recipe.image || !recipe.image.startsWith('data:')) {
            console.log(`✓ Recipe ${recipe.id} - ${recipe.name}: Already migrated or no image`);
            return { success: true, skipped: true };
        }
        
        console.log(`⏳ Migrating recipe ${recipe.id} - ${recipe.name}...`);
        
        // Convert base64 to blob
        const blob = await base64ToBlob(recipe.image);
        
        // Generate filename
        const fileExt = blob.type.split('/')[1] || 'jpg';
        const fileName = `${Date.now()}-${recipe.id}.${fileExt}`;
        const filePath = `${recipe.id}/${fileName}`;
        
        console.log(`  → Uploading to: ${filePath}`);
        
        // Upload to storage
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('recipe-images')
            .upload(filePath, blob, {
                cacheControl: '31536000', // 1 year
                upsert: false
            });
        
        if (uploadError) {
            // If file exists, that's okay - just use the existing file
            if (uploadError.message && uploadError.message.includes('already exists')) {
                console.log(`  ℹ Recipe ${recipe.id}: Image already exists in storage, using existing`);
            } else {
                throw uploadError;
            }
        }
        
        // Update recipe record with storage path
        const { error: updateError } = await supabase
            .from('recipes')
            .update({ 
                image_path: filePath
                // NOTE: We keep the 'image' column for now (backward compatibility)
                // Once verified, you can run a second pass to clear it: image: null
            })
            .eq('id', recipe.id);
        
        if (updateError) throw updateError;
        
        console.log(`✓ Recipe ${recipe.id} - ${recipe.name}: Migrated successfully`);
        return { success: true, storagePath: filePath };
        
    } catch (error) {
        console.error(`✗ Recipe ${recipe.id} - ${recipe.name}: Failed -`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Migrate all recipes with base64 images
 */
async function migrateAllImages() {
    console.log('='.repeat(50));
    console.log('🚀 Starting Image Migration to Supabase Storage');
    console.log('='.repeat(50));
    console.log('');
    
    // Fetch all recipes that might need migration
    console.log('📋 Fetching recipes from database...');
    const { data: recipes, error } = await supabase
        .from('recipes')
        .select('id, name, image, image_path');
    
    if (error) {
        console.error('❌ Failed to fetch recipes:', error);
        return;
    }
    
    // Filter to only base64 images
    const recipesToMigrate = recipes.filter(r => r.image && r.image.startsWith('data:'));
    
    console.log(`\n📊 Migration Status:`);
    console.log(`   Total recipes checked: ${recipes.length}`);
    console.log(`   Recipes with base64 images: ${recipesToMigrate.length}`);
    console.log(`   Already migrated: ${recipes.length - recipesToMigrate.length}`);
    console.log('');
    
    if (recipesToMigrate.length === 0) {
        console.log('✅ No migration needed! All images are already in Storage.');
        console.log('='.repeat(50));
        return;
    }
    
    console.log(`\n🔄 Starting migration of ${recipesToMigrate.length} recipes...\n`);
    
    const results = {
        total: recipesToMigrate.length,
        migrated: 0,
        skipped: 0,
        failed: 0,
        errors: []
    };
    
    // Migrate in batches of 3 to avoid overwhelming the server
    const batchSize = 3;
    const totalBatches = Math.ceil(recipesToMigrate.length / batchSize);
    
    for (let i = 0; i < recipesToMigrate.length; i += batchSize) {
        const batchNum = Math.floor(i / batchSize) + 1;
        console.log(`\n📦 Batch ${batchNum}/${totalBatches}:`);
        console.log('─'.repeat(40));
        
        const batch = recipesToMigrate.slice(i, i + batchSize);
        const batchResults = await Promise.all(
            batch.map(recipe => migrateRecipeImage(recipe))
        );
        
        batchResults.forEach((result, idx) => {
            if (result.skipped) {
                results.skipped++;
            } else if (result.success) {
                results.migrated++;
            } else {
                results.failed++;
                results.errors.push({
                    recipe: batch[idx].name,
                    error: result.error
                });
            }
        });
        
        const progress = Math.min(i + batchSize, recipesToMigrate.length);
        const percentage = Math.round((progress / recipesToMigrate.length) * 100);
        console.log(`\n📊 Progress: ${progress}/${recipesToMigrate.length} (${percentage}%)`);
        
        // Small delay between batches to be nice to the server
        if (i + batchSize < recipesToMigrate.length) {
            console.log('⏸  Waiting 2 seconds before next batch...');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    // Final report
    console.log('\n' + '='.repeat(50));
    console.log('✅ Migration Complete!');
    console.log('='.repeat(50));
    console.log(`\n📊 Final Results:`);
    console.log(`   Total recipes processed: ${results.total}`);
    console.log(`   ✓ Successfully migrated: ${results.migrated}`);
    console.log(`   - Skipped (already done): ${results.skipped}`);
    console.log(`   ✗ Failed: ${results.failed}`);
    
    if (results.errors.length > 0) {
        console.log(`\n⚠️  Errors (${results.errors.length}):`);
        results.errors.forEach((e, i) => {
            console.log(`   ${i + 1}. ${e.recipe}: ${e.error}`);
        });
    }
    
    if (results.failed === 0) {
        console.log('\n🎉 Success! All images migrated successfully!');
        console.log('\n📝 Next Steps:');
        console.log('   1. ✓ Verify all images are displaying correctly in your app');
        console.log('   2. ✓ Test uploading a new recipe with an image');
        console.log('   3. ✓ Test editing an existing recipe');
        console.log('   4. ⏳ Once verified (in a few days), you can clear base64 data to save space');
        console.log('      Run: clearBase64Images() (coming soon)');
    } else {
        console.log('\n⚠️  Some images failed to migrate.');
        console.log('   Please review the errors above and try again.');
        console.log('   The failed recipes still have their base64 images as fallback.');
    }
    
    console.log('\n' + '='.repeat(50));
}

/**
 * Optional: Clear base64 data after verifying migration worked
 * Only run this after you've verified everything works!
 */
async function clearBase64Images() {
    console.log('⚠️  WARNING: This will permanently remove base64 image data!');
    console.log('   Only run this after verifying Storage images work correctly.');
    
    const confirm = prompt('Type "CONFIRM" to proceed with clearing base64 data:');
    if (confirm !== 'CONFIRM') {
        console.log('❌ Cancelled. No data was modified.');
        return;
    }
    
    console.log('\n🧹 Clearing base64 image data from recipes with Storage paths...');
    
    const { data, error } = await supabase
        .from('recipes')
        .update({ image: null })
        .not('image_path', 'is', null)
        .select('id, name');
    
    if (error) {
        console.error('❌ Error:', error);
        return;
    }
    
    console.log(`✓ Cleared base64 data from ${data.length} recipes`);
    console.log('💾 Database space has been freed up!');
}

// Auto-run if this is the main script
if (typeof window !== 'undefined') {
    // Browser environment - expose functions to console
    window.migrateAllImages = migrateAllImages;
    window.clearBase64Images = clearBase64Images;
    
    console.log('');
    console.log('🔧 Migration Script Loaded!');
    console.log('');
    console.log('Commands available:');
    console.log('  migrateAllImages()     - Migrate all base64 images to Storage');
    console.log('  clearBase64Images()    - Clear base64 data after verification');
    console.log('');
    console.log('To start migration, run: migrateAllImages()');
    console.log('');
} else {
    // Node environment - run directly
    migrateAllImages().catch(console.error);
}

export { migrateAllImages, clearBase64Images };
