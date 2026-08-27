window.APP_VERSION = '3.3.5';

function renderAppVersionBadges() {
  document.querySelectorAll('.version-badge').forEach(el => {
    el.textContent = `v${window.APP_VERSION}`;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderAppVersionBadges);
} else {
  renderAppVersionBadges();
}
