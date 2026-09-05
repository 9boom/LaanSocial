/* Shared mock data and session state used by chat and onboarding modules. */

/* ---------- INITIALIZE THEME FROM INDEXEDDB ---------- */
(async function initializeTheme() {
  if (window.IDBStorage) {
    try {
      const savedTheme = await window.IDBStorage.getItem('themestate', 'light');
      document.body.classList.toggle('theme-dark', savedTheme === 'dark');
    } catch (err) {
      console.error('Failed to load theme from IndexedDB:', err);
      // Fallback to light theme on error
      document.body.classList.remove('theme-dark');
    }
  }
})();

/* ---------- DEFAULT NEUTRAL AVATAR SVG DATA-URI ---------- */
const DEFAULT_AVATAR_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e2e8f0'/%3E%3Cpath d='M50 48a16 16 0 1 0 0-32 16 16 0 0 0 0 32zm0 8c-18 0-34 11-38 28h76c-4-17-20-28-38-28z' fill='%2394a3b8'/%3E%3C/svg%3E";

/* ---------- DYNAMIC AVATARS UTILITY ---------- */
(function() {
  let cachedImages = [];
  let fetchPromise = null;

  async function fetchProfileImages() {
    if (cachedImages.length > 0) return cachedImages;
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
      try {
        const response = await fetch('/api/profile-images');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          cachedImages = data;
        }
      } catch (err) {
        console.warn('Unable to load profile images from API:', err);
      } finally {
        fetchPromise = null;
      }
      return cachedImages;
    })();

    return fetchPromise;
  }

  function getImages() {
    return cachedImages;
  }

  function getDefaultAvatar() {
    if (cachedImages.length > 0) {
      const anonymous = cachedImages.find(img => img.id === 'annonymous' || img.name === 'annonymous');
      if (anonymous && anonymous.src) return anonymous.src;
      return cachedImages[0].src;
    }
    return DEFAULT_AVATAR_PLACEHOLDER;
  }

  function getFallbackAvatar() {
    return getDefaultAvatar();
  }

  window.LaanAvatars = {
    DEFAULT_PLACEHOLDER: DEFAULT_AVATAR_PLACEHOLDER,
    fetchImages: fetchProfileImages,
    getImages: getImages,
    getDefaultAvatar: getDefaultAvatar,
    getFallbackAvatar: getFallbackAvatar
  };

  // Preload profile images on script initialization
  fetchProfileImages();
})();

/* ---------- PRIVATE CHAT (mockup state) ---------- */
const MY_TAG   = '[จฬ]';
const MY_NAME  = 'มะม่วงเบา';
let MY_AVATAR = window.LaanAvatars.getDefaultAvatar();
const contacts = {};
