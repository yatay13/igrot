-- ===========================================================================
--  EL CALENDARIO HEBREO, ADENTRO DE LA BASE
--
--  Versión: 2026-11-12.  Correr en Supabase -> SQL Editor.
--  Crea tres funciones y se comprueba a sí mismo. **No toca ninguna carta.**
--
--  ---------------------------------------------------------------------------
--  POR QUÉ ESTO EXISTE
--
--  Las fechas que quedaron por arreglar —las 14 del `ב` por `כ` y las 16 del
--  `אדר`— necesitan recalcular la fecha gregoriana a partir de la hebrea, y
--  yo venía diciendo que eso obligaba a pasar por Colab, porque el conversor
--  del proyecto está en Python.
--
--  **Estaba equivocado.** El calendario hebreo no necesita ninguna tabla ni
--  ningún dato externo: es aritmética. El molad de Tishrei se calcula con una
--  fórmula, las cuatro dehiyot son cuatro condiciones, y el largo de cada mes
--  sale del largo del año. Todo eso entra en Postgres sin problema.
--
--  Así que las fechas se pueden arreglar desde el SQL Editor, sin Colab.
--
--  ---------------------------------------------------------------------------
--  CÓMO SÉ QUE ESTÁ BIEN, Y NO SÓLO QUE CORRE
--
--  Hay un solo número que no sale de la fórmula: el desplazamiento entre la
--  época hebrea y el calendario gregoriano. Lo calibré con **una sola** fecha
--  —el 1 de Tishrei de 5720, que fue el 3 de octubre de 1959— y me dio
--  exactamente `-1373429`, que es la constante conocida del calendario
--  hebreo. No la ajusté hasta que diera: salió sola.
--
--  Y después lo probé contra **19 fechas de tu propio corpus**, calculadas en
--  su momento por el conversor de Python: las 19 coinciden. O sea que esta
--  función no «parece» correcta, sino que **reproduce exactamente** lo que ya
--  está en tu base, que es lo único que importa para que las fechas nuevas
--  sean consistentes con las viejas.
--
--  Esas 19 pruebas están abajo y corren cada vez. Si alguna fallara, el
--  informe lo dice y no hay que usar la función.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1 · ¿ES BISIESTO?
--  Siete años de cada diecinueve. `(7·año + 1) mod 19 < 7`.
-- ---------------------------------------------------------------------------
create or replace function heb_bisiesto(anio int) returns boolean
  language sql immutable as $$ select ((7 * anio + 1) % 19) < 7 $$;

-- ---------------------------------------------------------------------------
--  2 · CUÁNTOS DÍAS PASARON DESDE LA ÉPOCA HASTA EL 1 DE TISHREI DE ESE AÑO
--
--  Primero el molad —la conjunción media de la luna—, que se cuenta en días,
--  horas y «partes» (1080 partes en una hora). Después las cuatro dehiyot,
--  que son las reglas por las que Rosh Hashaná se corre un día:
--
--    · molad zaken: si la conjunción cae pasado el mediodía
--    · lo ADU rosh: Rosh Hashaná no puede caer domingo, miércoles ni viernes
--    · GaTaRaD y BeTUTaKFoT: dos casos que evitan años de largo imposible
-- ---------------------------------------------------------------------------
create or replace function heb_dias_hasta_rosh(anio int) returns bigint
language plpgsql immutable as $$
declare
  meses bigint; partes bigint; horas bigint;
  dia_conj bigint; partes_conj bigint; d bigint;
begin
  meses := 235 * ((anio - 1) / 19)
         + 12 * ((anio - 1) % 19)
         + (7 * ((anio - 1) % 19) + 1) / 19;
  partes := 204 + 793 * (meses % 1080);
  horas  := 5 + 12 * meses + 793 * (meses / 1080) + partes / 1080;
  dia_conj    := 1 + 29 * meses + horas / 24;
  partes_conj := 1080 * (horas % 24) + partes % 1080;

  if partes_conj >= 19440
     or (dia_conj % 7 = 2 and partes_conj >= 9924 and not heb_bisiesto(anio))
     or (dia_conj % 7 = 1 and partes_conj >= 16789 and heb_bisiesto(anio - 1))
  then d := dia_conj + 1;
  else d := dia_conj;
  end if;

  if d % 7 in (0, 3, 5) then return d + 1; else return d; end if;
end $$;

-- ---------------------------------------------------------------------------
--  3 · LA CONVERSIÓN
--
--  El largo del año sale de restar dos Rosh Hashaná, y de ahí salen los
--  largos de Jeshván y Kislev, que son los dos meses que varían.
--
--  Tolerancia a propósito: si la carta dice `אדר` en un año bisiesto se
--  entiende como `אדר ב` (que es la costumbre), y si dice `אדר א` o `אדר ב`
--  en un año que NO es bisiesto se entiende como el Adar único. Sin esa
--  tolerancia, las 16 cartas que tienen justamente ese problema devolverían
--  nulo en vez de una fecha.
-- ---------------------------------------------------------------------------
create or replace function heb_a_gregoriana(dia int, mes text, anio int)
returns date language plpgsql immutable as $$
declare
  largo_anio int; acum int := 0; m text; largo int;
  nombres text[]; largos int[]; i int;
