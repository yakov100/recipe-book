// Export the menu functions to make them globally available
export function openMenu() {
    document.getElementById('sideMenu').style.width = '250px';
}

export function closeMenu() {
    document.getElementById('sideMenu').style.width = '0';
}

export function setupUI() {
    setupGrid();
    setupSearch();
}

function setupGrid() {
    const grid6 = document.getElementById('grid6');
    const grid8 = document.getElementById('grid8');
    
    window.setRecipesPerRow = (columns) => {
        document.documentElement.style.setProperty('--columns', columns);
        localStorage.setItem('recipesPerRow', columns);
        
        grid6.classList.toggle('active', columns === 6);
        grid8.classList.toggle('active', columns === 8);
    };

    // Load saved preference
    const savedColumns = localStorage.getItem('recipesPerRow') || 6;
    setRecipesPerRow(parseInt(savedColumns));
}

function setupSearch() {
    const searchName = document.getElementById('searchName');
    const searchIngredients = document.getElementById('searchIngredients');
    
    window.filterRecipes = () => {
        const nameFilter = searchName.value.toLowerCase();
        const ingredientsFilter = searchIngredients.value.toLowerCase();
        
        document.querySelectorAll('.recipe-card').forEach(card => {
            const name = card.querySelector('.recipe-name').textContent.toLowerCase();
            const ingredients = card.getAttribute('data-ingredients')?.toLowerCase() || '';
            
            const matchesName = name.includes(nameFilter);
            const matchesIngredients = ingredients.includes(ingredientsFilter);
            
            card.style.display = (matchesName && matchesIngredients) ? '' : 'none';
        });
    };
}