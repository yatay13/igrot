# Los archivos SQL

Se pegan en **Supabase → SQL Editor → New query** y se corren ahí. No se
ejecutan desde el sitio ni desde el repositorio: están acá para que existan en
más de un lugar.

La lección de la sección 13 de `ESTADO_DEL_PROYECTO.md` fue *«un archivo que
existe en un solo lugar no existe»*, y durante semanas estos vivieron sólo en
un contenedor que se borra. Esto lo corrige.

## Qué hace cada uno

| archivo | qué hace | estado |
|---|---|---|
| `estado_de_los_vectores_hoy.sql` | mide la tabla `chunks` y cuánto falta vectorizar. No cambia nada. | se puede correr siempre |
| `revisar_la_seguridad_de_la_base.sql` | revisa RLS, permisos, políticas, funciones `SECURITY DEFINER` y el techo de gasto. No cambia nada. | **sin correr todavía** |
| `preparar_la_vectorizacion.sql` | crea `vectores_pendientes`, `guardar_chunks_de_carta` y `avance_de_vectores`. | aplicado |
| `techo_por_visitante.sql` | techo de gasto por persona, con huella irreversible en vez de la IP. | aplicado |
| `conversor_de_fechas_hebreas.sql` | el calendario hebreo adentro de Postgres, para no depender de Colab. | **sin correr todavía** |
| `arreglar_la_comilla_de_nuevo.sql` | el OCR escribía `"` como dos yods. 991 palabras, 35.545 caracteres. | aplicado |
| `arreglar_lugar_y_destinatario.sql` | normaliza lugares y vacía destinatarios que eran basura de OCR. | aplicado |
| `controles_de_los_vectores.sql` | controles de la etapa de vectores. | medición |
| `que_pasa_con_lugar_y_destinatario.sql` | la medición previa al arreglo de lugar/destinatario. | medición |

## Las reglas que no hay que olvidar

- **Después de cada carga que toque `cartas`, correr `despues_de_cada_carga.sql`.**
  Ese archivo todavía no está acá: vive en las descargas de Ariel y hay que
  subirlo. Está pendiente actualizarlo para que rehaga también la comilla, la
  limpieza del hebreo y lugar/destinatario.
- Los archivos que **miden** no cambian nada y se pueden correr cuando sea.
  Los que **aplican** traen su propio interruptor o su propia prueba, y varios
  se cancelan enteros si encuentran algo que no esperaban.
- `texto_tsv` y `busqueda_es` son columnas generadas y se recalculan solas al
  escribir. Los `chunks` **no**: si cambia el texto de una carta, sus vectores
  quedan viejos y hay que rehacerlos desde `/tareas`.
