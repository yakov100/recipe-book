import { supabase } from './supabase.js';

export async function setupRecipeHandlers() {
    const recipesContainer = document.getElementById('recipesContainer');
    
    // Load recipes from Supabase
    const { data: recipes, error } = await supabase
        .from('recipes')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading recipes:', error);
        return;
    }

    // Display recipes
    recipes.forEach(recipe => {
        const recipeCard = createRecipeCard(recipe);
        recipesContainer.appendChild(recipeCard);
    });
}

function createRecipeCard(recipe) {
    const card = document.createElement('div');
    card.className = 'recipe-card';
    
    const img = document.createElement('img');
    img.src = recipe.image_url || getDefaultImage(recipe.category);
    img.alt = recipe.name;
    card.appendChild(img);

    const info = document.createElement('div');
    info.className = 'recipe-info-overlay';
    info.innerHTML = `
        <h3 class="recipe-name">${recipe.name}</h3>
        ${recipe.source ? `<p class="recipe-source">${recipe.source}</p>` : ''}
    `;
    card.appendChild(info);

    return card;
}

function getDefaultImage(category) {
    const defaultImages = {
        'עוגות': '/assets/default-images/cakes/1.jpg',
        'מרקים': '/assets/default-images/soups/1.jpg',
        'סלטים': '/assets/default-images/salads/1.jpg',
        'תוספות': '/assets/default-images/sides/1.jpg',
        'מנות עיקריות': '/assets/default-images/main-dishes/1.jpg',
        'קינוחים': '/assets/default-images/desserts/1.jpg',
        'לחמים': '/assets/default-images/breads/1.jpg'
    };
    
    return defaultImages[category] || '/assets/default-images/other/1.jpg';
}