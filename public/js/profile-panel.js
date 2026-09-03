/* User Profile Panel: Handles slide-over side drawer for user profile viewing and reporting. */
(function(){
  const profilePanel      = document.getElementById('profilePanel');
  const profileOverlay    = document.getElementById('profileOverlay');
  const profilePanelClose = document.getElementById('profilePanelClose');
  const profileAvatarImg  = document.getElementById('profileAvatarImg');
  const profileTagEl      = document.getElementById('profileTag');
  const profileNameEl     = document.getElementById('profileName');
  const profileJoinDateEl = document.getElementById('profileJoinDate');
  const profileIdValEl    = document.getElementById('profileIdVal');
  const profileSocialEmpty= document.getElementById('profileSocialEmpty');
  const profileSocialLinks= document.getElementById('profileSocialLinks');
  const profileReportBtn  = document.getElementById('profileReportBtn');

  let activeProfileUser = null;

  function formatJoinDate(value){
    if(!value) return 'ไม่พบข้อมูลวันเข้าร่วม';
    const date = new Date(value);
    if(Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  function normalizedExternalUrl(value){
    const raw = typeof value === 'string' ? value.trim() : '';
    if(!raw) return '';

    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(candidate);
      if(url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.href;
    } catch (error) {
      return '';
    }
  }

  function socialMediaFor(userData){
    const socialMedia = userData.social_media || {};
    return {
      facebook: normalizedExternalUrl(socialMedia.facebook || userData.facebook),
      instagram: normalizedExternalUrl(socialMedia.instagram || userData.instagram)
    };
  }

  function renderSocialMedia(userData){
    if(!profileSocialLinks || !profileSocialEmpty) return;

    const socialMedia = socialMediaFor(userData);
    const items = [
      {
        key: 'facebook',
        label: 'Facebook',
        icon: 'assets/symbols/facebook.png',
        url: socialMedia.facebook
      },
      {
        key: 'instagram',
        label: 'Instagram',
        icon: 'assets/symbols/instagram.svg',
        url: socialMedia.instagram
      }
    ].filter(item => item.url);

    profileSocialLinks.innerHTML = '';
    items.forEach(item => {
      const link = document.createElement('a');
      link.className = `profile-social-link ${item.key}`;
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      const icon = document.createElement('img');
      icon.src = item.icon;
      icon.alt = '';

      const label = document.createElement('span');
      label.textContent = item.label;

      link.append(icon, label);
      profileSocialLinks.appendChild(link);
    });

    profileSocialEmpty.hidden = Boolean(items.length);
  }

  function openProfileDrawer(userData){
    if(!userData) return;
    activeProfileUser = userData;

    const nick = userData.nick || userData.name || userData.user_nick || 'ไม่ระบุชื่อ';
    const tag = userData.tag || userData.user_tag || '';
    const avatar = userData.avatar || userData.user_profile_url || 'assets/sim_db/users_profile_image/annonymous.png';
    const joinDate = formatJoinDate(userData.created_at || userData.joinDate);
    const profileId = userData.profileId || userData.user_id || 'USR-00000';

    if(profileAvatarImg){
      profileAvatarImg.src = avatar;
      profileAvatarImg.alt = nick;
    }
    if(profileTagEl) profileTagEl.textContent = tag;
    if(profileNameEl) profileNameEl.textContent = nick;
    if(profileJoinDateEl) profileJoinDateEl.textContent = joinDate;
    if(profileIdValEl) profileIdValEl.textContent = profileId;
    renderSocialMedia(userData);

    if(profilePanel) profilePanel.classList.add('open');
    if(profileOverlay) profileOverlay.classList.add('open');
    if(profilePanel) profilePanel.setAttribute('aria-hidden', 'false');
  }

  function closeProfileDrawer(){
    if(document.activeElement && profilePanel && profilePanel.contains(document.activeElement)){
      document.activeElement.blur();
    }
    if(profilePanel) profilePanel.classList.remove('open');
    if(profileOverlay) profileOverlay.classList.remove('open');
    if(profilePanel) profilePanel.setAttribute('aria-hidden', 'true');
    activeProfileUser = null;
  }

  // Report Action
  profileReportBtn?.addEventListener('click', () => {
    if(!activeProfileUser) return;
    const nick = activeProfileUser.nick || activeProfileUser.name || activeProfileUser.user_nick || '';
    const tag = activeProfileUser.tag || activeProfileUser.user_tag || '';
    closeProfileDrawer();

    if(typeof window.openReportModal === 'function'){
      window.openReportModal(tag, nick);
    } else {
      const reportOverlay = document.getElementById('reportOverlay');
      const reportTargetName = document.getElementById('reportTargetName');
      if(reportTargetName) reportTargetName.textContent = `${tag} ${nick}`.trim();
      if(reportOverlay) reportOverlay.classList.add('open');
    }
  });

  profilePanelClose?.addEventListener('click', closeProfileDrawer);
  profileOverlay?.addEventListener('click', closeProfileDrawer);

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && profilePanel && profilePanel.classList.contains('open')){
      closeProfileDrawer();
    }
  });

  window.openProfileDrawer = openProfileDrawer;
  window.closeProfileDrawer = closeProfileDrawer;
})();
