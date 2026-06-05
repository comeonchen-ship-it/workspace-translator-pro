document.addEventListener('DOMContentLoaded', () => {
  // Populate version badge from manifest
  const versionEl = document.getElementById('onboarding-version');
  if (versionEl && chrome && chrome.runtime) {
    const { version } = chrome.runtime.getManifest();
    versionEl.textContent = `v${version}`;
  }

  // Step elements
  const navItems = document.querySelectorAll('.nav-item');
  const steps = document.querySelectorAll('.step-content');
  
  // Navigation tabs
  function goToStep(stepNum) {
    // Update sidebar nav items
    navItems.forEach(item => {
      if (parseInt(item.getAttribute('data-step')) === stepNum) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update step visibility
    steps.forEach(step => {
      const stepId = `step-${stepNum}`;
      if (step.id === stepId) {
        step.classList.add('active');
      } else {
        step.classList.remove('active');
      }
    });
  }

  // Sidebar item click listeners
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const stepNum = parseInt(item.getAttribute('data-step'));
      goToStep(stepNum);
    });
  });

  // Next step button listeners
  document.querySelectorAll('.btn-next').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextStep = parseInt(btn.getAttribute('data-next'));
      goToStep(nextStep);
    });
  });

  // Prev step button listeners
  document.querySelectorAll('.btn-prev').forEach(btn => {
    btn.addEventListener('click', () => {
      const prevStep = parseInt(btn.getAttribute('data-prev'));
      goToStep(prevStep);
    });
  });

  // Close guide button
  const btnDone = document.getElementById('btn-done');
  if (btnDone) {
    btnDone.addEventListener('click', () => {
      window.close();
    });
  }

  // Fetch extension redirect URI
  const redirectUriEl = document.getElementById('redirect-uri');
  const btnCopyUri = document.getElementById('btn-copy-uri');
  
  if (redirectUriEl && btnCopyUri) {
    if (chrome && chrome.identity && typeof chrome.identity.getRedirectURL === 'function') {
      try {
        const redirectUri = chrome.identity.getRedirectURL();
        redirectUriEl.textContent = redirectUri;
        
        btnCopyUri.addEventListener('click', () => {
          navigator.clipboard.writeText(redirectUri).then(() => {
            btnCopyUri.textContent = 'Copied!';
            btnCopyUri.classList.add('btn-primary');
            btnCopyUri.classList.remove('btn-secondary');
            setTimeout(() => {
              btnCopyUri.textContent = 'Copy URI';
              btnCopyUri.classList.remove('btn-primary');
              btnCopyUri.classList.add('btn-secondary');
            }, 2000);
          }).catch(err => {
            console.error('Failed to copy text: ', err);
          });
        });
      } catch (e) {
        console.error(e);
        redirectUriEl.textContent = 'Error: Cannot retrieve redirect URI.';
      }
    } else {
      // Fallback if running outside of extension context for testing
      const extensionId = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) || 'extension-id';
      const fallbackUri = `https://${extensionId}.chromiumapp.org/`;
      redirectUriEl.textContent = fallbackUri;
      btnCopyUri.addEventListener('click', () => {
        navigator.clipboard.writeText(fallbackUri).then(() => {
          btnCopyUri.textContent = 'Copied!';
        });
      });
    }
  }
});
