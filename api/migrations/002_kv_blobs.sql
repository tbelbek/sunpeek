-- Bina dışı paylaşılan önbellek: JSON yanıtlar (Overture karosu, ışınım arşivi, adres arama/çözme) ve ikili karolar (arazi PNG).
-- Anahtar kaynağı ve sürümü içerir (ör. "ovt:2026-10-21.0:14/8740/5121"); tazelik okurken TTL ile, temizlik günlük.
create table kv (
  key text primary key,
  fetched_at timestamptz not null default now(),
  value jsonb not null
);
create index kv_fetched_at on kv (fetched_at);

create table blobs (
  key text primary key,
  fetched_at timestamptz not null default now(),
  content_type text not null,
  body bytea not null
);
create index blobs_fetched_at on blobs (fetched_at);
