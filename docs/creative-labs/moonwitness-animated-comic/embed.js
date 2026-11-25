(() => {
  'use strict';

  /**
   * Drop-in Web Component for embedding MoonWitness Animated Comic Lab in any app:
   *   <script src="/docs/creative-labs/moonwitness-animated-comic/embed.js" defer></script>
   *   <moonwitness-comic-player src="/docs/creative-labs/moonwitness-animated-comic/index.html"></moonwitness-comic-player>
   */
  class MoonWitnessComicPlayer extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const src = this.getAttribute('src') || './index.html';
      const title = this.getAttribute('title') || 'MoonWitness Animated Comic Lab — EP-LAB-01';
      const height = this.getAttribute('height') || '760px';

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
        <iframe src="${src}" title="${title}" loading="lazy" allow="fullscreen"></iframe>
      `;
    }
  }

  if (!customElements.get('moonwitness-comic-player')) {
    customElements.define('moonwitness-comic-player', MoonWitnessComicPlayer);
  }
})();
