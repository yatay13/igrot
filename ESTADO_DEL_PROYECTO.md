# Buscador de las Igrot Kodesh — estado del proyecto

**Versión de este documento: 2026-10-12.**

Esto es para que el proyecto se pueda retomar desde cero, con cualquiera y en
cualquier momento, sin depender de que yo recuerde nada. Mi memoria de trabajo
se borra: ya se borró tres veces durante este proyecto, y las tres veces se
perdieron archivos que no estaban guardados en ningún lado. Este documento es
la defensa contra eso.

**Guardalo en tu Drive, junto a los cuadernos.** Si alguna vez empezás una
conversación nueva conmigo sobre esto, pegame este archivo primero y arrancamos
donde estábamos.

---

## 1. Qué es el proyecto

Un buscador con inteligencia artificial y memoria vectorial sobre las **Igrot
Kodesh**, las cartas del Rebe de Lubavitch. Se puede buscar por significado
(no sólo por palabras exactas) y filtrar por tomo, fecha, año, festividad y
tema. Las cartas se pueden traducir a varios idiomas.

Las cartas empiezan con **ב"ה** y terminan con la firma del Rebe. Eso es lo que
permite cortarlas automáticamente dentro de un tomo.

### Restricciones permanentes

- **No usar nada de la otra conversación** donde se mandó el mismo pedido al
  principio. Todo se rehízo de cero acá.
- Ariel trabaja en **Windows con PowerShell** y tiene poca experiencia de
  terminal y de despliegue. Todo lo que tenga que hacer él va explicado
  **paso a paso, con los clics**, sin suponer conocimientos previos. Esto no
  hace falta pedirlo: va siempre.
- **Un archivo por mensaje**, y decir si es para **PEGAR** (un `.py`, va dentro
  de una celda de Colab) o para **SUBIR** (un `.ipynb`, va con
  `Archivo → Subir notebook`, nunca se abre ni se copia). Esta regla salió de
  un error real: se pegó el JSON de un `.ipynb` dentro de una celda y dio
  `NameError: name 'null' is not defined`.

---

## 2. Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Cuadernos de Colab | El Drive de Ariel |
| PDFs de los tomos | `MyDrive/igrot_cartas` |
| Cartas sueltas (2.152 PDFs) | Drive, carpeta de cartas sueltas |
| Cartas cortadas y enriquecidas | `MyDrive/igrot_enriquecidas/cartas_enriquecidas.jsonl` |
| Vectores | `MyDrive/igrot_enriquecidas/vectores.jsonl` |
| Base de datos | Supabase (tablas `libros`, `cartas`, `chunks`, `traducciones`) |
| Sitio web | Repositorio `github.com/yatay13/igrot`, desplegado en Vercel |

### Los cuadernos

1. **`02_segmentar_cartas.ipynb`** — corta los PDFs en cartas. Secciones 15 a 19
   son las de las cartas sueltas.
2. **`03_enriquecer_con_gemini.ipynb`** — le pide a Gemini el resumen en
   castellano, los temas, el destinatario y la fecha cuando falta.
3. **`04_vectores_y_base.ipynb`** — genera los vectores y sube todo a Supabase.

### Los módulos de código

Viven **embebidos dentro de los cuadernos** con `%%writefile`, y es así a
propósito: el cuaderno es lo único que sobrevive a que se recicle el contenedor.

- `segmentador.py` — corta un tomo en cartas. Tiene la tabla
  `FESTIVIDADES_TEXTO` con los 23 nombres canónicos de festividad.
- `cartas_sueltas.py` — corta las cartas sueltas, que son otro problema
  (ver sección 4).
- `enriquecedor.py` — arma el pedido a Gemini y aplica la respuesta.
- `cargador.py` — arma las filas y las sube a Supabase.
- `texto_legado.py` — arregla el hebreo mal codificado.

---

## 3. En qué estado está (al 2026-10-09)

| Cosa | Estado |
|---|---|
| Cartas en la base | **7.717** en **18 libros** |
| Con fecha | 6.710 (86%), de 1924 a 1981 |
| Con resumen en castellano | 7.717 (100%) |
| Vectores en español | 7.717 (100%) |
| **Vectores en hebreo** | **7.717 (100%)** — terminado el 2026-10-11 |
| Pedazos vectorizados en total | 19.178 (7.719 en español, 11.461 en hebreo) |
| Tiempo de una búsqueda | 0,06 s (antes del arreglo del 11/10: 11,46 s) |
| Etiquetas de tema | 175 |
| Fechas/festividades | 29 |
| Cartas sin ningún tema | 57 |
| Cartas invisibles a los dos filtros | 2 (ya venían así de Gemini) |
| Tomos escaneados sin OCR | 15 (tomos 3 a 9 y 13 a 19), 7.139 páginas |

---

## 4. Las decisiones técnicas que costaron encontrar

Esta es la sección que más vale. Cada una de estas salió de un error real y
volver a tropezar con ellas cuesta horas.

### El hebreo mal codificado
Los PDFs viejos traen bytes **cp1255 leídos como mac_roman**. Se arregla con
`linea.encode('mac_roman').decode('cp1255')`. Y la letra **נ se convierte en
U+F8FF**, un carácter privado de Apple que **se pierde al copiar y pegar**.

### Orden visual contra orden lógico
Son **dos problemas distintos** y se confunden fácil:
- renglón entero al revés → lo arregla `texto_legado`;
- palabras en orden invertido → lo arregla el segmentador.

El detector más confiable, porque no depende del contenido, son las **letras
finales ךםןףץ**: si aparecen al principio de una palabra, el texto está
espejado.

### Las cartas sueltas NO se cortan con `sg.segmentar`
`sg.segmentar` está hecho para un tomo y **devuelve 0 cartas** en una carta
suelta de verdad, porque `descartar_introduccion` tira los bloques que no
tienen número impreso, fórmula de cierre y firma. Hay que usar las piezas de
abajo (`_construir_documento`, `encontrar_limites`, `_analizar_carta`)
directamente, que es lo que hace `cartas_de_un_archivo`.

### El corte por numeración no sirve en un PDF de una página
Hay dos evidencias para cortar: los marcadores **ב"ה** y la **cadena de
numeración correlativa**. En un PDF de una página la cadena no significa nada
—agarra años y números de página— y producía 5 "cartas" donde había 2. De ahí
`solo_aperturas_bh=True`.

### Los meses del nombre del archivo cuentan desde Tishrei
`5718-03-06` → mes 3 = **Kislev**. Medido: 91% de acuerdo sobre 122
comparables, ~90% sobre 1.948, y confirmado contra dos cartas reales.

### Un solo rango de años válido, en los tres módulos
`ANIO_MIN, ANIO_MAX = 5680, 5755` (1920–1995). Que el enriquecedor usara otro
rango produjo el informe absurdo «AÑOS CUBIERTOS: de 1924 a 2021».

### El `drive.mount` de Colab
Los tres controles de Colab corren **antes** de mirar `force_remount`, así que
`force_remount=True` **no sirve** para montar sobre una carpeta con archivos:
sólo sirve para rehacer un montaje que ya existe. Lo único que resuelve una
carpeta que estorba es **correrla a un lado**. Y hay que comprobar
`os.path.ismount`: sin eso, una carpeta común llamada `MyDrive` se hace pasar
por Drive y todo lo demás busca los archivos en una carpeta vacía.

### Supabase y PostgREST
- `select=count` dispara un `count(*)` completo → **timeout 57014**. Para saber
  si una tabla existe hay que preguntar `select=*` con `limit=1`.
- **`42703`** («no existe la columna») significa que la **tabla sí existe**.
  404 es la tabla que falta.
- `traducciones` tiene clave compuesta `(carta_id, idioma)` y **no tiene `id`**.
- El editor SQL de Supabase muestra **filas**, no `raise notice`, y sólo el
  resultado de la **última** instrucción. Todo diagnóstico tiene que ser una
  consulta que devuelve filas.

### Las dos ortografías de las festividades
**Esta es la trampa más sutil del proyecto.** Los temas los escribe Gemini y las
festividades las detecta `segmentador.py` del hebreo, con dos transliteraciones
distintas:

| Tema (Gemini) | Festividad (canónica) |
|---|---|
| Yud Tet Kislev | Iud-Tet Kislev |
| Jánuca | Janucá |
| Yom Kipur | Iom Kipur |
| Lag Baomer | Lag BaOmer |
| Rosh Jodesh | Rosh Jódesh |
| Yud Shevat | Iud Shvat |
| Yud Bet Tamuz | Iud-Bet Tamuz |

Comparar los dos textos literalmente da **cero coincidencias** y hace parecer
que ninguna carta tiene la festividad anotada. Yo me comí ese error y por poco
dejo el desplegable con pares de entradas gemelas.

### El filtro de festividades miraba una sola columna
`buscar_cartas` filtraba sólo por `c.festividades` y `facetas_de_cartas` armaba
el desplegable sólo con esa columna. **`festividades_mencionadas` no la leía
nadie**, con cientos de cartas adentro. Ya está arreglado: las dos funciones
leen las dos columnas.

Lo que quieren decir las dos columnas:
- `festividades` → la carta está **fechada** en esa festividad;
- `festividades_mencionadas` → la carta **habla** de esa festividad.

### El índice vectorial estaba y la consulta no lo usaba

Al subir los vectores en hebreo, toda búsqueda empezó a cortarse por tiempo
(`57014 statement timeout`). **Es la trampa más cara del proyecto y la más
difícil de ver**, porque todo parecía estar en su lugar.

Medido parte por parte, la rama semántica se llevaba **15,72 segundos** y las
otras tres juntas 0,74. Y el índice `chunks_embedding_idx` **ya existía**: no
faltaba nada.

La culpa era de la FORMA de la consulta:

    order by min(ch.embedding <=> consulta_embedding)   -- sobre un group by

Cuando el orden se calcula sobre un resultado **agrupado**, un índice vectorial
no se puede usar. Postgres lo ignoraba y leía los 364 MB de vectores en cada
búsqueda. Antes andaba porque la tabla entraba en la memoria del plan gratuito;
al subir el hebreo dejó de entrar.

El arreglo son dos pasos en vez de uno: primero `cercanos` pide los N vectores
más parecidos sin agrupar y **sin filtrar** —esa es la única forma que el
índice sabe resolver—, y recién después se agrupa por carta y se aplican los
filtros. Resultado: de 11,46 s a **0,06 s**.

**Y el filtro tiene que ir DESPUÉS, no adentro del `where`.** Lo probé de las
dos maneras: con el filtro adentro y un filtro ANCHO el índice se usa, pero con
un filtro ANGOSTO —el caso que más importa— el planificador decide recorrer
todo y vuelve a los 15 segundos. No se puede forzar desde la consulta.

Lo que eso cuesta: al filtrar después, la parte semántica mira los más
parecidos de todo el corpus y recién ahí descarta. Con un filtro angosto quedan
pocos. Se amortigua con `alter role anon set hnsw.ef_search = 200`.

**Y una medición vale por dos teorías.** La primera vez diagnostiqué «falta el
índice» y era falso; el índice estaba. Reproducir la tabla con 19.178 vectores
de 1536 dimensiones y mirar el plan de ejecución fue lo que lo resolvió.

### Cómo medir tiempos dentro de una consulta

Las CTE **no garantizan orden de ejecución**. Un diagnóstico que tomaba la hora
entre una parte y la siguiente con CTE encadenadas me dio un tiempo
**negativo**. Para medir hay que usar un bloque `do`, donde las instrucciones
sí corren en orden, y volcar los resultados a una tabla temporal que se
consulta al final.

### ⚠️⚠️ ESTO YA PASÓ, Y NO AVISÓ

El 12 de octubre una carga dejó la base como estaba una semana antes: 226
etiquetas de tema en vez de 175, las fechas de vuelta entre los temas, y las
1.780 cartas sin su fecha/festividad. **Nada avisó.** Se descubrió de casualidad
porque un número de un resumen no cerraba.

Las tres señales de que pasó, para reconocerlo rápido:

| | Arreglado | Si volvió atrás |
|---|---|---|
| Etiquetas de tema distintas | 122 | 226 |
| Cartas sin ningún tema | 58 | 2 |
| `mujeres de Jabad` | no existe | 13 cartas |

**La defensa es `despues_de_cada_carga.sql`**: un solo archivo que rehace los
tres arreglos en orden. Correlo DESPUÉS DE CADA CARGA que toque `cartas`. Es
idempotente: si no hay nada que rehacer, toca 0 cartas.

### ⚠️ La sección 7 del cuaderno 04 borra el trabajo manual
`fila_de_carta` escribe `temas` y `festividades` **leyendo el .jsonl**. Así que
subir con la sección 7 **deshace** cualquier arreglo hecho por SQL sobre esas
dos columnas — como el movimiento de las 1.780 cartas.

**Regla:** después de cada carga con la sección 7, correr
`despues_de_cada_carga.sql` — **ese solo archivo, no dos.** Su paso 1 pliega
las 84 etiquetas y su paso 2 mueve las 22 fechas de `temas` a `festividades`,
así que ya incluye lo que antes hacían `plegar_temas_sinonimos.sql`,
`normalizar_temas_2026_10.sql` y `mover_fechas_de_temas_a_festividades.sql`
por separado. Es idempotente: si no hay nada que rehacer, toca 0 cartas.
(El 19/10 le dije a Ariel que había que correr dos archivos. Era la nota
vieja de esta sección, escrita antes de que los tres se consolidaran en uno.)

---

## 5. Los archivos SQL, y para qué sirve cada uno

Todos se corren en **supabase.com → SQL Editor → New query → pegar → Run**.

| Archivo | Qué hace | ¿Cambia datos? |
|---|---|---|
| `arreglar_filtro_de_festividades.sql` | Reemplaza `buscar_cartas` y `facetas_de_cartas` para que lean las dos columnas | No toca filas |
| `mover_fechas_de_temas_a_festividades.sql` | Saca las etiquetas de fecha de `temas` y las pone en `festividades`, traduciendo la ortografía | **Sí.** Tiene freno: `values (false)` |
| `control_despues_del_movimiento.sql` | Lista todos los temas, todas las fechas y tres números de salud | No |
| `diagnostico_temas_y_festividades.sql` | Mide por qué los temas clasifican mal | No |
| `normalizar_temas_2026_10.sql` | Plegó 30 etiquetas sinónimas (226 → 196). Ya aplicado | **Sí.** Con freno |
| **`despues_de_cada_carga.sql`** | **Rehace los tres arreglos de temas y fechas. CORRELO DESPUÉS DE CADA CARGA** | **Sí.** Con freno |
| `estado_despues_de_cargar_las_sueltas.sql` | El estado general de la base | No |
| `arreglar_la_busqueda_lenta.sql` | Reescribe la rama semántica para que use el índice, y sube `hnsw.ef_search`. **Ya aplicado el 11/10** | No toca filas |
| `medir_por_que_tarda_la_busqueda.sql` | Mide las cuatro partes de `buscar_cartas` por separado | No |
| `control_despues_de_los_vectores.sql` | Vectores por idioma, si el movimiento de fechas sigue en pie, índices | No |

**El freno de mano:** los que cambian datos tienen, cerca del principio, un
renglón `opciones(aplicar) as (values (false)),`. Así como está sólo muestra lo
que haría. Para aplicarlo se cambia `false` por `true` y se corre de nuevo.

---

## 6. El sitio web

`github.com/yatay13/igrot`, Next.js 14 (App Router), desplegado en Vercel.

### Cómo está armado
- `app/page.js` — toda la interfaz. Es un componente de cliente.
- `app/lib/servicios.js` — **todo lo que habla con Supabase y Gemini**. Sólo
  corre en el servidor: las claves nunca llegan al navegador.
