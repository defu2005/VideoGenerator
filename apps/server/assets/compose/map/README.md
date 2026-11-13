# Map data

Natural Earth vector **v5.1.2**, public domain.

- Countries: [`ne_110m_admin_0_countries.geojson`](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_admin_0_countries.geojson)
- Vietnam provinces: [`ne_10m_admin_1_states_provinces.geojson`](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson)

The 110m and 50m admin-1 files contain no Vietnam provinces, so `vn.json` is the 10m file filtered to ISO codes `VN-*`, without the macro-regions `VN-39`, `VN-53` and `VN-66`.

Downloaded once and simplified by hand: Douglas–Peucker tolerance 0.12°, coordinates rounded to 2 decimal places, rings smaller than 0.4% of the largest part dropped. Tests read these files and do not download anything.

`label` is a point near the visual centre of the largest part (the middle 60% of that part's box, inset from the border). Natural Earth's own `LABEL_Y` for Vietnam sits near 21.7°N, the northern tip, so it is not used.

`world.json` is admin-0 (`level` 0). `vn.json` is admin-1 (`level` 1, `parent` `VN`). `sample.json` is the Southeast Asia extract used by the template samples, plus Ho Chi Minh City (`VN-SG`).
