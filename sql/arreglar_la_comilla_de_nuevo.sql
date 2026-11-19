drop table if exists opciones;
create temp table opciones as select false as aplicar;   -- <<<<<< RENGLÓN 2
-- ###########################################################################
-- #  EL INTERRUPTOR ES EL RENGLÓN 2, EL DE ARRIBA DE ESTA LÍNEA.            #
-- #                                                                        #
-- #  Para APLICAR: cambiá `false` por `true` en ese renglón 2 y nada más.  #
-- #  No hace falta buscar nada: es el segundo renglón del archivo.         #
-- ###########################################################################

-- ###########################################################################

-- ===========================================================================
--  LA COMILLA, OTRA VEZ · AHORA SIN LA PUERTA QUE SE CERRÓ SOLA
--
--  Versión: 2026-11-08.
--  Correr en Supabase -> SQL Editor. Arranca en modo prueba.
--
--  ---------------------------------------------------------------------------
--  QUÉ SALIÓ MAL, Y ES UN ERROR MÍO DE DISEÑO
--
--  `arreglar_la_comilla_por_tandas.sql` decidía **qué tomos tocar** contando
--  cuántas de sus cartas tenían `בייה`. Y `בייה -> ב"ה` estaba en la tanda 1.
--
--      corrida 1 · la tanda 1 arregla `בייה` en los 13 tomos del lote malo
--      corrida 2 · el archivo vuelve a preguntar quién está afectado…
--                  y ya nadie llega al 5%, porque el marcador con el que los
--                  reconocía lo acababa de borrar él mismo
--      corridas 2 a 7 · recorren la tabla y no cambian una sola fila
--
--  Las tandas igual se marcaron como hechas, porque esa marca miraba si el
--  `update` había corrido, no si había cambiado algo.
--
--  **La herramienta de medición se comió el dato que medía.** Comprobado:
--
--      tanda 1 · אגוייח, אדייר      0 y 0 cartas rotas  -> aplicada
--      tanda 2 · אגהייק, אדהייז    23 y 17              -> nunca se aplicó
--      tanda 3 · אהייק, אייי       12 y 13
--      tandas 4 a 7 · todas con palabras rotas todavía
--
--  Y lo delató la cuenta de caracteres: 28.844 perdidos contra los ~35.000
--  previstos. Los tres controles de daño daban bien y el arreglo parecía
--  terminado.
--
--  ---------------------------------------------------------------------------
--  QUÉ CAMBIA ACÁ
--
--  1 · **Se va la decisión por tomo.** Sobraba. Las 991 palabras ya se
--      aprobaron mirando la provenencia cuando se armó el mapa: una palabra
--      aprobada es un defecto donde aparezca, en el tomo que sea. La única
--      condición que queda es la que no se puede borrar sola: que la carta
--      contenga `יי`, que es lo que toda palabra del mapa tiene.
--
--      De paso, esto arregla en el mismo paso las ~30 cartas sueltas que
--      vivían en tomos por debajo del 5%.
--
--  2 · **Una tanda se da por hecha según lo que CAMBIÓ, no según si corrió.**
--      Antes y después de cada tanda se mide la suma de caracteres de las seis
--      columnas. Cada arreglo cambia dos caracteres (`יי`) por uno (`"`), así
--      que la diferencia **es** la cantidad de arreglos. Si da cero, la tanda
--      no hizo nada y el informe lo dice con todas las letras.
--
--  3 · **Las tandas vuelven a estar pendientes**, porque las marcas de la
--      corrida anterior no son de fiar. Re-aplicar la tanda 1 es inofensivo:
--      ya no quedan `בייה` que cambiar, así que va a dar cero arreglos y eso
--      mismo lo confirma.
--
--  ---------------------------------------------------------------------------
--  CÓMO USARLO
--
--  1 · Pegalo y dale Run tal como está: no cambia nada, informa.
--  2 · Cambiá la palabra marcada con «ACÁ» por `true`.
--  3 · Dale Run. Cada corrida hace UNA tanda. Volvé a apretar Run, sin
--      cambiar nada, hasta que diga LISTO.
--
--  Se puede repetir sin consecuencias: cambia `בייה` por `ב"ה`, y una vez
--  cambiado no queda ningún `בייה` que volver a cambiar. Si el editor corta
--  con «Failed to fetch», apretá Run de nuevo.
--
--  Para volver atrás todo:  select * from volver_atras_comilla();
-- ===========================================================================

