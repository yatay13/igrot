-- ===========================================================================
--  LOS VECTORES, TAL COMO ESTÁN HOY
--
--  Versión: 2026-11-16.  Correr en Supabase -> SQL Editor.
--  **No modifica NADA.** Sólo mira y cuenta.
--
--  ---------------------------------------------------------------------------
--  POR QUÉ ESTE ARCHIVO EXISTE, Y POR QUÉ VA ANTES
--
--  Lo que quedó trabado en Colab es la vectorización: los chunks que quedaron
--  viejos cuando arreglamos la comilla —porque el texto cambió y el chunk
--  guardado ya no es el de la carta— y las cartas que nunca tuvieron vector
--  en hebreo.
--
--  TENGO UNA MANERA DE HACERLO SIN COLAB. Tu sitio ya tiene las tres piezas
--  que hacen falta: el código que le pide vectores a Gemini (está en
--  `servicios.js`, es el mismo que usa la búsqueda), la clave de Gemini en
--  Vercel y la de Supabase al lado. O sea que la vectorización puede correr
--  desde tu propio sitio, en tandas, con una pestaña abierta, y Colab deja de
--  hacer falta. Es la misma idea que destrabó las fechas: la herramienta que
--  no anda no era imprescindible, era la que teníamos a mano.
--
--  Pero para escribir eso necesito ver la tabla `chunks` tal como está: cómo
--  se llaman sus columnas, cuál es su clave, de qué dimensión son los
--  vectores. Escribirlo de memoria es la manera segura de mandarte un archivo
--  que falle en el primer renglón.
--
--  Esto es ese paso. Son dos minutos y no toca nada.
-- ===========================================================================

drop table if exists pg_temp.vec;
create temp table vec (orden int, clave int, cosa text, dato text);

-- ---------------------------------------------------------------------------
--  1 · LA FORMA DE LA TABLA
-- ---------------------------------------------------------------------------
insert into vec values (1, 0, '=== LAS COLUMNAS DE `chunks` ===', 'tipo');
insert into vec
select 1, ordinal_position,
       '  ' || column_name
       || case when is_nullable = 'NO' then '  (obligatoria)' else '' end,
       data_type
       || coalesce('(' || character_maximum_length || ')', '')
       || coalesce(' · por omisión ' || left(column_default, 40), '')
from information_schema.columns
where table_schema = 'public' and table_name = 'chunks'
order by ordinal_position;

insert into vec
select 1, 900, '  ⚠️ no existe una tabla `chunks`', 'nada de lo de abajo va a servir'
where not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'chunks');

-- ---------------------------------------------------------------------------
--  2 · LAS CLAVES Y LOS ÍNDICES
--      Hace falta saber la clave exacta para poder escribir un `on conflict`
--      que no duplique filas si una tanda se repite.
-- ---------------------------------------------------------------------------
insert into vec values (2, 0, '=== CLAVES E ÍNDICES DE `chunks` ===', '');
insert into vec
select 2, row_number() over (order by i.indisprimary desc, c.relname),
       '  ' || c.relname
       || case when i.indisprimary then '  (clave primaria)'
               when i.indisunique then '  (única)' else '' end,
       pg_get_indexdef(i.indexrelid)
from pg_index i
join pg_class c on c.oid = i.indexrelid
join pg_class t on t.oid = i.indrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and t.relname = 'chunks'
order by i.indisprimary desc, c.relname;

-- ---------------------------------------------------------------------------
--  3 · LA DIMENSIÓN DE LOS VECTORES
--      El cuaderno usaba 1536. Si la columna está declarada con otra, un
--      vector nuevo de 1536 sería rechazado por la base.
-- ---------------------------------------------------------------------------
insert into vec values (3, 0, '=== LOS VECTORES ===', '');
insert into vec
select 3, 1, '  tipo declarado de la columna del vector',
       coalesce((select format_type(a.atttypid, a.atttypmod)
                 from pg_attribute a
                 join pg_class c on c.oid = a.attrelid
                 join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname = 'chunks'
                   and a.attname in ('embedding','vector','embeddings')
                   and a.attnum > 0
                 limit 1), 'no encontré una columna de vectores');

-- ---------------------------------------------------------------------------
--  4 · CUÁNTO HAY, Y CUÁNTO FALTA
-- ---------------------------------------------------------------------------
insert into vec values (4, 0, '=== CUÁNTO HAY ===', '');
insert into vec select 4, 1, '  cartas en total', (select count(*)::text from cartas);
insert into vec select 4, 2, '  chunks en total', (select count(*)::text from chunks);
insert into vec
select 4, 10 + row_number() over (order by idioma),
       '  chunks en ' || coalesce(idioma, '(sin idioma)'),
       count(*) || ' · de ' || count(distinct carta_id) || ' cartas'
from chunks group by idioma order by idioma;

