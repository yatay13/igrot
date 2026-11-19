drop table if exists opciones;
create temp table opciones as select false as aplicar;   -- <<<<<< RENGLÓN 2
-- ###########################################################################
-- #  EL INTERRUPTOR ES EL RENGLÓN 2, EL DE ARRIBA DE ESTA LÍNEA.            #
-- #  Para APLICAR: cambiá `false` por `true` ahí y nada más.                #
-- ###########################################################################

-- ===========================================================================
--  LOS LUGARES Y LOS DESTINATARIOS
--
--  Versión: 2026-11-09.  Correr en Supabase -> SQL Editor. Arranca en prueba.
--
--  ---------------------------------------------------------------------------
--  LOS LUGARES · UN MAPA ESCRITO A MANO, NO UNA REGLA
--
--  Son 72 valores distintos. Con 72 se pueden leer todos, así que no hay
--  ninguna regla automática: hay una línea por variante, copiada tal cual de
--  la medición, con su lectura al lado para que la puedas revisar.
--
--  La forma buena es la que ya tiene el 95% del corpus: **`Brooklyn, N.Y.`**,
--  en letras latinas. El enriquecido normalizó así la gran mayoría
--  —`Jerusalén`, `Paris`, `Nueva York`— y lo que quedó en hebreo son las
--  sobras donde el modelo no llegó. El mapa las lleva a la forma que ya es
--  mayoría, no a una que yo invente.
--
--  Dos valores NO son lugares y se vacían: `ב` y `ש` (una letra suelta).
--  `עחה"פ` tampoco —parece `ע' חה"פ`, víspera de Pésaj, o sea una fecha— y
--  `בייפ` no lo sé leer: **ésos dos quedan como están** y te los marco aparte
--  en el informe para que decidas vos.
--
--  ---------------------------------------------------------------------------
--  LOS DESTINATARIOS · POR TÍTULOS, NO POR LARGO
--
--  Mi primera idea era cortar por largo. Está mal y la medición lo mostró:
--  entre los de 5 a 8 caracteres hay basura (`הרה"ח אי`, `כבוד הרה`,
--  `האברך וו`) y datos buenos (`נשי חב`, `בנות חב`, `גוטניק`, `גרליק`,
--  `שרה תי'`). Un corte por largo destruye los segundos.
--
--  La regla que sí distingue: **sacar los títulos y ver si queda un nombre**.
--  Si después de quitar `הרה"ח`, `הוו"ח`, `כבוד`, `האברך`, `מוה"ר`, `מרת`,
--  los puntos suspensivos y la puntuación **no queda ninguna palabra de dos
--  letras o más**, entonces no hay destinatario: hay un encabezado cortado.
--
--  Se VACÍA, no se borra la carta. Mejor nada que un dato falso: hoy el sitio
--  muestra «הרה» como si fuera a quién está dirigida la carta.
--
--  **Y esto no arregla la causa.** El enriquecedor sólo completa el
--  destinatario cuando está VACÍO, así que una vez vaciados, la próxima
--  corrida del enriquecido puede ponerles el nombre de verdad: en varias de
--  estas cartas el nombre completo está en el `encabezado`. Vaciar es lo que
--  destraba eso.
-- ===========================================================================

drop table if exists informe;
create temp table informe (orden int, clave int, que text, cuanto text);

create table if not exists respaldo_lugar_dest (
  guardado_en timestamptz not null default now(),
  id text primary key, lugar text, destinatario text
);

create or replace function volver_atras_lugar_dest()
returns text language plpgsql as $$
declare n int;
begin
  update cartas c set lugar = r.lugar, destinatario = r.destinatario
    from respaldo_lugar_dest r where r.id = c.id;
  get diagnostics n = row_count;
  return 'volví atrás ' || n || ' cartas';
end $$;


