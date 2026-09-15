/* Wonderland atmosphere: decorative only, so the check-in and voting app
   remains usable if this enhancement is unavailable or motion is disabled. */
(function () {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const suits = ['♥', '♠', '♦', '♣', '♥', '♦'];

  function init() {
    const layer = document.createElement('div');
    layer.className = 'wonderland-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = suits.map((suit) => `<span class="wonderland-card">${suit}</span>`).join('');
    const clock = document.createElement('span');
    clock.className = 'wonderland-clock';
    clock.setAttribute('aria-hidden', 'true');
    layer.append(clock);
    document.body.append(layer);

    if (!reduced && window.matchMedia?.('(pointer: fine)').matches) {
      window.addEventListener('pointermove', (event) => {
        const x = (event.clientX / window.innerWidth - .5) * 2;
        const y = (event.clientY / window.innerHeight - .5) * 2;
        layer.style.setProperty('--wonder-x', `${x * 5}px`);
        layer.style.setProperty('--wonder-y', `${y * 5}px`);
        clock.style.transform = `translate(${x * -5}px, ${y * -5}px) rotate(-14deg)`;
      }, { passive: true });
    }

    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('.btn, .icon-btn');
      if (!button || reduced || button.disabled) return;
      const rect = button.getBoundingClientRect();
      const burst = document.createElement('span');
      burst.className = 'wonderland-burst';
      burst.textContent = suits[Math.floor(Math.random() * suits.length)];
      burst.style.left = `${rect.left + rect.width * (.35 + Math.random() * .3)}px`;
      burst.style.top = `${rect.top + rect.height * .35}px`;
      burst.style.setProperty('--burst-x', `${Math.round((Math.random() - .5) * 80)}px`);
      burst.style.setProperty('--burst-y', `${Math.round(-35 - Math.random() * 50)}px`);
      document.body.append(burst);
      burst.addEventListener('animationend', () => burst.remove(), { once: true });
    });

    const digits = document.getElementById('clock-digits');
    if (digits) {
      const observer = new MutationObserver(() => {
        if (reduced) return;
        digits.querySelectorAll('.clock__n').forEach((node) => {
          node.classList.remove('is-ticking');
          void node.offsetWidth;
          node.classList.add('is-ticking');
        });
      });
      observer.observe(digits, { childList: true, subtree: true, characterData: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
