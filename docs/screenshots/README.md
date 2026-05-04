# Screenshots

Imágenes referenciadas desde el `README.md` raíz. Mantener nombres
consistentes para que los enlaces no se rompan al actualizarlas.

## Convenciones

- **Formato**: PNG (mejor calidad para UI con texto). Evitar JPEG.
- **Tamaño**: 1280×800 a 1600×1000 idealmente. Comprimir con `pngquant` o
  similar para que cada archivo quede < 500 KB.
- **Tema**: pantallas en modo claro para máximo contraste en el README.
- **Idioma**: capturar en español (idioma default).

## Archivos esperados

| Archivo | Sección del README | Qué mostrar |
|---|---|---|
| `hero.png` | Encabezado | Canvas con un diagrama no-trivial cargado, sidebar con el panel Debugger visible. Sirve de "elevator pitch" visual. |
| `debugger.png` | Funciones de debug | El panel Debugger con la lista de breakpoints poblada, log de ejecución reciente, y el cursor de ejecución (azul) sobre un bloque del canvas. |
| `page-guides.png` | Impresión multi-página | Canvas con las líneas rojas punteadas de los límites de página visibles, y un diagrama que cruza al menos 2 páginas. Bonus: title block colocado dentro del área imprimible. |
| `export-menu.png` | Formatos de exportación | Menú **File → Export As** desplegado mostrando las opciones (PDF / PNG / SVG / CSV / JSON / draw.io / C++ / Java / Go). Capturar con el menú abierto. |
| `title-block.png` | Title block | Vista cercana del title block con los 4 campos llenos (Título, Autor, Fecha, Versión). |

Para regenerar: levantar la app (`npm run dev`), cargar un ejemplo desde
`example-resolutions/`, y capturar con la herramienta nativa del SO. En
Windows: `Win + Shift + S`.
