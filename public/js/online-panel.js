/* Opens and closes the online members side panel. */

/* ---------- ONLINE MEMBERS SLIDE PANEL ---------- */
const onlinePanel     = document.getElementById('onlinePanel');
const onlineOverlay   = document.getElementById('onlineOverlay');
const onlinePanelClose= document.getElementById('onlinePanelClose');

function openOnlinePanel(){
  onlinePanel.classList.add('open');
  onlineOverlay.classList.add('open');
  onlinePanel.setAttribute('aria-hidden', 'false');
  const searchInput = onlinePanel.querySelector('.online-panel-search input');
  if(searchInput){
    window.setTimeout(() => searchInput.focus(), 150);
  }
}
function closeOnlinePanel(){
  onlinePanel.classList.remove('open');
  onlineOverlay.classList.remove('open');
  onlinePanel.setAttribute('aria-hidden', 'true');
}

document.querySelectorAll('.online-toggle-btn').forEach(btn => {
  btn.addEventListener('click', openOnlinePanel);
});
onlinePanelClose.addEventListener('click', closeOnlinePanel);
onlineOverlay.addEventListener('click', closeOnlinePanel);
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape'){
    closeOnlinePanel();
  }
});
