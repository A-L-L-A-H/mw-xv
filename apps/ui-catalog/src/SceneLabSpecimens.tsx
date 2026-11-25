import { useMemo } from 'react';
import signalSpecimenArt from '@moonwitness/assets/illustrations/editorial-signal.webp?url';
import archiveSpecimenArt from '@moonwitness/assets/illustrations/editorial-archive.webp?url';

export function SceneLabSpecimens() {
  return (
    <section
      className="scene-lab-selected-scenes"
      aria-label="Signals and Archive catalog specimens"
      data-testid="signals-archive-specimens"
    >
      <header>
        <span>ROUTE GAP · CATALOG ONLY</span>
        <h3>Signals & Archive scene directions</h3>
        <p>
          Visual concepts for future routes. These specimens contain no production records,
          metrics, or live data.
        </p>
      </header>
      <div className="scene-lab-selected-scenes-grid">
        <article data-testid="signals-scene-specimen">
          <img src={signalSpecimenArt} alt="Abstract editorial signal artwork" loading="lazy" />
          <div>
            <span>01 / SIGNALS</span>
            <h4>Signal in the city</h4>
            <p>Editorial atmosphere only · no route or live signal feed</p>
          </div>
        </article>
        <article data-testid="archive-scene-specimen">
          <img src={archiveSpecimenArt} alt="Abstract editorial archive artwork" loading="lazy" />
          <div>
            <span>02 / ARCHIVE</span>
            <h4>Quiet stacks</h4>
            <p>Editorial atmosphere only · no route or archive records</p>
          </div>
        </article>
      </div>
    </section>
  );
}
