// La página de tareas no es parte del sitio público: no tiene que aparecer en
// ningún buscador. El contenido igual está protegido por la clave —sin ella
// la ruta de la API no contesta nada— pero una dirección que no se indexa es
// una dirección que nadie encuentra de casualidad.
export const metadata = {
  title: "Tareas — Igrot Kodesh",
  robots: { index: false, follow: false, nocache: true },
};

export default function LayoutDeTareas({ children }) {
  return children;
}