drop table if exists informe;
create temp table informe (orden int, clave int, que text, cuanto text);

-- `arreglos` guarda cuántos caracteres quitó cada tanda. Que la columna no
-- existiera antes es justamente lo que permite saber qué tandas vienen de la
-- corrida vieja: ésas se vuelven a poner pendientes.
alter table mapa_comilla add column if not exists arreglos int;

create table if not exists respaldo_comilla (
  guardado_en        timestamptz not null default now(),
  id                 text primary key,
  texto              text,
  encabezado         text,
  fecha_hebrea_texto text,
  destinatario       text,
  firma              text,
  formula_cierre     text
);

create or replace function volver_atras_comilla()
returns text language plpgsql as $$
declare n int;
begin
  update cartas c
     set texto = r.texto, encabezado = r.encabezado,
         fecha_hebrea_texto = r.fecha_hebrea_texto,
         destinatario = r.destinatario, firma = r.firma,
         formula_cierre = r.formula_cierre
    from respaldo_comilla r
   where r.id = c.id;
  get diagnostics n = row_count;
  update mapa_comilla set hecha = false, arreglos = null;
  return 'volví atrás ' || n || ' cartas, y dejé todas las tandas pendientes';
end $$;

-- Las tandas que vienen marcadas de la corrida vieja (sin `arreglos`) no son
-- de fiar: vuelven a estar pendientes. Las que ya corrió ESTE archivo tienen
-- su número de arreglos y no se tocan.
update mapa_comilla set hecha = false where arreglos is null and hecha;


-- ---------------------------------------------------------------------------
--  0 · A QUÉ CARTAS HAY QUE ENTRARLE  (se calcula UNA SOLA VEZ)
--
--  Sacar la puerta por tomo arregló el error, pero dejó al `update`
--  recorriendo las 13.613 cartas en vez de 5.365, y con 150 expresiones
--  encima de cada texto. Eso es lo que hizo cortar al editor con
--  «Failed to fetch»: el arreglo era correcto y no entraba en una corrida.
--
--  El filtro `like '%יי%'` casi no ayuda, porque hay palabras hebreas e ídish
--  de verdad con dos yods —`חיים`, `זיין`, `אייר`— repartidas por todo el
--  corpus: casi toda carta tiene alguna.
--
--  Así que se arma una vez la lista exacta de cartas que **tienen una palabra
--  del mapa**: se sacan de cada carta sólo los pedazos que contienen `יי` y se
--  los cruza contra el mapa. Es una pasada sola, queda guardada en una tabla
--  de verdad, y después cada tanda recorre nada más que esas cartas.
-- ---------------------------------------------------------------------------
--  Si la lista hace falta se decide por si está VACÍA, no por si la tabla
--  existe. Si una corrida se corta por tiempo a mitad del cálculo, la tabla
--  puede quedar creada y sin filas: preguntando por su existencia, la corrida
--  siguiente la daría por buena y el arreglo trabajaría sobre una lista
--  incompleta sin que nada avisara. El `insert` es una sola sentencia, así
--  que o entran todas las filas o no entra ninguna.
create table if not exists objetivo_comilla (id text primary key);

drop table if exists recien_armada;
create temp table recien_armada as
select (select count(*) from objetivo_comilla) = 0 as si;

do $$
begin
  if not (select si from recien_armada) then return; end if;

  insert into objetivo_comilla (id)
  select distinct c.id
  from cartas c
  join lateral (
    select btrim((regexp_matches(
             coalesce(c.texto,'') || ' ' || coalesce(c.encabezado,'') || ' '
             || coalesce(c.fecha_hebrea_texto,'') || ' '
             || coalesce(c.destinatario,'') || ' ' || coalesce(c.firma,'') || ' '
             || coalesce(c.formula_cierre,''),
             '[^[:space:]]*יי[^[:space:]]*', 'g'))[1],
           '.,;:()[]{}!?-–—') as palabra
  ) p on true
  join mapa_comilla m on m.de = p.palabra
  on conflict (id) do nothing;
