-- Kullanıcıların bildirdiği kat sayısı (zemin kat dahil), yalnız OSM'de height/building:levels etiketi olmayan binalar için.
-- who: IP adresinden günlük değişen gizli tuzla üretilmiş kısa özet; aynı kişinin aynı gün tekrar oyu tek sayılır, kişiye ya da
-- günler arasında bağlanamaz. Ham IP saklanmaz. En az iki farklı bildiren ±1 kat içinde uyuşunca yanıtlara eklenir (sp:levels).
create table floor_reports (
  id bigint not null,          -- OSM yol/ilişki kimliği
  who text not null,
  floors smallint not null check (floors between 1 and 80),
  at timestamptz not null default now(),
  primary key (id, who)
);
create index floor_reports_at on floor_reports (at);
