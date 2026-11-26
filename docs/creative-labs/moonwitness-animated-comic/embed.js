(() => {
  'use strict';

  /**
   * Drop-in Web Component for embedding MoonWitness Animated Comic Lab in any app:
   *   <script src="/docs/creative-labs/moonwitness-animated-comic/embed.js" defer></script>
   *   <moonwitness-comic-player
   *     src="/docs/creative-labs/moonwitness-animated-comic/index.html"
   *     episode="EP-LAB-01"
   *     mode="stage"
   *     theme="riot"
   *     height="760px"
   *   ></moonwitness-comic-player>
   */
  class MoonWitnessComicPlayer extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const baseSrc = this.getAttribute('src') || './index.html';
      const episode = this.getAttribute('episode') || 'EP-LAB-01';
      const mode = this.getAttribute('mode') || 'stage';
      const theme = this.getAttribute('theme') || 'riot';
      const reduced = this.getAttribute('reduced-motion') === 'true' ? '1' : '0';
      const title = this.getAttribute('title') || `MoonWitness Animated Comic — ${episode}`;
      const height = this.getAttribute('height') || '760px';

      const sep = baseSrc.includes('?') ? '&' : '?';
      const fullSrc = `${baseSrc}${sep}episode=${encodeURIComponent(episode)}&mode=${encodeURIComponent(mode)}&theme=${encodeURIComponent(theme)}&reduced=${reduced}`;

      const shadow = this.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host {
            display: block;
            width: 100%;
            border: 3px solid #0d0d0d;
            box-shadow: 6px 6px 0 0 #ff2e88;
            background: #08090e;
            overflow: hidden;
          }
          iframe {
            display: block;
            width: 100%;
            height: ${height};
            border: 0;
            background: #08090e;
          }
        </style>
        <iframe src="${fullSrc}" title="${title}" loading="lazy" allow="fullscreen"></iframe>
      `;

      const expectedOrigin = new URL(fullSrc, window.location.href).origin;
      window.addEventListener('message', (evt) => {
        if (evt.origin !== expectedOrigin) return;
        if (evt.data && evt.data.source === 'mw-comic-lab') {
          this.dispatchEvent(new CustomEvent(evt.data.type, { detail: evt.data.payload }));
        }
      });
    }
  }

  if (!customElements.get('moonwitness-comic-player')) {
    customElements.define('moonwitness-comic-player', MoonWitnessComicPlayer);
  }
})();
