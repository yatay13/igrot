-- ===========================================================================
--  CONTROLES DE LA ETAPA 4 · LOS VECTORES  ·  SÓLO MIDE, NO CAMBIA NADA
--
--  Versión: 2026-11-09.
--  Correr en Supabase -> SQL Editor. **No tiene modo aplicar: no escribe.**
--
--  ---------------------------------------------------------------------------
--  POR QUÉ AHORA
--
--  Era el único de los cuatro controles por etapa que faltaba:
--
--      1 · el texto (OCR)   ·  que_tan_limpio_esta_el_texto.sql
--      2 · el cortado       ·  estan_bien_cortadas_las_cartas.sql
--      3 · el enriquecido   ·  controles_del_enriquecimiento.sql
--      4 · los vectores     ·  ESTE
--
--  Pero lo urgente es otra cosa. Acabamos de cambiarle el texto a unas 5.500
--  cartas con el arreglo de la comilla. **La búsqueda por palabras se arregló
--  sola**, porque `texto_tsv` es una columna generada y se recalcula al
--  guardar la fila. **La búsqueda por significado no**: ésa no mira `texto`,
--  mira la tabla `chunks` y los vectores que se calcularon a partir de ella.
--
--  O sea que esas cartas podrían estar siendo buscadas por un texto que ya no
--  existe: el chunk todavía dice `כייק` donde la carta ya dice `כ"ק`.
--
--  ---------------------------------------------------------------------------
--  CÓMO SE MIDE «VIEJO», SIN ADIVINAR
--
--  Un chunk es un pedazo literal del texto de su carta. Así que la prueba es
--  directa y no depende de ninguna regla mía: **¿el texto del chunk sigue
--  estando adentro del texto de su carta?** Si no está, el chunk quedó viejo,
--  sea por el arreglo de la comilla o por cualquier otra cosa.
--
--  Se compara con los primeros 120 caracteres del chunk y no con el chunk
--  entero, por costo: alcanza para decidir y recorre la tabla una sola vez.
--
--  ---------------------------------------------------------------------------
--  QUÉ DEVUELVE
--
--  A · cobertura: cuántas cartas tienen vectores, por idioma
--  B · los chunks viejos, que es el bloque que importa hoy
--  C · chunks huérfanos, vectores nulos, cartas con texto y sin vector
--  D · dónde faltan, por tomo
--  E · el índice de búsqueda por significado
--  F · el veredicto, contado de la tabla de controles
-- ===========================================================================

drop table if exists control;
create temp table control (
  n int, bloque text, nombre text,
  malas bigint, de bigint, umbral bigint, nota text
);
drop table if exists ejemplos;
create temp table ejemplos (orden int, clave int, que text, cuanto text);

drop table if exists total;
create temp table total as
select (select count(*) from cartas) as cartas,
       (select count(*) from chunks) as chunks;


-- ===========================================================================
--  A · COBERTURA
-- ===========================================================================
drop table if exists cobertura;
create temp table cobertura as
select ch.idioma, count(distinct ch.carta_id) as cartas, count(*) as chunks
from chunks ch group by ch.idioma;

insert into ejemplos
select 1, 0, '=== A · vectores por idioma ===',
       (select chunks::text from total) || ' chunks en total';
insert into ejemplos
select 1, row_number() over (order by cartas desc),
       '    ' || coalesce(idioma, '(sin idioma)'),
       cartas || ' cartas · ' || chunks || ' chunks'
from cobertura order by cartas desc;