- `app/api/buscar`, `carta`, `facetas`, `traducir`, `version` — las cinco rutas.
- `app/globals.css` — los estilos.
- `app/layout.js` — las tipografías y los metadatos.

### Las tres variables de entorno
Van en **Vercel → Settings → Environment Variables**, no en un archivo:
`SUPABASE_URL`, `SUPABASE_KEY` (la **anon**, nunca la service_role) y
`GEMINI_API_KEY`.

### Los arreglos de seguridad del 2026-10-08
Están explicados en detalle en `CAMBIOS.md`, dentro del repositorio. En
resumen: falta de `.gitignore`, envenenamiento del caché de traducciones,
entradas sin tope, errores crudos filtrados al navegador, cabeceras de
seguridad, y nueve archivos viejos en la raíz.

### Cómo sube Ariel los cambios
**Por la web de GitHub**, no con git: no tiene una copia local conectada. Eso
significa dos cosas:
1. La web **sólo agrega y reemplaza, nunca borra**: los archivos a borrar hay
   que borrarlos a mano, uno por uno.
2. Al subir hay que arrastrar **el contenido** de la carpeta, nunca la carpeta
   misma, o queda anidada y el sitio se rompe.

---

## 7. Lo que falta, en orden

### Terminado

- ~~Vectores en hebreo~~ — 7.717 de 7.717, subidos el 11/10.
- ~~La búsqueda que se cortaba por tiempo~~ — arreglada el 11/10, 0,06 s.
- ~~El plegado de sinónimos de los temas~~ — aplicado el 12/10: 175 → 122
  etiquetas, 75 cartas. Ya está incluido en `despues_de_cada_carga.sql`.
- ~~Subir el sitio a GitHub~~ — hecho el 12/10. Subió dos veces el contenido
  en vez de la carpeta; se arregló borrando la raíz por lista blanca y
  editando a mano los cinco archivos anidados.
- ~~La prueba del OCR~~ — sección 20, 20 páginas, el 12/10:
  `gemini-flash-lite-latest`, 100% hebreo, 1.290 + 689 tokens por página,
  7,6 s por página, DPI 200 alcanza. Unos US$10 si se paga; gratis, entre 8 y
  36 días según el límite diario real, que no se puede averiguar de otra
  manera que chocándose.

- ~~El OCR de los 14 tomos~~ — **TERMINADO el 15/10: 6.627 páginas.**
  543+558+379+400+428+400+368+556+592+496+410+398+607+492. El tomo 12 sigue
  afuera a propósito. Entre el 22% y el 30% de las páginas quedaron marcadas
  por letras de otro alfabeto dentro de palabras hebreas: eso es lo que mide
  la sección 22, y se decide antes de seguir.

### Pendiente

> **LO QUE QUEDA ABIERTO AL 19/10, en orden** (lo de abajo es el historial
> completo, que es largo; esto es el frente de trabajo de hoy):
>
> 1. **El filtro de festividades en dos grupos** («Pésaj — fechadas» /
>    «Pésaj — la mencionan»), que es la decisión 1 de Ariel. **Bloqueado
>    esperando la salida de `que_funciones_usa_el_sitio.sql`**, que ya está
>    en manos de Ariel. Hay que cambiar `facetas_de_cartas` y
>    `buscar_cartas` DENTRO de Supabase, más el código del sitio. **Es el
>    único cambio de esta semana que puede romper el sitio**, y Ariel ya
>    está avisado de eso.
> 2. **La cola larga de 249 etiquetas** (decisión 2), incluidas las 12
>    formas rotas de `emuná`. Falta un archivo que LISTE las 249 para que
>    Ariel decida las de criterio; la parte mecánica (caracteres de otro
>    alfabeto) la propongo sola.
> 3. **Meter el plegado de tildes dentro de `despues_de_cada_carga.sql`**,
>    entre el paso 1 y el paso 2, para que no haya que acordarse de
>    correrlo aparte.
> 4. **Los vectores en hebreo**: 7.717 de 13.613 (sección 5b del cuaderno
>    04). Son opcionales y van por tandas de cuota.
> 5. **Las 21 cartas del tomo 19 con `תש"יכ`** — el año queda 10 años
>    corrido. Es un UPDATE de SQL, chico.
> 6. **Re-cortar los tomos 25 a 32** para que las 116 cartas en ruso
>    lleguen al sitio.
> 7. Chicos y viejos: el límite de pedidos de Vercel en `/api/traducir`,
>    las 4 páginas a 120 DPI del tomo 5, y `inheritdoc` en la página 204
>    del tomo 14.

1. ~~Arreglar las letras de otro alfabeto~~ — **APLICADO el 16/10:
   5.934 palabras en 29 archivos.** Las copias quedaron como
   `<archivo>.antes-de-arreglar`. Queda confirmar con la sección 22 que
   «palabras mezcladas» bajó a 1.530 exactas.
   Los arreglos se reparten en tres grupos de magnitud muy distinta, lo que
   delata **tres procedencias de OCR**: los 14 tomos nuevos (Gemini vision)
   suman 5.693 (275 a 563 cada uno); los tomos 23 a 32 suman 241 (5 a 50); y
   los tomos **1, 2, 20, 21 y 22 tienen CERO** — ésos cinco, además, son los
   únicos cuyo nombre de archivo conserva el `.pdf` en el medio. Hipótesis:
   no fueron transcriptos por un modelo de visión sino de una capa de texto,
   y por eso no tienen contaminación entre alfabetos.
   Versión anterior, para referencia: medía 5.934 de 7.464 (79,5%). Las 1.530 que quedan son el 0,049% de las palabras
   del corpus: una cada 2.034. Hace copia (`.antes-de-arreglar`) antes de
   escribir. **Va antes de segmentar.**
   Lo que queda sin arreglar (1.530 apariciones, 0,049% de las palabras) es,
   casi todo, alfabetos sueltos que la tabla no cubre —siríaco (`ܒ` BETH), tailandés (`า` SARA AA), katakana, coreano, y
   nombres cirílicos y armenios que faltan: `BE`, `YU`, `GHE`, `VO`, `XEH`—.
   Agregarlos es sólo tabla, sin lógica nueva, y recuperaría tal vez un
   tercio. **No vale otra vuelta**: la ganancia es 0,017% de las palabras y
   cada vuelta en este archivo es otra oportunidad de meter un error (ya metí
   dos graves). Si alguna vez molesta en una búsqueda real, se hace entonces.
2. ~~Revisar el OCR antes de cortarlo~~ — hecho el 15/10, ver más abajo. —
   `PEGAR_EN_02_SECCION_22_REVISAR_EL_OCR.py`, enviada el 15/10. No gasta
   cuota y no escribe nada. Mide si las letras intrusas son siempre las
   mismas (si sí, hay tabla de reemplazos; si no, hay que decidir otra cosa),
   y de paso controla huecos de páginas y páginas donde el modelo explicó en
   vez de copiar. **Esto va antes de segmentar**: arreglar el texto después
   obliga a rehacer segmentación, enriquecido y vectores.
2. ~~Rehacer las cartas en ruso y las 7 contaminadas~~ — **HECHO el 16/10:
   122 de 123 páginas.** Las 116 rusas, todas, con **47.074 letras cirílicas
   recuperadas** (406 por página en promedio; la más larga, 1.249, en el tomo
   29 página 270). Antes había CERO: el texto estaba como latinas imitadas,
   ilegible e inencontrable. Y 6 de las 7 contaminadas con código.
   La que falta: **tomo 14, página 204**, que volvió con `inheritdoc` otra
   vez. Con `temperature: 0` el modelo es casi determinista, así que
   reintentar con el mismo modelo va a dar lo mismo; habría que cambiar de
   modelo. Es UNA palabra basura en UNA página de 13.456: se deja.
   `vale_la_pena_cambiar` rechazó esa única página. Sin ese control se habría
   guardado igual y nadie se habría enterado.
   Copias en `<archivo>.antes-de-rehacer`.
3. **EL CORPUS AHORA ES TRILINGÜE** (hebreo, ídish en letras hebreas, y ruso
   en cirílico), y eso toca lo que viene: la segmentación corta por ב״ה y por
   la firma, y 84 de las 116 rusas tienen encabezado hebreo, así que deberían
   cortarse bien; el enriquecido y los vectores son multilingües y no
   deberían sufrir; pero **una búsqueda escrita en castellano o hebreo no va
   a encontrar léxicamente una carta en ruso**. Hay que mirar cómo se
   comportan en el buscador una vez cargadas.
   `PEGAR_EN_02_SECCION_26_REHACER_LAS_RUSAS.py`, enviada el 16/10 con el
   freno `CONFIRMO_REHACER = False`. 116 páginas en ruso + 7 con código =
   123 páginas, unos 10 minutos y 123 pedidos de cuota. **LA CAUSA FUE EL
   PEDIDO QUE ESCRIBÍ YO**: la sección 21 le dice «Escribí SIEMPRE con letras
   hebreas», así que enfrentado a una página en cirílico el modelo no tenía
   permitido escribir cirílico e imitó con las letras que podía. No alucinó:
   obedeció una instrucción mal escrita. El `PEDIDO_CON_RUSO` nuevo nombra la
   imitación con las letras («no escribas «n» por «п»»).
   Protección clave: `vale_la_pena_cambiar` — ninguna página se guarda si no
   es mejor que la que había. **Mide LETRAS HEBREAS, no caracteres**: la
   primera versión medía caracteres y habría rechazado los arreglos
   correctos, porque quitarle las etiquetas `<div class=…>` a una página la
   acorta de manera legítima.
4. ~~Inventario antes de cortar~~ — hecho el 16/10 —
   `PEGAR_EN_02_SECCION_25_INVENTARIO_ANTES_DE_CORTAR.py`, enviada el 16/10.
   Lee todo, no escribe nada. Contesta las cuatro cosas que hacen falta para
   escribir la celda que rehaga las páginas: dónde están las alucinaciones de
   código en las 13.456 páginas, qué páginas son cartas en ruso (con tomo y
   número), qué páginas no son texto y hay que excluir, y **si están los PDF
   de los tomos 25 a 32 en la carpeta compartida** — sin la imagen no se
   puede rehacer nada, y eso hay que saberlo antes.
5. ~~Mirar las 148 páginas raras~~ — hecho el 16/10 —
   `PEGAR_EN_02_SECCION_24_VER_LAS_PAGINAS_RARAS.py`, enviada el 16/10. No
   gasta cuota, no escribe nada: clasifica las páginas con menos del 80% de
   hebreo (código alucinado, ruso, portadas, casi vacías) y muestra el texto
   de las peores. **Va antes de segmentar**: una página de código se
   convierte en una carta falsa. Rehacer las 148 cuesta 148 pedidos de
   Gemini, o sea nada; lo que no se puede es decidir sin mirarlas.
6. **Las 4 páginas a 120 DPI del tomo 5** (353, 354, 361, 364) — quedaron
   degradadas y NO se repararon, porque la corrida final usó la versión
   2026-10-13d y no la 2026-10-14 que las rehace. El tomo figura TERMINADO,
   así que nadie las va a volver a pedir solo. Están anotadas en
   `rescatadas_a_revisar.json`; la 2026-10-14 las rehace si se corre.
7. **Saber qué hay en la base antes de cortar** — `que_hay_en_la_base.sql`,
   versión 2026-10-16b. Sólo mira. Lista cartas por tomo (con años, fechas,
   temas, festividades y vectores), y detecta **si el texto de la base es el
   de antes de los arreglos** buscando letras árabes, que no tienen ninguna
   razón legítima para estar en una carta del Rebe. Trae un control del
   propio detector: un «0» puede ser «ya está arreglado» o «el detector no
   funciona», y hay que poder distinguirlos.
   **⚠️ EL ESQUEMA DE VERDAD ESTÁ EN `cargador.py`**, en `fila_de_libro`,
   `fila_de_carta` y `fila_de_chunk`. Las columnas son `libros(id, archivo,
   titulo, numero, paginas, total_cartas)`, `cartas(id, libro_id,
   orden_en_libro, numero_carta, numero_carta_valor, pagina_inicio,
   pagina_fin, encabezado, fecha_hebrea_texto, dia_hebreo, mes_hebreo,
   anio_hebreo, fecha_gregoriana, anio_gregoriano, lugar, destinatario,
   festividades, festividades_mencionadas, temas, resumen_es, formula_cierre,
   firma, n_palabras, flags, texto)` y `chunks(carta_id, idioma, idx, texto,
   embedding)`. **No hay columna `libro`: es `libro_id`**, y el id es
   `igrot_<número>`.
   **La primera versión falló con `42703 column c.libro does not exist`, y el
   error fue de MÉTODO:** la probé contra un Postgres de verdad pero con una
   tabla que me inventé, así que la prueba sólo demostró que la consulta era
   coherente consigo misma. La regla que sale de esto: **el esquema de prueba
   se GENERA desde `cargador.py`**, no se escribe a mano.
   **Dos trampas de Postgres anotadas ahí:** `array_length` de un arreglo
   vacío devuelve NULL y no 0, así que `array_length(temas,1) = 0` nunca es
   verdadero y hay que usar `cardinality`; y **el regex de Postgres no
   entiende `\u0600`**, así que los rangos Unicode van con los caracteres de
   verdad adentro de los corchetes.
8. **LO QUE HAY EN LA BASE, medido el 16/10** (con
   `que_hay_en_la_base.sql`):
   · **18 libros, 7.717 cartas, 19.178 vectores** (es: 7.717 · he: 11.461).
     Las 7.717 tienen vectores en los dos idiomas: no falta ninguna.
   · Los libros son los tomos **1, 2, 10, 11, 20, 21, 22, 23, 24, 25, 26, 27,
     28, 29, 30, 31, 32** más **«90) אגרות נוספים»** con 3.090 cartas, que no
     es un tomo sino el libro de las cartas sueltas que armó la sección 17.
   · `libros.total_cartas` coincide con las cartas que hay en los 18. Ninguna
     carga quedó a medias.
   · **EL CRUCE QUE DECIDE TODO:** en el cache y no en la base están los
     tomos **3, 4, 5, 6, 7, 8, 9, 13, 14, 15, 16, 17, 18, 19** — exactamente
     los 14 recién transcriptos, 6.627 páginas. **Cargarlos no duplica
     nada.** El tomo 12 queda afuera a propósito.
   · **⚠️ Los tomos 10 y 11 están en la base pero su `_paginas.json` NO está
     en `igrot_cache`.** Son 799 cartas cuyo texto original ya no está: si
     alguna vez hubiera que volver a segmentarlas, habría que rehacer su OCR.
   · **El texto viejo NO hay que recargarlo:** 1 carta de 7.717 tiene una
     letra árabe. La cuenta cierra sola: de los 5.934 arreglos de letras,
     5.693 fueron en los tomos 3 a 19, que no están en la base; a los diez
     tomos viejos que sí están les tocaron 241.
     (Cuidado con el alcance: el detector ve árabe y cirílico. Un intruso
     LATINO en un tomo viejo no se puede distinguir de una palabra latina
     legítima, así que «1 de 7.717» no es «el texto viejo está impecable»,
     es «no tiene letras árabes».)
   · **⚠️ ABIERTO: las cartas invisibles pasaron de 2 a 24.** El 7/10 eran 2;
     hoy son 24 cartas sin ningún tema Y sin ninguna fecha/festividad, o sea
     que no aparecen en ninguno de los dos filtros del sitio. Los archivos
     SQL viejos cuentan con `cardinality`, bien, así que el 2 estaba bien
     medido y el cambio es real. No lo pude explicar: hay que listar esas 24
     y ver de qué tomo son y qué les pasó. Sospecha a confirmar: la pérdida
     de datos del 12/10 y su recuperación.
     De paso, las cartas con fecha/festividad subieron de 664 a 1.436, que
     sí era esperable porque `despues_de_cada_carga.sql` rehace el
     movimiento de fechas desde cero.
