/* Handles app-shell navigation and basic chat pane interactions. */

const menuToggle = document.getElementById('menuToggle');
const overlay = document.getElementById('overlay');
menuToggle.addEventListener('click', () => document.body.classList.toggle('nav-open'));
overlay.addEventListener('click', () => document.body.classList.remove('nav-open'));

/* ---------- MOBILE APP-SHELL NAVIGATION ---------- */
// On screens <=900px only one pane (channel/DM list, chat, profile) is
// shown full-screen at a time. Above that breakpoint this attribute is
// simply ignored by the CSS, so it's always safe to set.
function setMobileView(view){
  document.body.dataset.mobileView = view;
}

if(window.innerWidth <= 900 && !document.body.dataset.mobileView){
  setMobileView('sidebar');
}

document.getElementById('openAddUniBtn').addEventListener('click', () => document.body.classList.remove('nav-open'));

document.getElementById('backToListBtn').addEventListener('click', () => setMobileView('sidebar'));
