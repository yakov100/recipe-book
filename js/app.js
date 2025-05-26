// Main application logic
import { initializeSupabase } from './supabase.js';
import { setupTimer } from './timer.js';
import { setupRecipeHandlers } from './recipes.js';
import { setupUI } from './ui.js';

document.addEventListener('DOMContentLoaded', async () => {
    await initializeSupabase();
    setupTimer();
    setupRecipeHandlers();
    setupUI();
});