9. ~~La segmentación de los 14 tomos nuevos salió sospechosa~~ — **ERA UNA
   FALSA ALARMA MÍA, Y DOBLE. Medido el 16/10 con la sección 27:**
   · **El 95% de cartas marcadas es NORMAL en este proyecto.** Los tomos que
     YA están cargados y funcionando en el sitio dan 88% en conjunto, y los
     tomos **27, 28, 30, 31 y 32 dan 99-100%**. Los nuevos dan 95%. Las dos
     banderas más frecuentes —`sin_cierre_detectado` 28% y `sin_dia` 23%—
     son IDÉNTICAS en los dos grupos.
   · **El «71% con fecha contra 87-90%» comparaba etapas distintas.** El 71%
     es del `.jsonl` recién segmentado; el 87-90% es de la BASE, después de
     enriquecer. Comparando `.jsonl` contra `.jsonl`: **71% los nuevos
     contra 75% los cargados.** Cuatro puntos, no quince.
   · Y hay una regla nueva que sale de ahí, medida en los 17 tomos sin una
     sola excepción: **la base tiene +12,5 puntos más de fechas que el
     `.jsonl`**, porque `fecha_gregoriana` se completa en el ENRIQUECIDO, no
     al segmentar. Así que esperar ~83% para los nuevos después de enriquecer.
   · Lo único que sí distingue de verdad: `anio_fuera_del_tomo` **10% en los
     nuevos contra 1% en los cargados** (unas 600 cartas), que es lo que
     produce los rangos imposibles del tipo «1923-1994» en el tomo 15. Está
     marcado con bandera, así que se puede buscar en la base después de
     cargar; no es un bloqueo.
   · `sin_numero_de_carta` da 13% en los nuevos contra 47% en los cargados:
     los nuevos tienen MÁS números de carta detectados, no menos.
   · El tomo 12 tiene un `.jsonl` parcial de 54 cartas. Sigue afuera
     (`SALTEAR = ['12)']` en la sección 4 del cuaderno 03).
   · El «90) אגרות נוספים» tiene 3.348 cartas en el `.jsonl` y 3.090 en la
     base: hay 258 filtradas entre una cosa y la otra, por la sección 19.
10. **⚠️ EL PATRÓN DE MIS ERRORES DE ESTA SEMANA, para reconocerlo antes.**
   Cinco falsas alarmas, todas de la misma familia: **un detector que
   encuentra algo legítimo, o dos números medidos en etapas distintas.**
   `.com` y `www.` marcaron las páginas de créditos; `||` marcó las rayas de
   las portadas; «ruso mal transcripto» marcó 116 cartas verdaderas; el
   «15 puntos peor en fechas» comparaba el `.jsonl` contra la base; y los
   «1.688 años mal escritos» de la sección 28 eran, en su mayoría, índices
   de años y verbos hebreos corrientes (punto 12). La regla:
   **antes de alarmar, medir lo mismo en el grupo que ya funciona.** La
   sección 27 está escrita así a propósito, y por eso se desarmó sola.
   **Y la regla hermana, que me faltaba:** antes de alarmar, **mirar si el
   detector mide la unidad que decide**. La 28 contaba tokens en el texto
   de las páginas cuando lo que decide son fechas de cartas, y por eso un
   número grande no significaba nada. Un detector que cuenta la unidad
   equivocada no se equivoca por poco: se equivoca por un factor.
   **OJO, Y ESTO ES IMPORTANTE: la quinta no era una falsa alarma.** Al
   medir bien dieron 204 cartas con la fecha mal contra 9 en los cargados:
   el defecto era real y había que arreglarlo. Lo que estaba mal era la
   UNIDAD, no la alarma. Así que la regla no es «desconfiar de las
   alarmas» —desconfiar por costumbre es otra forma de decidir por
   corazonada— sino **cambiar la unidad y medir los dos grupos, y después
   creerle al número que salga**, para cualquier lado que salga.
   **Tercera regla, de la misma vuelta:** cuando lo que hay que saber es qué
   hace un código nuestro, **correrlo**, no deducirlo de la expresión
   regular. El bloque A de la sección 29 le pregunta a `sg.leer_anio` y la
   respuesta —que `תשיז` no se lee como año— es la que desarmó la alarma.
   Es la misma lección que el `c.libro` inventado: ahí también me faltó
   mirar el código de verdad (`cargador.py`) en vez de suponerlo.
11. **⚠️⚠️ LAS 116 CARTAS EN RUSO NO LLEGARON AL `.jsonl`.** Las páginas se
   rehicieron en `igrot_cache` el 16/10, pero los tomos donde están —**25 a
   32**— ya estaban cargados, así que la sección 10 no los volvió a cortar
   (corrió sólo con los 14 nuevos). Sus `.jsonl` siguen siendo los de antes
   del arreglo, y la base también. **Hoy el rescate del ruso no se ve en el
   sitio.** Lo mismo vale para los 241 arreglos de letras de los tomos 23-32.
   Para que llegue: volver a cortar los tomos 25 a 32 (1.838 cartas).
   **ANTES DE PAGAR NADA, COMPARAR LOS CONTEOS.** El id de cada carta es
   `f"{libro}::{orden:05d}"` (segmentador.py, líneas 1474 y 1845), o sea que
   depende del ORDEN dentro del libro. Si al re-cortar salen las mismas
   cantidades (171, 369, 357, 164, 153, 204, 211, 209), los ids no se mueven
   y **alcanza con actualizar el texto: no hay que re-enriquecer ni pagar**.
   Si alguna cantidad cambia, los ids de ese tomo se corren y hay que
   re-enriquecer (368 llamadas) y reemplazar sus filas en la base, usando
   `RECORTADOS_DE_NUEVO` en la sección 4 del cuaderno 03 para sacar lo
   enriquecido viejo.
12. **⚠️ EL AÑO HEBREO MAL ESCRITO POR EL OCR, Y POR QUÉ VA ANTES DE
   ENRIQUECER.** La prueba 5c mostró este caso en el tomo 13, página 205:

       el encabezado dice ....... ב"ה, י"ב סיון, תש"יז
       las reglas leyeron ....... תש"י  = 5710 = 1950
       el tomo es ............... קיץ תשט"ז = verano de 5716

   `תש"יז` está mal escrito: **la gershayim va antes de la ÚLTIMA letra**
   (`תשי"ז`). Puesta un lugar antes, el lector de fechas toma `תש"י` y pierde
   la ז: siete años de error. Es del mismo tipo que las letras intrusas:
   mecánico y arreglable en el texto, sin Gemini.
   **Y el enriquecedor NO lo arregla.** Verificado en `enriquecedor.py`
   (`aplicar`, líneas 494-545): sólo pisa la fecha si el modelo devuelve un
   año válido Y de ahí sale una fecha gregoriana, lo que exige un MES
   canónico. En ese caso el modelo devolvió `None None 5716` — sin mes — así
   que la fecha quedó en 1950.
   **EL ORDEN IMPORTA Y ES IRREVERSIBLE:** el id de cada carta es
   `libro::00042`, o sea que depende del ORDEN. Arreglar el texto DESPUÉS de
   enriquecer obliga a volver a cortar, los ids se corren y hay que pagar las
   1.194 llamadas de nuevo. Arreglado antes: cortar de nuevo es gratis y se
   enriquece una sola vez.
   Lo mide `PEGAR_EN_02_SECCION_28_MEDIR_LOS_ANIOS_MAL_ESCRITOS.py` (16/10),
   sin cuota y sin escribir. Dos lecciones de su prueba:
   · **los años llevan prefijo** (`בתשי"ד` = «en 5714»), y el patrón que
     exigía que no hubiera ninguna letra hebrea antes no los encontraba;
   · **el apóstrofo simple (`תשי׳ז`) NO es un error**: el segmentador lo lee
     bien porque su expresión de año acepta `"` y `'`. Lo tenía en la lista
     y la propia función lo descartaba sola. Marcarlo habría sido inventar
     un problema.

   **⚠️ Y EL VEREDICTO DE LA 28 ESTABA MAL PLANTEADO. Es la quinta falsa
   alarma de la misma familia (ver el punto 10), y la escribí yo.** Midió
   1.688 tokens (21,3% de los años) en los 14 nuevos y 1.086 (14,2%) en los
   cargados, y su propia regla —«menos de 50 seguí, más de 50 arreglá»—
   mandó tocar el texto de 6.627 páginas. **Contaba la unidad equivocada:
   tokens en el texto de las páginas, no fechas de cartas.** Tres cosas, las
   tres medidas y no razonadas:

   · **QUÉ LEE EL SEGMENTADOR DE VERDAD** (corrido contra `sg.leer_anio`,
     no deducido de la expresión regular):

         תשי"ז   -> 5717            bien
         תש"יז   -> 5710  ⚠️        MAL: la única forma que hace daño
         תשיז    -> ningún año      no la lee como año: a lo sumo falta fecha
         ה'תשיז  -> 5717            con la ה' del milenio ya la lee bien
         תשוב    -> ningún año      no confunde verbos con fechas

     O sea que **de los 1.688, los 1.456 «sin gershayim» no pueden producir
     una fecha equivocada**: el segmentador no los lee. Sólo los 232
     «gershayim adelantada» pueden, y únicamente si caen en un encabezado.
   · **EL PATRÓN «sin gershayim» MARCA PALABRAS HEBREAS CORRIENTES.** Busca
     תר/תש + dos letras, y eso también describe verbos que caen justo en el
     rango: `תשוב` («volverás») = 5708, `תשיב` («responderás») = 5712,
     `תשלח` («enviarás») = 5738. **Arreglar ese grupo a ciegas le metería
     una comilla en el medio a verbos comunes de todo el corpus**, que es
     exactamente el daño que el freno de la sección 23 evitó en su momento.
     El patrón solo no puede decidir; el corpus sí (abajo).
   · **MUCHOS ESTÁN EN PÁGINAS DE ÍNDICE.** En el tomo 13 página 39 los
     «años mal escritos» eran `תרפא תרפב תרפג תרפד …`, una lista corrida de
     años, y la 40 seguía con `תשיא תשיב תשיג`. Es el índice del tomo: ahí
     no hay fecha de ninguna carta que arreglar.

   Lo mide bien `PEGAR_EN_02_SECCION_29_DONDE_ESTAN_LOS_ANIOS_MAL.py`
   (17/10), sin cuota y sin escribir. Cambia la unidad y el método:
   · le **pregunta al segmentador** qué lee en cada forma, en vez de que yo
     lo explique (bloque A, la tabla de arriba);
   · le **pregunta al corpus** si cada token es un año con la comilla caída
     o una palabra: cuenta cuántas veces aparece el año BIEN escrito
     (`תשי"ז`) contra cuántas veces aparece el token como palabra limpia.
     Si el año bien escrito no aparece nunca y el token aparece seguido, es
     una palabra. Es el mismo juez de la sección 23. **Suma los prefijos**
     (`ותשוב`, `בתשוב`) al contar el apoyo del token: sin eso, un verbo que
     en el corpus viene siempre con la ו pegada se quedaría sin apoyo y
     pasaría por año;
   · cuenta **sólo los que están en el `encabezado` de una carta ya
     cortada**, leyendo los `.jsonl` de `igrot_cartas`, porque el
     segmentador saca la fecha del encabezado y de ningún otro lado;
   · y de ésos distingue **FECHA MAL** (leyó justo el año equivocado),
     **FECHA PERDIDA** (no leyó ninguno, y eso lo levanta el enriquecedor)
     y **YA LO LEE BIEN**, comparando con el `anio` que la carta trae
     guardado en `fecha_hebrea`;
   · y lo mide **en los 14 nuevos y en los ya cargados**, que es la regla
     del punto 10.
   Pedida el 17/10. La decisión de tocar o no el texto depende de su bloque
   E: cuenta **cartas con la fecha mal leída**, no tokens.

   **RESULTADO DE LA 29 (17/10). MI SOSPECHA ERA FALSA Y EL DEFECTO ES
   REAL.** Medido sobre las 14.103 cartas ya cortadas:

       cartas nuevas con la fecha MAL LEÍDA ....  204 de 5.969  (3,42%)
       cartas ya cargadas, lo mismo ............    9 de 8.134  (0,11%)
       cartas nuevas que quedaron SIN año ......   16
       de los 1.688 tokens, en un encabezado ...  242

   **31 veces más en los nuevos que en los cargados, medido de los dos
   lados con la misma regla: eso no es una falsa alarma.** Lo que sí se
   confirmó de mi revisión es el reparto del daño: de los 1.688, sólo 242
   están en un encabezado, y el grupo «sin gershayim» (1.456) no produce
   ninguna fecha equivocada porque el segmentador no lo lee como año.
   Lo que NO se confirmó: la hipótesis del índice. `parece_indice` clasificó
   las 841 páginas como texto corrido, **ninguna** como índice. Y el juez
   del corpus respaldó 1.167 de los «sin gershayim» como años de verdad,
   contra 36 palabras y 253 dudosos: eran muchos menos verbos de lo que yo
   suponía. Me equivoqué en la magnitud; el método (medir los dos grupos,
   preguntarle al código) es lo que dio el número correcto.
   La causa está a la vista en la lista de cartas: **el tomo 14 es
   `חורף תשי"ז`**, así que casi todas sus cartas llevan ese año en el
   encabezado y el OCR escribe `תש"יז` una y otra vez. Un error sistemático
   por tomo produce cientos de fechas mal. Los dos tomos siguientes
   (15 = `קיץ תשי"ז`) repiten el patrón.
