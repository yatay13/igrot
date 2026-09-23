import "./globals.css";

export const metadata = {
  title: "Igrot Kodesh — buscador",
  description:
    "Buscador con memoria vectorial sobre las cartas del Rebe de Lubavitch.",
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
