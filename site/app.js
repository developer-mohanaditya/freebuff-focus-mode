/**
 * Install page behaviour.
 *
 * Progressive enhancement only - the page is fully readable with JS disabled,
 * which is why the reveal styles are gated behind the `js` class set here.
 */

document.documentElement.classList.add('js');

/* ------------------------------------------------------------ reveal on scroll */

const revealables = document.querySelectorAll('.reveal');

if ('IntersectionObserver' in window && revealables.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
  );

  revealables.forEach((el, index) => {
    el.style.transitionDelay = `${Math.min(index % 3, 2) * 70}ms`;
    observer.observe(el);
  });
} else {
  revealables.forEach((el) => el.classList.add('in'));
}

/* ----------------------------------------------------------------- copy path */

const copyButton = document.querySelector('[data-copy]');

if (copyButton) {
  copyButton.addEventListener('click', async () => {
    const code = copyButton.parentElement.querySelector('code');
    const value = code ? code.textContent.trim() : '';
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API unavailable (non-secure context) - fall back to selection.
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    const original = copyButton.textContent;
    copyButton.textContent = 'Copied';
    copyButton.dataset.state = 'done';

    setTimeout(() => {
      copyButton.textContent = original;
      delete copyButton.dataset.state;
    }, 1600);
  });
}

/* --------------------------------------------------------------- live version */

/**
 * The build stamps version.json into dist/. If it is present, reconcile the
 * rendered version in case the page was served from a stale cache; if not,
 * leave the statically stamped value alone.
 */
async function reconcileVersion() {
  try {
    const response = await fetch('version.json', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    if (!data || !data.version) return;

    document.querySelectorAll('[data-version]').forEach((el) => {
      el.textContent = data.version;
    });

    const download = document.querySelector('a[download]');
    if (download && data.zip) download.setAttribute('href', data.zip);
  } catch {
    // Static values are already correct - nothing to do.
  }
}

reconcileVersion();
