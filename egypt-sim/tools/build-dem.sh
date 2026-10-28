#!/usr/bin/env bash
# USGS → simulation DEM pipeline (alternative to the Terrarium fetch in bake-gis.mjs).
#
# Requires GDAL ≥ 3.4 and a free USGS EarthExplorer (or NASA Earthdata) account.
#
#  1. Download "SRTM 1 Arc-Second Global" (30 m) tiles covering N21–N32 / E024–E037:
#       https://earthexplorer.usgs.gov → Data Sets → Digital Elevation → SRTM
#     (Earthdata equivalent: SRTMGL1.003). Put the *.hgt / *.tif files in ./srtm/.
#  2. For sea floor, download ETOPO 2022 (NOAA, 15 arc-second) or GEBCO and save the
#     clipped GeoTIFF as ./bathy.tif. Without it, sea cells fall back to -50 m.
#  3. Run:  ./tools/build-dem.sh   (from the egypt-sim directory)
#
# Outputs .cache/dem.raw (Int16 LE, north row first, 1361×1081 @ 0.01°, pixel-is-point
# grid aligned with bake-gis.mjs) and re-runs the bake with it. The same merged GeoTIFF
# can also feed a high-resolution tile pyramid for the live streaming path:
#     rio rgbify -b -10000 -i 0.1 --max-z 14 --min-z 8 .cache/dem_merged.tif egypt-dem.mbtiles
# then serve it and point LIVE_SOURCES.dem at it with encoding "mapbox" (src/config.ts).
set -euo pipefail

OUT=.cache
mkdir -p "$OUT"
# Pixel centres on the 0.01° lattice: extend the extent by half a pixel on each side.
TE="23.995 21.395 37.605 32.205"

gdalbuildvrt -overwrite "$OUT/srtm.vrt" srtm/*
# Area-average down to ~1.1 km so the coarse grid is a proper low-pass of the 30 m data.
gdalwarp -overwrite -t_srs EPSG:4326 -te $TE -tr 0.01 0.01 -r average \
  -srcnodata -32768 -dstnodata -32768 -ot Int16 "$OUT/srtm.vrt" "$OUT/srtm_0p01.tif"

if [[ -f bathy.tif ]]; then
  gdalwarp -overwrite -t_srs EPSG:4326 -te $TE -tr 0.01 0.01 -r average -ot Int16 bathy.tif "$OUT/bathy_0p01.tif"
  gdal_calc.py --overwrite -A "$OUT/srtm_0p01.tif" -B "$OUT/bathy_0p01.tif" --type=Int16 \
    --calc="where(A==-32768, minimum(B, -1), A)" --outfile "$OUT/dem_merged.tif"
else
  gdal_calc.py --overwrite -A "$OUT/srtm_0p01.tif" --type=Int16 \
    --calc="where(A==-32768, -50, A)" --outfile "$OUT/dem_merged.tif"
fi

gdal_translate -of ENVI -ot Int16 "$OUT/dem_merged.tif" "$OUT/dem.raw"
node tools/bake-gis.mjs --dem-raw "$OUT/dem.raw" "$@"