17. **Mover la comilla del año** —
   `PEGAR_EN_02_SECCION_30_MOVER_LA_COMILLA_DEL_ANIO.py` (17/10), enviada
   con `CONFIRMO_MOVER_LA_COMILLA = False`. **ESCRIBE** sobre los
   `_paginas.json`; copia en `<archivo>.antes-de-los-anios`.
   Toca **sólo** la forma «gershayim adelantada» (`תש"יז` -> `תשי"ז`), 232
   apariciones, y sólo las que el corpus respalda. **NO toca los 1.456 «sin
   gershayim»**: no producen ninguna fecha mal (bloque A de la 29) y ese
   patrón también describe verbos (`תשוב` = 5708, `תשיב` = 5712), así que
   arreglarlos sería romper texto para ganar 16 fechas que el enriquecedor
   da gratis.
   **El invariante que hace esto seguro: el arreglo no agrega, no borra ni
   cambia ninguna letra; sólo mueve la comilla.** `תש"יז` y `תשי"ז` tienen
   las mismas letras y la misma comilla en otro orden, así que la celda
   compara **la lista de letras hebreas en orden** (no el total: un texto
   dado vuelta tiene el mismo total) y la cantidad de comillas, y descarta
   la página si algo no coincide. Más un control que se cierra solo: los
   años bien escritos del corpus tienen que subir exactamente en la
   cantidad de arreglos.
   **⚠️ EL JUEZ DEL CORPUS SOLO NO ALCANZÓ, y lo vi recién en la primera
   corrida (versión `2026-10-17b`).** Entre los 8 tokens aceptados venía:

       17  תש"יכ  ->  תשי"כ  (5730)   el corpus lo respaldaba 20 veces

   **`תשי"כ` no es un año**: 730 se escribe `תש"ל` (ל = 30), nunca 10+20.
   Las 20 apariciones que lo «respaldaban» eran **el mismo error del OCR
   repetido**, así que el juez confirmaba una basura con otra basura. Es el
   límite del método: un juez de frecuencia no distingue un error
   sistemático de un uso legítimo.
   El control que lo frena: **escribir el año en hebreo como se escribe de
   verdad y comparar letra por letra** (`escribir_numero_hebreo` +
   `es_anio_canonico`). Unifica las letras finales, porque 5720 se escribe
   `תש"ך` con kaf final y si no las unificara rechazaría un año correcto;
   y respeta que **15 y 16 se escriben טו y טז**, no יה ni יו (forman el
   Nombre), así que `תשט"ז` —el título del tomo 13— pasa.
   Y el error de verdad de `תש"יכ` es otro: **sobra una י** (el gershayim
   leído como yod) y el año es `תש"כ` = 5720, justo el título del tomo 19.
   Eso es **borrar** una letra, no moverla, y borrar es lo que casi arruinó
   el corpus en la sección 23: la celda los lista aparte y no los toca. Se
   arreglan después con un UPDATE, que es reversible. Son 17 + 4 = 21
   apariciones.
   El reemplazo guarda el prefijo en un grupo y reusa **la misma comilla**
   que vino (recta o hebrea), para no cambiar ningún carácter: sin el grupo
   del prefijo, `בתש"יד` habría quedado `תשי"ד` y se perdía la ב.
   Probado de punta a punta: una página con `תש"יז` que el segmentador leía
   **5710** pasa a leerse **5717** después del arreglo.
   **Corrida frenada del 17/10, los números finales:** 18 tokens distintos y
   247 apariciones; el corpus más el control de año canónico respaldan **7
   tokens, 212 apariciones** (`תשי"ב` 62, `תשי"ז` 37, `תשי"ד` 32, `תשי"ח`
   27, `תשי"ג` 25, `תשי"ט` 22, `תשי"א` 7), en 14 tomos: **211 en los nuevos
   y 1 en el tomo 2**. Confirmación independiente de que son fechas de
   verdad: **cada token cae en el tomo cuyo título es ese mismo año**
   (`חורף תשי"ב`, `חורף תשי"ז`, `תשי"ט`…).
   **El tomo 19 (`תש"כ`) queda sin un solo arreglo**, porque sus 17 casos
   son todos de la familia de la י de más. Sus cartas conservan el año mal
   hasta el UPDATE posterior.
   Conteos de cartas por tomo ANTES de volver a cortar, para comparar
   después (suman 5.969): 3)=372, 4)=454, 5)=373, 6)=348, 7)=400, 8)=367,
   9)=345, 13)=486, 14)=618, 15)=456, 16)=392, 17)=373, 18)=510, 19)=475.
   **APLICADO el 17/10: 212 años en 195 páginas**, y el control cerró
   exacto — los años bien escritos del corpus pasaron de **12.779 a
   12.991**, +212, sin una sola página descartada. Copias en
   `<archivo>.antes-de-los-anios`.
18. **Volver a cortar los 14 tomos nuevos** —
   `PEGAR_EN_02_SECCION_31_VOLVER_A_CORTAR_LOS_NUEVOS.py` (17/10). Reemplaza
   a la sección 10 para este paso y la razón es el orden de las
   operaciones: **la 10 corta y guarda de una**, así que si el corte saliera
   distinto el `.jsonl` viejo ya estaría sobreescrito y no quedaría con qué
   comparar. La 31 corta **en memoria**, compara, y escribe sólo si
   coincide; copia en `<nombre>.antes-del-recorte`.
   **El control es la HUELLA del corte, no el total**: la lista de
   (página de inicio, número de carta) de cada carta, en orden, una contra
   una. Contar no sirve — una carta partida en dos y dos pegadas en una dan
   el mismo total y los ids quedarían mal en silencio. Cuando no coincide
   dice **cuál es la primera carta que se corrió**.
   Y mide el efecto esperado del arreglo: **las cartas que leían 5710**
   (lo que devuelve el segmentador con la comilla adelantada) tienen que
   bajar unas 204, junto con `anio_fuera_del_tomo`. Si no bajan, el arreglo
   no llegó al corte y hay que entenderlo antes de gastar las llamadas.
   Probada de punta a punta con 14 tomos de juguete: con un corrimiento
   simulado en un tomo **no escribió ningún archivo**, ni los 13 que sí
   coincidían.
   **CORRIDA DEL 17/10: los 14 tomos cortaron en los MISMOS lugares.**
   Huella idéntica carta por carta, 5.969 cartas, los ids no se movieron.
   Efecto del arreglo, medido antes y después:

       cartas que leían 5710 ....  421 -> 236   (-185)
       con anio_fuera_del_tomo ..  578 -> 400   (-178)
       sin año hebreo .......... 1080 -> 1080   (sin cambio, esperado)

   **El `sin año` sin cambio es la confirmación de que no tocamos el grupo
   equivocado**: los «sin gershayim» eran los que dejaban cartas sin fecha y
   no se tocaron, así que ese número no tenía que moverse.
   Y la bajada de 185 contra las 204 que había contado la sección 29 **cuadra
   con las 21 apariciones de la familia `תש"יכ` que dejamos afuera a
   propósito** (las que faltan deben estar en el cuerpo y no en un
   encabezado). Las 236 que siguen leyendo 5710 incluyen las legítimas: el
   tomo 3 es `תש"ט-תש"י`, o sea 5709-5710.
   `.jsonl` escritos, copias en `<nombre>.antes-del-recorte`.
19. **⚠️ EL CONTROL DE `ya_estaban` NO SE VE ANTES DE PAGAR.** Lo veníamos
   repitiendo como si fuera un freno, y no lo es: `ya_estaban` sale en el
   resumen que `enriquecer_en_tandas` imprime **al terminar**, o sea después
   de las dos horas y de las llamadas pagadas. Si el archivo de enriquecidos
   no se encontrara, la corrida pagaría las 8.080 de nuevo y nos
   enteraríamos al final.
   Lo arregla `PEGAR_EN_03_SECCION_5d_CUANTO_VA_A_PAGAR.py` (17/10), que va
   entre la sección 4 y la 6 y hace la misma cuenta antes, sin gastar:
   reparte con la misma lógica que `enriquecer_en_tandas` y lee el archivo
   con **la misma función** (`en.ids_ya_hechos`), no con una copia.
   Y controla el re-corte **desde el otro lado**: cuántos ids ya pagados no
   existen entre las cartas cargadas. Si el corte hubiera movido un id, ese
   enriquecido quedaría colgado y aparecería ahí, con su libro. Son dos
   controles independientes de lo mismo: la sección 31 compara los cortes
   entre sí, la 5d compara contra lo que ya está pagado.
   **CORRIDA DEL 17/10, y el número correcto es 8.073, no 8.080.** El
   archivo `igrot_enriquecidas/cartas_enriquecidas.jsonl` (30,3 MB) tiene
   **8.073** cartas, y los 7 que faltaban para el 8.080 que yo venía
   repitiendo están identificados en la propia salida: son los pendientes de
   tomos YA CARGADOS — **2 del tomo 27, 2 del 28 y 3 del libro de las
   sueltas**. La cuenta cierra exacta: 5.969 (los 14 nuevos) + 7 = 5.976
   pendientes, y 8.073 + 7 = 8.080.
   O sea que **no se perdió nada con el re-corte** (el bloque C lo confirma:
   cero enriquecidos colgados): esas 7 cartas nunca se habían enriquecido,
   probablemente por un corte de cuota en alguna corrida vieja que no se
   reintentó. Se enriquecen ahora junto con el resto, y cuesta dos llamadas
   más. Total de la corrida: **5.976 cartas, 1.196 llamadas, unas 2 horas.**
   Lección: el 8.080 era un número que yo arrastraba de una medición de la
   BASE, no del archivo de enriquecidos. Dos cosas parecidas medidas en
   etapas distintas — la quinta vez esta semana.
20. **⚠️ CUÁNTO TARDA DE VERDAD EL ENRIQUECIDO: 21 s POR LLAMADA, NO 6.**
   Medido en la corrida del 17/10: **198 llamadas en 70 minutos**, o sea
   710 cartas. Yo había dicho 2 horas y son **9 o 10**. El 6,0 que puse en
   la sección 5d lo arrastraba "de corridas anteriores" sin verificar de qué
   etapa eran: otra vez un número de un contexto aplicado a otro.
   **Y la causa de los 21 s es la misma que la de las fallas**: `llamar`
   reintenta hasta 5 veces con esperas de 2, 4, 8 y 16 segundos ante
   429/500/502/503/504. Con la capa gratuita congestionada, buena parte del
   reloj son esperas, no el modelo pensando. Las fallas son las tandas que
   agotaron los 5 intentos, y por eso **suben de 5 en 5**: el `except` de
   afuera cuenta `len(grupo)`.
   **LO IMPORTANTE: una carta que falla NO se escribe en el archivo de
   salida** (verificado en `enriquecer_en_tandas`, líneas 739-806: sólo se
   escribe lo que vuelve con respuesta). Así que queda pendiente y **volver
   a ejecutar la misma celda la recupera**. Nada se pierde y nada se paga
   dos veces. Ritmo observado: ~12% de cartas fallando en la primera pasada.
   Y el archivo se escribe con `flush()` después de CADA carta, así que una
   desconexión de Colab cuesta como máximo una tanda.
   **TERMINADO el 18/10: las 14.049 cartas están enriquecidas.** La segunda
   pasada devolvió `ya_estaban: 14048, hechas: 1, fallaron: 0`, o sea que
   las fallas de las pasadas anteriores se barrieron solas volviendo a
   ejecutar la celda, como decía el código. **Confirmado en la práctica: una
   carta que falla queda pendiente y se recupera gratis.**
21. **Mirar cómo salió el enriquecido** —
   `PEGAR_EN_03_SECCION_7b_COMO_SALIO_EL_ENRIQUECIDO.py` (18/10), que
   reemplaza a la sección 7 para esta vuelta. La 7 mide las 14.049 juntas
   —los 14 nuevos y los 18 que ya andan en el sitio en el mismo promedio—,
   que es el error del punto 10 otra vez. La 7b pone **las dos columnas una
   al lado de la otra**, con porcentajes para que grupos de distinto tamaño
   sean comparables.
   Controla además cuatro cosas que deciden el paso siguiente:
   · **ids repetidos en el archivo**: se escribe agregando al final a lo
     largo de muchas corridas, y un id duplicado haría que el cargador
     meta la carta dos veces o se quede con la versión equivocada;
   · **el `tipo` de cada bloque**, que es por donde filtra la sección 19 del
     cuaderno 02;
   · **cuántas cartas quedaron en 1950**, que es el rastro del error de la
     comilla (la 31 lo dejó en 236, y el tomo 3 es `תש"ט-תש"י`, así que ahí
     1950 es correcto);
   · **los bloques de más de 20.000 caracteres y su tipo**: el de 33.619 de
     la prueba 5c quedó con `tipo: carta`, así que la sección 19 no lo saca
     y hay que mirarlo a mano.

   **RESULTADO DE LA 7b (18/10). Todo bien, y el detalle importa:**
   · 5.969 nuevas + 8.080 viejas = 14.049, **ningún id repetido y ningún id
     colgado** — la cuenta cierra por los dos lados;
   · `tipo: carta` en **98,7% de los nuevos contra 95,5% de los viejos**: 76
     bloques no son cartas y los saca la sección 19;
   · **fecha gregoriana: 82,7% en los nuevos contra 84,9% en los viejos.**
     Dos puntos de diferencia, medido like-for-like. (Comparar con la falsa
     alarma de los "15 puntos peor" del punto 10: era el `.jsonl` contra la
     base.);
   · **la IA corrigió 803 fechas en los nuevos y 60 en los viejos.** Trece
     veces más: el OCR nuevo trae más errores de fecha que los que arreglamos
     con la comilla, y el enriquecedor tapó buena parte;
   · **los 4 bloques enormes salieron `tipo: indice`**, incluido el de 33.619
     que en la prueba 5c había salido `carta` con confianza 0,95. Esta vez el
     modelo acertó, así que la sección 19 los saca a todos y el riesgo que
     temíamos no está;
   · **1950 bajó de 236 a 194**, y el reparto por tomo lo explica entero:
     **93 son del tomo 4 (`תשי"א` = 5711, que empieza en septiembre de 1950,
     o sea que ahí 1950 es CORRECTO)** y 84 del tomo 3 (`תש"ט-תש"י`, también
     correcto). Quedan 11 en el tomo 19 —justo la familia `תש"יכ` que
     dejamos afuera a propósito— y 6 sueltas. Mi nota en la celda sólo
     mencionaba el tomo 3: me faltaba el 4, y los datos lo corrigieron.
22. **⚠️ DOS DEFECTOS DE FECHA MÁS, ENCONTRADOS LEYENDO TRES RESÚMENES.** El
   bloque F de la 7b muestra tres cartas al azar para mirarlas con los ojos,
   y de las tres salieron dos defectos nuevos, los dos verificados corriendo
   el segmentador:

       8) ח - חורף תשי"ד · pág 255 · fecha None
       encabezado: ב"ה, כ"ה אד"ר, תשיי"ד

   · **`תשיי"ד` lleva un yod de más**: el año es 5714 y el segmentador lee
     **5724**. No pierde la fecha, la lee **diez años tarde y en silencio**
     (el yod vale 10). Es la misma familia del `תש"יכ` de la sección 30.
   · **`אד"ר` no está en la lista de meses** (`buscar_mes` lo devuelve como
     None), y es la abreviatura corriente de Adar Rishon. Sin mes no hay
     fecha gregoriana, y por eso esa carta quedó sin fecha aunque el año
     estuviera. Lo mismo con `אד"ש` (Adar Sheni). Verificado: `אדר`,
     `אדר א`, `אדר ראשון`, `אדר ב` y `אדר שני` sí están; las dos
     abreviaturas con comilla, no.
   Los dos se arreglan **con reglas, sin Gemini y sin volver a cortar**: la
   fecha sale del `encabezado`, que ya está guardado en cada carta
   enriquecida, así que se puede corregir el archivo enriquecido en el lugar
   y los ids no se mueven.
   **EL PELIGRO DEL ARREGLO DEL YOD, y está probado que pasa:** sacar el yod
   a lo bruto convierte `תשי"ז` (correcto, 5717) en `תש"ז` = 5707, diez años
   para el otro lado y en silencio. Lo único que lo hace seguro es el mismo
   control de año canónico de la sección 30: **se toca sólo si el año como
   está NO está bien escrito y el arreglado SÍ** (`תשייד` = 724, que se
   escribe `תשכד` → candidato; `תשיז` = 717, que se escribe `תשיז` → no se
   toca).
   Lo mide `PEGAR_EN_03_SECCION_7c_LAS_FECHAS_QUE_FALTAN.py` (18/10), que no
   estima: **recalcula** la fecha con los arreglos usando el segmentador de
   verdad y la compara con la que cada carta tiene hoy. Caso real probado de
   punta a punta: esa carta pasa de **sin fecha** a **1954-02-28**.

   **MEDIDO el 19/10:**

       yod de más en el año ....... 823 encabezados nuevos,  2 viejos
       אד"ר (Adar Rishon) .........  80 nuevos,  70 viejos
       אד"ש (Adar Sheni) ..........  88 nuevos,  65 viejos

       fechas que se recuperarían ..  92 nuevas, 43 viejas
       cartas que cambiarían de año   28 nuevas,  5 viejas
       la fecha que ya tienen ...... 704 nuevas, 72 viejas

   **De los 823 con el yod de más, 704 ya tienen la fecha bien**: el
   `corregir_anios_por_orden` del segmentador los rescata solo (prueba qué
   pasa si borra una letra y mira el orden cronológico del tomo) y el
   enriquecedor tapó otros. O sea que el arreglo no toca 823 cartas sino
   **120**, las que se le escaparon a los dos.
   **Y los arreglos se confirman contra el título del tomo**, que es
   evidencia independiente del OCR de la página: `תשטי"ז` en el tomo 13
   (`קיץ תשט"ז` = 1956) se leía 1966; `תשיי"ז` en el tomo 14
   (`חורף תשי"ז`) se leía 1966 y queda en octubre de 1956, que es
   Marjeshván de 5717. Las dos veces el error era de **exactamente diez
   años**, porque el yod vale 10.
