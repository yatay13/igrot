# Urgente: esto te destraba la vectorización

Te frenaste en 12.251 de 13.613 con el mensaje **«sin modelos de embeddings»**.
No era la cuota: eran tres errores míos, en cadena.

1. **La lista de modelos de Google viene paginada** —de a 50, con un token
   para pedir el resto— y yo leía sólo la primera página. Anduvo meses porque
   los modelos de embeddings entraban ahí. Google fue sumando modelos y en
   algún momento quedaron en la segunda página.
2. **La lista mala se guardaba en memoria.** La condición decía `||` donde
   iba `&&`, así que una copia del servidor que recibía una lista sin
   embeddings quedaba rota *mientras viviera*. Por eso las doce cartas de cada
   tanda fallaban todas en el mismo segundo.
3. **No había plan B.** Ahora, si la lista no trae ninguno, usa los nombres
   que ya conocemos.

Mis tests no veían nada de esto porque mi Gemini de mentira contestaba toda la
lista en una sola página. Ya pagina, y hay tres tests nuevos que **fallan con
el código viejo y pasan con el arreglado** — lo comprobé volviendo a poner el
error a propósito.

## Cómo subirlo

1. Descomprimí el `.zip` → **Extraer todo**.
2. `https://github.com/yatay13/igrot` → **Add file** → **Upload files**.
3. Seleccioná **sólo estas seis cosas**:

       .github     app     pruebas     sql
       package.json        ESTADO_DEL_PROYECTO.md

   **NO** el `LEEME-PRIMERO.md`.
4. Arrastralas. Fijate que aparezcan **con su carpeta adelante**.
5. Mensaje: `La lista de modelos de Gemini viene paginada` → **Commit changes**.
6. Esperá el tilde verde ✓ y que Vercel publique (uno o dos minutos).
7. Para confirmar que entró: abrí
   `https://igrot.vercel.app/api/version`. Tiene que decir **`2026-11-19`**.
8. Recargá `/tareas`, pegá la clave y **Empezar**. Sigue desde las 12.251.

Si este paquete incluye archivos que ya habías subido, no pasa nada: GitHub
los reemplaza por los mismos.

## Lo que falta después

- Terminar la vectorización: 1.362 sin vector y 2.053 viejos.
- Correr `sql/revisar_la_seguridad_de_la_base.sql` (nunca se corrió).
- Correr `sql/conversor_de_fechas_hebreas.sql` y arreglar las fechas.
- Subir `despues_de_cada_carga.sql`, que sigue existiendo sólo en tus
  descargas.
