# Panel de respuestas · Formulario de lonas

Visualiza en tiempo real las respuestas de:
https://forms.fillout.com/t/9LnZ4jfJXnus

## Qué incluye

- Listado de solicitudes con búsqueda
- Detalle completo de cada respuesta
- Vista ampliada de imágenes adjuntas (logotipo / referencias)
- Descarga de imágenes
- Actualización automática cada 5 segundos (botón En vivo / Pausado)

## Configuración

1. Obtén tu API key en [Fillout → Settings → Developer](https://build.fillout.com/home/settings/developer)
2. Copia el archivo de entorno:

```bash
cp .env.example .env.local
```

3. Edita `.env.local` y pega tu API key:

```
FILLOUT_API_KEY=tu_api_key_aqui
FILLOUT_FORM_ID=9LnZ4jfJXnus
```

4. Instala y arranca:

```bash
npm install
npm run dev
```

5. Abre [http://localhost:3000](http://localhost:3000)

## Notas

- La API key se queda solo en el servidor (nunca se expone al navegador).
- El enlace `build.fillout.com/join/...` es una invitación de colaboración a Fillout/Zite; este panel es la vista operativa de respuestas para Mercadotecnia.
