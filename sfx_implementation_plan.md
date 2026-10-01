## Plan de Integración de Efectos de Sonido (SFX)

El objetivo es aumentar la inmersión del jugador agregando respuesta auditiva a los eventos clave de la simulación. Utilizaremos el motor de audio nativo de **Three.js** (`THREE.AudioListener` y `THREE.Audio`), el cual es altamente eficiente y nos permite controlar el volumen y la reproducción en sincronía con los gráficos.

### 1. Eventos y Circunstancias de Sonido

Se proponen los siguientes efectos de sonido base:

| Efecto | Circunstancia | Comportamiento |
| :--- | :--- | :--- |
| **Motor (Rocket Thrust)** | Cuando el cohete tiene combustible (`rocket.candy > 0`). | Sonido en **bucle (loop)** continuo. Su volumen puede desvanecerse suavemente al mismo tiempo que las partículas del escape cuando el combustible llegue a cero. |
| **Viento (Caída Libre)** | Cuando el cohete cae a gran velocidad y el motor está apagado (`rocket.verticalVelocity < -15` aprox). | Sonido en **bucle**. El volumen aumentará conforme la velocidad de caída sea mayor, generando tensión. |
| **Explosión (Choque)** | Cuando se ejecuta `createExplosion()` (`d.crashed === true`). | Reproducción de **un solo golpe (one-shot)**, fuerte y abrupta. |
| **Éxito (Aterrizaje)** | Cuando la misión es exitosa y se muestra la pantalla de resultados. | Reproducción de **un solo golpe**, tono positivo/tecnológico (ej. un "ding" o jingle corto). |

### 2. Método de Implementación Propuesto

#### [NUEVO] Directorio de Assets
Crearemos un directorio `web/assets/sounds/` donde colocaremos los archivos de audio (`.mp3` o `.wav`).

#### [MODIFY] web/js/graphics.js
1. **Inicialización (`initAudio`)**: 
   Añadiremos un `THREE.AudioListener` a la `camera`.
   Usaremos `THREE.AudioLoader` para pre-cargar los 4 archivos de audio en memoria para que no haya retrasos al reproducirlos.
2. **Ciclo de Actualización (`renderGame`)**:
   En el mismo bloque donde actualizamos las partículas del motor, ajustaremos el volumen de los audios en bucle (Motor y Viento).

#### [MODIFY] web/js/network.js
1. **Disparadores Discretos**: 
   En los eventos del socket (`game_over`), daremos la orden de reproducir los audios *one-shot* (Explosión o Éxito) según corresponda. También detendremos de golpe los audios en bucle.

---

> [!IMPORTANT]
> ## Preguntas Abiertas para el Usuario
> 
> 1. **Archivos de Audio:** Actualmente no tenemos archivos `.mp3` en el proyecto. ¿Tienes tus propios efectos de sonido que te gustaría usar? Si no, puedo crear la estructura del código y usar archivos "placeholder" (de relleno) o indicarte de dónde descargar unos buenos efectos gratuitos (como *Freesound.org*) para que los coloques en la carpeta.
> 2. **Formato:** ¿Prefieres usar `.mp3` (más ligero) o `.wav` (mejor calidad sin compresión)? Para la web, `.mp3` u `.ogg` suele ser lo mejor.
