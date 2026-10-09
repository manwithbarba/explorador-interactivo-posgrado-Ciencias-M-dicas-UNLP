# Explorador de tesis · FCM UNLP

Consulta interactiva estática de tesis, preparada para GitHub Pages. Búsqueda, filtros, fichas, mapa y relaciones funcionan en el navegador; los registros completos y descargas se cargan cuando se solicitan. No requiere base de datos, credenciales ni un servidor de aplicación.

El corte curado publica 723 trabajos a partir de 725 registros fuente. Las dos fusiones conservan todos los originales y los enlaces antiguos redirigen al trabajo canónico. La curación aprobada corrige tres facultades y clasifica Linfogranulomatosis abdominal en Infectología. Las decisiones y su hash se publican con los datos; títulos, años de defensa y metadatos originales permanecen auditables en cada ficha.

## Ejecutar y verificar

Python 3.10+, sin dependencias de construcción:

```text
python tools/build.py --source sources/Tesis_FCM_UNLP_revision_auditable.zip
python tools/validate.py
python tools/package.py --stage _site
python -m http.server 8080 --directory _site
```

Abrir `http://localhost:8080`. Para reproducir el corte se necesita la fuente auditada indicada en `sources/`; también se admite `--source RUTA_A_DIRECTORIO`. La ruta predeterminada usa el ZIP incluido y, si no está disponible, busca la copia del entorno de auditoría original. La construcción verifica hashes de todos los archivos fuente antes de publicar. Las salidas ya generadas pueden validarse sin la fuente.

## Publicación

Publicar únicamente el contenido empaquetado de `_site/`: `index.html`, `assets/`, `data/`, `README.md` y `.nojekyll`. No publicar la fuente ZIP, herramientas ni documentos de trabajo. Las rutas relativas permiten servir el sitio bajo un subdirectorio de GitHub Pages. Consultar el flujo de despliegue del repositorio para activar una publicación posteriormente; construir o validar localmente no despliega.

Los datos tienen trazabilidad y señales visibles; los grupos y vecinos automáticos son exploratorios. No se han validado identidades de personas, relevancia temática experta ni disponibilidad remota de los PDF. Véase [Datos y método](docs/DATOS_Y_METODO.md) para transformaciones, límites y reproducibilidad.

Las instrucciones para un repositorio dedicado y el workflow manual se encuentran
en [Publicación en GitHub Pages](docs/PUBLICACION_GITHUB_PAGES.md).

## Pruebas

```text
python tools/test_data.py
npm ci --ignore-scripts --no-audit --no-fund
npx playwright install chromium
npm run test:browser
```

Node.js y Playwright sólo son herramientas de prueba. La aplicación publicada no
depende de npm, bibliotecas externas, fuentes remotas ni servicios de terceros.
La prueba sirve el sitio bajo una subruta, recorre escritorio y móvil y guarda
capturas y resultados en `test-results/`. El workflow ejecuta estos controles
antes de publicar.

## Procedencia y normalización

Los metadatos se obtuvieron de [SEDICI](https://sedici.unlp.edu.ar/), Servicio de Difusión de la Creación Intelectual de la UNLP, mediante OAI-PMH, y se completaron con las páginas públicas de cada registro. Se seleccionaron los trabajos de posgrado de la Facultad. La clasificación temática editorial de origen se incorporó conservando áreas principales y secundarias.

Se normalizaron caracteres Unicode, entidades HTML y espacios; se separaron títulos y subtítulos, se ordenaron fechas y se priorizó el año de defensa. Las decisiones sobre denominaciones institucionales, clasificación y registros repetidos se documentaron conservando las fuentes y variantes originales. No se fusionan trabajos solo por coincidir sus títulos.

La comparación de contenido textual utiliza TF-IDF y similitud del coseno sobre títulos, resúmenes y términos de los metadatos. La proyección bidimensional es exploratoria y puede distorsionar distancias. El mapa también permite agrupamientos descriptivos por año de defensa, área temática y tipo de trabajo (doctorado, maestría y especialización). Los colores siguen indicando el área temática.
