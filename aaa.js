(() => {
    document.addEventListener('DOMContentLoaded', loadRecipesAndDisplay);
  
    let recipes = JSON.parse(localStorage.getItem('recipes')) || [];
    let editingIndex = -1;
    let backupReminderTimeout;
    let selectedCategory = '';
  
    const defaultImages = {
    };
  
    function getYoutubeEmbed(videoUrl) {
        if (!videoUrl) return '';
        var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        var match = videoUrl.match(regExp);
        if (match && match[7].length === 11) {
          return 'https://www.youtube.com/embed/' + match[7];
        }
        return '';
    }
  
    function loadRecipesAndDisplay() {
      updateCategoryList();
      updateCategoryButtons();
      displayRecipes(recipes);
      document.getElementById('filterRating').innerHTML = generateFilterStars();
      setupBackupReminder();
      setRecipesPerRow(6); // ברירת מחדל ל-6 מתכונים בשורה
      drawGridIcons();
      initializeTimer();
  
      // הוספת מאזיני אירועים לסגירת חלונות בעת לחיצה מחוץ לתוכן
      setupPopupCloseOnOverlayClick();
    }
  
    document.getElementById('recipeForm').addEventListener('submit', function(e) {
      e.preventDefault();
      const name = document.getElementById('recipeName').value;
      const source = document.getElementById('recipeSource').value || 'לא ידוע';
      const ingredients = document.getElementById('ingredients').value;
      const instructions = document.getElementById('instructions').value;
      const category = document.getElementById('category').value || 'שונות';
      const notes = document.getElementById('notes').value;
      const videoUrl = document.getElementById('recipeVideo').value;
      const recipeLink = document.getElementById('recipeLink').value;
      const file = document.getElementById('image').files[0];
  
      let rating = 0;
      if (editingIndex !== -1 && recipes[editingIndex].rating) {
        rating = recipes[editingIndex].rating;
      }
  
      if (file) {
        resizeImage(file, 300, 300, (resizedDataUrl) => {
          saveRecipe({ name, source, ingredients, instructions, category, notes, videoUrl, recipeLink, image: resizedDataUrl, rating });
        });
      } else {
        let image = defaultImages[category] || '';
        if (editingIndex !== -1 && recipes[editingIndex].image && recipes[editingIndex].image !== defaultImages[recipes[editingIndex].category]) {
          image = recipes[editingIndex].image;
        }
        saveRecipe({ name, source, ingredients, instructions, category, notes, videoUrl, recipeLink, image, rating });
      }
    });
  
    function saveRecipe(recipe) {
      if (editingIndex === -1) {
        recipes.push(recipe);
      } else {
        recipes[editingIndex] = recipe;
      }
      try {
        localStorage.setItem('recipes', JSON.stringify(recipes));
        updateCategoryList();
        updateCategoryButtons();
        displayRecipes(recipes);
        closeFormPopup();
        document.getElementById('recipeForm').reset();
        editingIndex = -1;
      } catch (e) {
        alert('שגיאה: לא ניתן לשמור את הנתונים. המקום בדפדפן מלא.');
      }
    }
  
    function resizeImage(file, maxWidth, maxHeight, callback) {
      const reader = new FileReader();
      reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
          let width = img.width;
          let height = img.height;
  
          if (width > height) {
            if (width > maxWidth) {
              height = Math.round(height * (maxWidth / width));
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round(width * (maxHeight / height));
              height = maxHeight;
            }
          }
  
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          callback(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  
    function getUniqueCategories() {
      const categories = recipes.map(recipe => recipe.category);
      return [...new Set(categories)];
    }
  
    function updateCategoryList() {
      const categories = getUniqueCategories();
      const datalist = document.getElementById('categoryList');
      datalist.innerHTML = '';
      categories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        datalist.appendChild(option);
      });
    }
  
    function updateCategoryButtons() {
      const categories = getUniqueCategories();
      const categoryFilter = document.getElementById('categoryFilter');
      categoryFilter.innerHTML = '';
  
      const allButton = document.createElement('button');
      allButton.className = 'category-button';
      allButton.innerHTML = 'כל הקטגוריות';
      allButton.onclick = resetSearch;
      categoryFilter.appendChild(allButton);
  
      categories.forEach(category => {
        const button = document.createElement('button');
        button.className = 'category-button';
        button.innerHTML = `<span>${category}</span>`;
        button.onclick = () => filterByCategory(category);
        categoryFilter.appendChild(button);
      });
    }
  
    function filterByCategory(category) {
      selectedCategory = category;
      filterRecipes();
    }
  
    function filterRecipes() {
      const searchName = document.getElementById('searchName').value.toLowerCase();
      const searchIngredients = document.getElementById('searchIngredients').value.toLowerCase();
      const selectedRating = getSelectedRating();
      const filteredRecipes = recipes.filter(recipe => {
        return recipe.name.toLowerCase().includes(searchName) &&
               recipe.ingredients.toLowerCase().includes(searchIngredients) &&
               (selectedCategory === '' || recipe.category === selectedCategory) &&
               (selectedRating === 0 || recipe.rating === selectedRating);
      });
      displayRecipes(filteredRecipes);
    }
  
    function displayRecipes(filteredRecipes) {
      const container = document.getElementById('recipesContainer');
      container.innerHTML = '';
  
      filteredRecipes.forEach((recipe, index) => {
        const card = document.createElement('div');
        card.className = 'recipe-card';
  
        // תמונת המתכון
        if (recipe.image) {
          const img = document.createElement('img');
          img.src = recipe.image;
          img.alt = recipe.name;
          card.appendChild(img);
        }
  
        // פרטי המתכון
        const cardContent = document.createElement('div');
        cardContent.className = 'recipe-details';
        
        // הוספת שם המתכון ומקור המתכון
        const titleContainer = document.createElement('div');
        titleContainer.className = 'recipe-title-container';
        
        const recipeName = document.createElement('span');
        recipeName.className = 'recipe-name';
        recipeName.textContent = recipe.name;
        titleContainer.appendChild(recipeName);
        
        const recipeSource = document.createElement('span');
        recipeSource.className = 'recipe-source';
        recipeSource.textContent = recipe.source || 'לא ידוע';
        titleContainer.appendChild(recipeSource);
        
        cardContent.appendChild(titleContainer);
        card.appendChild(cardContent);

        // Create overlay container for action buttons on hover
        const overlayButtons = document.createElement('div');
        overlayButtons.className = 'action-buttons-overlay';
        overlayButtons.innerHTML = `
           <button class="action-btn" onclick="event.stopPropagation(); editRecipe(${index})" title="ערוך" style="background-color: #4CAF50; border-radius: 50%; width: 40px; height: 40px; border: none; color: white; margin: 0 5px; cursor: pointer;">
             <i class="fas fa-edit"></i>
           </button>
           <button class="action-btn" onclick="event.stopPropagation(); shareRecipe(${index})" title="שתף" style="background-color: #4CAF50; border-radius: 50%; width: 40px; height: 40px; border: none; color: white; margin: 0 5px; cursor: pointer;">
             <i class="fas fa-share"></i>
           </button>
           <button class="action-btn" onclick="event.stopPropagation(); downloadRecipe(${index})" title="הורד" style="background-color: #4CAF50; border-radius: 50%; width: 40px; height: 40px; border: none; color: white; margin: 0 5px; cursor: pointer;">
             <i class="fas fa-download"></i>
           </button>
           <button class="action-btn" onclick="event.stopPropagation(); deleteRecipe(${index})" title="מחק" style="background-color: #4CAF50; border-radius: 50%; width: 40px; height: 40px; border: none; color: white; margin: 0 5px; cursor: pointer;">
             <i class="fas fa-trash"></i>
           </button>
        `;
        // Set initial styles for the overlay
        overlayButtons.style.display = 'none';
        overlayButtons.style.position = 'absolute';
        overlayButtons.style.top = '0';
        overlayButtons.style.left = '0';
        overlayButtons.style.width = '100%';
        overlayButtons.style.height = '100%';
        overlayButtons.style.justifyContent = 'center';
        overlayButtons.style.alignItems = 'center';
        overlayButtons.style.backgroundColor = 'rgba(255,255,255,0.8)'; // Semi-transparent white background
        // Ensure the card is positioned relative to contain the absolute overlay
        card.style.position = 'relative';
        card.appendChild(overlayButtons);

        // Add hover event listeners to show/hide the overlay
        card.addEventListener('mouseenter', () => {
          overlayButtons.style.display = 'flex';
        });
        card.addEventListener('mouseleave', () => {
          overlayButtons.style.display = 'none';
        });

        card.addEventListener('click', () => {
          showRecipe(index, filteredRecipes);
        });

        container.appendChild(card);
      });
    }
  
    function showRecipe(index, filteredRecipes) {
      const recipe = filteredRecipes[index];
      const actualIndex = recipes.indexOf(recipe);
      const popup = document.getElementById('popup');
      const popupBody = document.getElementById('popupBody');
      
      popupBody.innerHTML = `
        <div class="recipe-full" ${recipe.image ? `style="background-image: url('${recipe.image}')"` : ''}>
          <div class="recipe-content-overlay">
            <div class="recipe-header">
              <h2 class="recipe-title">${recipe.name}</h2>
              <span class="recipe-source">${recipe.source}</span>
            </div>
            <div class="recipe-flex-container">
              <div class="recipe-right-side">
                <p><strong>קטגוריה:</strong> ${recipe.category}</p>
                <div class="recipe-main-content">
                  <div class="ingredients-section">
                    <p><strong>מצרכים:</strong></p>
                    <ul class="ingredients-list">
                      ${recipe.ingredients.split('\n').map(ingredient => `<li>${ingredient}</li>`).join('')}
                    </ul>
                  </div>
                  <div class="instructions-section">
                    <p><strong>הוראות הכנה:</strong></p>
                    <ul class="instructions-list">
                      ${recipe.instructions.split('\n').map(instruction => `<li>${instruction}</li>`).join('')}
                    </ul>
                  </div>
                </div>
              </div>
              <div class="recipe-left-side">
                <div class="recipe-rating">
                  ${generateStars(recipe.rating || 0, actualIndex)}
                </div>
                ${recipe.videoUrl ? `
                  <div class="recipe-video">
                    <iframe width="560" height="315" src="${getYoutubeEmbed(recipe.videoUrl)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                  </div>` : ''}
                ${recipe.recipeLink ? `<div class="recipe-link"><strong>קישור למתכון:</strong><br><a href="${recipe.recipeLink}" target="_blank">${recipe.recipeLink}</a></div>` : ''}
                ${recipe.notes ? `<div class="recipe-notes"><strong>הערות:</strong><br>${recipe.notes}</div>` : ''}
                <div class="action-buttons">
                  <button class="action-button" data-tooltip="ערוך" onclick="editRecipe(${actualIndex})">✎</button>
                  <button class="action-button" data-tooltip="מחק" onclick="confirmDeleteRecipe(${actualIndex})">🗑</button>
                  <button class="action-button" data-tooltip="הורד" onclick="downloadRecipe(${actualIndex})">⭳</button>
                  <button class="action-button" data-tooltip="שתף" onclick="shareRecipe(${actualIndex})">⤤</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      
      popup.style.display = 'flex';
    }
  
    function closePopup() {
      document.getElementById('popup').style.display = 'none';
    }
  
    function openFormPopup() {
      document.getElementById('formPopup').style.display = 'flex';
    }
  
    function closeFormPopup() {
      document.getElementById('formPopup').style.display = 'none';
      document.getElementById('recipeForm').reset();
      editingIndex = -1;
    }
  
    function editRecipe(index) {
      const recipe = recipes[index];
      document.getElementById('recipeName').value = recipe.name;
      document.getElementById('recipeSource').value = recipe.source;
      document.getElementById('ingredients').value = recipe.ingredients;
      document.getElementById('instructions').value = recipe.instructions;
      document.getElementById('category').value = recipe.category;
      document.getElementById('notes').value = recipe.notes;
      document.getElementById('recipeVideo').value = recipe.videoUrl;
      document.getElementById('recipeLink').value = recipe.recipeLink;
      document.getElementById('image').value = '';
      editingIndex = index;
      closePopup();
      openFormPopup();
    }
  
    function confirmDeleteRecipe(index) {
      const confirmPopup = document.getElementById('confirmPopup');
      confirmPopup.style.display = 'flex';
      confirmPopup.setAttribute('data-index', index);
    }
  
    function deleteRecipe() {
      const confirmPopup = document.getElementById('confirmPopup');
      const index = confirmPopup.getAttribute('data-index');
      recipes.splice(index, 1);
      localStorage.setItem('recipes', JSON.stringify(recipes));
      updateCategoryList();
      updateCategoryButtons();
      displayRecipes(recipes);
      closeConfirmPopup();
    }
  
    function closeConfirmPopup() {
      document.getElementById('confirmPopup').style.display = 'none';
    }
  
    function downloadRecipe(index) {
      const recipe = recipes[index];
      const content = `
          <!DOCTYPE html>
          <html lang="he" dir="rtl">
          <head>
              <meta charset="UTF-8">
              <title>${recipe.name}</title>
              <style>
                  body {
                      font-family: Arial, sans-serif;
                      direction: rtl;
                      padding: 20px;
                      max-width: 400px;
                      margin: auto;
                      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                      border: 1px solid #ccc;
                      border-radius: 8px;
                  }
                  img {
                      max-width: 100%;
                      height: auto;
                      border-radius: 8px;
                  }
                  h1 {
                      font-size: 1.5em;
                      margin-bottom: 20px;
                  }
                  p {
                      margin: 10px 0;
                  }
                  ul.ingredients-list, ul.instructions-list {
                      margin: 10px 0;
                      padding-left: 20px;
                  }
              </style>
          </head>
          <body>
              <h1>${recipe.name} / ${recipe.source}</h1>
              ${recipe.image ? `<img src="${recipe.image}" alt="תמונה של ${recipe.name}">` : ''}
              <p><strong>קטגוריה:</strong> ${recipe.category}</p>
              <p><strong>מצרכים:</strong></p>
              <ul class="ingredients-list">
                  ${recipe.ingredients.split('\n').map(ingredient => `<li>${ingredient}</li>`).join('')}
              </ul>
              <p><strong>הוראות:</strong></p>
              <ul class="instructions-list">
                  ${recipe.instructions.split('\n').map(instruction => `<li>${instruction}</li>`).join('')}
              </ul>
              ${recipe.videoUrl ? `<div class="recipe-video">
                <iframe width="560" height="315" src="${getYoutubeEmbed(recipe.videoUrl)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
              </div>` : ''}
              ${recipe.recipeLink ? `<div class="recipe-link"><strong>קישור למתכון:</strong><br><a href="${recipe.recipeLink}" target="_blank">${recipe.recipeLink}</a></div>` : ''}
              ${recipe.notes ? `<div class="recipe-notes"><strong>הערות:</strong><br>${recipe.notes}</div>` : ''}
          </body>
          </html>
      `;
      const blob = new Blob([content], { type: 'text/html' });
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
  
    function generateStars(rating, index) {
      let stars = '';
      for (let i = 1; i <= 5; i++) {
        stars += `<span onclick="rateRecipe(${index}, ${i})">${i <= rating ? '★' : '☆'}</span>`;
      }
      return stars;
    }
  
    function rateRecipe(index, rating) {
      recipes[index].rating = rating;
      localStorage.setItem('recipes', JSON.stringify(recipes));
      showRecipe(index, recipes);
      displayRecipes(recipes);
    }
  
    function generateFilterStars() {
      let stars = '';
      for (let i = 1; i <= 5; i++) {
        stars += `<span onclick="setFilterRating(${i})" id="filterStar${i}">☆</span>`;
      }
      return stars;
    }
  
    function setFilterRating(rating) {
      for (let i = 1; i <= 5; i++) {
        const starElement = document.getElementById(`filterStar${i}`);
        starElement.classList.remove('selected');
        starElement.style.color = 'gray';
        starElement.textContent = '☆';
      }
      if (rating > 0) {
        for (let i = 1; i <= rating; i++) {
          const starElement = document.getElementById(`filterStar${i}`);
          starElement.classList.add('selected');
          starElement.style.color = 'green';
          starElement.textContent = '★';
        }
      }
      filterRecipes();
    }
  
    function getSelectedRating() {
      const stars = document.querySelectorAll('.filter-rating .selected');
      return stars.length;
    }
  
    function resetFilterStars() {
      const stars = document.querySelectorAll('.filter-rating span');
      stars.forEach(star => {
        star.classList.remove('selected');
        star.textContent = '☆';
        star.style.color = 'gray';
      });
    }
  
    function resetSearch() {
      document.getElementById('searchName').value = '';
      document.getElementById('searchIngredients').value = '';
      selectedCategory = '';
      resetFilterStars();
      displayRecipes(recipes);
    }
  
    function exportRecipes() {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(recipes));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "recipes.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    }
  
    function importRecipes(event) {
      const file = event.target.files[0];
      const reader = new FileReader();
      reader.onload = function(e) {
        const importedRecipes = JSON.parse(e.target.result);
        recipes = importedRecipes;
        localStorage.setItem('recipes', JSON.stringify(recipes));
        updateCategoryList();
        updateCategoryButtons();
        displayRecipes(recipes);
      };
      reader.readAsText(file);
    }
  
    function processOCR(event) {
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
    }
  
    function shareRecipe(index) {
      const recipe = recipes[index];
      if (navigator.share) {
        const content = `
            <!DOCTYPE html>
            <html lang="he" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>${recipe.name}</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        direction: rtl;
                        padding: 20px;
                        max-width: 400px;
                        margin: auto;
                        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                        border: 1px solid #ccc;
                        border-radius: 8px;
                    }
                    img {
                        max-width: 100%;
                        height: auto;
                        border-radius: 8px;
                    }
                    h1 {
                        font-size: 1.5em;
                        margin-bottom: 20px;
                    }
                    p {
                        margin: 10px 0;
                    }
                    ul.ingredients-list, ul.instructions-list {
                        margin: 10px 0;
                        padding-left: 20px;
                    }
                </style>
            </head>
            <body>
                <h1>${recipe.name} / ${recipe.source}</h1>
                ${recipe.image ? `<img src="${recipe.image}" alt="תמונה של ${recipe.name}">` : ''}
                <p><strong>קטגוריה:</strong> ${recipe.category}</p>
                <p><strong>מצרכים:</strong></p>
                <ul class="ingredients-list">
                    ${recipe.ingredients.split('\n').map(ingredient => `<li>${ingredient}</li>`).join('')}
                </ul>
                <p><strong>הוראות:</strong></p>
                <ul class="instructions-list">
                    ${recipe.instructions.split('\n').map(instruction => `<li>${instruction}</li>`).join('')}
                </ul>
                ${recipe.videoUrl ? `<div class="recipe-video">
                  <iframe width="560" height="315" src="${getYoutubeEmbed(recipe.videoUrl)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                </div>` : ''}
                ${recipe.recipeLink ? `<div class="recipe-link"><strong>קישור למתכון:</strong><br><a href="${recipe.recipeLink}" target="_blank">${recipe.recipeLink}</a></div>` : ''}
                ${recipe.notes ? `<div class="recipe-notes"><strong>הערות:</strong><br>${recipe.notes}</div>` : ''}
            </body>
            </html>
        `;
        const blob = new Blob([content], { type: 'text/html' });
        const file = new File([blob], `${recipe.name}.html`, { type: 'text/html' });
  
        const shareData = {
          title: recipe.name,
          text: `${recipe.name} - ${recipe.source}`,
          files: [file]
        };
  
        navigator.share(shareData).then(() => {
          console.log('Shared successfully');
        }).catch((error) => {
          console.error('Error sharing:', error);
        });
      } else {
        alert('שיתוף לא נתמך בדפדפן זה.');
      }
    }
  
    function setupBackupReminder() {
      const lastBackup = localStorage.getItem('lastBackup');
      const now = new Date().getTime();
      const twoWeeks = 14 * 24 * 60 * 60 * 1000;
  
      if (!lastBackup || now - lastBackup > twoWeeks) {
        showBackupReminder();
      }
  
      backupReminderTimeout = setTimeout(setupBackupReminder, twoWeeks);
    }
  
    function showBackupReminder() {
      const backupReminder = document.getElementById('backupReminder');
      backupReminder.style.display = 'flex';
    }
  
    function closeBackupReminder() {
      const backupReminder = document.getElementById('backupReminder');
      backupReminder.style.display = 'none';
      localStorage.setItem('lastBackup', new Date().getTime());
      clearTimeout(backupReminderTimeout);
    }
  
    // פונקציה להורדת כל המתכונים כקובץ HTML
    function downloadAllRecipes() {
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
                ${recipe.image ? `<img src="${recipe.image}" alt="תמונה של ${recipe.name}">` : ''}
                <p><strong>קטגוריה:</strong> ${recipe.category}</p>
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
  
    // פונקציה לשינוי מספר המתכונים בשורה
    function setRecipesPerRow(number) {
      document.documentElement.style.setProperty('--columns', number);
      document.getElementById('grid6').classList.remove('active');
      document.getElementById('grid8').classList.remove('active');
      document.getElementById('grid' + number).classList.add('active');
    }
  
    // ציור אייקוני הגריד
    function drawGridIcons() {
      const grids = [
        { id: 'grid6', cols: 6 },
        { id: 'grid8', cols: 8 }
      ];
  
      grids.forEach(grid => {
        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 40;
        const ctx = canvas.getContext('2d');
  
        const cols = grid.cols;
        const rows = 1;
        const cellWidth = canvas.width / cols;
        const cellHeight = canvas.height / rows;
  
        for (let i = 0; i < cols; i++) {
          ctx.strokeStyle = '#333';
          ctx.strokeRect(i * cellWidth, 0, cellWidth, cellHeight);
        }
  
        document.getElementById(grid.id).appendChild(canvas);
      });
    }
  
    // פונקציה לסגירת חלונות בעת לחיצה על ה-overlay
    function setupPopupCloseOnOverlayClick() {
      const popups = ['popup', 'formPopup', 'confirmPopup'];
      popups.forEach(popupId => {
        const popup = document.getElementById(popupId);
        popup.addEventListener('click', function(event) {
          if (event.target === popup) {
            if (popupId === 'popup') closePopup();
            if (popupId === 'formPopup') closeFormPopup();
            if (popupId === 'confirmPopup') closeConfirmPopup();
          }
        });
      });
    }
  
    // פונקציות לפתיחת וסגירת תפריט הצד
    function openMenu() {
      document.getElementById('sideMenu').style.width = '250px';
    }
  
    function closeMenu() {
      document.getElementById('sideMenu').style.width = '0';
    }
  
    // חשיפת הפונקציות לחלון הגלובלי כדי שהן יהיו נגישות מ-onclick
    window.openFormPopup = openFormPopup;
    window.closeFormPopup = closeFormPopup;
    window.closePopup = closePopup;
    window.editRecipe = editRecipe;
    window.confirmDeleteRecipe = confirmDeleteRecipe;
    window.deleteRecipe = deleteRecipe;
    window.closeConfirmPopup = closeConfirmPopup;
    window.downloadRecipe = downloadRecipe;
    window.shareRecipe = shareRecipe;
    window.closeBackupReminder = closeBackupReminder;
    window.filterRecipes = filterRecipes;
    window.filterByCategory = filterByCategory;
    window.resetSearch = resetSearch;
    window.rateRecipe = rateRecipe;
    window.setFilterRating = setFilterRating;
    window.processOCR = processOCR;
    window.exportRecipes = exportRecipes;
    window.importRecipes = importRecipes;
    window.downloadAllRecipes = downloadAllRecipes;
    window.openMenu = openMenu;
    window.closeMenu = closeMenu;
    window.setRecipesPerRow = setRecipesPerRow;
  
    // Timer functionality
    let timerInterval;

    function beep(duration, frequency, volume, type) {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = type || 'sine';
        oscillator.frequency.value = frequency || 440;
        gainNode.gain.value = volume || 0.10;
        oscillator.start();
        setTimeout(() => {
            oscillator.stop();
        }, duration);
    }

    function initializeTimer() {
        const startBtn = document.getElementById('start-timer');
        const stopBtn = document.getElementById('stop-timer');
        
        if (startBtn && stopBtn) {
            startBtn.addEventListener('click', startTimer);
            stopBtn.addEventListener('click', stopTimer);
        }
    }

    function startTimer() {
        const minutes = parseInt(document.getElementById('timer-input').value);
        if (isNaN(minutes) || minutes <= 0) return;

        const startBtn = document.getElementById('start-timer');
        const stopBtn = document.getElementById('stop-timer');
        const display = document.getElementById('timer-display');

        startBtn.style.display = 'none';
        stopBtn.style.display = 'flex';

        let totalSeconds = minutes * 60;
        const endTime = Date.now() + (totalSeconds * 1000);

        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            const now = Date.now();
            const remaining = Math.max(0, endTime - now);
            
            if (remaining === 0) {
                clearInterval(timerInterval);
                beep(3000, 440, 0.5, 'sine');
                startBtn.style.display = 'flex';
                stopBtn.style.display = 'none';
                display.textContent = '';
                return;
            }

            const remainingMinutes = Math.floor(remaining / 60000);
            const remainingSeconds = Math.floor((remaining % 60000) / 1000);
            display.textContent = `${remainingMinutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        }, 1000);
    }

    function stopTimer() {
        const startBtn = document.getElementById('start-timer');
        const stopBtn = document.getElementById('stop-timer');
        const display = document.getElementById('timer-display');

        clearInterval(timerInterval);
        startBtn.style.display = 'flex';
        stopBtn.style.display = 'none';
        display.textContent = '';
    }

    // Initialize timer when page loads
    document.addEventListener('DOMContentLoaded', () => {
        initializeTimer();
    });
})();