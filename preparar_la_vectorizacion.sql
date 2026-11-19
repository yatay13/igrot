-- ===========================================================================
--  LA VECTORIZACIÓN, SIN COLAB
--
--  Versión: 2026-11-16.  Correr en Supabase -> SQL Editor.
--  Crea tres funciones. **No toca ninguna carta ni ningún chunk.**
--
--  ---------------------------------------------------------------------------
--  LA IDEA
--
--  Colab tenía que hacer tres cosas: partir el texto hebreo en tramos, pedirle
--  los vectores a Gemini y guardarlos. Tu sitio ya sabe hacer las tres: el
--  código de embeddings está en `servicios.js` —es el mismo que usa la
--  búsqueda cada vez que alguien escribe algo— y las dos claves están en
--  Vercel.
--
--  Así que la vectorización va a correr desde tu propio sitio, de a tandas,
--  con una pestaña abierta. Colab deja de hacer falta.
--
--  Este archivo es la mitad que vive en la base:
--
--    · `vectores_pendientes(n)`         qué cartas faltan, de a n
--    · `guardar_chunks_de_carta(...)`   guardar los tramos con sus vectores
--    · `avance_de_vectores()`           cuánto falta, para la barra
--
--  ---------------------------------------------------------------------------
--  LO QUE SE COMPRUEBA ANTES DE CREAR NADA
--
--  Escribí estas funciones contra la forma que yo creo que tiene tu tabla
--  `chunks`: clave única por (carta_id, idioma, idx) y vectores de 1536. Si
--  me equivoqué en algo, el archivo **se cancela entero en el primer bloque**
--  y te dice qué encontró, en vez de crear funciones que fallarían recién
--  cuando ya estés vectorizando.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  0 · QUE LA TABLA SEA LA QUE ESPERO
-- ---------------------------------------------------------------------------
do $$
declare
  v_dim int;
  v_falta text;
begin
  -- las columnas
  foreach v_falta in array array['carta_id','idioma','idx','texto','embedding'] loop
    if not exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name='chunks'
                     and column_name = v_falta) then
      raise exception
        'la tabla `chunks` no tiene la columna `%`. Pegame la salida de estado_de_los_vectores_hoy.sql y lo corrijo.',
        v_falta;
    end if;
  end loop;

  -- la clave única por la que se reemplaza
  if not exists (
    select 1 from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname='public' and t.relname='chunks' and i.indisunique
      -- `attname` es de tipo `name`, no `text`: sin el casteo, la comparación
      -- con el arreglo literal no encuentra un operador y el bloque falla.
      and (select array_agg(a.attname::text order by a.attname::text)
           from unnest(i.indkey) k join pg_attribute a
             on a.attrelid = t.oid and a.attnum = k)
          = array['carta_id','idioma','idx']::text[]
  ) then
    raise exception
      '`chunks` no tiene una clave única por (carta_id, idioma, idx). Sin eso no puedo reemplazar tramos sin duplicarlos.';
  end if;

  -- la dimensión
  select (regexp_match(format_type(a.atttypid, a.atttypmod), '\((\d+)\)'))[1]::int
    into v_dim
  from pg_attribute a join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relname='chunks' and a.attname='embedding';

  if v_dim is distinct from 1536 then
    raise exception
      'los vectores de `chunks` son de dimensión %, y el sitio calcula de 1536. Decime y ajusto.', v_dim;
  end if;

  raise notice 'la tabla `chunks` es la que esperaba: clave por (carta_id, idioma, idx) y vectores de 1536';
end $$;


