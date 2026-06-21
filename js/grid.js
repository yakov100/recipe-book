// Grid-size selector: how many recipe cards per row, persisted via settings.
import { saveSetting } from './data/recipes-repo.js';

    export function setRecipesPerRow(number) {
      document.documentElement.style.setProperty('--columns', number);
      // Update grid selector menu active state
      const gridOptions = document.querySelectorAll('.grid-option');
      gridOptions.forEach(option => {
        option.classList.remove('active');
        if (parseInt(option.dataset.cols) === number) {
          option.classList.add('active');
        }
      });
      saveSetting('recipesPerRow', number);
    }

    // פתיחה/סגירה של תפריט בחירת גריד
    export function toggleGridSelector() {
      const menu = document.getElementById('grid-selector-menu');
      if (!menu) return;
      
      const isVisible = menu.style.display !== 'none';
      menu.style.display = isVisible ? 'none' : 'flex';
      
      // סגירה בלחיצה מחוץ לתפריט
      if (!isVisible) {
        const closeOnClickOutside = (e) => {
          if (!e.target.closest('.grid-selector-wrapper')) {
            menu.style.display = 'none';
            document.removeEventListener('click', closeOnClickOutside);
          }
        };
        // Delay to prevent immediate close
        setTimeout(() => {
          document.addEventListener('click', closeOnClickOutside);
        }, 0);
      }
    }

    // הגדרת event listeners לכפתורי הגריד
    export function setupGridSelector() {
      const gridOptions = document.querySelectorAll('.grid-option');
      gridOptions.forEach(option => {
        option.addEventListener('click', () => {
          const cols = parseInt(option.dataset.cols);
          setRecipesPerRow(cols);
          document.getElementById('grid-selector-menu').style.display = 'none';
        });
      });
    }
