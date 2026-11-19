-- ===========================================================================
--  REVISIÓN DE SEGURIDAD DE LA BASE
--
--  Versión: 2026-11-12.  Correr en Supabase -> SQL Editor.
--  **No modifica NADA.** Sólo mira y da un veredicto por renglón.
--
--  ---------------------------------------------------------------------------
--  POR QUÉ ESTO VA PRIMERO
--
--  Revisé el backend entero (`servicios.js` y las cinco rutas de la API) y
--  encontré diez cosas para arreglar. Nueve las puedo ver leyendo el código.
--  **La décima no**, y es la más importante de todas: no puedo saber desde
--  acá si las tablas tienen RLS prendido.
--
--  Por qué eso decide todo lo demás. Tu sitio está bien armado en un punto
--  clave: el navegador nunca le habla a Supabase, siempre pasa por `/api`, y
--  la clave vive en una variable de entorno de Vercel. Pero Supabase expone
--  TODAS las tablas por HTTP a través de PostgREST, y lo único que decide
--  quién puede leerlas y escribirlas es RLS más los permisos. Si RLS está
--  apagado, la puerta está abierta y no la cierra ninguna mejora que yo le
--  haga a las rutas, porque el que entra no pasa por las rutas.
--
--  Así que esto primero. Según lo que diga, el resto del trabajo cambia.
-- ===========================================================================

drop table if exists pg_temp.seg;
create temp table seg (orden int, clave int, cosa text, estado text, que_hacer text);

-- ---------------------------------------------------------------------------
--  1 · ¿EXISTEN LOS ROLES QUE USA SUPABASE?
--      `anon` es el rol de la clave pública. `service_role` salta RLS por
--      diseño. Saber cuáles existen hace falta para interpretar el resto.
-- ---------------------------------------------------------------------------
insert into seg values (1, 0, '=== LOS ROLES ===', '', '');
insert into seg
select 1, 1, '  rol ' || r, case when exists (select 1 from pg_roles where rolname = r)
                                 then 'existe' else 'no existe' end, ''
from unnest(array['anon','authenticated','service_role']) as r;

-- ---------------------------------------------------------------------------
--  2 · RLS TABLA POR TABLA
--
--      Lo que hay que entender: RLS prendido SIN políticas no rompe tu sitio
--      si la clave es `service_role`, porque ese rol salta RLS. Y si la clave
--      es `anon`, hacen falta políticas de SELECT para que el sitio lea.
--      Por eso el veredicto de abajo depende de cuál clave usás, y te lo
--      aclaro en el informe en vez de adivinar.
-- ---------------------------------------------------------------------------
insert into seg values (2, 0, '=== RLS EN CADA TABLA ===', 'estado', 'políticas');
insert into seg
select 2, row_number() over (order by c.relname),
       '  ' || c.relname,
       case when c.relrowsecurity and c.relforcerowsecurity then '✔ prendido y forzado'
            when c.relrowsecurity                           then '✔ prendido'
            else '⚠️ APAGADO' end,
       case when not c.relrowsecurity
            then 'cualquiera con la clave pública lee y ESCRIBE esta tabla'
            else (select count(*) from pg_policies p
                  where p.schemaname = 'public' and p.tablename = c.relname)::text
                 || ' política(s)' end
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- ---------------------------------------------------------------------------
--  3 · QUÉ PUEDE HACER `anon` EN CADA TABLA
--
--      Esto es independiente de RLS y se olvida seguido: si `anon` no tiene
--      el permiso, no entra ni con RLS apagado; y si lo tiene, RLS es lo
--      único que lo frena. Un INSERT, UPDATE o DELETE acá es un problema,
--      porque tu sitio es de sólo lectura: todo lo que escribe lo hace a
--      través de funciones.
-- ---------------------------------------------------------------------------
drop table if exists pg_temp.permisos;
create temp table permisos as
select c.relname as tabla, coalesce(r.rolname, 'PUBLIC') as quien, a.privilege_type as permiso
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(c.relacl) a
left join pg_roles r on r.oid = a.grantee
where n.nspname = 'public' and c.relkind = 'r'
  and coalesce(r.rolname, 'PUBLIC') in ('anon', 'authenticated', 'PUBLIC');

insert into seg values (3, 0, '=== PERMISOS DE anon Y authenticated ===', 'puede', '');
insert into seg
select 3, row_number() over (order by quien, tabla), '  ' || quien || ' → ' || tabla,
       string_agg(permiso, ', ' order by permiso),
       case when bool_or(permiso in ('INSERT','UPDATE','DELETE','TRUNCATE'))
            then '⚠️ puede escribir: sólo es seguro si RLS está prendido y ninguna política lo permite'
            else 'sólo lectura' end
from permisos group by quien, tabla order by quien, tabla;

insert into seg
select 3, 900, '  (ningún permiso directo para anon ni authenticated)',
       '✔ bien', 'entonces entran sólo por las funciones'
where not exists (select 1 from permisos);

-- ---------------------------------------------------------------------------
--  4 · LAS POLÍTICAS QUE HAY, Y SI ALGUNA DEJA ESCRIBIR
-- ---------------------------------------------------------------------------
insert into seg values (4, 0, '=== LAS POLÍTICAS, UNA POR UNA ===', 'para qué', 'a quién');
insert into seg
select 4, row_number() over (order by tablename, policyname),
       '  ' || tablename || ' · ' || policyname,
       cmd || case when cmd in ('ALL','INSERT','UPDATE','DELETE') then '  ⚠️ ESCRIBE' else '' end,
       coalesce(array_to_string(roles, ', '), 'todos')
       || case when coalesce(qual, 'true') = 'true' and cmd in ('ALL','SELECT')
               then ' · sin condición (deja ver todo)' else '' end