-- ---------------------------------------------------------------------------
--  1 · EL MAPA DE LUGARES
-- ---------------------------------------------------------------------------
drop table if exists mapa_lugar;
create temp table mapa_lugar (de text primary key, a text, lectura text);
insert into mapa_lugar (de, a, lectura) values
  ('ברוקלין',          'Brooklyn, N.Y.', 'Brooklyn'),
  ('ברוקלין, נ.י.',    'Brooklyn, N.Y.', 'Brooklyn, N.Y.'),
  ('ברוקלין.',         'Brooklyn, N.Y.', 'Brooklyn.'),
  ('ברוקליו, נ.י.',    'Brooklyn, N.Y.', 'Brooklio (vav por nun final)'),
  ('בּרוקלין',          'Brooklyn, N.Y.', 'Brooklyn con daguesh'),
  ('ברוקלין, נ. י.',   'Brooklyn, N.Y.', 'Brooklyn, N. Y.'),
  ('ברוקליו',          'Brooklyn, N.Y.', 'Brooklio'),
  ('ברןקלין.',         'Brooklyn, N.Y.', 'nun final en medio'),
  ('ברוקלין נ.י.',     'Brooklyn, N.Y.', 'sin coma'),
  ('ברוקלץ.',          'Brooklyn, N.Y.', 'tsadi final'),
  ('ברקלין',           'Brooklyn, N.Y.', 'sin vav'),
  ('ב ד ר ק ל י ן',    'Brooklyn, N.Y.', 'letras separadas, dalet por resh'),
  ('ברוק,לין',         'Brooklyn, N.Y.', 'coma en el medio'),
  ('ברוקלי, (.ל.',     'Brooklyn, N.Y.', 'destrozado'),
  ('ברוקליו, נ.י,',    'Brooklyn, N.Y.', 'coma final'),
  ('ברוקליו.',         'Brooklyn, N.Y.', 'Brooklio.'),
  ('בְּרוֹקְלִין',          'Brooklyn, N.Y.', 'con nikud completo'),
  ('בּרוּקלין',          'Brooklyn, N.Y.', 'con nikud parcial'),
  ('ברוקלין נ. י.',    'Brooklyn, N.Y.', 'sin coma, con espacios'),
  ('ברוקלין, ג.י.',    'Brooklyn, N.Y.', 'guimel por nun'),
  ('ברוקלין, נ. י .',  'Brooklyn, N.Y.', 'espacio antes del punto'),
  ('ברוקלין, נ.*.',    'Brooklyn, N.Y.', 'asterisco'),
  ('ברוקלין, נ.י-',    'Brooklyn, N.Y.', 'guion final'),
  ('ברוקלין, נ.י,',    'Brooklyn, N.Y.', 'coma final'),
  ('ברוקלין, ניי.',    'Brooklyn, N.Y.', 'dos yods'),
  ('בּרוקלין.',         'Brooklyn, N.Y.', 'daguesh y punto'),
  ('ברוקלין. נ.י.',    'Brooklyn, N.Y.', 'punto en vez de coma'),
  ('ברוקליר',          'Brooklyn, N.Y.', 'resh por nun final'),
  ('ברוקليן',          'Brooklyn, N.Y.', 'lamed ARABE adentro'),
  ('בררוקלין',         'Brooklyn, N.Y.', 'resh repetida'),
  ('גרוקלין',          'Brooklyn, N.Y.', 'guimel por bet'),
  ('גרוקלין.',         'Brooklyn, N.Y.', 'guimel por bet, con punto'),
  ('כרוקלין',          'Brooklyn, N.Y.', 'kaf por bet'),
  ('ניו יארק, נ.י.',   'Nueva York',     'Nueva York, N.Y.'),
  ('ניוייארק',         'Nueva York',     'Nueva York junto'),
  ('פריז',             'Paris',          'Paris'),
  ('פאריז',            'Paris',          'Paris'),
  ('פאריס',            'Paris',          'Paris'),
  ('ירושלים (ישראל)',  'Jerusalén',      'Jerusalén (Israel)'),
  ('ירושלים עיה"ק ת"ו','Jerusalén',      'Jerusalén, ciudad santa'),
  ('מאנטרעאל',         'Montreal',       'Montreal'),
  ('במאנטריאל',        'Montreal',       'en Montreal'),
  ('מאנטרעאל, קנדה',   'Montreal',       'Montreal, Canadá'),
  ('מונטרעאל, קנדה',   'Montreal',       'Montreal, Canadá'),
  ('שיקאגא',           'Chicago',        'Chicago'),
  ('באלטימאר',         'Baltimore',      'Baltimore'),
  ('באסטאן',           'Boston',         'Boston'),
  ('ברלין',            'Berlín',         'Berlín'),
  ('דארטשעסטער',       'Dorchester',     'Dorchester'),
  ('ורשא',             'Varsovia',       'Varsovia'),
  ('חיפה',             'Haifa',          'Haifa'),
  ('לונדון',           'Londres',        'Londres'),
  ('מלבורן',           'Melbourne',      'Melbourne'),
  ('מקסיקה',           'México',         'México'),
  ('נוארק',            'Newark, N.J.',   'Newark'),
  ('נוארק נ.דזש.',     'Newark, N.J.',   'Newark, N.J.'),
  ('ניו-הייווען, קאנ.','New Haven, Conn.','New Haven, Connecticut'),
  ('נתני''',           'Netanya',        'Netanya'),
  ('פתח-תקוה',         'Petaj Tikva',    'Petaj Tikva'),
  ('ריגא',             'Riga',           'Riga'),
  ('שאנגהאי',          'Shanghái',       'Shanghái'),
  ('בכפר חב',          'Kfar Jabad',     'en Kfar Jabad'),
  ('ב',                null,             'una letra suelta: no es un lugar'),
  ('ש',                null,             'una letra suelta: no es un lugar');

