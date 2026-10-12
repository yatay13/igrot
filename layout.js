import "./globals.css";
import { Frank_Ruhl_Libre, Inter } from "next/font/google";

// LAS TIPOGRAFÍAS, QUE HASTA AHORA NO SE CARGABAN.
//
// `globals.css` pedía `font-family: "Frank Ruhl Libre", ...` para el hebreo,
// pero esa tipografía no se cargaba en ninguna parte: no había `@font-face`, ni
// `<link>` a Google Fonts, ni `next/font`. Así que el navegador pasaba de largo
// y caía en `"Times New Roman", "David", serif`. El hebreo del sitio se estaba
// leyendo en la tipografía de reserva, y esa es la diferencia estética más
// grande que tiene esta página: es texto rabínico, se lee en renglones largos y
// de derecha a izquierda, y la letra decide si se puede leer de corrido o no.
//
// Frank Ruhl es la elección correcta y no por capricho: es una letra hebrea con
// serifas diseñada para texto corrido, la que usan los libros, y tiene las
// formas abiertas que hacen falta cuando el original viene de un OCR y hay
// abreviaturas con comillas por todas partes.
//
// `next/font` las DESCARGA AL COMPILAR y las deja servidas desde el propio
// sitio. Eso importa por tres cosas: la página no le pide nada a Google cuando
// alguien la abre (ni le cuenta a Google quién la abrió), no hay un salto de
// tipografía al cargar porque Next genera el `@font-face` con `size-adjust`, y
// la política de contenido puede decir `font-src 'self'` sin excepciones.
// Sin `weight`: las dos son tipografías VARIABLES —lo verifiqué en el catálogo
// que trae esta versión de Next, `font-data.json`, donde las dos listan
// "variable" y un eje `wght` de 300 a 900—. Un solo archivo cubre todos los
// grosores, pesa menos que tres archivos estáticos y no hay manera de pedir un
// grosor que no exista.
const hebreo = Frank_Ruhl_Libre({
  subsets: ["hebrew", "latin"],
  display: "swap",
  variable: "--tipo-hebreo",
});

const latina = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--tipo-latina",
});

export const metadata = {
  title: "Igrot Kodesh — buscador",
  description:
    "Buscador con memoria vectorial sobre las cartas del Rebe de Lubavitch. " +
    "Se puede buscar por significado o por palabras exactas, y filtrar por " +
    "tomo, tema, fecha o festividad.",
  applicationName: "Igrot Kodesh",
  // Las páginas de la API no tienen que aparecer en un buscador; la portada sí.
  robots: { index: true, follow: true },
  openGraph: {
    title: "Igrot Kodesh — buscador",
    description:
      "Buscá entre las cartas del Rebe de Lubavitch por significado, por " +
      "palabras exactas, o filtrando por tomo, tema y fecha.",
    locale: "es_AR",
    type: "website",
  },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // Que el color de la barra del navegador acompañe al tema, en vez de quedar
  // blanca sobre un sitio oscuro.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#16150f" },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={`${latina.variable} ${hebreo.variable}`}>
      <body>
        {/* Para quien navega con el teclado: el primer tabulador ofrece saltar
            los filtros e ir directo a los resultados. Está escondido hasta que
            recibe el foco. */}
        <a className="salto" href="#resultados">
          Saltar a los resultados
        </a>
        {children}
      </body>
    </html>
  );
}