insert into control values
 (101,'A','cartas sin ningún vector',
  (select count(*) from cartas c
   where not exists (select 1 from chunks ch where ch.carta_id = c.id)),
  (select cartas from total), null,
  'informativo · son las que la búsqueda por significado no puede encontrar'),
 -- Una carta puede tener vector en español y no en hebreo, y la búsqueda
 -- principal del sitio corre sobre el hebreo: «sin ningún vector» no alcanza.
 (102,'A','cartas sin vector en HEBREO',
  (select count(*) from cartas c
   where not exists (select 1 from chunks ch
                     where ch.carta_id = c.id
                       and ch.idioma in ('he','heb','hebreo'))),
  (select cartas from total), null,
  'informativo · la búsqueda por significado corre sobre el hebreo'),
 (103,'A','cartas con texto largo y sin vector en hebreo',
  (select count(*) from cartas c
   where coalesce(c.n_palabras, 0) >= 60
     and not exists (select 1 from chunks ch
                     where ch.carta_id = c.id
                       and ch.idioma in ('he','heb','hebreo'))),
  (select count(*) from cartas where coalesce(n_palabras,0) >= 60), 0,
  'una carta larga sin vector hebreo es un agujero en la búsqueda'),
 (104,'A','cartas con texto largo y sin ningún vector',
  (select count(*) from cartas c
   where coalesce(c.n_palabras, 0) >= 60
     and not exists (select 1 from chunks ch where ch.carta_id = c.id)),
  (select count(*) from cartas where coalesce(n_palabras,0) >= 60), 0,
  'una carta larga sin vector es un agujero, no una carta corta');


-- ===========================================================================
--  B · LOS CHUNKS QUE QUEDARON VIEJOS
-- ===========================================================================
drop table if exists viejos;
create temp table viejos as
select ch.id, ch.carta_id, ch.idioma, ch.idx, c.libro_id, c.pagina_inicio,
       left(ch.texto, 120) as pedazo
from chunks ch
join cartas c on c.id = ch.carta_id
where ch.texto is not null and c.texto is not null
  and length(btrim(ch.texto)) >= 20
  -- el idioma del chunk tiene que ser el del texto original; una traducción
  -- no está adentro del texto hebreo y no es un chunk viejo
  and ch.idioma in ('he', 'heb', 'hebreo')
  and position(left(ch.texto, 120) in c.texto) = 0;

insert into control values
 (201,'B','chunks cuyo texto ya no está en su carta',
  (select count(*) from viejos),
  (select count(*) from chunks where idioma in ('he','heb','hebreo')), 0,
  'el vector describe un texto que ya no existe'),
 (202,'B','cartas afectadas por eso',
  (select count(distinct carta_id) from viejos),
  (select cartas from total), 0, null),
 (203,'B','de ésas, cartas que tocó el arreglo de la comilla',
  (select count(distinct v.carta_id) from viejos v
   where exists (select 1 from respaldo_comilla r where r.id = v.carta_id)),
  (select count(*) from respaldo_comilla), null,
  'informativo · es la causa esperada');

insert into ejemplos
select 2, 0, '=== B · veinte chunks viejos ===',
       'el pedazo que ya no está en la carta';
insert into ejemplos
select 2, row_number() over (order by libro_id, pagina_inicio, idx),
       '    ' || libro_id || ' p.' || coalesce(pagina_inicio::text,'?')
       || ' · chunk ' || idx,
       left(regexp_replace(pedazo, E'[\n\r]+', ' ', 'g'), 90)
from viejos
order by libro_id, pagina_inicio, idx
limit 20;

insert into ejemplos
select 3, 0, '=== B2 · por tomo ===', 'dónde hay que rehacer los vectores';
insert into ejemplos
select 3, row_number() over (order by count(*) desc),
       '    ' || libro_id,
       count(*) || ' chunks viejos · ' || count(distinct carta_id) || ' cartas'
from viejos group by libro_id order by count(*) desc limit 15;


-- ===========================================================================
--  C · LO QUE NO TENDRÍA QUE EXISTIR
-- ===========================================================================
insert into control values
 (301,'C','chunks huérfanos (su carta no existe)',
  (select count(*) from chunks ch
   where not exists (select 1 from cartas c where c.id = ch.carta_id)),
  (select chunks from total), 0, null),
 (302,'C','chunks con el vector nulo',
  (select count(*) from chunks where embedding is null),
  (select chunks from total), 0,
  'ocupan lugar y la búsqueda no los puede usar'),
 (303,'C','chunks con el texto vacío',
  (select count(*) from chunks where coalesce(btrim(texto), '') = ''),
  (select chunks from total), 0, null),
 (304,'C','chunks repetidos (misma carta, idioma e índice)',
  (select coalesce(sum(n - 1), 0) from (
     select count(*) as n from chunks
     group by carta_id, idioma, idx having count(*) > 1) r),
  (select chunks from total), 0, null);

