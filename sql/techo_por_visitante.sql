-- ===========================================================================
--  UN TECHO POR VISITANTE
--
--  Versión: 2026-11-13.  Correr en Supabase -> SQL Editor.
--  Crea una tabla y una función. **No toca ninguna carta.**
--
--  ---------------------------------------------------------------------------
--  QUÉ PROBLEMA RESUELVE
--
--  Hoy el sitio tiene un solo techo de gasto: `consumir_cuota`, que cuenta
--  cuántas llamadas a Gemini se hicieron en el día, para todo el mundo junto.
--  Eso te protege la cuenta, y está bien.
--
--  Pero tiene un costado que no se ve: **una sola persona puede gastarle el
--  día a todos los demás**. Trescientas búsquedas en un minuto desde una
--  computadora, y el resto de las visitas se queda sin búsqueda por
--  significado hasta mañana, sin que nada esté roto y sin que nadie se
--  entere. No hace falta mala intención: un script mal hecho alcanza.
--
--  Esto agrega el otro techo: por persona y por ventana corta. Los dos se
--  miran, y miden cosas distintas.
--
--  ---------------------------------------------------------------------------
--  NO SE GUARDA LA DIRECCIÓN IP DE NADIE
--
--  La aplicación no manda la IP: manda una huella irreversible (un SHA-256 de
--  la dirección con sal). Alcanza para distinguir a un visitante de otro, que
--  es lo único que hace falta. En esta tabla queda un revoltijo de letras.
--
--  Guardar la IP de cada persona que entra a leer cartas del Rebe sería
--  guardar un dato personal que no nos hace falta para nada.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1 · DÓNDE SE CUENTA
--
--  La cuenta va por (visitante, servicio, ventana). La ventana es un bloque
--  de tiempo fijo: todas las llamadas que caen en el mismo bloque suman al
--  mismo renglón, y cuando empieza el bloque siguiente se cuenta de nuevo
--  desde cero.
-- ---------------------------------------------------------------------------
create table if not exists cuota_por_visitante (
  visitante text        not null,
  servicio  text        not null,
  ventana   timestamptz not null,
  usado     int         not null default 0,
  primary key (visitante, servicio, ventana)
);

-- Para poder borrar lo viejo rápido.
create index if not exists cuota_por_visitante_ventana
  on cuota_por_visitante (ventana);

-- ---------------------------------------------------------------------------
--  2 · CUÁNTO SE PERMITE
--
--  Los topes viven en una tabla y NO se le pasan a la función. Si viajaran
--  como parámetro, alcanzaría con llamarla con un número enorme. Es la misma
--  decisión que ya está tomada en `limites`.
--
--  Los valores: una persona que busca a mano hace una búsqueda cada varios
--  segundos. Treinta por cada diez minutos es holgado para alguien que
--  investiga de verdad, y corta en seco a un script.
-- ---------------------------------------------------------------------------
create table if not exists limites_por_visitante (
  servicio         text primary key,
  tope             int not null,
  ventana_segundos int not null default 600
);

insert into limites_por_visitante (servicio, tope, ventana_segundos) values
  ('buscar',   30, 600),
  ('traducir', 40, 600)
on conflict (servicio) do nothing;

