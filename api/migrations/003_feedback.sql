-- Sahada doğrulama: kullanıcı evin önündeyken "şu an bu duvarda güneş var mı?" cevabı ve modelin o anki tahmini.
-- Kişisel veri yok: IP, hesap, cihaz kimliği tutulmaz; konum ~10 m'ye yuvarlanır. 2 yıl sonra silinir (purge).
create table feedback (
  id bigserial primary key,
  at timestamptz not null default now(),
  lat double precision not null,
  lon double precision not null,
  az smallint not null,          -- duvarın baktığı yön
  floor smallint not null,
  answer text not null check (answer in ('sun', 'shade')),
  predicted text not null check (predicted in ('vis', 'block', 'terrain', 'behind', 'unknown')),
  conf smallint,                 -- birleşik güven 0-2 (lo/mid/hi)
  src text check (src in ('osm', 'overture')),
  sun_alt real, sun_az real
);
create index feedback_at on feedback (at);