end $$;


-- ---------------------------------------------------------------------------
--  1 · CÓMO ESTÁ LA BASE AHORA
-- ---------------------------------------------------------------------------
insert into informe
select 0, 0, case when (select aplicar from opciones)
                  then '>>> MODO APLICAR'
                  else '>>> MODO PRUEBA · esta corrida NO cambia nada' end,
       case when (select aplicar from opciones)
            then 'mirá el bloque 3'
            else 'el interruptor está arriba de todo, marcado con «ACÁ»' end;

insert into informe
select 1, 0, '=== 1 · cómo está la base ===', '';
insert into informe
select 1, 1, '    palabras en el mapa',
       (select count(*)::text from mapa_comilla);
insert into informe
select 1, 2, '    tandas hechas por ESTE archivo',
       (select count(distinct tanda)::text from mapa_comilla where hecha)
       || ' de ' || (select count(distinct tanda)::text from mapa_comilla);
insert into informe
select 1, 3, '    cartas que tienen una palabra del mapa',
       (select count(*)::text from objetivo_comilla)
       || case when (select si from recien_armada)
               then '  (recién calculadas en esta corrida)' else '' end;
insert into informe
select 1, 4, '    cartas en el respaldo',
       (select count(*)::text from respaldo_comilla);


-- ---------------------------------------------------------------------------
--  2 · CUÁNTO FALTA, MEDIDO SOBRE UNA MUESTRA DEL MAPA
--
--  Comprobar las 991 palabras una por una son 991 recorridos de la tabla y el
--  editor corta. Con dos palabras por tanda alcanza para ver si una tanda
--  entró o no: si las dos están en cero, entró.
-- ---------------------------------------------------------------------------
insert into informe
select 2, 0, '=== 2 · dos palabras de cada tanda ===',
       'en cero = esa tanda ya está aplicada';
insert into informe
select 2, row_number() over (order by m.tanda, m.de),
       '    tanda ' || m.tanda || ' · ' || m.de || '  ->  ' || m.a,
       (select count(*) from cartas c
        join objetivo_comilla o on o.id = c.id
        where c.texto ~ ('\m' || m.de || '\M'))::text || ' cartas rotas'
from (select tanda, de, a,
             row_number() over (partition by tanda order by de) as n
      from mapa_comilla) m
where m.n <= 2
order by m.tanda, m.de;


-- ---------------------------------------------------------------------------
--  3 · APLICAR UNA TANDA
-- ---------------------------------------------------------------------------
do $$
declare
  t        int;
  expr     text;
  cols     text[] := array['texto','encabezado','fecha_hebrea_texto',
                            'destinatario','firma','formula_cierre'];
  col      text;
  par      record;
  cuantas  int;
  faltan   int;
  antes    bigint;
  despues  bigint;
  hechos   int;