from pg_policies where schemaname = 'public'
order by tablename, policyname;

insert into seg
select 4, 900, '  (no hay ninguna política)', '',
       'con RLS prendido eso significa: nadie entra, salvo service_role'
where not exists (select 1 from pg_policies where schemaname = 'public');

-- ---------------------------------------------------------------------------
--  5 · LAS FUNCIONES: EL AGUJERO CLÁSICO DE POSTGRES
--
--      Una función `SECURITY DEFINER` corre con los permisos del dueño, o
--      sea que salta RLS a propósito: así es como tu sitio escribe
--      traducciones sin abrir la tabla. Está bien que sea así.
--
--      Pero una `SECURITY DEFINER` **sin `search_path` fijado** es un hueco
--      conocido: quien pueda crear una tabla o una función en un esquema que
--      esté antes en el camino de búsqueda puede hacer que la función use SU
--      versión de algo y correrla con los permisos del dueño. Se arregla con
--      una línea: `set search_path = public, pg_temp`.
-- ---------------------------------------------------------------------------
insert into seg values (5, 0, '=== FUNCIONES ===', 'cómo corre', 'search_path');
insert into seg
select 5, row_number() over (order by p.proname),
       '  ' || p.proname
       || case when exists (select 1 from pg_roles where rolname = 'anon')
                    and has_function_privilege('anon', p.oid, 'EXECUTE')
               then '  (anon la puede llamar)' else '' end,
       case when p.prosecdef then 'SECURITY DEFINER (salta RLS)' else 'security invoker' end,
       case when not p.prosecdef then '—'
            when exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) x
                         where x like 'search\_path=%')
                 then '✔ fijado'
            else '⚠️ NO FIJADO · agregarle: set search_path = public, pg_temp' end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
order by p.proname;

-- ---------------------------------------------------------------------------
--  6 · LAS VISTAS
--      Una vista sin `security_invoker` corre con los permisos de su dueño,
--      así que puede mostrar filas que RLS debería tapar.
-- ---------------------------------------------------------------------------
insert into seg values (6, 0, '=== VISTAS ===', '', '');
insert into seg
select 6, row_number() over (order by c.relname), '  ' || c.relname,
       case when coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=t%'
            then '✔ security_invoker' else '⚠️ corre como su dueño' end,
       case when coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=t%'
            then '' else 'si la tabla de abajo tiene RLS, la vista lo esquiva' end
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
order by c.relname;
insert into seg
select 6, 900, '  (no hay vistas)', '✔', ''
where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind = 'v');

-- ---------------------------------------------------------------------------
--  7 · EL TECHO DE GASTO
--
--      `consumir_cuota` es lo único que impide que una tarde de visitas
--      —o una sola persona con malas intenciones— te vacíe la cuota de
--      Gemini. Dos cosas tienen que ser ciertas: que la función exista, y
--      que la tabla `limites` NO sea escribible desde afuera. Si alguien
--      puede hacerle UPDATE a `limites`, el techo no es un techo.
-- ---------------------------------------------------------------------------
insert into seg values (7, 0, '=== EL TECHO DE GASTO ===', '', '');
insert into seg
select 7, 1, '  función consumir_cuota',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = 'consumir_cuota')
            then '✔ existe' else '⚠️ NO EXISTE · el gasto no tiene techo' end, '';
insert into seg
select 7, 2, '  tabla limites',
       case when exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = 'public' and c.relname = 'limites')
            then '✔ existe' else '⚠️ no existe' end, '';
insert into seg
select 7, 3, '  ¿anon puede escribir limites?',
       case when exists (select 1 from permisos where tabla = 'limites'
                           and quien in ('anon','PUBLIC')
                           and permiso in ('INSERT','UPDATE','DELETE'))
            then '⚠️ SÍ · el techo se puede levantar desde afuera'
            else '✔ no' end, '';
insert into seg
select 7, 4, '  los límites puestos hoy',
       coalesce((select string_agg(x.t, ' · ') from (
          select servicio || ': ' || tope::text as t
          from limites order by servicio) x), 'la tabla está vacía: no hay ningún tope puesto'), ''
where exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'limites')
  and exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='limites' and column_name='tope');

-- ---------------------------------------------------------------------------
--  8 · RESUMEN
-- ---------------------------------------------------------------------------
insert into seg values (9, 0, '=== RESUMEN ===', '', '');
insert into seg
select 9, 1, '  tablas con RLS APAGADO',
       (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
       'si no es cero, esto es lo primero que hay que arreglar';
insert into seg
select 9, 2, '  funciones SECURITY DEFINER sin search_path',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) x
                          where x like 'search\_path=%')),
       'cada una se arregla con un renglón';
insert into seg
select 9, 3, '  tablas que anon puede ESCRIBIR directo',
       (select count(distinct tabla)::text from permisos
        where quien in ('anon','PUBLIC')
          and permiso in ('INSERT','UPDATE','DELETE','TRUNCATE')),
       'tu sitio no necesita ninguna: escribe por funciones';

select cosa, estado, que_hacer from seg order by orden, clave;