-- ---------------------------------------------------------------------------
--  1 · QUÉ FALTA
--
--  Dos cosas distintas, y el motivo viaja con cada carta para que del otro
--  lado se pueda informar bien:
--
--    `falta`  la carta tiene texto hebreo y NINGÚN tramo en hebreo.
--    `viejo`  tiene tramos, pero su texto ya no está en la carta. Pasa cuando
--             el texto cambió después de calcularlos —es exactamente lo que
--             provocó el arreglo de la comilla— y el vector quedó describiendo
--             algo que ya no se lee así.
--
--  EL ORDEN ES FIJO Y ESO IMPORTA. Las tandas se piden una tras otra, y cada
--  una devuelve «las n primeras que faltan». Si el orden cambiara entre una
--  llamada y la siguiente, se saltearían cartas sin que nadie se entere. Con
--  `order by` sobre la clave, la tanda siguiente empieza justo donde terminó
--  la anterior, porque las ya hechas dejan de faltar.
-- ---------------------------------------------------------------------------
create or replace function vectores_pendientes(p_cantidad int default 3)
returns table (carta_id text, texto text, motivo text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with pendientes as (
    select c.id, c.texto, 'falta'::text as motivo
    from cartas c
    where coalesce(btrim(c.texto), '') <> ''
      and not exists (select 1 from chunks ch
                      where ch.carta_id = c.id
                        and ch.idioma in ('he','heb','hebreo'))
    union all
    select distinct c.id, c.texto, 'viejo'::text
    from chunks ch join cartas c on c.id = ch.carta_id
    where ch.idioma in ('he','heb','hebreo')
      and coalesce(btrim(ch.texto), '') <> ''
      and position(left(ch.texto, 120) in coalesce(c.texto, '')) = 0
  )
  select id, texto, motivo
  from pendientes
  order by motivo, id
  limit greatest(1, least(coalesce(p_cantidad, 3), 25));
$$;


-- ---------------------------------------------------------------------------
--  2 · GUARDAR LOS TRAMOS DE UNA CARTA
--
--  Recibe los tramos ya calculados y reemplaza TODOS los de esa carta y ese
--  idioma. Reemplazar y no agregar es a propósito: si la carta tenía cinco
--  tramos viejos y ahora salen cuatro, el quinto viejo tiene que desaparecer.
--  Agregando quedaría ahí para siempre, describiendo un texto que ya no
--  existe, y la búsqueda semántica seguiría encontrándolo.
--
--  EL CONTROL QUE NO SE PUEDE SALTEAR. Cada tramo se compara contra el texto
--  de la carta ANTES de guardarlo, igual que en `guardar_traduccion`. Es lo
--  que impide que esta función sirva para meter texto cualquiera en el
--  corpus: aunque alguien llegara a llamarla, sólo acepta pedazos de cartas
--  que ya están en la base.
--
--  Se compara sin espacios porque el partido en tramos puede normalizar
--  saltos de línea, y un `position` crudo rechazaría un tramo legítimo.
--
--  Devuelve cuántos tramos guardó. Un cero significa que rechazó todo, y eso
--  del otro lado se informa en vez de darse por bueno.
-- ---------------------------------------------------------------------------
create or replace function guardar_chunks_de_carta(
  p_carta_id text,
  p_idioma   text,
  p_chunks   jsonb
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_texto   text;
  v_limpio  text;
  v_pieza   jsonb;
  v_cuantos int := 0;
  v_dims    int;
begin
  if coalesce(btrim(p_carta_id), '') = '' then return 0; end if;
  if p_idioma is null or p_idioma not in ('he','heb','hebreo','es') then return 0; end if;
  if jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 then return 0; end if;
  -- Un tope por las dudas: una carta de verdad no tiene doscientos tramos.
  if jsonb_array_length(p_chunks) > 200 then return 0; end if;

  select c.texto into v_texto from cartas c where c.id = p_carta_id;
  if v_texto is null then return 0; end if;          -- la carta no existe
  v_limpio := regexp_replace(v_texto, '\s+', '', 'g');

  -- Primero se revisa TODO, después se escribe. Si un solo tramo no es de
  -- esta carta, no se guarda ninguno: media carta vectorizada es peor que
  -- ninguna, porque no se nota.
  for v_pieza in select * from jsonb_array_elements(p_chunks) loop
    if coalesce(btrim(v_pieza->>'texto'), '') = '' then return 0; end if;
    if position(regexp_replace(v_pieza->>'texto', '\s+', '', 'g') in v_limpio) = 0 then
      return 0;
    end if;
    if jsonb_typeof(v_pieza->'embedding') <> 'array' then return 0; end if;
    v_dims := jsonb_array_length(v_pieza->'embedding');
    if v_dims <> 1536 then return 0; end if;
  end loop;

  delete from chunks where carta_id = p_carta_id and idioma = p_idioma;

  insert into chunks (carta_id, idioma, idx, texto, embedding)
  select p_carta_id,
         p_idioma,
         coalesce((p->>'idx')::int, (n - 1)::int),
         p->>'texto',
         ((p->'embedding')::text)::vector
  from jsonb_array_elements(p_chunks) with ordinality as t(p, n);

  get diagnostics v_cuantos = row_count;
  return v_cuantos;
end $$;


-- ---------------------------------------------------------------------------
--  3 · CUÁNTO FALTA
--      Para la barra de avance. Devuelve una sola fila de json.
-- ---------------------------------------------------------------------------
create or replace function avance_de_vectores()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'cartas_con_texto', (select count(*) from cartas where coalesce(btrim(texto),'') <> ''),
    'con_hebreo', (
      select count(distinct ch.carta_id) from chunks ch
      where ch.idioma in ('he','heb','hebreo')),
    'faltan', (
      select count(*) from cartas c
      where coalesce(btrim(c.texto),'') <> ''
        and not exists (select 1 from chunks ch
                        where ch.carta_id = c.id
                          and ch.idioma in ('he','heb','hebreo'))),
    'viejos', (
      select count(distinct ch.carta_id) from chunks ch join cartas c on c.id = ch.carta_id
      where ch.idioma in ('he','heb','hebreo')
        and coalesce(btrim(ch.texto),'') <> ''
        and position(left(ch.texto, 120) in coalesce(c.texto,'')) = 0),
    'chunks_hebreos', (select count(*) from chunks where idioma in ('he','heb','hebreo')),
    'sin_vector', (select count(*) from chunks where embedding is null)
  );
$$;


-- ---------------------------------------------------------------------------
--  4 · QUIÉN PUEDE LLAMARLAS
--
--  Las tres se pueden llamar con la clave del sitio, como las demás. La que
--  escribe está protegida por dos cosas distintas, y conviene tener claro
--  cuál hace qué:
--
--    · El control de adentro —que cada tramo sea de verdad un pedazo de esa
--      carta— es el que impide meter texto ajeno. Ese no se puede saltear.
--    · La ruta del sitio que la llama pide una clave propia que sólo vos
--      tenés. Ese es el que impide que un desconocido te gaste la cuota de
--      Gemini vectorizando el corpus entero.
-- ---------------------------------------------------------------------------
grant execute on function vectores_pendientes(int)                  to anon, authenticated, service_role;
grant execute on function guardar_chunks_de_carta(text, text, jsonb) to anon, authenticated, service_role;
grant execute on function avance_de_vectores()                      to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
--  5 · LA PRUEBA, QUE CORRE SOLA Y CANCELA TODO SI FALLA
-- ---------------------------------------------------------------------------
do $$
declare
  v_falsa text := 'PRUEBA-VEC-' || md5(random()::text);
  v_vec   text := '[' || array_to_string(array(select '0.01' from generate_series(1,1536)), ',') || ']';
  v_n     int;
begin
  insert into cartas (id, texto) values (v_falsa, 'אבג דהו זחט ישכ למנ סעפ');

  -- a · un tramo legítimo entra
  v_n := guardar_chunks_de_carta(v_falsa, 'he',
    jsonb_build_array(jsonb_build_object('idx',0,'texto','אבג דהו','embedding', v_vec::jsonb)));
  if v_n <> 1 then raise exception 'un tramo legítimo tendría que haberse guardado, y guardó %', v_n; end if;

  -- b · reemplaza, no agrega
  v_n := guardar_chunks_de_carta(v_falsa, 'he',
    jsonb_build_array(
      jsonb_build_object('idx',0,'texto','אבג','embedding', v_vec::jsonb),
      jsonb_build_object('idx',1,'texto','דהו','embedding', v_vec::jsonb)));
  if (select count(*) from chunks where carta_id = v_falsa) <> 2 then
    raise exception 'tendría que haber reemplazado y quedar 2 tramos, y quedaron %',
      (select count(*) from chunks where carta_id = v_falsa);
  end if;

  -- c · un texto que NO es de la carta se rechaza, y no pisa lo que había
  v_n := guardar_chunks_de_carta(v_falsa, 'he',
    jsonb_build_array(jsonb_build_object('idx',0,'texto','El Rebe dijo otra cosa','embedding', v_vec::jsonb)));
  if v_n <> 0 then raise exception 'un texto ajeno tendría que rechazarse, y devolvió %', v_n; end if;
  if (select count(*) from chunks where carta_id = v_falsa) <> 2 then
    raise exception 'un rechazo no tiene que borrar los tramos que ya estaban';
  end if;

  -- d · un vector de otra dimensión se rechaza
  v_n := guardar_chunks_de_carta(v_falsa, 'he',
    jsonb_build_array(jsonb_build_object('idx',0,'texto','אבג','embedding','[1,2,3]'::jsonb)));
  if v_n <> 0 then raise exception 'un vector de 3 números tendría que rechazarse'; end if;

  -- e · si UN tramo de la tanda es ajeno, no entra NINGUNO
  v_n := guardar_chunks_de_carta(v_falsa, 'he',
    jsonb_build_array(
      jsonb_build_object('idx',0,'texto','אבג','embedding', v_vec::jsonb),
      jsonb_build_object('idx',1,'texto','texto ajeno','embedding', v_vec::jsonb)));
  if v_n <> 0 then raise exception 'con un tramo ajeno no tendría que entrar ninguno'; end if;
  if (select count(*) from chunks where carta_id = v_falsa) <> 2 then
    raise exception 'y los que ya estaban tienen que seguir ahí';
  end if;

  -- f · una carta que no existe se rechaza
  if guardar_chunks_de_carta('NO-EXISTE-'||v_falsa, 'he',
       jsonb_build_array(jsonb_build_object('idx',0,'texto','x','embedding', v_vec::jsonb))) <> 0 then
    raise exception 'una carta inexistente tendría que rechazarse';
  end if;

  -- limpieza
  delete from chunks where carta_id = v_falsa;
  delete from cartas where id = v_falsa;

  raise notice 'las seis pruebas pasaron: guarda, reemplaza, y rechaza texto ajeno, vector corto, tanda mixta y carta inexistente';
end $$;


-- ---------------------------------------------------------------------------
--  6 · EL INFORME
-- ---------------------------------------------------------------------------
select 'las tres funciones existen' as cosa,
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public'
          and p.proname in ('vectores_pendientes','guardar_chunks_de_carta','avance_de_vectores'))
       || ' de 3' as dato
union all
select 'cuánto falta ahora mismo', avance_de_vectores()::text
union all
select 'la primera carta pendiente',
       coalesce((select carta_id || '  (' || motivo || ')' from vectores_pendientes(1)),
                'ninguna: está todo vectorizado');
