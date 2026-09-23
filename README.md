# Videojuego Expociencias SpaceNL 🚀

Un simulador interactivo de "weathercocking" (veleta) para cohetes sonda. Este proyecto utiliza la cámara web para detectar el movimiento del jugador, permitiendo que la inclinación de sus hombros controle el cohete y contrarreste las ráfagas de viento laterales en tiempo real.

## Características Principales

- **Simulador de Físicas 2D:** Modelo dinámico rotacional que simula el efecto "weathercocking" (inclinación hacia el viento) provocado por ráfagas de viento laterales estocásticas.
- **Control por Visión Computacional:** Utiliza la cámara web y **MediaPipe Pose** para rastrear la inclinación de los hombros del jugador, traduciéndolo en comandos de torque para estabilizar el cohete.
- **Integración Meteorológica:** Obtiene datos meteorológicos reales (actuales o históricos) mediante la API de *Open-Meteo* basándose en la ubicación.
- **Soporte para OpenRocket (`.ork`):** Capacidad de cargar y analizar archivos de diseño de OpenRocket para importar las dimensiones, peso y características de vuelo al simulador.
- **Interfaz Web Integradora:** Una UI fluida construida en HTML/JS/CSS, renderizada como una aplicación de escritorio nativa mediante `pywebview` y sincronizada con el motor de físicas a través de **WebSockets**.
- **CFD (Opcional):** Integra un solver *Lattice Boltzmann Method* (LBM) básico para visualizar dinámica de fluidos computacional alrededor del cohete.

## Tecnologías Utilizadas

- **Python 3.12+** (Backend y Físicas)
- **MediaPipe & OpenCV** (Procesamiento de cámara y esqueleto)
- **WebSockets** (Comunicación en tiempo real a 60Hz)
- **PyWebView** (Aplicación de escritorio)
- **Vanilla JS, HTML & CSS** (Frontend visual)

## Instalación

El proyecto incluye soporte para [`uv`](https://github.com/astral-sh/uv) como gestor de paquetes de Python rápido, pero también es compatible con herramientas tradicionales.

### Opción 1: Usando `uv` (Recomendado)
```bash
# 1. Asegúrate de tener uv instalado
# 2. Clona o entra al directorio del proyecto
cd JuegoExpociencias_v2

# 3. Sincroniza el entorno virtual y dependencias
uv sync
```

### Opción 2: Usando `pip` y `venv` estándar
```bash
# 1. Crea y activa un entorno virtual
python -m venv .venv

# Activar en Windows:
.venv\Scripts\activate

# 2. Instala las dependencias
pip install -r requirements.txt
```

## Ejecución

Para iniciar el videojuego y la simulación, ejecuta el archivo principal:

```bash
uv run main.py
```
*(Si usas el método tradicional de pip, asegúrate de tener el entorno virtual activado y corre `python main.py`)*

Al ejecutarse:
1. Se iniciará el procesamiento de la cámara web (el led de la cámara debería encenderse).
2. Se levantarán servidores locales para la interfaz y comunicación.
3. Se abrirá la ventana principal del juego. ¡Inclínate de lado a lado para estabilizar el cohete!

## Estructura del Proyecto

- `main.py`: Punto de entrada de la app. Inicia los threads, el servidor HTTP estático, WebSocket server, integración de APIs y lanza la ventana web.
- `physics_engine.py`: Contiene el modelo matemático y físico que calcula las fuerzas aerodinámicas, inercias y las ráfagas de viento.
- `camera_processor.py`: Lógica asíncrona de captura de video y tracking corporal con MediaPipe.
- `cfd_lbm.py`: Módulo para resolver y visualizar la mecánica de fluidos computacional.
- `web/`: Recursos del cliente (HTML, CSS `style.css`, y JS `app.js`) que renderizan los gráficos 2D.

## Créditos

- **Autor:** SebasAzpeytia ([azpeytiagael@gmail.com](mailto:azpeytiagael@gmail.com))
- Desarrollado para el proyecto Expociencias.
