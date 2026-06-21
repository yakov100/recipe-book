// AI chat with the "chef": message rendering, conversation history (Supabase),
// suggested-recipe cards, image attachments, and streaming replies from the
// recipe-ai edge function. setAuthGateVisible is reached via window (main.js).
import { supabase, edgeFunctionUrl, edgeFunctionHeaders } from './supabase.js';
import {
    recipes,
    aiChatMessages, setAiChatMessages,
    aiChatAbortController, setAiChatAbortController,
    aiGeneratedImage, setAiGeneratedImage,
    currentConversationId, setCurrentConversationId,
    conversationHistory, setConversationHistory,
    chatAttachments, setChatAttachments,
    chatClosedAt, setChatClosedAt,
    pendingSuggestedRecipe, setPendingSuggestedRecipe,
    isSharedRecipeMode,
    CHAT_RESUME_THRESHOLD_MS,
} from './state.js';
import { getCurrentUser, isAuthenticated } from './auth.js';
import { saveRecipeToDB, saveRecipesToCache } from './data/recipes-repo.js';
import { getDisplayUrl, getDefaultImageUrl, uploadImageToStorage } from './images.js';
import { updateCategoryList, updateCategoryButtons } from './categories.js';
import { filterRecipes } from './filters.js';
import { showRecipe, displayRecipes } from './recipe-view.js';
import { openFormPopup } from './recipe-form.js';
import { initVoiceButton } from './voice.js';
import { chefImageUrl, formatMessageTime, formatRelativeDate, compactRecipes } from './utils.js';

    export function renderAiChatMessages() {
      const el = document.getElementById('aiChatMessages');
      if (!el) return;
      el.innerHTML = '';
      
      // Add date separator at the beginning
      const dateSeparator = document.createElement('div');
      dateSeparator.className = 'ai-chat-date-separator';
      dateSeparator.innerHTML = '<span>היום</span>';
      el.appendChild(dateSeparator);
      
      aiChatMessages.forEach(function(m, msgIndex) {
        // Create wrapper for avatar layout
        const wrapper = document.createElement('div');
        wrapper.className = 'ai-chat-msg-wrapper ' + (m.role === 'user' ? 'user' : 'assistant');

        // Create avatar (only for assistant messages)
        if (m.role !== 'user') {
          const avatar = document.createElement('div');
          avatar.className = 'ai-chat-avatar chef';
          avatar.innerHTML = '<img src="' + chefImageUrl('chef-serving.png') + '" alt="שף" class="chef-avatar-img">';
          wrapper.appendChild(avatar);
        }

        // Create content container (message + timestamp)
        const contentContainer = document.createElement('div');
        contentContainer.className = 'ai-chat-msg-content';

        // Create message bubble
        const d = document.createElement('div');
        d.className = 'ai-chat-msg ' + (m.role === 'user' ? 'user' : 'assistant');

        // Add text content (with support for highlighted text)
        const textContent = m.content || '';
        d.innerHTML = '<p class="text-sm leading-relaxed">' + textContent.replace(/\n/g, '<br>') + '</p>';

        // Add attachment thumbnails if present
        if (m.attachments && m.attachments.length > 0) {
          const attachmentsDiv = document.createElement('div');
          attachmentsDiv.className = 'message-attachments';
          m.attachments.forEach(function(att) {
            if (att.type === 'image') {
              const imgContainer = document.createElement('div');
              imgContainer.className = 'message-attachment';
              const img = document.createElement('img');
              img.src = att.data;
              img.alt = att.name || 'תמונה';
              img.onclick = function() { window.open(att.data, '_blank'); };
              imgContainer.appendChild(img);
              attachmentsDiv.appendChild(imgContainer);
            }
          });
          d.appendChild(attachmentsDiv);
        }

        // Add recipe card if present (inside the message bubble)
        if (m.recipeCard) {
          const recipeCard = document.createElement('div');
          recipeCard.className = 'ai-chat-recipe-card';
          recipeCard.innerHTML = `
            <img src="${getDisplayUrl(m.recipeCard) || getDefaultImageUrl(m.recipeCard.category || 'שונות')}" alt="${m.recipeCard.name}" onerror="this.src=getDefaultImageUrl('שונות')">
            <div class="ai-chat-recipe-card-footer" onclick="viewRecipeFromChat('${m.recipeCard.id || ''}')">
              <span>צפה במתכון המלא</span>
              <span class="material-symbols-outlined">arrow_back</span>
            </div>
          `;
          d.appendChild(recipeCard);
        }

        contentContainer.appendChild(d);

        // Suggested recipe preview – standalone card below the message bubble
        if (m.suggestedRecipe && typeof m.suggestedRecipe === 'object') {
          var sr = m.suggestedRecipe;
          var srImg = getDisplayUrl({ imagePath: sr.image_path, image: sr.image });
          var srIngredients = (sr.ingredients || '').replace(/\n/g, '<br>');
          var srInstructions = (sr.instructions || '').replace(/\n/g, '<br>');
          var srCategory = sr.category || 'שונות';
          var isAdded = !!m.recipeAdded;
          const srCard = document.createElement('div');
          srCard.className = 'ai-chat-recipe-confirm';
          srCard.innerHTML = `
            ${srImg ? `<div class="recipe-card-image"><img src="${srImg}" alt="${sr.name || ''}" onerror="this.parentElement.style.display='none'"><div class="recipe-card-category-badge">${srCategory}</div></div>` : ''}
            <div class="recipe-card-body">
              <div class="recipe-card-title">${sr.name || ''}</div>
              ${!srImg ? `<span class="recipe-card-category-inline">${srCategory}</span>` : ''}
              ${srIngredients ? `
                <div class="recipe-card-section open">
                  <div class="recipe-card-section-header" onclick="this.parentElement.classList.toggle('open')">
                    <span><span class="material-symbols-outlined">shopping_basket</span> מצרכים</span>
                    <span class="material-symbols-outlined recipe-card-chevron">expand_more</span>
                  </div>
                  <div class="recipe-card-section-content">${srIngredients}</div>
                </div>` : ''}
              ${srInstructions ? `
                <div class="recipe-card-section">
                  <div class="recipe-card-section-header" onclick="this.parentElement.classList.toggle('open')">
                    <span><span class="material-symbols-outlined">cooking</span> הוראות הכנה</span>
                    <span class="material-symbols-outlined recipe-card-chevron">expand_more</span>
                  </div>
                  <div class="recipe-card-section-content">${srInstructions}</div>
                </div>` : ''}
            </div>
            ${isAdded ? `
              <div class="recipe-confirm-added">
                <span class="material-symbols-outlined">check_circle</span>
                המתכון נוסף לספר!
              </div>
            ` : `
              <div class="recipe-confirm-buttons">
                <button type="button" class="confirm-add-btn" onclick="addSuggestedRecipeDirectly(${msgIndex})">
                  <span class="material-symbols-outlined">add</span>
                  הוסף לספר
                </button>
                <button type="button" class="confirm-edit-btn" onclick="editSuggestedRecipeFromMsg(${msgIndex})">
                  <span class="material-symbols-outlined">edit</span>
                  ערוך
                </button>
                <button type="button" class="confirm-cancel-btn" onclick="dismissSuggestedRecipe(${msgIndex})" aria-label="סגור">
                  <span class="material-symbols-outlined">close</span>
                </button>
              </div>
            `}
          `;
          contentContainer.appendChild(srCard);
        }

        // Add timestamp
        const timeDiv = document.createElement('div');
        timeDiv.className = 'ai-chat-msg-time';
        timeDiv.textContent = formatMessageTime(m.timestamp || new Date());
        contentContainer.appendChild(timeDiv);

        // Assemble wrapper
        wrapper.appendChild(contentContainer);
        el.appendChild(wrapper);
      });

      // pendingSuggestedRecipe confirmation card removed - buttons are now inline in each message

      if (el.scrollTo) {
        requestAnimationFrame(function() {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    }

    // Add suggested recipe to book: try API (generate image + insert), fallback to local save without image
    export async function addSuggestedRecipeDirectly(msgIndex) {
      var m = aiChatMessages[msgIndex];
      if (!m || !m.suggestedRecipe) return;
      var sr = m.suggestedRecipe;

      // Show chef cooking avatar while adding
      var msgsEl = document.getElementById('aiChatMessages');
      var addingWrapper = null;
      if (msgsEl) {
        addingWrapper = document.createElement('div');
        addingWrapper.className = 'ai-chat-msg-wrapper assistant';
        addingWrapper.id = 'aiChatAddingToBook';
        var addingAvatar = document.createElement('div');
        addingAvatar.className = 'ai-chat-avatar chef';
        addingAvatar.innerHTML = '<img src="' + chefImageUrl('chef-cooking.png') + '" alt="שף מבשל" class="chef-avatar-img">';
        var addingContent = document.createElement('div');
        addingContent.className = 'ai-chat-msg-content';
        var addingMsg = document.createElement('div');
        addingMsg.className = 'ai-chat-msg assistant loading';
        addingMsg.setAttribute('aria-label', 'מוסיף לספר');
        addingMsg.innerHTML = '<span class="typing-dots">מוסיף לספר...</span>';
        addingContent.appendChild(addingMsg);
        addingWrapper.appendChild(addingAvatar);
        addingWrapper.appendChild(addingContent);
        msgsEl.appendChild(addingWrapper);
        msgsEl.scrollTo({ top: msgsEl.scrollHeight, behavior: 'smooth' });
      }

      function removeAddingIndicator() {
        var el = document.getElementById('aiChatAddingToBook');
        if (el) el.remove();
      }

      var payload = {
        insertSuggestedRecipe: true,
        suggestedRecipe: {
          name: sr.name || '',
          ingredients: sr.ingredients || '',
          instructions: sr.instructions || '',
          category: sr.category || 'שונות',
          source: sr.source || 'נוצר על ידי AI'
        }
      };

      try {
        var addHeaders = await edgeFunctionHeaders();
        if (!addHeaders) {
          removeAddingIndicator();
          alert('נא להתחבר עם Google כדי להוסיף מתכון');
          window.setAuthGateVisible(true);
          return;
        }
        var res = await fetch(edgeFunctionUrl('recipe-ai'), {
          method: 'POST',
          headers: addHeaders,
          body: JSON.stringify(payload)
        });
        var data = res.ok ? (await res.json().catch(function() { return {}; })) : {};

        if (data && data.insertedRecipeId) {
          removeAddingIndicator();
          // Add the new recipe to the local array and update cache without a full DB refetch
          var newRecipeRow = data.suggestedRecipe || {};
          var newRecipe = {
            id: data.insertedRecipeId,
            name: newRecipeRow.name || sr.name || '',
            source: newRecipeRow.source || sr.source || 'נוצר על ידי AI',
            ingredients: newRecipeRow.ingredients || sr.ingredients || '',
            instructions: newRecipeRow.instructions || sr.instructions || '',
            category: newRecipeRow.category || sr.category || 'שונות',
            dietaryType: null,
            notes: null,
            rating: 0,
            difficulty: null,
            imagePath: newRecipeRow.image_path || null,
            image: null,
            recipeLink: null,
            videoUrl: null,
            preparationTime: null
          };
          if (!Array.isArray(recipes)) setRecipes([]);
          setRecipes(recipes.filter(function(r) { return r && r.id !== data.insertedRecipeId; }));
          recipes.push(newRecipe);
          saveRecipesToCache(recipes);
          m.recipeAdded = true;
          m.addedRecipeId = data.insertedRecipeId;
          if (m.dbId) {
            await updateMessageMetadataInDb(m.dbId, buildMessageMetadata(m));
          }
          setPendingSuggestedRecipe(null);
          renderAiChatMessages();
          filterRecipes();
          updateCategoryList();
          updateCategoryButtons();
          return;
        }
      } catch (apiErr) {
        console.warn('Recipe-ai insert failed, falling back to local save:', apiErr);
      }

      // Fallback: save without image so the recipe is not lost
      try {
        var newRecipe = {
          name: sr.name || '',
          source: sr.source || 'נוצר על ידי AI',
          ingredients: sr.ingredients || '',
          instructions: sr.instructions || '',
          category: sr.category || 'שונות',
          notes: null,
          rating: 0,
          imagePath: null,
          recipeLink: null,
          videoUrl: null
        };
        await saveRecipeToDB(newRecipe);
        recipes.push(newRecipe);
        m.recipeAdded = true;
        m.addedRecipeId = newRecipe.id;
        if (m.dbId) {
          await updateMessageMetadataInDb(m.dbId, buildMessageMetadata(m));
        }
        setPendingSuggestedRecipe(null);
        removeAddingIndicator();
        renderAiChatMessages();
        filterRecipes();
        updateCategoryList();
        updateCategoryButtons();
      } catch (err) {
        removeAddingIndicator();
        console.error('Failed to add recipe directly:', err);
        alert('שגיאה בהוספת המתכון: ' + (err.message || err));
      }
    }

    // Open form to edit recipe from chat message
    export async function editSuggestedRecipeFromMsg(msgIndex) {
      var m = aiChatMessages[msgIndex];
      if (!m || !m.suggestedRecipe) return;
      applySuggestedRecipe(m.suggestedRecipe);
      m.suggestedRecipe = null;
      setPendingSuggestedRecipe(null);
      if (m.dbId) {
        await updateMessageMetadataInDb(m.dbId, buildMessageMetadata(m));
      }
      renderAiChatMessages();
    }

    // Dismiss suggested recipe from chat message
    export async function dismissSuggestedRecipe(msgIndex) {
      var m = aiChatMessages[msgIndex];
      if (!m) return;
      m.suggestedRecipe = null;
      setPendingSuggestedRecipe(null);
      if (m.dbId) {
        await updateMessageMetadataInDb(m.dbId, buildMessageMetadata(m));
      }
      renderAiChatMessages();
    }
    // --- Chat Conversation Management ---
    export async function createNewConversation() {
      const user = getCurrentUser();
      if (!supabase || !user) return null;
      try {
        const { data, error } = await supabase
          .from('chat_conversations')
          .insert({ title: 'שיחה חדשה', user_id: user.id })
          .select('id')
          .single();
        if (error) {
          console.error('Error creating conversation:', error);
          return null;
        }
        return data.id;
      } catch (e) {
        console.error('Error creating conversation:', e);
        return null;
      }
    }

    export async function loadConversationHistory() {
      if (!supabase) return [];
      try {
        // Calculate the date 24 hours ago
        const oneDayAgo = new Date();
        oneDayAgo.setHours(oneDayAgo.getHours() - 24);
        const oneDayAgoISO = oneDayAgo.toISOString();

        // Load only conversations from the last 24 hours
        const { data, error } = await supabase
          .from('chat_conversations')
          .select('id, title, updated_at, last_message_preview')
          .gte('updated_at', oneDayAgoISO)
          .order('updated_at', { ascending: false })
          .limit(30);
        if (error) {
          console.error('Error loading conversations:', error);
          return [];
        }
        
        // Also clean up old conversations (older than 24 hours)
        deleteOldConversations();
        
        return data || [];
      } catch (e) {
        console.error('Error loading conversations:', e);
        return [];
      }
    }

    // Delete conversations older than 24 hours
    export async function deleteOldConversations() {
      if (!supabase) return;
      try {
        const oneDayAgo = new Date();
        oneDayAgo.setHours(oneDayAgo.getHours() - 24);
        const oneDayAgoISO = oneDayAgo.toISOString();

        // Delete old messages first (due to foreign key constraint)
        await supabase
          .from('chat_messages')
          .delete()
          .lt('created_at', oneDayAgoISO);

        // Then delete old conversations
        await supabase
          .from('chat_conversations')
          .delete()
          .lt('updated_at', oneDayAgoISO);

        console.log('Old conversations cleaned up');
      } catch (e) {
        console.error('Error deleting old conversations:', e);
      }
    }

    export function buildMessageMetadata(message) {
      if (!message || typeof message !== 'object') return {};
      var meta = {};
      if (message.suggestedRecipe && typeof message.suggestedRecipe === 'object') {
        meta.suggestedRecipe = message.suggestedRecipe;
      }
      if (message.recipeAdded) meta.recipeAdded = true;
      if (message.addedRecipeId) meta.addedRecipeId = message.addedRecipeId;
      if (message.recipeCard) meta.recipeCard = message.recipeCard;
      return meta;
    }

    export function applyMessageMetadata(message, metadata) {
      if (!metadata || typeof metadata !== 'object') return message;
      if (metadata.suggestedRecipe && typeof metadata.suggestedRecipe === 'object') {
        message.suggestedRecipe = metadata.suggestedRecipe;
      }
      if (metadata.recipeAdded) message.recipeAdded = true;
      if (metadata.addedRecipeId) message.addedRecipeId = metadata.addedRecipeId;
      if (metadata.recipeCard) message.recipeCard = metadata.recipeCard;
      return message;
    }

    export async function loadConversationMessages(conversationId) {
      if (!supabase) return [];
      try {
        const { data, error } = await supabase
          .from('chat_messages')
          .select('id, role, content, attachments, metadata, created_at')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true });
        if (error) {
          console.error('Error loading messages:', error);
          return [];
        }
        return data || [];
      } catch (e) {
        console.error('Error loading messages:', e);
        return [];
      }
    }

    export async function saveMessageToDb(conversationId, role, content, attachments, metadata) {
      if (!supabase || !conversationId) return null;
      try {
        const { data, error } = await supabase.from('chat_messages').insert({
          conversation_id: conversationId,
          role: role,
          content: content,
          attachments: attachments || [],
          metadata: metadata || {}
        }).select('id').single();
        if (error) {
          console.error('Error saving message:', error);
          return null;
        }
        return data ? data.id : null;
      } catch (e) {
        console.error('Error saving message:', e);
        return null;
      }
    }

    export async function updateMessageMetadataInDb(messageId, metadata) {
      if (!supabase || !messageId) return;
      try {
        const { error } = await supabase
          .from('chat_messages')
          .update({ metadata: metadata || {} })
          .eq('id', messageId);
        if (error) console.error('Error updating message metadata:', error);
      } catch (e) {
        console.error('Error updating message metadata:', e);
      }
    }

    export function showChatView(view) {
      const homeView = document.getElementById('aiChatHomeView');
      const threadView = document.getElementById('aiChatThreadView');
      if (!homeView || !threadView) return;

      const isHome = view === 'home';
      homeView.classList.toggle('ai-chat-view-active', isHome);
      threadView.classList.toggle('ai-chat-view-active', !isHome);

      if (isHome) {
        homeView.setAttribute('aria-hidden', 'false');
        threadView.setAttribute('aria-hidden', 'true');
      } else {
        homeView.setAttribute('aria-hidden', 'true');
        threadView.setAttribute('aria-hidden', 'false');
        updateThreadTitle();
      }
    }

    export function updateThreadTitle() {
      const titleEl = document.getElementById('aiChatThreadTitle');
      if (!titleEl) return;

      const conv = conversationHistory.find(function(c) { return c.id === currentConversationId; });
      titleEl.textContent = conv && conv.title ? conv.title : 'שיחה חדשה';
    }

    export function renderConversationList() {
      const listEl = document.getElementById('aiChatHistoryList');
      if (!listEl) return;

      listEl.innerHTML = '';

      if (conversationHistory.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'history-empty';
        empty.textContent = 'אין שיחות עדיין — התחילו שיחה חדשה';
        listEl.appendChild(empty);
        return;
      }

      conversationHistory.forEach(function(conv) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'history-item' + (conv.id === currentConversationId ? ' active' : '');
        item.onclick = function() { loadPastConversation(conv.id); };

        const row = document.createElement('div');
        row.className = 'history-item-row';

        const main = document.createElement('div');
        main.className = 'history-item-main';

        const title = document.createElement('div');
        title.className = 'history-item-title';
        title.textContent = conv.title || 'שיחה ללא כותרת';

        const preview = document.createElement('div');
        preview.className = 'history-item-preview';
        preview.textContent = conv.last_message_preview || 'אין הודעות עדיין';

        main.appendChild(title);
        main.appendChild(preview);

        const date = document.createElement('div');
        date.className = 'history-item-date';
        date.textContent = formatRelativeDate(conv.updated_at);

        row.appendChild(main);
        row.appendChild(date);
        item.appendChild(row);
        listEl.appendChild(item);
      });
    }

    export async function goBackToChatHome() {
      setConversationHistory(await loadConversationHistory());
      renderConversationList();
      showChatView('home');
    }

    export async function loadPastConversation(conversationId) {
      setCurrentConversationId(conversationId);
      const messages = await loadConversationMessages(conversationId);
      setAiChatMessages(messages.map(function(m) {
        var message = {
          role: m.role,
          content: m.content,
          attachments: m.attachments || [],
          timestamp: m.created_at ? new Date(m.created_at) : new Date(),
          dbId: m.id || null
        };
        return applyMessageMetadata(message, m.metadata);
      }));
      renderAiChatMessages();
      renderConversationList();
      showChatView('thread');
      clearAttachmentPreview();

      var input = document.getElementById('aiChatInput');
      if (input) input.focus();
      var sendBtn = document.getElementById('aiChatSend');
      if (sendBtn) sendBtn.disabled = false;
    }

    export async function startNewConversation() {
      setCurrentConversationId(await createNewConversation());
      setAiChatMessages([]);
      setChatAttachments([]);

      aiChatMessages.push({
        role: 'assistant',
        content: 'היי! איך אוכל לעזור לך לבשל היום? אני יכול להציע מתכונים, לחפש לפי מצרכים שיש לך בבית, או להמציא מתכון חדש.',
        timestamp: new Date()
      });

      setConversationHistory(await loadConversationHistory());
      renderConversationList();
      renderAiChatMessages();
      clearAttachmentPreview();
      showChatView('thread');

      var input = document.getElementById('aiChatInput');
      if (input) input.focus();
    }

    export function toggleChatMenu() {
      // Placeholder for menu functionality
      console.log('Chat menu clicked');
    }

    // --- File Upload Handling ---
    export function handleChatFileSelect(event) {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 5 * 1024 * 1024) {
          alert('הקובץ גדול מדי (מקסימום 5MB)');
          continue;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
          // Resize image before storing
          resizeImageFromDataUrl(e.target.result, 800, 800, function(resizedData) {
            chatAttachments.push({
              type: 'image',
              data: resizedData,
              name: file.name
            });
            renderAttachmentPreviews();
          });
        };
        reader.readAsDataURL(file);
      }

      event.target.value = '';
    }

    export function resizeImageFromDataUrl(dataUrl, maxW, maxH, callback) {
      const img = new Image();
      img.onload = function() {
        let w = img.width;
        let h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        callback(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function() {
        callback(dataUrl); // fallback to original
      };
      img.src = dataUrl;
    }

    export function renderAttachmentPreviews() {
      const container = document.getElementById('aiChatAttachments');
      if (!container) return;

      if (chatAttachments.length === 0) {
        container.style.display = 'none';
        return;
      }

      container.style.display = 'flex';
      container.innerHTML = '';

      chatAttachments.forEach(function(att, idx) {
        const preview = document.createElement('div');
        preview.className = 'attachment-preview';

        if (att.type === 'image') {
          const img = document.createElement('img');
          img.src = att.data;
          img.alt = att.name || 'תמונה';
          preview.appendChild(img);
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'attachment-remove';
        removeBtn.innerHTML = '&times;';
        removeBtn.onclick = function() {
          chatAttachments.splice(idx, 1);
          renderAttachmentPreviews();
        };
        preview.appendChild(removeBtn);

        container.appendChild(preview);
      });

      // Update attach button state
      const attachBtn = document.getElementById('aiChatAttach');
      if (attachBtn) {
        attachBtn.classList.toggle('has-attachments', chatAttachments.length > 0);
      }
    }

    export function clearAttachmentPreview() {
      setChatAttachments([]);
      renderAttachmentPreviews();
    }

    export async function openAiChat() {
      if (!isAuthenticated()) {
        window.setAuthGateVisible(true);
        alert('נא להתחבר עם Google כדי לשוחח עם ה-AI');
        return;
      }
      var ov = document.getElementById('aiChatOverlay');
      if (ov) ov.style.display = 'flex';
      initVoiceButton();

      const shouldResume =
        currentConversationId &&
        aiChatMessages.length > 0 &&
        chatClosedAt &&
        Date.now() - chatClosedAt < CHAT_RESUME_THRESHOLD_MS;

      if (shouldResume) {
        setConversationHistory(await loadConversationHistory());
        renderConversationList();
        showChatView('thread');
        renderAiChatMessages();
        clearAttachmentPreview();
        var resumedInput = document.getElementById('aiChatInput');
        if (resumedInput) resumedInput.focus();
        var resumedSendBtn = document.getElementById('aiChatSend');
        if (resumedSendBtn) resumedSendBtn.disabled = false;
        return;
      }

      setConversationHistory(await loadConversationHistory());
      renderConversationList();
      showChatView('home');
    }

    export function closeAiChat() {
      if (aiChatAbortController) {
        aiChatAbortController.abort();
        setAiChatAbortController(null);
      }
      setChatClosedAt(Date.now());
      var ov = document.getElementById('aiChatOverlay');
      if (ov) ov.style.display = 'none';
    }

    // Fallback when Edge Function did not insert to DB: fill form for user to edit and save.
    export function applySuggestedRecipe(suggestedRecipe) {
      if (!suggestedRecipe || typeof suggestedRecipe !== 'object') return;
      closeAiChat();
      openFormPopup();
      document.getElementById('recipeName').value = suggestedRecipe.name || '';
      document.getElementById('recipeSource').value = suggestedRecipe.source || '';
      document.getElementById('ingredients').value = suggestedRecipe.ingredients || '';
      populateIngredientRows(suggestedRecipe.ingredients || '');
      document.getElementById('instructions').value = suggestedRecipe.instructions || '';
      var cat = suggestedRecipe.category || 'שונות';
      var sel = document.getElementById('category');
      if (sel) {
        populateCategorySelectAndDropdown();
        if (![].slice.call(sel.options).some(function(o) { return o.value === cat; })) {
          var opt = document.createElement('option');
          opt.value = cat;
          opt.textContent = cat;
          sel.appendChild(opt);
        }
        sel.value = cat;
        updateCategoryTriggerDisplay();
      }
      // Store AI-generated image/path for use when saving
      setAiGeneratedImage(suggestedRecipe.image_path ? { imagePath: suggestedRecipe.image_path } : (suggestedRecipe.image ? suggestedRecipe.image : null));

      var dietary = (typeof suggestedRecipe.dietaryType === 'string' && suggestedRecipe.dietaryType.trim())
        ? suggestedRecipe.dietaryType.trim()
        : (typeof suggestedRecipe.dietary_type === 'string' && suggestedRecipe.dietary_type.trim())
          ? suggestedRecipe.dietary_type.trim()
          : '';
      var dietaryEl = document.getElementById('dietaryType');
      if (dietaryEl) dietaryEl.value = dietary;
    }

    export async function sendAiMessage() {
      var input = document.getElementById('aiChatInput');
      var sendBtn = document.getElementById('aiChatSend');
      var msg = (input && input.value) ? input.value.trim() : '';

      // Allow sending with only attachments (no text required)
      if (!msg && chatAttachments.length === 0) return;

      if (!isAuthenticated()) {
        window.setAuthGateVisible(true);
        alert('נא להתחבר עם Google כדי לשוחח עם ה-AI');
        return;
      }

      var authHeaders = await edgeFunctionHeaders();
      if (!authHeaders) {
        window.setAuthGateVisible(true);
        alert('נא להתחבר עם Google כדי לשוחח עם ה-AI');
        return;
      }

      if (aiChatAbortController) {
        aiChatAbortController.abort();
      }
      setAiChatAbortController(new AbortController());

      // Build message with attachments
      var userMessage = {
        role: 'user',
        content: msg || (chatAttachments.length > 0 ? '[תמונה]' : ''),
        attachments: chatAttachments.slice(), // copy array
        timestamp: new Date()
      };

      aiChatMessages.push(userMessage);

      // Save user message to database
      if (currentConversationId) {
        var userDbId = await saveMessageToDb(
          currentConversationId,
          'user',
          userMessage.content,
          userMessage.attachments,
          buildMessageMetadata(userMessage)
        );
        if (userDbId) userMessage.dbId = userDbId;
      }

      // Clear inputs
      if (input) input.value = '';
      clearAttachmentPreview();
      renderAiChatMessages();
      if (sendBtn) sendBtn.disabled = true;

      var loadingWrapper = document.createElement('div');
      loadingWrapper.className = 'ai-chat-msg-wrapper assistant';
      loadingWrapper.id = 'aiChatLoading';

      var loadingAvatar = document.createElement('div');
      loadingAvatar.className = 'ai-chat-avatar chef';
      loadingAvatar.innerHTML = '<img src="' + chefImageUrl('chef-typing.png') + '" alt="שף מקליד" class="chef-avatar-img">';

      var loadingContent = document.createElement('div');
      loadingContent.className = 'ai-chat-msg-content';

      var loading = document.createElement('div');
      loading.className = 'ai-chat-msg assistant loading';
      loading.setAttribute('aria-label', 'חושב...');
      loading.innerHTML = '<span class="typing-dots">מעבד...</span>';

      loadingContent.appendChild(loading);
      loadingWrapper.appendChild(loadingAvatar);
      loadingWrapper.appendChild(loadingContent);
      var msgsEl = document.getElementById('aiChatMessages');
      if (msgsEl) {
        msgsEl.appendChild(loadingWrapper);
        msgsEl.scrollTo({ top: msgsEl.scrollHeight, behavior: 'smooth' });
      }

      fetch(edgeFunctionUrl('recipe-ai'), {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ messages: aiChatMessages, recipes: compactRecipes(recipes) }),
        signal: aiChatAbortController.signal
      })
        .then(function(res) { return res.json().then(function(data) { return { res: res, data: data }; }); })
        .then(async function(_ref) {
          var res = _ref.res;
          var data = _ref.data;
          console.log('[AI Chat] Response data:', JSON.stringify(data, null, 2));
          var loadEl = document.getElementById('aiChatLoading');
          if (loadEl) loadEl.remove();
          if (sendBtn) sendBtn.disabled = false;

          var reply = (data && data.reply) ? data.reply : (data && data.error) ? data.error : 'לא התקבלה תשובה.';
          if (res && res.status === 401) {
            reply = 'נא להתחבר עם Google כדי להשתמש ב-AI';
            window.setAuthGateVisible(true);
          } else if (!reply && res && !res.ok) {
            reply = 'שגיאה מהשרת (' + (res.status || '') + '). נא לבדוק GEMINI_API_KEY ב-Supabase Secrets.';
          }

          var assistantMessage = { role: 'assistant', content: reply, timestamp: new Date() };

          // Attach suggested recipe data to the message for inline display
          if (data && data.suggestedRecipe && typeof data.suggestedRecipe === 'object') {
            assistantMessage.suggestedRecipe = data.suggestedRecipe;
          }

          aiChatMessages.push(assistantMessage);

          // Save assistant message to database (including suggested recipe for history restore)
          if (currentConversationId) {
            var assistantDbId = await saveMessageToDb(
              currentConversationId,
              'assistant',
              reply,
              [],
              buildMessageMetadata(assistantMessage)
            );
            if (assistantDbId) assistantMessage.dbId = assistantDbId;
          }

          renderAiChatMessages();

          var recipeIds = (data && Array.isArray(data.recipeIds)) ? data.recipeIds : [];
          if (data && data.insertedRecipeId) {
            // Recipe was confirmed and inserted to DB
            setPendingSuggestedRecipe(null);
            closeAiChat();
            // Update local array and cache without a full DB refetch
            var aiNewRecipeRow = (data.suggestedRecipe && typeof data.suggestedRecipe === 'object') ? data.suggestedRecipe : {};
            var aiNewRecipe = {
              id: data.insertedRecipeId,
              name: aiNewRecipeRow.name || '',
              source: aiNewRecipeRow.source || 'נוצר על ידי AI',
              ingredients: aiNewRecipeRow.ingredients || '',
              instructions: aiNewRecipeRow.instructions || '',
              category: aiNewRecipeRow.category || 'שונות',
              dietaryType: null,
              notes: null,
              rating: 0,
              difficulty: null,
              imagePath: aiNewRecipeRow.image_path || null,
              image: null,
              recipeLink: null,
              videoUrl: null,
              preparationTime: null
            };
            if (!Array.isArray(recipes)) setRecipes([]);
            setRecipes(recipes.filter(function(r) { return r && r.id !== data.insertedRecipeId; }));
            recipes.push(aiNewRecipe);
            saveRecipesToCache(recipes);
            filterRecipes();
            updateCategoryList();
            updateCategoryButtons();
            var idx = recipes.findIndex(function(r) { return r && r.id === data.insertedRecipeId; });
            if (idx >= 0) showRecipe(idx);
          } else if (data && data.regenerateImageForRecipeId && (data.regeneratedImagePath || data.regeneratedImage)) {
            closeAiChat();
            var idx = recipes.findIndex(function(r) { return r && r.id === data.regenerateImageForRecipeId; });
            if (idx >= 0) {
              var aiImagePath = data.regeneratedImagePath || null;
              if (!aiImagePath && data.regeneratedImage) {
                try {
                  var imgResp = await fetch(data.regeneratedImage);
                  var imgBlob = await imgResp.blob();
                  var imgExt = imgBlob.type === 'image/png' ? 'png' : 'jpg';
                  var imgFile = new File([imgBlob], 'ai-regenerated.' + imgExt, { type: imgBlob.type });
                  aiImagePath = await uploadImageToStorage(imgFile);
                } catch (aiUploadErr) {
                  console.warn('Failed to upload AI regenerated image to Storage:', aiUploadErr);
                }
              }
              const path = data.regeneratedImagePath || aiImagePath;
              const previousImagePath = recipes[idx].imagePath || null;
              if (path) {
                recipes[idx].imagePath = path;
                recipes[idx].image = null;
              } else if (data.regeneratedImage) {
                recipes[idx].imagePath = null;
                recipes[idx].image = data.regeneratedImage;
              }

              if (path && previousImagePath && previousImagePath !== path) {
                await deleteRecipeImageFromStorage(previousImagePath);
              }

              await saveRecipeToDB(recipes[idx]);
              filterRecipes();
              showRecipe(idx);
            }
          } else if (recipeIds.length > 0) {
            var filtered = recipes.filter(function(r) { return r.id && recipeIds.indexOf(r.id) !== -1; });
            displayRecipes(filtered);
          } else if (data && data.suggestedRecipe) {
            // suggestedRecipe is already attached to the assistant message above
            // Re-render to show the inline recipe card with action buttons
            setPendingSuggestedRecipe(data.suggestedRecipe);
            renderAiChatMessages();
          }
        })
        .catch(function(err) {
          if (err && err.name === 'AbortError') return;
          var loadEl = document.getElementById('aiChatLoading');
          if (loadEl) loadEl.remove();
          if (sendBtn) sendBtn.disabled = false;
          aiChatMessages.push({ role: 'assistant', content: 'לא ניתן להתחבר ל-AI. נא לבדוק חיבור וכו\'.', timestamp: new Date() });
          renderAiChatMessages();
        });
    }

    // --- הקלטה קולית: Web Speech (עברית, מדויק) → Gemini fallback ---