23. **Arreglar esas fechas** —
   `PEGAR_EN_03_SECCION_7d_ARREGLAR_LAS_FECHAS.py` (19/10), con el freno
   `CONFIRMO_ARREGLAR_LAS_FECHAS = False`. Reescribe
   `cartas_enriquecidas.jsonl` en el lugar (copia en
   `.antes-de-las-fechas`, y escribe a un temporal + `os.replace` para que
   una desconexión no deje el archivo partido). **No hace falta re-cortar ni
   re-enriquecer**: la fecha sale del `encabezado`, que ya está guardado en
   cada carta, así que los ids no se mueven.
   `aplicar_fecha` toca **sólo** `fecha_hebrea`, `fecha_gregoriana`,
   `anio_gregoriano` y las banderas (saca `sin_anio`, `sin_dia` y
   `anio_fuera_del_tomo`, agrega `fecha_arreglada_por_reglas` para poder
   encontrarlas después en la base). El texto, el resumen y los temas quedan
   intactos, y eso está probado campo por campo.
   **⚠️ LAS CARTAS SUELTAS NO SE TOCAN A CIEGAS.** Varias de las que
   cambiarían de año son del `90) אגרות נוספים`, y ahí el nombre del archivo
   trae su propia fecha (está en el id y en `fecha_del_nombre`). En cuatro
   casos, en cuatro carpetas de años distintos, el nombre dice
   5715/5716/5717/5718 y el encabezado dice `תשי"ט` en todos: eso huele a
   encabezado contaminado, no a nombres mal. Así que la celda aplica la
   **misma regla que ya usa el enriquecedor**: donde el nombre del archivo y
   el texto no coinciden, gana no inventar. Esas cartas se saltean y se
   listan aparte.
   Control que se cierra solo: los renglones del archivo tienen que ser los
   mismos y las cartas con fecha tienen que subir **exactamente** en la
   cantidad de fechas recuperadas.

   **CORRIDA FRENADA DEL 19/10:** 210 cartas se tocarían — **135 fechas
   nuevas y 75 corregidas** (160 de los tomos nuevos, 50 de los cargados).
   Las 4 cartas sueltas ambiguas quedaron salteadas, como corresponde:
   el nombre dice 5709/5716/5720/5723 y el encabezado `תש"ח`/`תשי"ד`/
   `תשי"א`/`תשי"ט`.
   **DOS AJUSTES QUE SALIERON DE MIRAR ESA CORRIDA (versión `2026-10-19b`):**
   · **a la celda le faltaba marcar de quién es la fecha de hoy.** De las
     210, **70 tienen una fecha que puso la IA** y el arreglo por reglas se
     la pisa. En la 7c eso se mostraba y en la 7d me lo había olvidado. Los
     tres casos verificables salieron todos a favor de las reglas: la IA
     había puesto Nisán donde el encabezado dice `אדר ב'` con todas las
     letras, agosto de 1957 donde dice Marjeshván de 5717 (= octubre de
     1956) y Adar I donde dice `אד"ש`. La bandera
     `fecha_arreglada_por_reglas` queda justamente para poder revisarlas en
     la base después.
   · **46 de las 75 «corregidas» no cambian de año sino de mes**, y por eso
     este número era mayor que el de la 7c: la 7c comparaba sólo el año
     (`greg[:4]`) y la 7d compara la fecha entera. No era una
     contradicción, eran dos medidas distintas mal etiquetadas por mí.
   **Un riesgo que verifiqué antes de soltarla:** `אד"ש` → `אדר ב` en un año
   que NO es bisiesto. El segmentador lo resuelve bien: en 5718 (común)
   tanto `אדר א` como `אדר ב` caen en el único Adar y devuelve la fecha
   marcada como aproximada, sin inventar un mes que no existe.
   **APLICADO el 19/10: 210 cartas tocadas**, y el control cerró exacto —
   14.049 renglones antes y después, cartas con fecha de **11.795 a 11.930,
   +135**, que es justo la cantidad de fechas recuperadas. Copia en
   `cartas_enriquecidas.jsonl.antes-de-las-fechas`.
24. **⚠️ LA «SECCIÓN 19» NO HACÍA FALTA: ERA UNA SUPOSICIÓN MÍA.** Venía
   anotado como pendiente «filtrar los no-cartas con la sección 19 del
   cuaderno 02». Fui a leer las dos cosas y:
   · la **sección 19 del cuaderno 02 filtra por CANTIDAD DE PALABRAS**
     (menos de 10), no por `tipo`, y trabaja sobre los `.jsonl` de
     `igrot_cartas`;
   · la **sección 4 del cuaderno 04 YA filtra por `tipo`**:
     `cartas = [c for c in todas if c.get('tipo', 'carta') == 'carta']`, y
     de paso ya deja afuera el tomo 12.
   O sea que los 76 bloques que no son cartas se van solos en el paso
   siguiente, donde corresponde. El pendiente estaba escrito sobre una
   suposición sobre nuestro propio código, que es el error del punto 10.
   **Y la sección 4 del cuaderno 04 trae un control que valida gratis el
   arreglo de las fechas**: imprime el rango de años y avisa si alguno cae
   fuera de 1919-1996. Si el arreglo del yod hubiera metido un año
   imposible, aparece ahí.
   **La sección 5 (vectores) sí muestra el número ANTES de pagar**:
   `cg.cobertura()` se imprime antes del freno, al contrario de lo que pasaba
   con `ya_estaban` en el enriquecido (punto 19). Y `embeber_cartas` reanuda
   por `piezas_ya_hechas`, así que una corrida cortada no se paga dos veces.
25. **VECTORES EN ESPAÑOL: HECHOS, 19/10.** De **7.717 a 13.613 de 13.613,
   0 fallaron**, en varias pasadas (la última, de 904 vectores, tardó 8
   minutos). La aritmética cierra: 13.613 − 7.717 = 5.896 generados, y 5.896
   contra las 5.893 cartas nuevas — los 3 de más son de las 7 cartas viejas
   que se enriquecieron en esta vuelta y nunca habían tenido vector.
   Y el estado de la sección 4 del cuaderno 04 antes de cargar:
   **14.049 bloques → 13.613 cartas** (436 afuera: 258 notas editoriales,
   86 introducciones, 65 índices, 27 ilegibles), **13.613 con resumen
   (el 100%)**, 11.761 con fecha (86,4%), y el rango de años quedó en
   **1924-1993**, todo dentro de lo posible — que es la validación
   independiente del arreglo de fechas del punto 23.
   **Los vectores del hebreo (sección 5b) siguen pendientes y son
   opcionales**: el orden que recomienda el propio `embeber_cartas` es
   español de TODAS las cartas primero, y recién después hebreo.
26. **⚠️ LA CARGA SE CORTÓ: LA SECCIÓN 7 DEL CUADERNO 04 NO SUBE `cartas`.**
   Subió 19.150 chunks y se cortó repitiendo:

       HTTP 409 · 23503 · Key (carta_id)=(13) יג…::00003) is not present
       in table "cartas" · violates foreign key constraint

   La causa la imprime la propia celda (versión `2026-10-09`, **más nueva
   que la copia que hay en este repo**, dato a tener en cuenta: para
   cuaderno 04 sección 7 el repo está desactualizado):

       SE VA A SUBIR: chunks
          (las cartas NO, a propósito: no cambiaron, y subirlas otra vez
           deshace el movimiento de las etiquetas de fecha)

   **Esa protección era correcta cuando se escribió y hoy es falsa.** Era
   cierto que las cartas «no cambiaron» cuando la tabla tenía las 7.717 de
   siempre; ahora hay **5.896 cartas nuevas que nunca estuvieron en la
   base**, y `chunks` tiene una clave ajena que exige que cada vector
   apunte a una carta existente. Los 19.150 que entraron son exactamente
   los de las 7.717 que ya estaban.
   **Es una variante del patrón del punto 10**: una defensa escrita para un
   estado del mundo, aplicada a otro. No fue un error de código sino de
   vigencia.
   Lo arregla `PEGAR_EN_04_SECCION_7b_SUBIR_TAMBIEN_LAS_CARTAS.py` (19/10),
   con freno `CONFIRMO_SUBIR_LAS_CARTAS = False`: sube **libros → cartas →
   chunks** en ese orden (cada uno apunta al anterior), descarta los
   vectores cuya carta no está en la lista, y **si `libros` o `cartas`
   fallan corta antes de intentar los chunks**, porque sin ellos los
   vectores van a chocar contra la misma regla.
   Estado del archivo de vectores al momento de la carga: **25.076 vectores
   — 13.615 en español (13.613 de 13.613 cartas) y 11.461 en hebreo (7.717
   de 13.613)**. Los 2 de más son de bloques que no son cartas.
27. **CARGADO Y ANDANDO, 19/10. El sitio pasó de 7.717 a 13.613 cartas.**
   32 libros, 13.613 cartas, 25.074 chunks, **cero errores**. Después,
   `despues_de_cada_carga.sql`: plegó 168 cartas, movió la festividad a su
   columna en **2.708**, y las invisibles bajaron de 24 a **3**. La sección 8
   da `CARTAS BUSCABLES: 13613 de 13613` y la prueba de búsqueda devuelve
   cinco cartas pertinentes sobre educación.
28. **⚠️ EL VOCABULARIO DE TEMAS SE TRIPLICÓ: 122 ETIQUETAS → 376.** Lo
   delató la prueba de búsqueda de la sección 8: de los cinco resultados,
   cuatro decían `educación de los hijos` y uno `educacion de los hijos`,
   sin tilde. **Son dos etiquetas distintas para el mismo tema y el filtro
   del sitio las muestra separadas.**
   La causa: el enriquecido de los 14 tomos nuevos inventó etiquetas —el
   pedido lo permite, «agregá otras si hace falta»— y el mapa de plegado de
   `despues_de_cada_carga.sql` cubre 84: las que existían cuando se
   escribió. Otra defensa escrita para un estado del mundo anterior.
   Medido con `temas_repetidos_por_la_tilde.sql` (19/10, sólo mide):
   · **29 grupos** de la misma etiqueta escrita distinto, unas **566
     apariciones** en la forma minoritaria. En todos gana una por lejos:
     `estudio de Torá` 4.058 contra `estudio de Tora` 36 y `estudio de tora`
     1; `emuná y confianza` 1.626 contra `emuna` 320, `emúná` 28, `Emuná` 3
     y `emúna` 1; `yeshivá` 1.070 contra `Yeshivá` 60; `aliyá` 196 contra
     `Aliyá` 16;
   · y una cola larga: **249 de las 376 etiquetas tienen una o dos cartas**
     (298 apariciones, el 2% del uso). Ahí hay inventos de una sola vez
     (`alentamiento`, `arrepentimiento`, `campaña de mitzvot`) y hasta una
     basura de otro alfabeto (`alර්ථה`, 1 carta).
   Lo pliega `plegar_las_tildes_de_los_temas.sql` (19/10), que **calcula el
   mapa de los datos** en vez de traerlo escrito: agrupa por la forma sin
   tildes y en minúsculas y **gana la que más cartas tiene**. Así, si en la
   próxima carga aparece una quinta forma de `tzedaká`, la pliega sin que
   haya que tocar el archivo — que es justamente lo que le falló al mapa a
   mano.
   Tres cosas que salieron de CORRERLO y que no habría visto leyéndolo:
   · **las cadenas.** La cuenta manda `emúnah y confianza` → `emunah y
     confianza`, y la lista de casos especiales manda `emunah` → `emuná`.
     Con un solo salto, `emúnah` terminaba en una de las formas que
     queríamos sacar. Ahora las cadenas se resuelven con un `with
     recursive`, con un tope de 6 pasos como seguro contra un ciclo;
   · **los empates.** Con dos formas de 1 carta cada una, el desempate
     alfabético elegía `tefilin` sobre `tefilín`. Ahora ante un empate gana
     la que lleva tilde o mayúscula. En los datos de verdad no hay empates
     entre los 29 grupos, pero los habrá en la cola larga;
   · y **el informe mentía en modo prueba**: el bloque «las 15 más usadas
     después de plegar» leía `cartas`, que todavía estaba sin plegar. Ahora
     lee la tabla proyectada.
   **NO toca la cola larga de 249 etiquetas, a propósito**: decidir si
   `arrepentimiento` es `teshuvá` es una decisión de contenido, no de
   ortografía. Y no borra etiquetas de ninguna carta: sólo reemplaza una
   forma por otra, y si una carta queda con la misma dos veces, deja una.
   Conserva el orden (el enriquecedor las pone de la más específica a la más
   general) por la primera posición de cada una.
29. **⚠️ MI PROPIO SQL MIDIÓ MAL «LAS INVISIBLES»: DECÍA 30 Y SON 3.**
   `temas_repetidos_por_la_tilde.sql` v1 contaba `temas` vacío y
   `festividades` vacío, pero el sitio lee **las dos** columnas de
   festividades (`buscar_cartas` y `facetas_de_cartas` se arreglaron para
   eso), así que la condición correcta incluye `festividades_mencionadas`,
   como ya hacía `despues_de_cada_carga.sql`. No era una contradicción entre
   la base y el SQL: eran dos consultas mías midiendo cosas distintas con el
   mismo nombre. Corregido. **Regla: cuando dos archivos míos reportan el
   mismo renglón, tienen que compartir la condición, no parecerse.**
30. **AHORA LOS .sql SE PRUEBAN CONTRA UN POSTGRES DE VERDAD.** Es el cierre
   del agujero que produjo el `c.libro`. En el contenedor hay PostgreSQL 16:
   · `pruebas_sql/esquema_de_prueba.sql` — el esquema con las columnas que
     escribe `cargador.py`, más datos de juguete que incluyen a propósito un
     empate de etiquetas y cartas sin temas;
   · `pruebas_sql/probar_el_sql.sh archivo.sql` — arma un Postgres temporal
     (como usuario `pgtest`, porque Postgres no corre como root), carga el
     esquema y corre cada archivo con `ON_ERROR_STOP=1`;
   · `test_esquema_de_prueba.py` — compara el esquema contra
     `fila_de_carta`, `fila_de_libro` y `fila_de_chunk` y falla si falta una
     columna, así el esquema de prueba no se queda viejo en silencio. Ya
     encontró una: `chunks.embedding` no estaba.
   Y encontró un error en mí mismo: la primera versión de ese comparador
   leía un nombre por renglón y el esquema tiene renglones con dos columnas,
   así que reportó 15 columnas faltantes que estaban todas ahí. **El que
   medía mal era el medidor** — la misma familia que el punto 10, esta vez
   adentro de una prueba.
