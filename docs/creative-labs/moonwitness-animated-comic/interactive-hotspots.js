(() => {
  'use strict';

  const HOTSPOT_MAP = {
    P03: {
      x: '76%',
      y: '48%',
      label: 'Inspect Receiver',
      title: 'Sub-Band 4 Partial Carrier',
      body: 'Three clean carrier peaks separated by two dead drop-outs. Source integrity rule: capture raw gaps without inventing missing bars.',
    },
    P07: {
      x: '52%',
      y: '46%',
      label: 'Inspect Voids',
      title: 'Unrecovered Evidence Voids',
      body: 'MoonWitness II World Rule 03: Mystery, unknown, and unresolved states are valid parts of the universe and stay explicitly marked.',
    },
    P10: {
      x: '60%',
      y: '72%',
      label: 'Inspect Seal',
      title: 'Archival Kraft Folio',
      body: 'Clipped in signal yellow and taped in hot magenta with both unknown slots preserved intact for responsible night relay.',
    },
  };

  class EpistemicHotspotLayer {
    constructor(layerEl) {
      this.el = layerEl;
      this.open = false;
    }

    update(panel) {
      if (!this.el) return;
      this.el.innerHTML = '';
      this.open = false;
      const spec = panel && HOTSPOT_MAP[panel.panelId];
      if (!spec) {
        this.el.hidden = true;
        return;
      }
      this.el.hidden = false;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hotspot-pin';
      btn.style.left = spec.x;
      btn.style.top = spec.y;
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = `+ ${spec.label}`;

      const card = document.createElement('div');
      card.className = 'hotspot-card';
      card.hidden = true;
      card.innerHTML = `<strong>${spec.title}</strong><p>${spec.body}</p>`;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.open = !this.open;
        card.hidden = !this.open;
        btn.setAttribute('aria-expanded', String(this.open));
      });

      this.el.appendChild(btn);
      this.el.appendChild(card);
    }
  }

  window.EpistemicHotspotLayer = EpistemicHotspotLayer;
})();
