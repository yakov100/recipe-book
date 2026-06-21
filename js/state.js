// Shared, mutable application state.
//
// These are exported as live `let` bindings so any module can READ the current
// value with a plain import (the binding reflects later updates). To REASSIGN a
// value, call the matching setX() function — ES module imports are read-only,
// so reassignment must go through the owning module. In-place mutation of the
// arrays/objects (push, splice, sort, setting a property) is fine without a
// setter, since the binding still points at the same object.

export let recipes = [];
export function setRecipes(v) { recipes = v; }

export let editingIndex = -1;
export function setEditingIndex(v) { editingIndex = v; }

export let formSelectedRating = 0;
export function setFormSelectedRating(v) { formSelectedRating = v; }

export let formSelectedDifficulty = 2; // 1=קל, 2=בינוני, 3=קשה
export function setFormSelectedDifficulty(v) { formSelectedDifficulty = v; }

export let selectedCategory = null;
export function setSelectedCategory(v) { selectedCategory = v; }

export let backupReminderTimeout;
export function setBackupReminderTimeout(v) { backupReminderTimeout = v; }

export let aiChatMessages = [];
export function setAiChatMessages(v) { aiChatMessages = v; }

export let aiChatAbortController = null;
export function setAiChatAbortController(v) { aiChatAbortController = v; }

export let aiGeneratedImage = null; // Stores AI-generated image for suggested recipes
export function setAiGeneratedImage(v) { aiGeneratedImage = v; }

export let formRegeneratedImage = null; // { imagePath } or { image } - from "צור תמונה חדשה" in add/edit form
export function setFormRegeneratedImage(v) { formRegeneratedImage = v; }

export let currentConversationId = null;
export function setCurrentConversationId(v) { currentConversationId = v; }

export let conversationHistory = [];
export function setConversationHistory(v) { conversationHistory = v; }

export let chatAttachments = [];
export function setChatAttachments(v) { chatAttachments = v; }

export let chatClosedAt = null;
export function setChatClosedAt(v) { chatClosedAt = v; }

export let pendingSuggestedRecipe = null; // Stores recipe waiting for user confirmation
export function setPendingSuggestedRecipe(v) { pendingSuggestedRecipe = v; }

export let isSharedRecipeMode = false; // Track if loaded via shared link
export function setIsSharedRecipeMode(v) { isSharedRecipeMode = v; }

// Constant (no setter needed)
export const CHAT_RESUME_THRESHOLD_MS = 10 * 60 * 1000;
