# Gridlock

An open-world driving game set in a 1:1 Manhattan (Battery Park to ~66th St), built in the browser with three.js from NYC open data.

**Play:** https://gridlock-nyc.vercel.app

- **25,597 real buildings** (DoITT building footprints + roof heights), with procedural facades by era: glass curtain walls, postwar office, prewar limestone, brick walk-ups. Lit windows and storefronts at night, rooftop water towers.
- **The real street grid** (DOT CSCL centerline): 4,789 segments with real widths, lane counts and **one-way directions**. Traffic obeys them and stops at signals.
- **47,365 street trees** from the 2015 Street Tree Census (in their November colours), plus parks, shoreline and seawalls.
- Day/night cycle with the real late-November sun path over NYC, PBR materials, shadows, SSAO, bloom.
- Steal any car, take taxi fares to real landmarks, get chased by NYPD (pathfinding over the street graph), lose your wanted level.

## Controls
WASD drive/walk · mouse look · F steal/exit · Space handbrake/jump · Shift sprint · click punch · H horn · M map · T skip an hour · R reset car · V camera · N mute

## Build
```
python pipeline/fetch.py      # downloads footprints + centerline into raw/
python pipeline/build.py      # bakes web/public/world/*
cd web && pnpm i && pnpm dev
```
Not affiliated with any game studio or the City of New York.
