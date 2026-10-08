/** @type {import('next').NextConfig} */

// En desarrollo Next compila en el navegador y necesita `eval`. En producción
// no, y ahí no hay que regalárselo.
const enDesarrollo = process.env.NODE_ENV !== "production";

// La política de contenido. Vale la pena explicar cada renglón, porque una CSP
// copiada de internet se rompe en el primer despliegue y entonces se borra
// entera, que es lo peor de los dos mundos.
const CSP = [
  // Nada se carga de otro sitio salvo lo que se permita abajo.
  "default-src 'self'",
  // `unsafe-inline` hace falta: Next pone en la página un script en línea para
  // arrancar React. Se saca sólo si se adoptan `nonce`, que obliga a renderizar
  // todo dinámicamente y pierde el cacheado. No vale la pena acá.
  `script-src 'self' 'unsafe-inline'${enDesarrollo ? " 'unsafe-eval'" : ""}`,
  // Lo mismo para los estilos que Next inserta en línea.
  "style-src 'self' 'unsafe-inline'",
  // Las tipografías se sirven desde el propio sitio: `next/font` las descarga
  // en el momento de compilar y las deja junto a la aplicación. Por eso acá
  // dice 'self' y no hay ningún dominio de Google.
  "font-src 'self'",
  "img-src 'self' data:",
  // El navegador sólo habla con este sitio: todas las llamadas van a /api.
  "connect-src 'self'",
  // Nadie puede meter el sitio dentro de un marco en otra página.
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Que una URL http:// de un recurso se pida como https://.
  "upgrade-insecure-requests",
].join("; ");

const cabeceras = [
  // No adivines el tipo de un archivo por su contenido: respetá lo que digo.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Al salir del sitio no mandes la URL completa. Importa porque la consulta
  // de búsqueda viaja en la página y no tiene por qué llegarle a un tercero.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // `frame-ancestors` de arriba es el control moderno; esto es para los
  // navegadores viejos que no lo miran.
  { key: "X-Frame-Options", value: "DENY" },
  // El sitio no usa nada de esto. Decirlo evita que un día lo use sin querer.
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), " +
      "magnetometer=(), gyroscope=(), accelerometer=()",
  },
  { key: "Content-Security-Policy", value: CSP },
  // Vercel ya manda HSTS en sus dominios; con esto queda puesto igual si algún
  // día el sitio se sirve desde otro lado.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

module.exports = {
  reactStrictMode: true,
  // La versión de Next no se anuncia en cada respuesta. No es una vulnerabilidad
  // por sí misma; es información que no le hace falta a nadie de afuera.
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: cabeceras },
      // Ninguna ruta de la API tiene que aparecer en un buscador.
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      // Y las tres que dependen del pedido no se guardan en ningún
      // intermediario. Van nombradas una por una A PROPÓSITO: `/api/facetas`
      // queda AFUERA porque declara `revalidate = 60` y su respuesta es igual
      // para todo el mundo —las listas de tomos, temas y fechas—, así que que
      // se cachee es justamente lo que hace que el sitio aguante visitas. Un
      // `no-store` sobre todo `/api/*` habría apagado eso sin que se note.
      {
        source: "/api/:ruta(buscar|carta|traducir)",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};
