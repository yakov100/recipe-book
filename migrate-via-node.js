/**
 * Node.js Migration Script - Run images migration via Supabase
 *
 * Run with: node migrate-via-node.js
 * Requires VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (or SUPABASE_*)
 * in .env.local, .env, or the environment — see .env.example.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  content.split('\n').forEach((line) => {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (!m) return;
    const key = m[1].trim();
    if (process.env[key] !== undefined) return;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

loadEnvFile(path.join(__dirname, '.env'));
loadEnvFile(path.join(__dirname, '.env.local'));

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing Supabase credentials. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
      '(or SUPABASE_URL and SUPABASE_ANON_KEY) in .env.local or the environment. See .env.example.'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function base64ToBuffer(base64) {
    // Remove data URL prefix
    const base64Data = base64.split(',')[1];
    return Buffer.from(base64Data, 'base64');
}

async function migrateRecipeImage(recipe) {
    try {
        if (!recipe.image || !recipe.image.startsWith('data:')) {
            console.log(`✓ Recipe ${recipe.id} - ${recipe.name}: Already migrated or no image`);
            return { success: true, skipped: true };
        }
        
        console.log(`⏳ Migrating recipe ${recipe.id} - ${recipe.name}...`);
        
        // Get mime type
        const mimeMatch = recipe.image.match(/data:([^;]+);/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const ext = mimeType.split('/')[1] || 'jpg';
        
        // Convert to buffer
        const buffer = await base64ToBuffer(recipe.image);
        
        // Generate filename
        const fileName = `${Date.now()}-${recipe.id}.${ext}`;
        const filePath = `${recipe.id}/${fileName}`;
        
        console.log(`  → Uploading to: ${filePath} (${Math.round(buffer.length / 1024)}KB)`);
        
        // Upload to storage
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('recipe-images')
            .upload(filePath, buffer, {
                contentType: mimeType,
                cacheControl: '31536000',
                upsert: false
            });
        
        if (uploadError) {
            if (uploadError.message && uploadError.message.includes('already exists')) {
                console.log(`  ℹ Recipe ${recipe.id}: Image already exists in storage`);
            } else {
                throw uploadError;
            }
        }
        
        // Update recipe record
        const { error: updateError } = await supabase
            .from('recipes')
            .update({ image_path: filePath })
            .eq('id', recipe.id);
        
        if (updateError) throw updateError;
        
        console.log(`✓ Recipe ${recipe.id} - ${recipe.name}: Migrated successfully`);
        return { success: true, storagePath: filePath };
        
    } catch (error) {
        console.error(`✗ Recipe ${recipe.id} - ${recipe.name}: Failed -`, error.message);
        return { success: false, error: error.message };
    }
}

async function main() {
    console.log('='.repeat(50));
    console.log('🚀 Starting Image Migration');
    console.log('='.repeat(50));
    console.log('');
    
    // Fetch all recipes
    console.log('📋 Fetching recipes...');
    const { data: recipes, error } = await supabase
        .from('recipes')
        .select('id, name, image, image_path');
    
    if (error) {
        console.error('❌ Failed to fetch recipes:', error);
        return;
    }
    
    const recipesToMigrate = recipes.filter(r => r.image && r.image.startsWith('data:') && !r.image_path);
    
    console.log(`\n📊 Status:`);
    console.log(`   Total: ${recipes.length}`);
    console.log(`   Need migration: ${recipesToMigrate.length}`);
    console.log('');
    
    if (recipesToMigrate.length === 0) {
        console.log('✅ No migration needed!');
        return;
    }
    
    const results = {
        total: recipesToMigrate.length,
        migrated: 0,
        skipped: 0,
        failed: 0,
        errors: []
    };
    
    // Migrate in batches
    const batchSize = 3;
    for (let i = 0; i < recipesToMigrate.length; i += batchSize) {
        const batch = recipesToMigrate.slice(i, i + batchSize);
        console.log(`\n📦 Batch ${Math.floor(i / batchSize) + 1}:`);
        
        const batchResults = await Promise.all(
            batch.map(recipe => migrateRecipeImage(recipe))
        );
        
        batchResults.forEach((result, idx) => {
            if (result.skipped) results.skipped++;
            else if (result.success) results.migrated++;
            else {
                results.failed++;
                results.errors.push({ recipe: batch[idx].name, error: result.error });
            }
        });
        
        console.log(`Progress: ${Math.min(i + batchSize, recipesToMigrate.length)}/${recipesToMigrate.length}`);
        
        if (i + batchSize < recipesToMigrate.length) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ Migration Complete!');
    console.log('='.repeat(50));
    console.log(`Migrated: ${results.migrated}`);
    console.log(`Failed: ${results.failed}`);
    
    if (results.errors.length > 0) {
        console.log('\nErrors:');
        results.errors.forEach(e => console.log(`- ${e.recipe}: ${e.error}`));
    }
}

main().catch(console.error);
