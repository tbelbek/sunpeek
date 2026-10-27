-- GlobalBuildingAtlas (GBA.LoD1, CC BY-NC 4.0) bina yükseklikleri: yalnız OSM'de height/building:levels etiketi olmayan,
-- içe aktarılmış alanlardaki binalar için. OSM verisine (osm_cells, ODbL) karıştırılmaz; API yanıtı oluşturulurken eklenir.
-- id = OSM yol kimliği (GBA anahtarı "osm<id><ülke>"). h = metre, v = modelin varyansı (m²).
create table gba (id bigint primary key, h real not null, v real not null);