-- Los que NO toco y quiero que mires vos.
drop table if exists sin_decidir;
create temp table sin_decidir (valor text, por_que text);
insert into sin_decidir values
  ('עחה"פ', 'parece ע'' חה"פ, víspera de Pésaj: sería una FECHA, no un lugar'),
  ('בייפ',  'no lo sé leer'),
  ('מחנה גן ישראל על יד המרכז לעניני חינוך, עלענוויל, נ.י.',
            'es un campamento en Ellenville N.Y.: lugar de verdad, largo pero bueno');


-- ---------------------------------------------------------------------------
--  2 · LOS TÍTULOS QUE NO SON UN NOMBRE
-- ---------------------------------------------------------------------------
drop table if exists titulos;
create temp table titulos (palabra text primary key);
insert into titulos values
  ('הרה"ח'),('הרה"ג'),('הרה'),('הרה'''),('הרח'),('הרש'),('הרב'),
  ('הוו"ח'),('הוו'),('הוו'''),('הווי'),('הו'),('ה"ה'),('האברך'),
  ('כבוד'),('לכבוד'),('מוה"ר'),('מוהר'),('מוה'),('מוה'''),('מהור'),('מהר'),
  ('מר'),('מרת'),('אי"א'),('נו"נ'),('אנ'),('לאנ'),('באה'),('הנו'),
  ('הבתו'),('הד'),('בי'),('שב'),('מכתבה'),('אל'),
  -- AGREGADOS DESPUÉS DE MIRAR EL BLOQUE 2c DE LA MEDICIÓN DEL 9/11.
  -- Mi lista estaba corta: éstos se quedaban como si fueran nombres y no lo
  -- son. Son tres familias:
  --   · títulos cortados a mitad de palabra: להרה, להררמ, מהורמ, מהורנ,
  --     מהורש, מוהרב, מוהרצ, הוויי, תל, מחוי
  --   · bendiciones que van DESPUÉS del nombre, no en lugar de él:
  --     שיחיו, תחי
  --   · sustantivos genéricos sin nombre detrás: הנהלת («la dirección
  --     de…»), התלמיד («el alumno»), האברכים, ידידי («mi amigo»), ועד
  --     («el comité de…»), חברה («la sociedad…»), ד"ר a secas, כו, אני
  --
  -- Agregar estos NO pone en riesgo los nombres: la regla sólo vacía cuando
  -- no queda NADA. `ועד כפר חב"ד` pierde el `ועד` y conserva el resto, así
  -- que se queda.
  ('להרה'),('להררמ'),('מהורמ'),('מהורנ'),('מהורש'),('מוהרב'),('מוהרצ'),
  ('הוויי'),('תל'),('מחוי'),('שיחיו'),('תחי'),('הנהלת'),('התלמיד'),
  ('האברכים'),('ידידי'),('ועד'),('חברה'),('ד"ר'),('כו'),('אני'),
  -- `מוהייר` es `מוה"ר` con la comilla escrita como dos yods Y una `ه`
  -- ÁRABE adentro. Por la letra árabe no entró en el mapa de la comilla.
  ('מוهייר'),
  -- SEGUNDA PASADA, del bloque 2c del 9/11. Los que quedaban y no son
  -- nombres: `כת"ר` («su honorable Torá») es una forma de tratamiento, no
  -- un nombre; `עוסק בצ"צ` («que se ocupa de las necesidades de la
  -- comunidad») es una descripción; el resto son fragmentos cortados.
  ('כת"ר'),('עוסק'),('בצ'),('הבאים'),('עה'),('או'),('הור''ח'),
  ('התמים'),('יכו'),('מהו'),('מחו'),('רב'),('יקרו'),
  -- Las bendiciones que acompañan al nombre: `שי'` (שיחיה, que viva),
  -- `תי'`/`תחי'` para femenino. **Van siempre DESPUÉS del nombre**, nunca en
  -- su lugar, así que sacarlas no puede dejar sin destinatario a una carta
  -- que lo tenga: `שמואל שי'` conserva `שמואל`. Lo único que vacían es el
  -- caso donde no hay más que un tratamiento y la bendición, como
  -- `כת"ר שי'`.
  ('שי'),('תי'),('תח'),('שיחי'),('שתחי'),('הי'),
  ('ה'),('ב'),('ד'),('כ'),('ש'),('מו'),('ו'),('אי'),('וו');