31. **⚠️ Y AUN PROBÁNDOLO CONTRA POSTGRES, SUPABASE LO RECHAZÓ:**

       ERROR: 42P01: relation "plegado_final" does not exist

   El archivo armaba `plegado`, después `plegado_final`, y los renombraba.
   **Eso corría bien en mi Postgres de las dos formas** —mandando las
   sentencias de a una (`psql -f`) y mandando todo junto en una sola
   consulta (`psql -c "$(cat …)"`, que imita al editor de Supabase)— y en
   Supabase falló igual. No sé por qué, y **no lo averigüé**: saqué el
   renombrado, que era un truco que no hacía falta. Ahora son dos tablas con
   nombres distintos, `plegado_crudo` y `plegado`, y ninguna se renombra.
   La lección no es sobre Supabase: **cuando una construcción no es
   necesaria, la forma de arreglarla es borrarla, no entenderla.** Y la
   segunda: probar contra un Postgres propio sube mucho la confianza pero no
   la vuelve certeza — el entorno de verdad es el de Ariel.
   De paso, los datos de juguete ahora ejercitan a propósito los dos casos
   que me fallaron: un EMPATE de etiquetas (`mezuza`/`mezuzá`) y una CADENA
   (`emúnah` → `emunah` → `emuná`).
   **CORRIDA EN MODO PRUEBA (19/10): 40 etiquetas se reemplazan, 528 cartas
   cambian, 376 → 336.** Revisé las 40 direcciones una por una y todas van a
   la forma que manda. La cadena funcionó sobre datos de verdad: las SEIS
   variantes de `emuná y confianza` —`emuna` (320), `emúná` (28), `emúnah`
   (16), `emunah` (4), `Emuná` (3), `emúna` (1)— caen todas en `emuná y
   confianza`, y `emúnah` va directo al final sin quedarse en `emunah`.
   El control `destinos que todavía habría que plegar` dio 0.
   **Y la aritmética cierra contra la medición anterior, incluidos los
   descuentos**: `estudio de Torá` suma 4.095 apariciones pero el proyectado
   dice 4.094, `difusión de las fuentes` 1.783 contra 1.782 y `Eretz Israel`
   935 contra 933. Esas 4 de diferencia son **cartas que llevaban DOS formas
   de la misma etiqueta** y quedan con una: es el deduplicado haciendo su
   trabajo, no un error de cuenta.
   **Queda pendiente** meter este plegado dentro de
   `despues_de_cada_carga.sql`, para que corra solo después de cada carga.
   Mientras no esté, hay que acordarse — y acordarse es justo lo que falla.
   **APLICADO el 19/10: 40 etiquetas reemplazadas, 528 cartas, 376 → 336.**
32. **DÓNDE QUEDÓ TODO, 19/10 (el estado para empezar la próxima vez).**
   El sitio tiene **13.613 cartas de 32 libros**, todas con resumen y todas
   buscables en español. Lo que falta, en orden de lo que más conviene:
   1. **meter `plegar_las_tildes_de_los_temas.sql` dentro de
      `despues_de_cada_carga.sql`**, entre el paso 1 (plegar) y el paso 2
      (mover las fechas): el plegado tiene que dejar `Januca` como `Janucá`
      ANTES de que el paso 2 lo busque. Mientras sean dos archivos, depende
      de acordarse;
   2. **los vectores del hebreo de los 14 tomos nuevos** (sección 5b del
      cuaderno 04): hoy están 7.717 de 13.613. Es opcional y mejora la
      búsqueda escrita en hebreo;
   3. **las 21 cartas del tomo 19 con el año 10 años corrido** (la familia
      `תש"יכ` del punto 23, que dejamos afuera a propósito porque el arreglo
      es borrar una letra). Se arreglan con un UPDATE, ya cargadas;
   4. **volver a cortar los tomos 25 a 32** para que las 116 cartas en ruso
      lleguen al sitio (punto 11), comparando los conteos primero;
   5. **la cola de 249 etiquetas de uno o dos usos** (punto 28): decisión de
      criterio, no mecánica;
   6. el límite por IP en `/api/traducir` (Vercel → Firewall);
   7. las 4 páginas a 120 DPI del tomo 5 y el `inheritdoc` del tomo 14
      página 204.
   **Lo que NO pude verificar yo**: desde este entorno no puedo abrir
   igrot.vercel.app —el proxy lo bloquea y el navegador tampoco llega—, así
   que si el filtro de temas quedó bien y si las cartas nuevas se ven es algo
   que tiene que mirar Ariel.
33. **⚠️ ARIEL MIRÓ EL SITIO Y ENCONTRÓ DOS COSAS. UNA ES UN DEFECTO REAL
   QUE NINGUNA DE MIS MEDICIONES HABÍA TOCADO.**
   · el filtro de TEMAS seguía mostrando `emuna y confianza` separado —puede
     ser la página vieja en el navegador o algo guardado del lado del sitio,
     y el bloque A de la medición nueva lo contesta;
   · y el filtro de FESTIVIDADES da **982 cartas en «Rosh Jódesh»**, con las
     dos primeras fechadas el 2 de mayo de 1930 y el 28 de febrero de 1932,
     que no son Rosh Jódesh.
   **EL MECANISMO, reproducido contra `segmentador.py`:**
   `detectar_festividades` busca cada festividad como **subcadena suelta**
   (`if patron in texto`), y en la lista hay entradas de dos letras:

       הר"ח     = «el Rav Jaim»   -> detecta Rosh Jódesh ✗
       מוהר"ח   = otro honorífico -> detecta Rosh Jódesh ✗
       בשר"ה                      -> detecta Rosh Hashaná ✗
       ר"ח ניסן                   -> correcto ✓

   **Y el propio segmentador ya sabe de este problema en otro lado**: su
   `RE_ROSH_JODESH`, el que usa para leer la FECHA, exige `(?<![א-ת])` antes
   del `ר`. `detectar_festividades` no hace esa comprobación. Una defensa que
   existe en un lugar y falta en el de al lado.
   **Esto no lo encontró ninguna medición mía**: medí cuántas cartas tenían
   festividad y cuántas no, nunca si la festividad era CIERTA. El filtro del
   sitio, usado por una persona, lo mostró en diez segundos. Anotarlo como
   recordatorio de que mirar el producto no es opcional.
   Lo mide `por_que_hay_982_rosh_jodesh.sql` (19/10), probado contra el
   Postgres local con cartas que imitan los casos reales. Para distinguir
   usa `\m` (principio de palabra), porque Postgres no tiene lookbehind:
   en `הר"ח` la `ר` no está al principio de palabra y no pasa.
   El arreglo tendrá dos partes: un UPDATE que saque la etiqueta donde no
   corresponda, y el borde de palabra en `detectar_festividades` para que no
   vuelva a pasar al cortar.
