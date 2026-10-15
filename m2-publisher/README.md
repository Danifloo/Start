# M2 Publisher — panel privado de Instagram

**Estado:** Código de una **primera versión ejecutable en GitHub**, listo para desplegar desde la rama `feature/m2-publisher`. No está alojado ni conectado a Instagram todavía.

## Qué hace esta versión
- Panel web protegido con contraseña, adaptable a Android y ordenador.
- Agenda de posts de **@maqued2** en los minutos 00, 15, 30 y 45 de Nueva York.
- Cola persistente SQLite para carruseles con 2–10 imágenes públicas HTTPS.
- Evita duplicar titulares y horarios.
- Usa la API oficial de Instagram para crear y publicar carruseles.
- Consulta la cuota real mediante `content_publishing_limit`.
- Solo marca publicado tras recibir un enlace directo de Instagram.
- Si falla o no se conoce el resultado de un envío, conserva `UNCERTAIN` para evitar publicar duplicados.

## Alcance actual
Esta versión **no descubre noticias ni edita diseños automáticamente en Canva**. Se añade un post con el enlace a su fuente, licencia de sus imágenes, descripción e imágenes HTTPS exportadas de Canva. Para automatizar investigación/diseño habrá que integrar un servicio editorial separado. No introduce ni publica contenido de relleno. Tampoco puede saltar el límite de publicación de Meta.

La versión ampliada, anteriormente preparada como ZIP en el chat, incluye más interfaz y funciones; este directorio contiene un despliegue GitHub simplificado que puede funcionar sin ese ZIP.

## Despliegue en Railway (o servicio Docker similar)
1. Importa tu repositorio `Danifloo/Start` y selecciona rama `feature/m2-publisher`, directorio raíz `m2-publisher`.
2. Crea un **volumen persistente** en `/data` y fija `DATA_DIR=/data`.
3. Configura las variables privadas del servidor:

```text
ADMIN_PASSWORD=(clave única de 16 caracteres o más)
SESSION_SECRET=(cadena aleatoria secreta de 32 caracteres o más)
DATA_DIR=/data
PUBLIC_BASE_URL=https://tu-sitio.railway.app
IG_USER_ID=(identificador de tu cuenta profesional Instagram)
IG_ACCESS_TOKEN=(token oficial con permisos de publicación)
META_GRAPH_VERSION=v25.0
```

4. Mantén **una sola réplica y un solo proceso** para impedir trabajos dobles.
5. Configura el acceso oficial a Instagram mediante Meta Developer; obtén el identificador y token por un flujo legítimo de Meta, colócalos solo como secretos del alojamiento. **La interfaz todavía no ofrece el botón de OAuth**; esa integración queda pendiente.
6. Abre la URL HTTPS que entregue el alojamiento, entra con `ADMIN_PASSWORD`, crea un carrusel de prueba con imágenes autorizadas y comprueba su enlace real de Instagram.

## Seguridad
- El repositorio **Danifloo/Start es público**. No subas archivos `.env`, tokens, contraseñas, datos de seguidores ni publicaciones privadas.
- Nunca pongas credenciales de Meta en el navegador ni en el código GitHub. Usa variables privadas del servidor.
- El programa no afirma que se publicó nada si Meta no devuelve el `permalink`.
- Para un despliegue 24/7, utiliza un servidor siempre activo, HTTPS y volumen persistente. El alojamiento podría tener costos.
- GitHub almacena el código; **GitHub por sí solo no mantiene ejecutándose una aplicación web con programador permanente**.

## Comprobación
```bash
pip install -r requirements.txt
ADMIN_PASSWORD='clave-larga-de-prueba' SESSION_SECRET='clave-de-sesion-larga-de-32-o-mas-caracteres' python -m uvicorn service:app
```

La aplicación está diseñada para trabajar con la cuenta **@maqued2** una vez configurada. Ningún post se publica por el hecho de subir este código a GitHub.