insert into vec values (5, 0, '=== CUÁNTO FALTA ===', '');
insert into vec
select 5, 1, '  cartas con texto hebreo pero SIN ningún chunk en hebreo',
       (select count(*)::text from cartas c
        where coalesce(btrim(c.texto), '') <> ''
          and not exists (select 1 from chunks ch
                          where ch.carta_id = c.id
                            and ch.idioma in ('he','heb','hebreo')));
insert into vec
select 5, 2, '  ⚠️ chunks en hebreo cuyo texto YA NO está en su carta',
       (select count(*)::text from chunks ch join cartas c on c.id = ch.carta_id
        where ch.idioma in ('he','heb','hebreo')
          and coalesce(btrim(ch.texto), '') <> ''
          and position(left(ch.texto, 120) in coalesce(c.texto, '')) = 0);
insert into vec
select 5, 3, '     …y de cuántas cartas son',
       (select count(distinct ch.carta_id)::text from chunks ch join cartas c on c.id = ch.carta_id
        where ch.idioma in ('he','heb','hebreo')
          and coalesce(btrim(ch.texto), '') <> ''
          and position(left(ch.texto, 120) in coalesce(c.texto, '')) = 0);
insert into vec
select 5, 4, '  chunks sin vector calculado (nulo)',
       (select count(*)::text from chunks where embedding is null);
insert into vec
select 5, 5, '  chunks huérfanos (su carta ya no existe)',
       (select count(*)::text from chunks ch
        where not exists (select 1 from cartas c where c.id = ch.carta_id));

-- ---------------------------------------------------------------------------
--  5 · EL TAMAÑO DEL TRABAJO
--      De esto depende de a cuántas cartas por tanda conviene ir: Vercel corta
--      la función a los 60 segundos, así que la tanda tiene que entrar holgada.
-- ---------------------------------------------------------------------------
insert into vec values (6, 0, '=== EL TAMAÑO DEL TRABAJO ===', '');
insert into vec
select 6, 1, '  largo del texto hebreo: mediana / promedio / el más largo',
       (select round(percentile_cont(0.5) within group (order by length(texto)))::text
               || ' / ' || round(avg(length(texto)))::text
               || ' / ' || max(length(texto))::text || ' caracteres'
        from cartas where coalesce(btrim(texto), '') <> '');
insert into vec
select 6, 2, '  con tramos de 1.500 caracteres, cuántos tramos saldrían de las que faltan',
       (select coalesce(sum(greatest(1, ceil(length(c.texto)::numeric / 1300))), 0)::text
        from cartas c
        where coalesce(btrim(c.texto), '') <> ''
          and not exists (select 1 from chunks ch
                          where ch.carta_id = c.id
                            and ch.idioma in ('he','heb','hebreo')));

-- ---------------------------------------------------------------------------
--  6 · QUÉ FUNCIONES HAY YA, PARA NO DUPLICAR
-- ---------------------------------------------------------------------------
insert into vec values (7, 0, '=== FUNCIONES QUE YA EXISTEN ===', 'cómo corre');
-- Sólo las TUYAS. Sin el filtro de `pg_depend`, acá aparecían las ciento y
-- pico de funciones que trae pgvector —`l2_distance`, `vector_add` y
-- compañía— y tapaban las cinco que me interesa ver.
insert into vec
select 7, row_number() over (order by p.proname), '  ' || p.proname,
       case when p.prosecdef then 'SECURITY DEFINER' else 'invoker' end
       || ' · ' || pg_get_function_identity_arguments(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and not exists (
    select 1 from pg_depend d
    where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
  )
order by p.proname;

insert into vec
select 7, 900, '  (no hay ninguna función propia)', ''
where not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend d
                    where d.objid = p.oid and d.classid = 'pg_proc'::regclass
                      and d.deptype = 'e'));

-- ---------------------------------------------------------------------------
--  7 · UN CHUNK DE EJEMPLO, PARA VER LA FORMA DE LOS DATOS
--      Sin el vector, que son mil quinientos números y no se puede leer.
-- ---------------------------------------------------------------------------
insert into vec values (8, 0, '=== UN CHUNK DE EJEMPLO ===', '');
insert into vec
select 8, 1, '  carta_id · idioma · idx',
       (select ch.carta_id || '  ·  ' || coalesce(ch.idioma,'?') || '  ·  ' || coalesce(ch.idx::text,'?')
        from chunks ch where ch.embedding is not null
          and ch.idioma in ('he','heb','hebreo') limit 1);
insert into vec
select 8, 2, '  los primeros 90 caracteres de su texto',
       (select left(ch.texto, 90) from chunks ch where ch.embedding is not null
          and ch.idioma in ('he','heb','hebreo') limit 1);
insert into vec
select 8, 3, '  cuántos números tiene su vector',
       (select vector_dims(ch.embedding)::text from chunks ch
        where ch.embedding is not null limit 1);

select cosa, dato from vec order by orden, clave;