34. **⚠️⚠️ Y LA REGLA QUE YO HABÍA PROPUESTO PARA ARREGLARLO ESTABA MAL.**
   Propuse exigir que `ר"ח` estuviera **al principio de una palabra**, igual
   que hace `RE_ROSH_JODESH`. Los ejemplos reales mostraron que esa regla
   tira la mitad de las buenas:

       ער"ח טבת    = VÍSPERA de Rosh Jódesh de Tevet  -> la rechazaba ✗
       מער"ח שבט   = desde la víspera de R.J. de Shvat -> la rechazaba ✗
       מר"ח מנ"א   = desde R.J. de Menajem Av          -> la rechazaba ✗
       לר"ח תשרי   = para R.J. de Tishrei              -> la rechazaba ✗

   **Son los mismos prefijos que ya me habían hecho tropezar con los años**
   (`בתשי"ד` = «en 5714», punto 12). En hebreo casi nada aparece pelado, y
   ya lo había aprendido una vez.
   Sobre los once ejemplos que pegó Ariel, mi regla acertaba **2**; la nueva
   acierta **9**.
   **LA REGLA QUE SÍ DISTINGUE MIRA LO QUE VIENE DESPUÉS, NO LO DE ANTES.**
   `הר"ח` («el Rav Jaim») y `ר"ח` (Rosh Jódesh) son la misma cadena de
   letras: lo de antes no puede decidir. Lo que decide es que **Rosh Jódesh
   es el comienzo de un mes y casi siempre lleva el mes al lado**:

       הר"ח מואלאזין -> un lugar  => nombre      ✗
       ר"ח ניסן      -> un MES    => Rosh Jódesh ✓

   Es la misma idea que el segmentador ya usa para los años abreviados
   (`leer_anio_abreviado`): aceptar una sigla de dos letras **sólo pegada al
   mes**, porque fuera de ahí no se distingue de nada.
   Lo arregla `arreglar_rosh_jodesh_y_rosh_hashana.sql` (19/10), con freno y
   probado contra el Postgres local con los casos reales: **saca 4 de 4
   nombres y conserva 5 de 5 formas legítimas**, y es idempotente.
   **LA CORRIDA DE VERDAD (982 cartas) ENSEÑÓ TRES COSAS MÁS:**
   · **`ר"ח` también es Rabeinu Jananel.** En las discusiones halájicas
     aparece `לדברי ר"ח` y `דר"ח אוסר`: no es una fecha, es un comentarista
     del siglo XI. Yo no lo había considerado y la regla del mes los saca
     igual, por el mismo motivo por el que saca los nombres.
   · **`ר"ח` está adentro de los AÑOS.** `זיטומיר תר"ח` es el año 5608 de
     una edición, y `תר"ח` contiene `ר"ח`. La regla del mes también lo saca.
   · **y el texto guardado tiene `ר'ח` con apóstrofo**, porque
     `detectar_festividades` corre sobre el texto NORMALIZADO y la base
     guarda el original. Mi expresión buscaba sólo `"` y `״`, y por eso una
     carta salía con `(sin ר"ח)`: el tag estaba bien puesto y mi regla no
     encontraba de dónde venía. Agregado el apóstrofo.
   **Y un error de cuenta que delató un error de lógica:** 982 no era
   748 + 201, faltaban 33. `dia_hebreo = 1` da **NULL** cuando no hay día
   leído, y `falso or falso or NULL` es NULL, que no es ni true ni false: 33
   cartas no caían en ninguna de las dos ramas y el UPDATE no las habría
   tocado. Resuelto con `coalesce(..., false)`.
   **Una cuenta que no cierra es siempre un error, nunca un redondeo** — y
   ésta la encontré sumando dos renglones del informe que yo mismo escribí.
   Versión `2026-10-19b`: los siete casos reales clasifican bien (4 se
   sacan, 3 se quedan, incluido `מער"ח ירחא תליתאי`, «la víspera del Rosh
   Jódesh del tercer mes», que es Siván en arameo).
   **Versión `2026-10-19c`, con las dos últimas de la segunda corrida:**
   · **`ר"ח` también es Rabí Jaim Vital**, el discípulo del Arizal
     (`תלמידו ר"ח וויטל`). Tercer nombre propio distinto escondido en dos
     letras, después de Rabeinu Jananel y Rav Jaim de Volozhin.
   · **`ר"ח הרחמים`** es «Rosh Jódesh del mes de la misericordia», o sea
     Elul: el mes está ahí pero escrito por su apodo. Agregado `הרחמים` a la
     lista de meses.
   · **Y LAS COMILLAS SON TRECE, NO TRES.** `normalizar()` unifica
     `" ״ “ ” ″ ʺ ׳ ‘ ’ ′ ʹ \`` a `"` o `'`, **y además convierte `''` (dos
     apóstrofos) en una comilla doble**. `detectar_festividades` corre sobre
     el texto normalizado y la base guarda el original, así que una carta con
     `ר''ח אלול` tenía la etiqueta bien puesta y mi regla no encontraba de
     dónde venía: salía como `(sin ר"ח)`. Mi expresión miraba tres de los
     trece caracteres.
   Los once casos reales clasifican bien: salen el año, los tres nombres
   propios y las dos citas; se quedan las seis formas legítimas.
   **Tres iteraciones sobre la misma regla, y cada una salió de mirar la
   corrida anterior.** De 2 aciertos sobre 11 a 11 sobre 11. Ninguna de las
   tres correcciones se me habría ocurrido leyendo el código.
   **Y una cuarta, `2026-10-19d`, por un efecto que no había previsto:** al
   salir tres casos de la lista de 15, entraron otros tres que antes no se
   veían. Iterar sobre una ventana de 15 no termina nunca. Lo nuevo:
   · **`אדר"ח` = `א' דר"ח`**, el primer día de Rosh Jódesh, que el
     segmentador ya reconoce en `RE_ROSH_JODESH`. Entra sin pedirle el mes,
     igual que `ער"ח`. **El `דר"ח` pelado NO**, porque ése es «que Rabeinu
     Jananel»: la `א` adelante es justo lo que los separa;
   · **`מ"ח` = `מרחשון`**, que aparece en encabezados de verdad
     (`ב"ה, אדר"ח מ"ח, תשי"ז`) y es una carta FECHADA, de las que más caro
     sale perder.
   Y la lista de ejemplos pasó de 15 a 40, para dejar de descubrir de a tres.
   **Y con los 40 a la vista, la regla se dio vuelta entera (`2026-10-19e`).**
   Los 44 casos reales (los 40 de la corrida más los de antes) están
   guardados en `pruebas_sql/casos_reales_rosh_jodesh.py`, clasificados a
   mano: **16 son Rosh Jódesh de verdad y 28 no**. Y las 28 son once
   familias, no una:

       10  honoríficos (הר"ח, הרר"ח, רהר"ח, מהר"ח: «el Rav Jaim…»)
        5  Rabeinu Jananel (דר"ח אוסר, לדברי ר"ח)
        4  Rabí Jaim Vital (ר"ח ווייטל)
        2  otros nombres
        1  el Gaón Rabí Jaim de Brisk (הגר"ח מבריסק)
        1  el Pri Jadash (הפר"ח), un libro de halajá
        1  un AÑO (זיטומיר תר"ח)
        3  citas de libros y tratados

   **La regla del mes perdía 10 de las 16 buenas**: «לאחר ר"ח» («después de
   Rosh Jódesh»), «ושבת ור"ח שמח» y «כן ר"ח כולל בתוכו» —una carta que
   EXPLICA qué es Rosh Jódesh— no llevan mes y son Rosh Jódesh igual.
   La regla nueva es al revés: **se queda salvo que sea una de las familias
   conocidas**. Y decide **aparición por aparición, no por carta**: una
   carta puede nombrar a Rabeinu Jananel en un párrafo y hablar de Rosh
   Jódesh en otro, y con la regla por carta se perdía
   `מר"ח ושבת ר"ח (הכו`, que tiene las dos cosas.
   Resultado contra los 44: **41 aciertos, y los 3 que falla los deja
   PUESTOS**, que es el lado seguro. Antes: 34, perdiendo 10 buenas.
   **La lección, y es la que más vale de todo el día:** la regla «pedir el
   mes» era *precisa* y la nueva es *generosa*, y para un buscador la
   diferencia importa. Perder una carta que sí habla de Rosh Jódesh es un
   daño invisible —nadie sabe que falta— y dejar una de más sólo cuesta un
   resultado raro que se ve y se corrige. **Cuando el error es asimétrico,
   la regla tiene que serlo también**, y yo había elegido la dirección
   equivocada cuatro versiones seguidas.

   **Sexta y última vuelta (`2026-10-19f`), con una familia más:**
   `א' דר"ח` y `ב' דר"ח` («el primer/segundo día de Rosh Jódesh»), que la
   `ד` de delante hacía caer en la exclusión de Rabeinu Jananel. Cuatro
   casos, **dos de ellos encabezados** —`ב"ה, ל' תשרי, א' דר"ח מרחשון` y
   `ב"ה בי דר"ח אד"ר`—, que son los más caros de perder. En el segundo el
   apóstrofo de `ב'` salió como una `י`, así que la expresión lo acepta.
   También salió el paréntesis de la lista de exclusiones: sacaba
   `בר"ח (סוכה לה, א)` (una cita) pero también `קודס ר"ח (ובודאי` («antes
   de Rosh Jódesh»). **Una exclusión que acierta una y falla otra no paga.**
   **Resultado final: 48 de 52, y las 4 que falla las deja PUESTAS. Cero
   cartas perdidas.**
   Queda como banco de pruebas permanente:
   `pruebas_sql/casos_reales_rosh_jodesh.py` (los 52 textos clasificados a
   mano) y `pruebas_sql/probar_la_regla_rosh_jodesh.py`, que **saca las
   expresiones del propio `.sql`** —no una copia— y falla si alguna vez se
   pierde una carta buena.
   **Corrida final de Rosh Jódesh: de 982 saca 94**, y las 40 que muestra
   son todas correctas — veinte honoríficos, seis de Jaim Vital, cuatro de
   Rabeinu Jananel, dos del Pri Jadash, `סי' תר"ח` (el *simán* 608 del
   Shulján Aruj, no una fecha), y `ודר"ח: ודרכי חסידות`, que es una lista de
   abreviaturas explicándose a sí misma. Quedan 5 casos `(sin ר"ח)` sin
   explicar; la hipótesis es que el `ר"ח` estaba en las notas del editor que
   el enriquecedor recorta DESPUÉS de que el segmentador calculó las
   festividades (`notas_editoriales_recortadas`).
38. **⚠️ Y CASI APLICO UNA REGLA QUE NUNCA MIRÉ.** El mismo archivo sacaba
   **326 de 1.023 Rosh Hashaná**, el 32%, con una regla que escribí en la
   PRIMERA versión y no revisé ni una vez — mientras le daba seis vueltas a
   la de Rosh Jódesh contra 52 ejemplos. Me di cuenta sumando los dos
   renglones del informe.
   **Es el mismo error de forma que vengo corrigiendo todo el día, pero
   peor**: no es que la regla estuviera mal, es que estaba **sin mirar**, y
   la iba a aplicar escondida detrás de otra que sí había validado. Que una
   parte de un archivo esté bien probada no dice nada de la otra.
   Versión `2026-10-19g`: Rosh Hashaná pasa a tener **su propio freno,
   apagado** (`tocar_rosh_hashana = false`). El informe cuenta sus casos y
   muestra 25 ejemplos, pero no toca nada. Se aplica cuando su regla esté
   mirada con el mismo cuidado.
39. **⚠️⚠️ Y HABER FRENADO ROSH HASHANÁ EVITÓ BORRAR 326 ETIQUETAS BUENAS.**
   De los 25 ejemplos que mostró, **23 decían «(no dice ר"ה)»**: la carta
   tiene la etiqueta y su texto no contiene la abreviatura por ningún lado.
   La explicación está en nuestro propio código:
   · **`Rosh Hashaná` está en la lista de TEMAS del enriquecedor**
     (`enriquecedor.py`, junto a Pésaj, Purim, Jánuca…), así que Gemini se
     lo pone a una carta **leyéndola**, sin que el hebreo diga `ר"ה`;
   · y el **paso 2 de `despues_de_cada_carga.sql`** mueve ese tema a la
     columna de festividades (`('Rosh Hashaná', 'Rosh Hashaná')` y
     `('saludos de año nuevo', 'Rosh Hashaná')` están en su mapa).
   **Esas etiquetas no vienen del detector de subcadenas: vienen del modelo
   que leyó la carta. Son las mejores que hay, no las peores.** Y el mapa
   tiene también `('Rosh Jodesh', 'Rosh Jódesh')`, así que las 5
   `(sin ר"ח)` de Rosh Jódesh eran lo mismo.
   **La regla nueva (`2026-10-19h`), y es la más importante de todas:
   si el texto NO contiene la abreviatura, la regla no juzga.** Una regla
   sólo puede opinar sobre lo que ella misma podría haber producido.
   Resultado: Rosh Jódesh baja de 94 a 89 y Rosh Hashaná, cuando se mire,
   va a quedar en una fracción de 326.
   **Dos lecciones del mismo hallazgo:**
   · frenar lo no validado no fue prudencia abstracta: **evitó borrar 326
     etiquetas correctas**, y las habría borrado en el mismo UPDATE que una
     regla que sí estaba bien;
   · y la explicación no estaba en los datos sino **en nuestro propio
     código, en dos archivos distintos que se combinan**. Los 23 «(no dice
     ר"ה)» eran la pregunta; la respuesta estaba en `enriquecedor.py` y en
     `despues_de_cada_carga.sql`.
   La prueba `probar_la_regla_rosh_jodesh.py` también hubo que arreglarla:
   leía sólo las condiciones `~` y no las `!~`, así que daba por perdida una
   carta que la regla conserva. **El medidor otra vez atrasado respecto de
   lo medido** — tercera vez en el día.
   Los catorce casos reales clasifican bien: salen el año, los tres nombres
   propios y las dos citas; se quedan las ocho formas legítimas.
   **La lección de las cuatro vueltas:** una regla sobre texto hebreo de OCR
   no se termina de escribir en el escritorio. Cada corrida mostró una
   familia que yo no sabía que existía — Rabeinu Jananel, los años `תר"ח`,
   las trece comillas, el mes por su apodo. Y la ventana de ejemplos tiene
   que ser más grande que la cantidad de familias que uno espera encontrar.
40. **✅ APLICADO (19/10): `arreglar_rosh_jodesh_y_rosh_hashana.sql`, versión
   `2026-10-19i`. Rosh Jódesh 982 → 912 (sacó 70) y Rosh Hashaná
   1.023 → 1.000 (sacó 23).** Los dos frenos encendidos.
   Los dos últimos arreglos fueron **el mismo error mío por tercera vez**:
   · Rosh Jódesh: `דר"ח ניסן, תשל"ג` (encabezado de `igrot_28 p219`) se
     perdía porque la `ד` estaba prohibida (por `דר"ח אוסר` = Rabeinu
     Jananel) y no había א ni ב delante. Excepción nueva: **`דר"ח` seguido
     del nombre de un MES se queda.** Sólo agrega cartas, nunca saca, así
     que no puede romper lo ya validado. Recuperó 2 (72 → 70).
   · Rosh Hashaná: la regla permitía **un** prefijo (`[בלמוהשכע]?`) y por eso
     tiraba `יום א דר"ה`, `בער"ה`, `כשר"ה`, `שבר"ה` y `דר"ה לאילנות` (que es
     Tu BiShvat). Pasó al mismo esquema que terminó funcionando para `ר"ח`:
     **lista corta de letras PROHIBIDAS pegadas antes —`ה ג ר ת`— en vez de
     lista de prefijos permitidos.** En hebreo casi nada aparece pelado; es
     la tercera vez que esto me muerde (`בתשי"ד`, `מער"ח`, ahora `דר"ה`).
   **Las 23 de Rosh Hashaná, revisadas una por una, son cuatro familias y
   ninguna es una fecha:** `הר"ה מפאריטש` ×6 (Hilel de Paritch), los
   honoríficos `הר"ה"ח` / `הר"ה"ג` / `מוהר"ה` / `הגר"ה`, `כתר"ה` (= כבוד
   תורתו הרמה, el tratamiento al destinatario) y `תר"ה` / `רסתר"ה` (un año y
   un *simán*).
   **Y un hallazgo que cierra el círculo con la sección de los años:**
   `הר"ה"ח` es `הרה"ח` **con la comilla corrida de lugar por el OCR**.
   Escrito bien, `הרה"ח` no contiene `ר"ה` por ningún lado y nunca habría
   recibido la etiqueta. Cinco cartas estaban etiquetadas como Rosh Hashaná
   **por una comilla mal puesta** — exactamente el defecto `תש"יז` de los
   años, en otra columna.
   Infraestructura nueva: `pruebas_sql/reglas_del_sql.py` saca las
   expresiones del `.sql` partiéndolo por el nombre de la columna
   (`as rj_se_queda`) en vez de por «tiene una ח», que funcionaba de
   casualidad; `pruebas_sql/casos_reales_rosh_hashana.py` +
   `probar_la_regla_rosh_hashana.py` (15 de 15, 0 perdidas); y el esquema de
   prueba tiene los casos `k*` y `m*`, así el `דר"ח ניסן` y los tres nombres
   de `ר"ה` se verifican también **contra un PostgreSQL de verdad**, no sólo
   con el motor de regex de Python.
   Rosh Jódesh: **52 de 56 casos, 0 perdidas.** Las 4 de más (`לדברי ר"ח`,
   `בר"ח שי היראה`, `שר"ח ס"ה`, `בר"ח (סוכה לה, א)`) se dejan a propósito:
   una etiqueta de más se ve, una de menos no.

37. **LAS DOS DECISIONES QUE TOMÓ ARIEL EL 19/10:**
   1. **El filtro de festividades va a mostrar LOS DOS GRUPOS SEPARADOS**:
      «Pésaj — fechadas (110)» y «Pésaj — la mencionan (1.147)». Se conserva
      todo y el visitante elige. Hay que cambiar `facetas_de_cartas` (arma el
      desplegable) y `buscar_cartas` (filtra), las dos **dentro de Supabase,
      no en el repositorio de GitHub**, más lo que haga falta en el sitio.
   2. **Se arregla TODA la cola larga de 249 etiquetas**, no sólo las 12
      formas rotas de `emuná`. La parte mecánica —las que tienen caracteres
      de otro alfabeto— la puedo proponer sola; la de criterio (¿es
      `arrepentimiento` lo mismo que `teshuvá`?) la decide Ariel sobre una
      lista.
   Primer paso del punto 1: `que_funciones_usa_el_sitio.sql` (19/10), que
   devuelve el código de esas funciones con `pg_get_functiondef`. **No las
   voy a reescribir de memoria**: una función que no leí es una función que
   no conozco, que es la misma lección del `c.libro`.
35. **LA PREGUNTA DE PRODUCTO QUE DESTAPÓ TODO ESTO.** De las 982 de Rosh
   Jódesh, **417 están FECHADAS en la festividad y 565 sólo la MENCIONAN**.
   Y no es sólo ésa: Pésaj tiene **1.257 cartas y sólo 110 fechadas**. El
   sitio lee las dos columnas para el filtro (se arregló así a propósito,
   ver «El filtro de festividades miraba una sola columna»), de modo que
   **el filtro está dominado 5 a 1 por menciones de pasada**. Eso es lo que
   lo hace sentir roto, más que los falsos positivos. Es una decisión de
   Ariel, no mía: filtrar por «fechada en» es preciso y chico, filtrar por
   «habla de» es amplio y ruidoso. Una salida intermedia: mostrar las dos
   cosas separadas en el desplegable.
36. **LA FAMILIA `emuná` ESTÁ CORROMPIDA A NIVEL DE LETRA, NO DE TILDE.**
   Después del plegado quedan **13 formas**, 12 de ellas rotas, 23 cartas en
   total: `emund`, `emunar`, `emuno`, `emuntá`, `emunة` (¡con una TEH
   MARBUTA árabe adentro!), `emuna_y_confianza`, `emunak vebitajon`,
   `emunak`, `emundá`, `emúnָh` (con un niqud hebreo), `emunidad`, `emunt`.
   **Es la misma contaminación entre alfabetos que arreglamos en el texto
   hebreo en la sección 23, ahora adentro de una etiqueta en español**: el
   modelo escribió la etiqueta mirando un texto contaminado. El plegado por
   tildes no las toca porque no son tildes. Pendiente, y hace falta otra
   regla: agrupar por las palabras que NO están rotas (todas terminan en
   `y confianza`) o por cercanía contra las etiquetas limpias.
13. **Enriquecer los 14 tomos nuevos** — cuaderno 03. La sección 4 carga
   TODOS los `.jsonl` menos el 12 (**14.049 cartas**), y
   `enriquecer_en_tandas` saltea las ya hechas por `ids_ya_hechos`, así que
   **`ya_estaban` tiene que decir 8.080** y sólo se enriquecen las **5.969**
   nuevas: 1.194 llamadas a 5 cartas por tanda, unas 2 horas.
   **Si `ya_estaban` sale cerca de 0, hay que parar**: significaría que va a
   volver a pagar 8.080 cartas ya enriquecidas.
   OJO: en el cuaderno guardado, la sección 6 ya tiene `CONFIRMO = True`.
   **La sección 5 prueba `cartas[:3]`, que son del TOMO 1** —ya enriquecido y
   cargado— así que no dice nada sobre los 14 nuevos. La celda
   `PEGAR_EN_03_SECCION_5c_PROBAR_CON_LAS_NUEVAS.py` (16/10) prueba 6 cartas
   elegidas de los tomos nuevos, una por caso que puede salir mal: una
   normal de largo típico, una con `anio_fuera_del_tomo`, una sin fecha, una
   sin ב״ה, la más corta y la más larga. La «normal» se toma del MEDIO del
   reparto de largos a propósito: tomando la primera resultaba ser también la
   más corta y dos de los seis casos se pisaban.
   **Resultado de la 5c (16/10), 5 casos:** la normal del tomo 8 salió
   perfecta (fecha, temas, resumen); **la basura dio `tipo: ilegible` y la
   lista de números dio `tipo: indice`, sin inventar resumen** — eso es la
   propiedad que más importaba y pasó. Falla: una «carta» del tomo 18 de
   **33.619 caracteres** que empieza con una lista de numerales (כט ל לא)
   recibió `tipo: carta`, un resumen convincente y confianza 0,95. Es el
   aparato del principio del tomo, no una carta. El `tipo` del enriquecido
   es el filtro para sacarlas después (sección 19 del cuaderno 02).
14. **Después del enriquecido**: vectores (cuaderno 04) → sección 7 →
   `despues_de_cada_carga.sql`.
15. **El límite por IP en `/api/traducir`** — Vercel → Firewall → Rate Limiting,
   unos 20 pedidos por minuto.
3. ~~Sacar el parche del tiempo~~ — resuelto el 12/10: el límite de `anon`
   quedó en **10 s** y la búsqueda anda holgada adentro. Si alguna vez hay que
   cambiarlo, son dos líneas y la segunda es imprescindible:
   `alter role anon set statement_timeout = '10s';` y después
   `notify pgrst, 'reload config';` — **sin el `notify`, la API no se entera**,
   que es lo que nos hizo perder medio día el 11/10.
5. **Los 4 tomos ya traducidos** (`מתורגמות`, 1.633 páginas) — postergado hasta
   medir cuánto se solapan con lo que ya hay.

### Si algún día la búsqueda vuelve a ponerse lenta

Correr `medir_por_que_tarda_la_busqueda.sql`, que mide las cuatro partes por
separado. De los 0,06 s de hoy, la parte de vectores es apenas una décima: el
resto se lo llevan las ramas de texto y el **conteo de coincidencias** (0,46 s
medidos), que es lo que permite decir «184 cartas» en vez de «muchas». Ése es
el próximo candidato a optimizar, y sólo si molesta.

---

## 8. Cosas conocidas que no están resueltas

- **`ת'נ'צ'ב'ה'`** termina en `ב' ה'` y se lee como una apertura falsa.
- El **encabezado corrido del kuntres** (`<número>` + `מכתב`) no se saca nunca,
  así que algunos encabezados son en realidad un número de página.
- **408 cartas** son colas rescatadas de cartas que empiezan en otro archivo.
- **302 cartas** son pasajes sin ב"ה: el kuntres los publicó empezando en mitad
  de una oración.
- **El tomo 12 queda afuera** a propósito: su OCR está cortado en la página 82
  de 512.
- **NO hay un tope diario que se note.** El 12/10 sumé 20 + 476 + 4 = 500
  exactos y concluí «la cuota diaria es 500». **Estaba mal**: el 13/10 pasaron
  988 páginas en un día. Un número redondo que cierra una vez es una
  coincidencia, no una medición. Lo que frena de verdad son **rachas de
  congestión** (`503 overloaded`) y **límites por minuto** (`429 PerMinute`),
  los dos pasajeros: se resuelven esperando, no rindiéndose. La cuota diaria
  existe en los mensajes de Gemini (`PerDayPerProjectPerModel`) y es por
  modelo, pero no la vimos actuar.
- **Una página que falla NO se arregla haciéndola más chica.** La idea de
  bajar el DPI ante una falla nunca se demostró útil (la 421 falló igual a 238
  y a 159 kB) y el 13/10 degradó cuatro páginas del tomo 5 al disparar sobre
  un `429 por minuto`, donde el tamaño de la imagen no juega ningún papel.
  Sacado de la sección 21. Las cuatro se rehacen solas desde
  `rescatadas_a_revisar.json`.
- **Un límite por minuto no debe gastar intentos.** No es una falla del
  pedido, es un «todavía no». El 13/10 siete páginas quedaron sin hacer y la
  corrida se detuvo por una racha que habría pasado sola. Ahora las esperas
  doblan (30 s, 1, 2, 4 min) y no consumen intento.
- **La página 421 del tomo 4 costó tres corridas y salió a 120 DPI.** Falló
  con `503` y con la conexión cortada a los 60 s, con los dos modelos, tres
  veces seguidas. **No era el tamaño:** la imagen pesa 238 kB a 200 DPI, y a
  120 DPI pesaba 159 kB y recibió el mismo 503. Salió al cuarto intento, a
  120 DPI. No sé por qué esa página; lo que importa es que una sola página
  rebelde ya no paraliza la corrida.
- **Una página rescatada a menor DPI queda en el corpus para siempre.** Una
  vez en el `_paginas.json`, `que_falta` no la vuelve a pedir nunca. Por eso
  la sección 21 las anota aparte en `rescatadas_a_revisar.json`: sin eso, la
  pérdida de calidad es invisible y no se puede rastrear.
- **Un freno que no distingue «falla la página» de «falla el mundo» paraliza
  todo.** El del 12/10 («cero páginas en este tomo → parar») convirtió una
  página rebelde en 6.172 páginas sin hacer. Lo correcto es saltear la página
  —no queda en el archivo, así que `que_falta` la vuelve a pedir— y parar sólo
  si fallan cinco seguidas.
- **Un corte de red NO es un modelo sobrecargado.** `HTTPSConnectionPool`
  pasa entre Colab y Google y no dice nada del modelo; `503 This model is
  currently overloaded` sí. El 13/10 los tenía en la misma bolsa, y por eso
  la celda abandonó `flash-lite` (476 páginas seguidas sin un error el día
  anterior) por un corte de red.
- **Cambiar de modelo tiene que poder DESANDARSE.** El `cual_modelo += 1` del
  13/10 era de ida nomás: una vez en `flash-latest`, que estaba congestionado,
  no había vuelta. 23 de los 24 errores de ese día fueron del modelo al que se
  cambió. La cuota agotada sí es definitiva (no vuelve hasta mañana); la
  sobrecarga no.
- **`gemini-flash-latest` gratuito se congestiona por rachas** y devuelve
  `503` muchas veces seguidas. `gemini-flash-lite-latest` aguantó 476 páginas
  seguidas sin un error. Ante la duda, el lite.
- **Un informe que miente es peor que no informar.** El 13/10 la celda paró
  por sobrecarga y dijo «se acabó la cuota de hoy; hoy entraron 3 páginas: ése
  es tu límite diario». Las dos frases falsas, y la segunda convertía un
  número sin sentido en un dato del proyecto. Cada motivo para parar necesita
  su propio aviso: **ninguno puede hablar en nombre de otro.**
- **No buscar `rate` dentro del texto de un error de Gemini.** Cuando se
  acaba la cuota del día, el mensaje dice «please mig**rate** to a paid plan».
  Y «per day» va pegado y con mayúsculas intercaladas (`PerDayPerProject`).
  Comparar sobre el texto sin espacios ni signos, y nunca con `rate` solo.
- **EL CORPUS TIENE 29 TOMOS Y 13.456 PÁGINAS**, no 14 y 6.627. En
  `igrot_cache` están también los tomos 1, 2 y 20 a 32, de las corridas
  viejas. Medido el 15/10 con la sección 22.
- **Las letras intrusas NO son al azar: son el MISMO alfabeto semítico.**
  Medido el 15/10 sobre las 13.456 páginas: 4.169 páginas (31%) afectadas,
  7.464 palabras rotas de 3,1 millones (0,24%), 14.587 letras intrusas de
  12,5 millones (0,12%), 425 caracteres distintos. Las 20 más frecuentes
  explican sólo el 68% — y **ése era el criterio equivocado**. Lo que importa
  no es cuántos caracteres hay sino si cada uno tiene reemplazo determinado,
  y lo tiene: `و` WAW→ו VAV, `ي` YEH→י YOD, `ر` REH→ר RESH, `ل` LAM→ל LAMED,
  `م` MEEM→מ MEM, `ن` NOON→נ NUN, `ب` BEH→ב BET, `ه` HEH→ה HE. El modelo no
  se equivoca de forma: se equivoca de abecedario. Lo mismo con el griego
  (ι→י, δ→ד) y el cirílico (м→מ, и→י).
- **Pero la tabla sola no alcanza, y el juez es el corpus.** El árabe tiene
  una sola `ت` donde el hebreo tiene ת y ט: `לקוتي` con la tabla da `לקותי` y
  la palabra real es `לקוטי`. La sección 23 prueba todas las combinaciones y
  **sólo acepta la que ya existe entre las palabras limpias del propio
  corpus**, con al menos 3 apariciones y ganando 4 a 1 a la segunda. Si no
  puede verificar, no toca.
- **⚠️ BORRAR UNA LETRA NO PUEDE COMPETIR DE IGUAL A IGUAL CON REEMPLAZARLA.**
  El peor error del proyecto, y lo frenó el freno. Al permitir que «borrar
  esta letra» fuera una candidata más, y siendo el juez la frecuencia en el
  corpus, **borrar ganaba siempre**, porque en hebreo la palabra más corta es
  casi siempre más frecuente:
  `ויהי` → `י` (15.018 contra 2.367, en 95 páginas), `למה` → `מה` (3.922
  contra 558), y `וברכה` quedaba sin arreglar porque `ברכה` le empataba.
  El freno de «más prueba cuanto más se adivina» NO lo detecta, porque la
  candidata falsa tiene muchísima prueba.
  **La regla:** el corpus sabe juzgar entre candidatas COMPARABLES, no entre
  una palabra y un pedazo de otra. Las candidatas se agrupan por cuántas
  letras se borraron, y los niveles se miran en orden: reemplazar todo
  primero; borrar una letra sólo si en el nivel anterior no hubo nada.
- **Al deducir del nombre Unicode se perdieron las latinas de una letra.**
  `LATIN SMALL LETTER N` no tiene nombre semítico, así que `n`, `m`, `r`,
  `s`, `t`, `b`, `d` se quedaron sin reemplazo y `ברוקליn` dejó de
  arreglarse. Las de una sola letra van a mano, siempre.
- **El nombre Unicode de una letra dice qué letra semítica es**, en todos los
  alfabetos que descienden del fenicio: `ETHIOPIC SYLLABLE LA` es lamed,
  `ARMENIAN SMALL LETTER HO` es he, `GEORGIAN LETTER SHIN` es shin, `THAI
  CHARACTER DO DEK` es dalet. Eso ahorra escribir una tabla por alfabeto y
  cubre los que todavía no aparecieron. El coreano es la excepción: sus
  signos se llaman MIEUM, RIEUL, SIOS, y van a mano.
- **Hay que buscar sin nikud y devolver con nikud.** `אַהבת` no estaba en el
  corpus porque el corpus casi no tiene vocales; la vocal es parte del libro
  y se conserva en lo que se escribe.
- **Candidatas repetidas = «empate» contra sí misma.** `candidatas('ברוקליn')`
  devolvía `ברוקלין` dos veces (una por la tabla `n`→ן, otra por la regla de
  formas finales sobre la variante con נ), y el juez lo leía como dos rivales
  parejas y se negaba a arreglar. Miles de palabras habrían quedado sin tocar.
  Hay que deduplicar las candidatas.
- **✅ EL ARREGLO DE LETRAS, VERIFICADO el 16/10.** Palabras mezcladas
  7.464 → **1.530 exactas** (lo predicho). Páginas afectadas 4.169 → 1.276
  (31% → 9,5%). Letras intrusas 14.587 → 3.444. Y las cuentas del bloque B
  cierran solas: el hebreo ganó 9.921 letras, los otros alfabetos perdieron
  11.143, y el total bajó 1.222 — o sea 9.921 reemplazos y 1.222 borrados, y
  el borrado fue el 11% del arreglo, que es lo que se espera de un último
  recurso. Esa cuenta cruzada es la verificación, no el «se arreglaron 5.934».
- **⚠️⚠️ LAS 104 PÁGINAS «EN RUSO» SON CARTAS DE VERDAD, NO BASURA.**
  Leído el texto el 16/10: la del tomo 29 página 254 tiene número de carta
  (יא׳קצד), fecha hebrea (כ״ז תמוז ה׳תשל״ד), ב״ה y Brooklyn, y el cuerpo
  `Xa6afl Xay3 KnHBnaHfl IIIonoM H Bpoxo` es «Хабад Хаус Кливленд — Шолом и
  Брохо». **Son las cartas que el Rebe escribió en ruso**, y hoy no se pueden
  encontrar porque el OCR puso latinas parecidas en lugar de las cirílicas.
  **Yo estuve a punto de recomendar borrarlas** por haber clasificado sin
  leer. Se concentran en los tomos 25 a 32 (27 en el 27, 36 en el 28, 23 en
  el 29). Hay que REHACERLAS pidiéndole a Gemini que transcriba el cirílico
  como cirílico, que es lo que el PEDIDO actual no dice.
- **⚠️ UNA LISTA DE SEÑAS DE BASURA NO PUEDE CONTENER NADA QUE UN LIBRO
  TENGA IMPRESO.** Esta lección la aprendí DOS VECES el mismo día: `.com` y
  `www.` marcaron las páginas de créditos (`www.kehot.com` está impreso), y
  `||` marcó las portadas y los índices, donde las rayas del marco se leyeron
  como barras verticales. De las 13 «alucinaciones» del inventario, 6 eran
  esto. Las 7 verdaderas (`npmjs`, `inheritdoc`, `resourceUrl`,
  `hasOwnProperty`, y tres con etiquetas `</div`) están en los tomos 14, 15,
  18 y 19, o sea los que se transcribieron con Gemini vision esta semana:
  7 de 6.627 páginas, el 0,1%.
- **Las 7 páginas de «código alucinado» eran PÁGINAS DE CRÉDITOS.** Mi lista
  de señas incluía `.com` y `www.`, y encontró `www.kehot.com` impreso de
  verdad en el libro. Buscar señas de código y encontrar una dirección real
  es un error de la lista, no del OCR. Lección: una lista de señas de basura
  no puede contener nada que un libro pueda tener impreso.
- **Las 18 de «párrafos en alfabeto latino» son FACSÍMILES** (`פאקסימיליות`):
  fotos de cartas manuscritas con el membrete legible y el resto ilegible.
  Ningún OCR las va a leer. Se excluyen, no se rehacen.
- **⚠️ Y SÍ HAY ALUCINACIONES DE CÓDIGO, pero no ahí.** En los ejemplos de la sección 22
  `וinheritdoc`, `נresourceUrl`, `שnpmjs` y `בhasOwnPropertyוננתם` están en
  el corpus, y ésos sí son nombres de programación que ningún libro tiene.
  Están en páginas con MUCHO hebreo, así que no entran en el bloque C y la
  sección 24 las buscó donde no estaban. Los busca la sección 25, en las
  13.456.
- **⚠️ Y PÁGINAS EN RUSO MAL TRANSCRIPTO**, con latinas que imitan las
  cirílicas: `דרגאJJpyrHMH` (ДРУГИМИ), `nncaHHOM` (написанном), `עTpyflHO`
  (трудно), `ברכותj1arocn0BeHHa` (благословенна). «n» por «п», «H» por «н»,
  «fl» por «д», «0» por «о», «1» por «л».
- **148 páginas (1,10%) tienen menos del 80% de hebreo** y son más graves que
  cualquier palabra rota: una página en castellano ensucia la búsqueda. Se
  concentran en los tomos 25 a 32. La página 2 de los tomos 29, 30, 31 y 32
  da 0% con unos 1.000 caracteres: casi seguro portada o créditos.
- **Letras de otro alfabeto dentro de palabras hebreas** en lo que devuelve el
  OCR: `להקriv`, `ועלينو`. Medido en 2 de las 3 páginas de muestra del 12/10.
  La «proporción de hebreo» **no lo detecta**: once letras latinas sobre
  cuarenta y tres hebreas siguen dando 99%, así que hay que contar las letras
  intrusas aparte (`esta_sospechosa` en la sección 21 lo hace). No se arregla
  automáticamente a propósito: no hay forma de saber qué decía `להקriv` sin
  mirar el original.

---

## 9. Errores que cometí yo, para que no se repitan

Los dejo escritos porque el patrón se repite y reconocerlo ahorra tiempo.

- **Generalizar desde un ejemplo.** Me pasó tres veces: la receta de
  codificación de la sección 18 (era falsa: los archivos son extractos), el
  arreglo de las fechas entre corchetes (recuperó 34, no 334), y la hipótesis
  del cajón de sastre.
- **Medir mal y creerle a la medición.** Comparé la fecha del nombre contra
  todas las cartas del PDF en vez de la que la fecha, y contra la ortografía
  equivocada en el bloque B del diagnóstico.
- **Avisar de más.** Predije que 10 cartas quedarían sin tema (fueron 0), que
  un freno iba a saltar (no podía), y que un número bajaría de 55 a 42 (se
  quedó en 55, y tenía que quedarse).
- **Un arreglo peor que el problema.** Mi primer control de «Drive ya está
  montado» aceptaba una carpeta vacía: cambié una negativa ruidosa y correcta
  de Colab por un estado equivocado y silencioso.
- **Una prueba que no probaba nada.** Mi `drive.mount` de juguete se portaba
  distinto del real justo en lo que la prueba decía probar.
- **Dar instrucciones para una herramienta que Ariel no tiene.** Le expliqué
  cómo usar git y GitHub Desktop cuando sube los archivos por la web.
- **Contar la unidad equivocada y decidir con ese número.** La sección 28
  contó 1.688 «años mal escritos» en el texto de las páginas y su veredicto
  mandó tocar 6.627 páginas. Lo que decide son las fechas de las cartas, y
  ésas se leen sólo del encabezado: la mayoría de esos 1.688 eran índices de
  años y verbos hebreos (`תשוב`, `תשיב`). Peor: escribí los umbrales del
  veredicto («menos de 50 / más de 50») **antes** de haber mirado dónde
  vivían los tokens. Una regla sobre un número no es una regla sobre el
  problema.
- **Deducir qué hace nuestro código en vez de correrlo.** Dos veces: el
  `c.libro` que no existe (la verdad estaba en `cargador.py`) y la lectura
  del año (la verdad estaba en `sg.leer_anio`, que no lee `תשיז` como año).
  Las dos veces la respuesta estaba a una corrida de distancia.

La regla que sale de todo esto: **medir antes de construir, y cuando no se
puede medir, decirlo en vez de elegir por corazonada.** Y medir **la unidad
que decide**, preguntándole al código y al corpus, no a mi lectura de ellos.