-- ---------------------------------------------------------------------------
--  3 · LA FUNCIÓN
--
--  Devuelve `true` si todavía le queda, `false` si se pasó. Suma uno en el
--  mismo movimiento: preguntar y contar tienen que ser una sola operación, o
--  dos pedidos simultáneos pueden pasar los dos.
--
--  `security definer` con `search_path` fijado. Lo primero hace falta para
--  que la función pueda escribir la tabla sin que la tabla esté abierta; lo
--  segundo es el renglón que evita el agujero clásico de Postgres, donde
--  alguien hace que una función con permisos de dueño use SU versión de algo.
--
--  SI NO HAY TOPE PUESTO PARA ESE SERVICIO, DEJA PASAR. Es a propósito: el
--  día que se agregue un servicio nuevo a la aplicación, que ande, y que el
--  techo se le ponga después a mano.
-- ---------------------------------------------------------------------------
create or replace function consumir_cuota_por_visitante(
  p_servicio  text,
  p_visitante text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tope    int;
  v_ventana int;
  v_inicio  timestamptz;
  v_usado   int;
begin
  if coalesce(btrim(p_visitante), '') = '' then return true; end if;

  select tope, ventana_segundos into v_tope, v_ventana
  from limites_por_visitante where servicio = p_servicio;

  if v_tope is null then return true; end if;   -- sin tope puesto: pasa

  -- El comienzo del bloque de tiempo en el que estamos.
  v_inicio := to_timestamp(
    floor(extract(epoch from now()) / v_ventana) * v_ventana
  );

  -- Preguntar y sumar en un solo movimiento. `on conflict ... do update`
  -- toma el candado de la fila, así que dos pedidos a la vez no pueden
  -- contar los dos como si fueran el primero.
  insert into cuota_por_visitante (visitante, servicio, ventana, usado)
  values (left(p_visitante, 64), p_servicio, v_inicio, 1)
  on conflict (visitante, servicio, ventana)
    do update set usado = cuota_por_visitante.usado + 1
  returning usado into v_usado;

  -- Limpieza barata: de vez en cuando, borrar lo que ya no sirve. Va adentro
  -- de la misma llamada para no necesitar una tarea programada, y sólo se
  -- hace una vez cada tanto para no pagarla en cada búsqueda.
  if random() < 0.01 then
    delete from cuota_por_visitante
    where ventana < now() - (v_ventana * 4) * interval '1 second';
  end if;

  return v_usado <= v_tope;
end $$;

-- ---------------------------------------------------------------------------
--  4 · QUIÉN LA PUEDE LLAMAR, Y QUIÉN NO PUEDE TOCAR LA TABLA
--
--  La función sí se puede llamar desde la aplicación. Las tablas NO se abren:
--  si alguien pudiera escribir `limites_por_visitante`, el techo no sería un
--  techo, y si pudiera escribir `cuota_por_visitante`, se borraría la cuenta.
-- ---------------------------------------------------------------------------
alter table cuota_por_visitante    enable row level security;
alter table limites_por_visitante  enable row level security;
-- Sin políticas: nadie entra por PostgREST. La función, al ser
-- `security definer`, entra igual porque corre con los permisos de su dueño.

revoke all on cuota_por_visitante   from anon, authenticated;
revoke all on limites_por_visitante from anon, authenticated;

grant execute on function consumir_cuota_por_visitante(text, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
--  5 · LA PRUEBA, QUE CORRE SOLA
--
--  Se llama a la función 35 veces con un visitante inventado y se mira en qué
--  número empezó a decir que no. Con el tope en 30, las primeras 30 tienen
--  que pasar y la 31 tiene que frenar. Al final se borra el visitante de
--  prueba, así que esto no deja nada atrás.
-- ---------------------------------------------------------------------------
do $$
declare
  v_falso   text := 'PRUEBA-' || md5(random()::text);
  v_tope    int;
  v_pasaron int := 0;
  v_primer_no int := 0;
  i int;
begin
  select tope into v_tope from limites_por_visitante where servicio = 'buscar';

  for i in 1 .. (v_tope + 5) loop
    if consumir_cuota_por_visitante('buscar', v_falso) then
      v_pasaron := v_pasaron + 1;
    elsif v_primer_no = 0 then
      v_primer_no := i;
    end if;
  end loop;

  delete from cuota_por_visitante where visitante = left(v_falso, 64);

  -- Esto no es un aviso que se pueda pasar por alto: si el corte no está
  -- donde tiene que estar, el archivo entero se cancela y no queda nada a
  -- medio aplicar. Un techo que no corta es peor que no tener techo, porque
  -- parece que está puesto.
  if v_pasaron <> v_tope or v_primer_no <> v_tope + 1 then
    raise exception
      'el techo por visitante NO está cortando donde debe: pasaron % de % y el primer "no" fue el %',
      v_pasaron, v_tope, v_primer_no;
  end if;

  raise notice 'probado: pasaron las primeras % y la % quedó afuera, como corresponde',
    v_pasaron, v_primer_no;
end $$;

-- ---------------------------------------------------------------------------
--  6 · EL INFORME
-- ---------------------------------------------------------------------------
select 'la función existe' as cosa,
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'consumir_cuota_por_visitante'
       ) then '✔ sí' else '⚠️ no' end as estado
union all
select 'tiene search_path fijado',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
              unnest(coalesce(p.proconfig, array[]::text[])) x
         where n.nspname = 'public' and p.proname = 'consumir_cuota_por_visitante'
           and x like 'search\_path=%'
       ) then '✔ sí' else '⚠️ no' end
union all
select 'los topes puestos',
       coalesce((select string_agg(servicio || ': ' || tope || ' cada ' ||
                                   (ventana_segundos/60) || ' min', ' · ' order by servicio)
                 from limites_por_visitante), 'ninguno')
union all
select 'RLS en las dos tablas nuevas',
       case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname='public' and c.relrowsecurity
                    and c.relname in ('cuota_por_visitante','limites_por_visitante')) = 2
            then '✔ prendido en las dos' else '⚠️ falta en alguna' end
union all
select 'visitantes contados ahora mismo',
       (select count(distinct visitante)::text from cuota_por_visitante);