insert into ejemplos
select 4, 0, '=== C · los huérfanos, hasta diez ===', '';
insert into ejemplos
select 4, row_number() over (order by ch.carta_id, ch.idx),
       '    ' || ch.carta_id || ' · chunk ' || ch.idx,
       left(coalesce(ch.texto,''), 70)
from chunks ch
where not exists (select 1 from cartas c where c.id = ch.carta_id)
order by ch.carta_id, ch.idx limit 10;


-- ===========================================================================
--  D · DÓNDE FALTAN, POR TOMO
-- ===========================================================================
insert into ejemplos
select 5, 0, '=== D · los diez tomos con menos cobertura ===',
       'cartas sin ningún vector';
insert into ejemplos
select 5, row_number() over (order by sin_vector::float / n desc),
       '    ' || libro_id,
       sin_vector || ' sin vector de ' || n || ' cartas  ('
       || round(100.0 * sin_vector / n) || '%)'
from (
  select c.libro_id, count(*) as n,
         count(*) filter (
           where not exists (select 1 from chunks ch where ch.carta_id = c.id)
         ) as sin_vector
  from cartas c group by c.libro_id
) x
where sin_vector > 0
order by sin_vector::float / n desc
limit 10;


-- ===========================================================================
--  E · EL ÍNDICE DE LA BÚSQUEDA POR SIGNIFICADO
--
--  Sin índice, cada búsqueda compara el vector de la consulta contra todos
--  los chunks. Con 13.613 cartas eso se nota, y es lo que ya nos pasó en
--  octubre: `arreglar_la_busqueda_lenta.sql` existe por esto.
-- ===========================================================================
insert into ejemplos
select 6, 0, '=== E · índices sobre `chunks` ===', '';
insert into ejemplos
select 6, row_number() over (order by indexname),
       '    ' || indexname,
       case when indexdef ilike '%hnsw%' then 'HNSW · el de los vectores'
            when indexdef ilike '%ivfflat%' then 'IVFFlat · el de los vectores'
            else 'común' end
from pg_indexes where schemaname = 'public' and tablename = 'chunks'
order by indexname;

insert into control values
 (401,'E','índice de vectores sobre `chunks`',
  (select case when exists (
     select 1 from pg_indexes where schemaname = 'public'
       and tablename = 'chunks'
       and (indexdef ilike '%hnsw%' or indexdef ilike '%ivfflat%'))
   then 0 else 1 end),
  1, 0, 'sin él, cada búsqueda recorre todos los chunks');


-- ===========================================================================
--  EL INFORME
-- ===========================================================================
drop table if exists informe;
create temp table informe (orden int, clave int, que text, cuanto text);

insert into informe
select 0, 0, '=== CONTROLES DE LOS VECTORES · '
             || (select cartas from total) || ' cartas, '
             || (select chunks from total) || ' chunks ===',
       'cada renglón: cuántos están mal';

insert into informe
select 1, n, '  ' || bloque || ' · ' || nombre,
       malas::text
       || case when de is not null then ' de ' || de else '' end
       || case
            when umbral is null then '   (' || coalesce(nota,'informativo') || ')'
            when malas <= umbral then '   ✔'
            else '   ⚠️' || case when nota is not null then ' ' || nota else '' end
          end
from control;

insert into informe
select 2, 1, '=== VEREDICTO ===',
       (select count(*) filter (where umbral is not null and malas <= umbral)
               || ' controles pasaron · '
               || count(*) filter (where umbral is not null and malas > umbral)
               || ' fallaron · '
               || count(*) filter (where umbral is null) || ' informativos'
        from control);
insert into informe
select 2, 2, '    los que fallaron',
       coalesce((select string_agg(bloque || ' ' || nombre, ' | ' order by n)
                 from control where umbral is not null and malas > umbral),
                'ninguno ✔');

insert into informe select 100 + orden, clave, que, cuanto from ejemplos;

select que, cuanto from informe order by orden, clave;
