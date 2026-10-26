-- Paylaşılan bina önbelleği: ~550 m'lik ızgara hücresi (i = floor(lat/0.005), j = floor(lon/0.005)) başına
-- Overpass'tan gelen OSM öğeleri. Yük JSONB: biçim değişse de şema değişmez. 90 günden eskiler silinir.
create table cells (
  i integer not null,
  j integer not null,
  fetched_at timestamptz not null default now(),
  data jsonb not null,
  primary key (i, j)
);
create index cells_fetched_at on cells (fetched_at);