begin
  if dia is null or anio is null or coalesce(btrim(mes), '') = ''
     then return null; end if;
  if dia < 1 or dia > 30 then return null; end if;

  largo_anio := (heb_dias_hasta_rosh(anio + 1) - heb_dias_hasta_rosh(anio))::int;

  nombres := array['תשרי','חשון','כסלו','טבת','שבט'];
  largos  := array[30, case when largo_anio in (355, 385) then 30 else 29 end,
                   case when largo_anio in (353, 383) then 29 else 30 end, 29, 30];
  if heb_bisiesto(anio) then
    nombres := nombres || array['אדר א','אדר ב'];  largos := largos || array[30, 29];
  else
    nombres := nombres || array['אדר'];            largos := largos || array[29];
  end if;
  nombres := nombres || array['ניסן','אייר','סיון','תמוז','אב','אלול'];
  largos  := largos  || array[30, 29, 30, 29, 30, 29];

  for i in 1 .. array_length(nombres, 1) loop
    m := nombres[i]; largo := largos[i];
    if m = btrim(mes)
       or (heb_bisiesto(anio) and btrim(mes) = 'אדר'   and m = 'אדר ב')
       or (not heb_bisiesto(anio) and btrim(mes) in ('אדר א','אדר ב') and m = 'אדר')
    then
      if dia > largo then return null; end if;   -- 30 de un mes de 29 no existe
      return date '0001-01-01'
             + (heb_dias_hasta_rosh(anio) + acum + dia - 1 - 1373429)::int;
    end if;
    acum := acum + largo;
  end loop;
  return null;
end $$;


-- ===========================================================================
--  4 · LAS 19 PRUEBAS, CONTRA FECHAS DE TU PROPIO CORPUS
--
--  Las tablas de este archivo se llaman todas `heb_...` y se borran sólo
--  dentro de `pg_temp`, para que no pueda tocar por accidente una tabla tuya
--  que se llame parecido.
-- ===========================================================================
drop table if exists pg_temp.heb_pruebas;
create temp table heb_pruebas (dia int, mes text, anio int, esperado date, de_donde text);
insert into heb_pruebas values
 (1,'תשרי',5720,'1959-10-03','la fecha con la que calibré'),
 (30,'תשרי',5720,'1959-11-01','igrot_19 p.48'),
 (30,'חשון',5720,'1959-12-01','igrot_19 p.47'),
 (29,'תשרי',5709,'1948-11-01','igrot_3 p.45'),
 (2,'אדר',5705,'1945-02-15','igrot_1 p.133'),
 (11,'אדר',5705,'1945-02-24','igrot_1 p.142'),
 (25,'אדר',5707,'1947-03-17','igrot_14 p.468'),
 (3,'אדר',5707,'1947-02-23','igrot_14 p.492'),
 (3,'אדר',5710,'1950-02-20','igrot_18 p.263'),
 (16,'אדר',5710,'1950-03-05','igrot_18 p.294'),
 (22,'אדר',5710,'1950-03-11','igrot_18 p.308'),
 (9,'אדר',5710,'1950-02-26','igrot_21 p.270'),
 (21,'אדר',5710,'1950-03-10','igrot_21 p.273'),
 (7,'אדר',5720,'1960-03-06','igrot_2 p.328'),
 (15,'אדר ב',5704,'1944-03-10','igrot_22 p.209'),
 (12,'אדר א',5704,'1944-03-07','igrot_8 p.234'),
 (19,'אדר ב',5704,'1944-03-14','igrot_8 p.304'),
 (7,'אדר',5701,'1941-03-06','igrot_4 p.234'),
 (24,'אדר',5701,'1941-03-23','igrot_4 p.254');

drop table if exists pg_temp.heb_informe;
create temp table heb_informe (orden int, clave int, que text, cuanto text);

insert into heb_informe
select 1, 1, '=== LAS 19 PRUEBAS ===',
       (select count(*) filter (where heb_a_gregoriana(dia, mes, anio) = esperado)
               || ' de ' || count(*) || ' coinciden'
        from heb_pruebas);
insert into heb_informe
select 1, 2,
       case when malas = 0 then '    ✔ el conversor reproduce tu corpus'
                           else '    ⚠️ NO uses estas funciones' end,
       case when malas = 0 then 'se puede confiar para recalcular fechas'
                           else 'falló alguna prueba: el detalle está abajo' end
from (select count(*) as malas from heb_pruebas
      where heb_a_gregoriana(dia, mes, anio) is distinct from esperado) x;

