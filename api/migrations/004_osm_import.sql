-- Şehirlerin toplu içe aktarılmış OSM binaları (import.mjs): bu alanlarda Overpass'a hiç gidilmez, ilk ziyaret beklemez.
-- osm_cover: içe aktarılan alanların sınırları (BBBike .poly / şehir kutusu); içinde olup osm_cells'te olmayan hücre = binasız.
-- import.mjs tabloyu yeni adla kurup tek işlemde değiştirir; purge bu tablolara dokunmaz (tazeleme = yeniden içe aktarma).
create table osm_cells (i int not null, j int not null, data jsonb not null, primary key (i, j));
create table osm_cover (name text primary key, ring jsonb not null, imported_at timestamptz not null default now());
