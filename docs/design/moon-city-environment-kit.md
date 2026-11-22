# Moon City Environment Kit

Canonical visual environment vocabulary for MoonWitness XV scenes across homepage, editorial, and addon surfaces.

## Lighting & Palette

- Sky zenith `#090d1c` -> mid `#111a31` -> horizon `#20344d`
- Lunar highlight `#f3efe4`, atmospheric mist `#aabbd0`
- Diegetic signal accents: yellow `#ffe031`, cyan `#39e6ff`, magenta `#ff3b9a`
- Foreground ink `#0d0f17` with hard rim strokes for anime-zine depth separation

## Depth Layers (2048x1152 reference canvas)

1. `z=0` Sky (`source/artwork/moon-city-sky-layer.svg`) — static deep-navy starfield.
2. `z=10` Moon (`source/artwork/moon-city-moon-disc-layer.svg`) — transparent alpha crescent disc, focal point `(0.72, 0.24)`.
3. `z=20` Far clouds (`source/artwork/moon-city-clouds-loop-b.svg`) — seamless horizontal loop, subtle opacity (`0.28`).
4. `z=30` Distant skyline (`source/world/environments/moon-city-skyline-far.svg`) — distant towers and beacons.
5. `z=40` Near clouds (`source/artwork/moon-city-clouds-loop-a.svg`) — primary atmospheric drift band.
6. `z=50` Midground city (`source/world/environments/moon-city-skyline-mid.svg`) — stepped rooftops, window lights, horizon depth.
7. `z=60` Character plane — reserved for canonical character sprites/rigs (`crew-01`).
8. `z=70..90` Foreground rooftop & props (`moon-city-foreground-layer.svg`, `moon-city-prop-railing.svg`, `moon-city-prop-wires.svg`, `moon-city-prop-sign.svg`) — perimeter framing keeping text-safe zones unobstructed.

## Alternate Reusable Environments

- `env-underground.svg` — tunnel/vault infrastructure backdrop
- `env-archive.svg` — clerestory archival stacks backdrop
- `env-rooftop.svg` — elevated observatory deck backdrop
- `env-street.svg` — rain-lit night street corridor backdrop

No environment asset embeds interface copy, counts, routes, or business telemetry.
