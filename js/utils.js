// Pure, dependency-free helpers shared across the app.
// Extracted from main.js (no shared app state, no cross-module calls).

const CHEF_ASSET_MAP = {
    'chef-typing.png': 'chef-serving.png',
    'chef-serving.png': 'chef-serving.png',
    'chef-cooking.png': 'chef-serving.png',
    'chef-main.png': 'chef-serving.png'
};

// Base URL for static assets (works with Vite base path, e.g. GitHub Pages)
export function chefImageUrl(filename) {
    const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL)
        ? import.meta.env.BASE_URL.replace(/\/$/, '')
        : '';
    const mapped = CHEF_ASSET_MAP[filename] || filename;
    return base + '/' + (mapped.startsWith('/') ? mapped.slice(1) : mapped);
}

export function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function getYoutubeEmbed(videoUrl) {
    if (!videoUrl) return '';
    var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    var match = videoUrl.match(regExp);
    if (match && match[7].length === 11) {
        return 'https://www.youtube.com/embed/' + match[7];
    }
    return '';
}

export function compactRecipes(list) {
    return (list || []).map(function(r) {
        return {
            id: r.id,
            name: r.name || '',
            category: r.category || 'שונות',
            ingredients: (r.ingredients || '').slice(0, 250),
            instructions: (r.instructions || '').slice(0, 250),
            rating: r.rating ?? 0
        };
    });
}

export function formatMessageTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

export function formatRelativeDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'עכשיו';
    if (diffMins < 60) return 'לפני ' + diffMins + ' דקות';
    if (diffHours < 24) return 'לפני ' + diffHours + ' שעות';
    if (diffDays < 7) return 'לפני ' + diffDays + ' ימים';
    return date.toLocaleDateString('he-IL');
}

export function blobToBase64(blob) {
    return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onloadend = function() {
            var dataUrl = typeof reader.result === 'string' ? reader.result : '';
            var comma = dataUrl.indexOf(',');
            resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export function formatTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
