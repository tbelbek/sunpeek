-- Günlük kullanım sayaçları: yalnız (gün, olay, kaynak etiketi) başına toplam. IP, cihaz, oturum ya da konum tutulmaz.
create table stats (
  day date not null default current_date,
  event text not null,          -- visit, demo, result, share, solar
  ref text not null default '', -- bağlantıdaki ?ref= (ör. reddit-gbg), yoksa boş
  n integer not null default 0,
  primary key (day, event, ref)
);