begin
  if not (select aplicar from opciones) then return; end if;

  -- Si el objetivo se armó recién en esta corrida, no se aplica nada: las
  -- dos cosas juntas son lo que hace cortar al editor.
  if (select si from recien_armada) then
    insert into informe values (3, 1, '>>> LISTA DE CARTAS ARMADA',
      (select count(*) from objetivo_comilla) || ' cartas · esta corrida no '
      || 'cambió nada · volvé a correr el mismo texto para empezar');
    return;
  end if;

  if not exists (select 1 from mapa_comilla) then
    insert into informe values (3, 1, '>>> NO HICE NADA',
      '`mapa_comilla` está vacía: el mapa se arma con el archivo anterior');
    return;
  end if;

  select min(tanda) into t from mapa_comilla where not hecha;
  if t is null then
    insert into informe values (3, 1, '>>> LISTO',
      'todas las tandas están hechas');
    return;
  end if;
  select count(*) into cuantas from mapa_comilla where tanda = t;

  -- Respaldo. Ahora alcanza a CUALQUIER carta que pueda cambiar, no sólo a
  -- las de los tomos del lote malo: ésas son justamente las que el arreglo
  -- viejo dejaba afuera. `do nothing` conserva el texto más viejo, que es el
  -- que hay que poder recuperar.
  insert into respaldo_comilla (id, texto, encabezado, fecha_hebrea_texto,
                                destinatario, firma, formula_cierre)
  select c.id, c.texto, c.encabezado, c.fecha_hebrea_texto,
         c.destinatario, c.firma, c.formula_cierre
  from cartas c join objetivo_comilla o on o.id = c.id
  on conflict (id) do nothing;

  -- La medida de verdad: cada arreglo quita exactamente un carácter.
  select sum(length(coalesce(texto,'')) + length(coalesce(encabezado,''))
           + length(coalesce(fecha_hebrea_texto,''))
           + length(coalesce(destinatario,'')) + length(coalesce(firma,''))
           + length(coalesce(formula_cierre,'')))
    into antes from cartas c join objetivo_comilla o on o.id = c.id;

  -- `\m` y `\M` son los bordes de palabra, comprobados con hebreo: sin ellos
  -- `ובייהם` («y en ellos») se convertiría en `וב"הם`.
  foreach col in array cols loop
    expr := quote_ident(col);
    for par in select de, a from mapa_comilla where tanda = t order by de loop
      expr := format('regexp_replace(%s, %L, %L, %L)',
                     expr, '\m' || par.de || '\M', par.a, 'g');
    end loop;
    execute format(
      'update cartas c set %I = %s
         from objetivo_comilla o
        where o.id = c.id and c.%I is not null and c.%I like %L',
      col, expr, col, col, '%יי%');
  end loop;

  select sum(length(coalesce(texto,'')) + length(coalesce(encabezado,''))
           + length(coalesce(fecha_hebrea_texto,''))
           + length(coalesce(destinatario,'')) + length(coalesce(firma,''))
           + length(coalesce(formula_cierre,'')))
    into despues from cartas c join objetivo_comilla o on o.id = c.id;

  hechos := (antes - despues)::int;
  update mapa_comilla set hecha = true, arreglos = hechos where tanda = t;
  select count(distinct tanda) into faltan from mapa_comilla where not hecha;

  insert into informe values (3, 1, '>>> TANDA ' || t || ' APLICADA',
    cuantas || ' palabras · ' || hechos || ' arreglos');
  if hechos = 0 then
    insert into informe values (3, 2, '    ⚠️ esta tanda no cambió nada',
      'si ya estaba aplicada está bien; si no, avisame antes de seguir');
  end if;
  if faltan = 0 then
    insert into informe values (3, 3, '>>> LISTO · no quedan tandas', '');
  else
    insert into informe values (3, 3, '    faltan ' || faltan || ' tandas',
      'volvé a correr el MISMO texto, sin cambiarle nada');
  end if;
end $$;


-- ---------------------------------------------------------------------------
--  4 · LA CUENTA QUE TIENE QUE CERRAR
-- ---------------------------------------------------------------------------
insert into informe
select 4, 0, '=== 4 · la cuenta de los caracteres ===',
       'cada arreglo quita exactamente uno';
insert into informe
select 4, 1, '    arreglos hechos por este archivo, por tanda',
       coalesce((select string_agg(tanda || ':' || arreglos, '  ' order by tanda)
                 from (select distinct tanda, arreglos from mapa_comilla
                       where arreglos is not null) x), '(todavía ninguno)');
insert into informe
select 4, 2, '    caracteres que perdió el corpus en total',
       coalesce((select sum(length(r.texto) - length(c.texto))::text
                 from respaldo_comilla r join cartas c on c.id = r.id
                 where r.texto is not null and c.texto is not null), '0');
insert into informe
select 4, 3, '    ⚠️ cartas donde el texto se ALARGÓ (no puede pasar)',
       (select count(*)::text from respaldo_comilla r join cartas c on c.id = r.id
        where length(c.texto) > length(r.texto));
insert into informe
select 4, 4, '    ⚠️ cartas que tenían texto y quedaron vacías',
       (select count(*)::text from respaldo_comilla r join cartas c on c.id = r.id
        where coalesce(btrim(r.texto),'') <> ''
          and coalesce(btrim(c.texto),'') = '');

select que, cuanto from informe order by orden, clave;
