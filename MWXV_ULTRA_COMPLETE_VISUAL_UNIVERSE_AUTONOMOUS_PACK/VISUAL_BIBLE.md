# MoonWitness XV — Visual World Bible

## Core identity

MoonWitness is an original punk/grunge manga-inspired universe: rough editorial collage, photocopy and ink texture, hand-drawn marks, urban anime environments, expressive typography, and a deliberate palette of ink black, paper white, hot magenta, electric blue/cyan and signal yellow. The supplied MoonWitness collage reference defines composition energy and material language; it is not a template to copy pixel-for-pixel.

Preserve canonical MoonWitness wordmark, crown, symbols, existing theme system and approved brand assets. Do not redesign the brand as an unrelated generic anime/game brand.

## World rendering language

- Manga/anime line language: consistent outline hierarchy, intentional line weight, readable silhouettes.
- Cel shading: coherent light direction, limited shadow bands, controlled highlights.
- Urban night: moonlit sky, layered city, rooftop, cables, signage, rain, reflections and atmospheric haze.
- Grunge: xerox grain, torn paper, scratches, tape and halftone in controlled layers—not noise over every pixel.
- Composition: asymmetry, editorial panels, strong negative space, focal points, crop-safe areas and visual rhythm.
- Typography: existing self-hosted font/token system. Use brush/display fonts for short expressive headings only; body/control copy stays readable live text.
- Character silhouettes: consistent proportions, outfits, recurring props and visual continuity.

## Character continuity

Each recurring character needs:
- Stable ID and approved identity sheet.
- Front/side/back turnaround or approved silhouette sheet.
- Height/proportion reference.
- Palette, outline and shading notes.
- Outfit, accessories and props.
- Facial/expression sheet only where appropriate.
- Pose/gesture library.
- Layer separation and rig/pivot metadata when animated.
- Approved idle/action clips and static fallback.
- Scene appearance log and provenance.

Do not use uncontrolled image generation that changes the character between scenes. A reference board and consistency review are mandatory. Anonymous/back-facing/hooded crew silhouettes are a valid default. Identifiable character faces are an approved design choice, not an accidental by-product.

## Environment continuity

Each environment has:
- Environment ID, mood, palette, lighting, perspective and camera language.
- Background/midground/foreground planes.
- Props and reusable modules.
- Time/weather variants only when explicitly designed.
- Focal point and safe content zones.
- Layer order, depth, pivot and parallax response.
- Static/reduced-motion composite.

## Motion grammar

| Motion class | Use | Rule |
|---|---|---|
| UI micro | Hover, press, focus, status | Short and purposeful |
| Editorial | Panel/heading reveal | Finite, deterministic, no layout jump |
| Cinematic | Scene entrance, camera pan/zoom, panel transition | Controlled timeline; user can proceed immediately |
| Character | Idle, blink, hair, gesture, walk | Consistent cycle, bounded playback, pause when offscreen |
| Ambient | Clouds, rain, distant light, particles | Subtle, opt-in intensity, low-power and static modes |
| Impact | Flash, shake, burst, slash | Brief, rare, never obscures controls/content |

## Animation craft rules

- Every clip has duration/timing, loop mode, playback rate, pivot/origin, state trigger and fallback.
- Loopable clips must not visibly pop at the seam.
- Camera transforms use bounded ranges and avoid motion sickness.
- Scroll motion never hijacks native scrolling or hides essential content.
- Scene content must be visible even if animation fails or is disabled.
- `prefers-reduced-motion` is respected in CSS and JavaScript.
- Do not animate every layer simultaneously; assign priorities and stagger only where useful.
- Pause offscreen and release resources on unmount/navigation.

## Experience hierarchy

- Living World: richest cinematic experience on Home and selected storytelling pages.
- Editorial World: layered manga/zine panels with modest transitions.
- Operational World: restrained visual identity, no animated tables/forms or distracting data panels.
- Infrastructure: no visual dependency.

## Explicit exclusions

- No third-party anime character/franchise imitation, logos, signature props or copied compositions.
- No embedded UI text, fake buttons, false statistics, fake maps or invented production data in artwork.
- No unlicensed sound/music.
- No visual depiction of Allah or sacred figures.
- No blanket animated wallpaper, heavy filters on every component, endless parallax or forced autoplay audio.