insert into heb_informe
select 2, row_number() over (order by anio, mes, dia),
       '    ' || dia || ' ' || mes || ' ' || anio || ' · ' || de_donde,
       'esperaba ' || esperado || ' · dio '
       || coalesce(heb_a_gregoriana(dia, mes, anio)::text, 'nulo')
from heb_pruebas
where heb_a_gregoriana(dia, mes, anio) is distinct from esperado;


-- ===========================================================================
--  5 · LA AUDITORÍA QUE ANTES NO SE PODÍA HACER
--
--  Con el calendario adentro de la base se puede preguntar algo nuevo:
--  **¿la fecha gregoriana de cada carta es la que le corresponde a su fecha
--  hebrea?** Esto es exacto. En octubre yo comparaba con ventanas de meses
--  aproximadas, y por eso marqué mal 1.461 cartas que estaban bien.
--
--  Calculo una vez y guardo, en lugar de llamar a la función dentro de un
--  `order by` sobre trece mil renglones: así no hay riesgo de que la consulta
--  se corte con «Failed to fetch».
-- ===========================================================================
drop table if exists pg_temp.heb_recalculo;
create temp table heb_recalculo as
select c.id, c.libro_id, c.pagina_inicio,
       c.dia_hebreo, btrim(c.mes_hebreo) as mes_hebreo, c.anio_hebreo,
       c.fecha_gregoriana as guardada,
       heb_a_gregoriana(c.dia_hebreo, btrim(c.mes_hebreo), c.anio_hebreo) as calculada
from cartas c
where c.dia_hebreo is not null
  and c.anio_hebreo is not null
  and coalesce(btrim(c.mes_hebreo), '') <> '';
create index on heb_recalculo (id);

insert into heb_informe
select 3, 1, '=== AUDITORÍA DE LAS FECHAS QUE YA ESTÁN ===', '';
insert into heb_informe
select 3, 2, '    cartas con día, mes y año hebreo leídos', count(*)::text from heb_recalculo;
insert into heb_informe
select 3, 3, '    de ésas, con fecha gregoriana guardada',
       count(*)::text from heb_recalculo where guardada is not null;
insert into heb_informe
select 3, 4, '    ✔ la guardada coincide con la calculada',
       count(*)::text from heb_recalculo where guardada is not null and guardada = calculada;
insert into heb_informe
select 3, 5, '    ⚠️ no coinciden', count(*)::text
from heb_recalculo where guardada is not null and guardada is distinct from calculada;
insert into heb_informe
select 3, 6, '    sin fecha guardada pero el calendario la puede calcular',
       count(*)::text from heb_recalculo where guardada is null and calculada is not null;
insert into heb_informe
select 3, 7, '    ⚠️ el calendario devuelve nulo (día o mes imposible)',
       count(*)::text from heb_recalculo where calculada is null;

insert into heb_informe
select 4, 0, '=== en qué se van las que no coinciden ===', 'cuántas cartas';
insert into heb_informe
select 4, row_number() over (order by count(*) desc), '    ' || etiqueta, count(*)::text
from (
  select case when abs(d) <= 10  then 'se desvía ' || abs(d) || ' día(s)'
              when abs(d) <= 45  then 'se desvía un mes, más o menos'
              when abs(d) <= 200 then 'se desvía varios meses'
              when abs(d) <= 400 then 'se desvía un año, más o menos'
              else 'se desvía ' || (abs(d) / 365) || ' años o más' end as etiqueta
  from (select (guardada - calculada) as d from heb_recalculo
        where guardada is not null and guardada is distinct from calculada) z
) w
group by etiqueta
order by count(*) desc;

insert into heb_informe
select 5, 0, '=== las veinte que más se desvían ===', 'guardada contra calculada';
insert into heb_informe
select 5, row_number() over (order by abs(guardada - calculada) desc),
       '    ' || libro_id || ' p.' || coalesce(pagina_inicio::text, '?')
       || ' · ' || dia_hebreo || ' ' || mes_hebreo || ' ' || anio_hebreo,
       'guardada ' || guardada || ' · calculada ' || calculada
       || ' · ' || abs(guardada - calculada) || ' días'
from heb_recalculo
where guardada is not null and guardada is distinct from calculada
order by abs(guardada - calculada) desc
limit 20;

insert into heb_informe
select 6, 0, '=== y las que el calendario no pudo calcular ===', 'por qué';
insert into heb_informe
select 6, row_number() over (order by libro_id, pagina_inicio),
       '    ' || libro_id || ' p.' || coalesce(pagina_inicio::text, '?')
       || ' · ' || dia_hebreo || ' ' || coalesce(mes_hebreo, '(sin mes)') || ' ' || anio_hebreo,
       case when dia_hebreo > 30 then 'día mayor que 30'
            when anio_hebreo < 5600 or anio_hebreo > 5760 then 'año fuera del corpus'
            else 'el día no existe en ese mes, o el mes no se reconoce' end
from heb_recalculo
where calculada is null
order by libro_id, pagina_inicio
limit 25;

select que, cuanto from heb_informe order by orden, clave;
