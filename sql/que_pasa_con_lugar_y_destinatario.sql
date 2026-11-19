-- ===========================================================================
--  LOS LUGARES Y LOS DESTINATARIOS  ·  SÓLO MIDE, NO CAMBIA NADA
--
--  Versión: 2026-11-09.
--  Correr en Supabase -> SQL Editor. No tiene interruptor: no escribe.
--
--  ---------------------------------------------------------------------------
--  DE DÓNDE SALE
--
--  El control del enriquecido dejó dos cosas chicas y muy visibles, porque
--  las dos salen impresas en el chip de cada carta del sitio:
--
--      · 51 de los 72 lugares distintos aparecen UNA SOLA VEZ, y casi todos
--        son `ברוקלין` con ruido del OCR: `ברוק,לין`, `ברוקליו.`,
--        `ברוקלין, נ.*.`, `ברוקליר`, y uno con una `ل` árabe adentro.
--      · 249 destinatarios tienen de 1 a 4 caracteres: `הרה`, `מוה`, `ה`,
--        `מו`. Son el prefijo honorífico cortado. El enriquecedor tiene un
--        freno para esto (`MINIMO_DESTINATARIO = 5`, y descartó 2.257), pero
--        ese freno sólo mira lo que propone el modelo: éstos entraron por el
--        camino de las reglas del segmentador, que no tiene mínimo.
--
--  ---------------------------------------------------------------------------
--  POR QUÉ MIDE EN VEZ DE ARREGLAR
--
--  Son 72 valores distintos de lugar. Con 72 no hace falta ninguna regla
--  automática ni ningún esqueleto: **se pueden leer todos**. Y vos leés
--  hebreo y yo no de forma confiable, así que la lista la mirás vos y la
--  agrupación la propongo yo sobre lo que haya, no sobre lo que imagino.
--
--  Es al revés de lo que hice con los temas, y a propósito: ahí eran 336 y
--  una regla era inevitable. Acá una regla automática sería más riesgo que
--  beneficio.
-- ===========================================================================

drop table if exists informe;
create temp table informe (orden int, clave int, que text, cuanto text);


-- ---------------------------------------------------------------------------
--  A · TODOS LOS LUGARES, UNO POR UNO
-- ---------------------------------------------------------------------------
insert into informe
select 1, 1, 'A · valores distintos de `lugar`',
       (select count(distinct btrim(lugar))::text from cartas
        where coalesce(btrim(lugar),'') <> '');
insert into informe
select 1, 2, '    cartas con lugar',
       (select count(*)::text from cartas where coalesce(btrim(lugar),'') <> '');
insert into informe
select 1, 3, '    cartas sin lugar',
       (select count(*)::text from cartas where coalesce(btrim(lugar),'') = '');

insert into informe
select 2, 0, '=== A2 · todos los lugares, por cantidad ===',
       'los de arriba son los buenos; los de abajo, variantes';
insert into informe
select 2, row_number() over (order by count(*) desc, btrim(lugar)),
       '    «' || btrim(lugar) || '»',
       count(*) || ' cartas · ' || length(btrim(lugar)) || ' caracteres'
from cartas
where coalesce(btrim(lugar),'') <> ''
group by btrim(lugar)
order by count(*) desc, btrim(lugar);


-- ---------------------------------------------------------------------------
--  B · LOS DESTINATARIOS CORTOS
--
--  Se agrupan por su valor: si son todos `הרה` y `מוה`, el arreglo es una
--  lista corta y no hace falta ninguna regla.
-- ---------------------------------------------------------------------------
insert into informe
select 3, 1, 'B · destinatarios de menos de 5 caracteres',
       (select count(*)::text from cartas
        where coalesce(btrim(destinatario),'') <> ''
          and length(btrim(destinatario)) < 5);
insert into informe
select 3, 2, '    valores distintos entre ésos',
       (select count(distinct btrim(destinatario))::text from cartas
        where coalesce(btrim(destinatario),'') <> ''
          and length(btrim(destinatario)) < 5);

insert into informe
select 4, 0, '=== B2 · cuáles son, y cuántas veces ===',
       'ninguno de éstos es un nombre';
insert into informe
select 4, row_number() over (order by count(*) desc, btrim(destinatario)),
       '    «' || btrim(destinatario) || '»  ('
       || length(btrim(destinatario)) || ' caracteres)',
       count(*) || ' cartas'
from cartas
where coalesce(btrim(destinatario),'') <> ''
  and length(btrim(destinatario)) < 5
group by btrim(destinatario)
order by count(*) desc, btrim(destinatario);

-- Y los que están justo arriba del mínimo, para ver si el corte en 5 alcanza
-- o si hay basura de 5, 6 y 7 caracteres también.
insert into informe
select 5, 0, '=== B3 · los de 5 a 8 caracteres, para ver si el corte alcanza ===',
       'si acá también hay prefijos sueltos, el mínimo quedó corto';
insert into informe
select 5, row_number() over (order by count(*) desc, btrim(destinatario)),
       '    «' || btrim(destinatario) || '»  ('
       || length(btrim(destinatario)) || ')',
       count(*) || ' cartas'
from cartas
where coalesce(btrim(destinatario),'') <> ''
  and length(btrim(destinatario)) between 5 and 8
group by btrim(destinatario)
order by count(*) desc, btrim(destinatario)
limit 30;


-- ---------------------------------------------------------------------------
--  C · DE DÓNDE VINIERON
--
--  Si los destinatarios cortos traen la marca `destinatario_de_ia_descartado_
--  por_corto`, entonces el modelo propuso algo, el enriquecedor lo descartó
--  bien, y lo que quedó escrito es lo que había puesto el segmentador. Eso
--  confirma de dónde hay que arreglar el canal, no sólo los datos.
-- ---------------------------------------------------------------------------
insert into informe
select 6, 1, 'C · de los cortos, cuántos tienen la marca del descarte',
       (select count(*)::text from cartas c
        where coalesce(btrim(c.destinatario),'') <> ''
          and length(btrim(c.destinatario)) < 5
          and 'destinatario_de_ia_descartado_por_corto'
              = any (coalesce(c.flags,'{}')));
insert into informe
select 6, 2, '    (si son la mayoría)',
       'el freno del enriquecedor funcionó y el dato viene del segmentador';

insert into informe
select 7, 0, '=== C2 · diez cartas con destinatario corto ===',
       'para ver si el encabezado tiene el nombre completo';
insert into informe
select 7, row_number() over (order by libro_id, pagina_inicio),
       '    ' || libro_id || ' p.' || coalesce(pagina_inicio::text,'?')
       || ' · «' || btrim(destinatario) || '»',
       left(coalesce(encabezado, '(sin encabezado)'), 90)
from cartas
where coalesce(btrim(destinatario),'') <> ''
  and length(btrim(destinatario)) < 5
order by libro_id, pagina_inicio
limit 10;


select que, cuanto from informe order by orden, clave;