-- Qué queda de un destinatario después de sacarle los títulos, la puntuación
-- y los puntos suspensivos.
drop table if exists restos;
create temp table restos as
select c.id, c.libro_id, c.pagina_inicio, btrim(c.destinatario) as valor,
       coalesce((
         select string_agg(p, ' ')
         from (select btrim(x, '.,;:()[]''"־–—') as p
               from regexp_split_to_table(
                      regexp_replace(btrim(c.destinatario), '\.{2,}', ' ', 'g'),
                      '[[:space:]]+') as x) y
         where length(p) >= 2
           and not exists (select 1 from titulos t where t.palabra = p)
       ), '') as resto
from cartas c
where coalesce(btrim(c.destinatario), '') <> '';

drop table if exists a_vaciar;
create temp table a_vaciar as
select * from restos where btrim(resto) = '';


-- ---------------------------------------------------------------------------
--  3 · EL INFORME
-- ---------------------------------------------------------------------------
insert into informe
select 0, 0, case when (select aplicar from opciones)
                  then '>>> MODO APLICAR' else '>>> MODO PRUEBA · no cambio nada' end,
       'el interruptor es el renglón 2';

insert into informe
select 1, 1, '1 · lugares que el mapa cambia',
       (select count(*)::text from cartas c join mapa_lugar m
        on m.de = btrim(c.lugar) where m.a is not null);
insert into informe
select 1, 2, '    lugares que el mapa vacía (no son lugares)',
       (select count(*)::text from cartas c join mapa_lugar m
        on m.de = btrim(c.lugar) where m.a is null);
insert into informe
select 1, 3, '    valores distintos que quedarían al final',
       (select count(distinct coalesce(m.a, btrim(c.lugar)))::text
        from cartas c left join mapa_lugar m on m.de = btrim(c.lugar)
        where coalesce(btrim(c.lugar),'') <> ''
          and (m.de is null or m.a is not null));

insert into informe
select 2, 0, '=== 1b · cómo queda la lista de lugares ===', '';
insert into informe
select 2, row_number() over (order by count(*) desc, 1),
       '    «' || coalesce(m.a, btrim(c.lugar)) || '»', count(*) || ' cartas'
from cartas c left join mapa_lugar m on m.de = btrim(c.lugar)
where coalesce(btrim(c.lugar),'') <> '' and (m.de is null or m.a is not null)
group by coalesce(m.a, btrim(c.lugar))
order by count(*) desc limit 25;

insert into informe
select 3, 0, '=== 1c · los que NO toco, decidilos vos ===', '';
insert into informe
select 3, row_number() over (order by valor), '    «' || valor || '»', por_que
from sin_decidir order by valor;

insert into informe
select 4, 1, '2 · destinatarios que se vaciarían',
       (select count(*)::text from a_vaciar);
insert into informe
select 4, 2, '    valores distintos entre ésos',
       (select count(distinct valor)::text from a_vaciar);
insert into informe
select 4, 3, '    destinatarios que SE QUEDAN',
       (select count(*)::text from restos where btrim(resto) <> '');

insert into informe
select 5, 0, '=== 2b · los que se vaciarían, por valor ===',
       'ninguno de éstos tiene que ser un nombre';
insert into informe
select 5, row_number() over (order by count(*) desc, valor),
       '    «' || valor || '»', count(*) || ' cartas'
from a_vaciar group by valor order by count(*) desc, valor limit 40;

insert into informe
select 6, 0, '=== 2c · los MÁS CORTOS que SE QUEDAN ===',
       '⚠️ si alguno de éstos no es un nombre, falta un título en mi lista';
insert into informe
select 6, row_number() over (order by length(valor), valor),
       '    «' || valor || '»  queda: «' || resto || '»',
       count(*) || ' cartas'
from restos where btrim(resto) <> ''
group by valor, resto order by length(valor), valor limit 30;


-- ---------------------------------------------------------------------------
--  4 · APLICAR
-- ---------------------------------------------------------------------------
do $$
declare n int; m int;
begin
  if not (select aplicar from opciones) then return; end if;

  insert into respaldo_lugar_dest (id, lugar, destinatario)
  select c.id, c.lugar, c.destinatario from cartas c
  where exists (select 1 from mapa_lugar k where k.de = btrim(c.lugar))
     or exists (select 1 from a_vaciar v where v.id = c.id)
  on conflict (id) do nothing;

  update cartas c set lugar = m.a
    from mapa_lugar m where m.de = btrim(c.lugar)
      and c.lugar is distinct from m.a;
  get diagnostics n = row_count;

  update cartas c set destinatario = null
    from a_vaciar v where v.id = c.id;
  get diagnostics m = row_count;

  insert into informe values (7, 1, '>>> APLICADO',
    n || ' lugares · ' || m || ' destinatarios vaciados');
  insert into informe values (7, 2, '    para volver atrás',
    'select * from volver_atras_lugar_dest();');
end $$;

select que, cuanto from informe order by orden, clave;
