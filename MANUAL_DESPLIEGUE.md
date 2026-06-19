# MANUAL DE DESPLIEGUE · [1002] Registro de Albaranes de Compras
## JOSEPAN 360 · Ecosistema OMNI · v10.0

---

## Requisitos del servidor

| Componente | Versión mínima |
|---|---|
| Apache | 2.4 (`mod_rewrite` activo) |
| PHP | 8.1+ (extensiones: `curl`, `json`, `mbstring`) |
| SSL | Let's Encrypt (Certbot) |
| Conectividad saliente | `api.omni.josepan.app` y `api.anthropic.com` |

---

## 1. Despliegue en producción (LAMP)

### 1.1 Copiar archivos

```bash
# Subir archivos al servidor
scp -r ./1002/* root@srv:/var/www/omni/1002/
# o via git
cd /var/www/omni/1002 && git pull
```

### 1.2 Permisos

```bash
chown -R www-data:www-data /var/www/omni/1002
chmod 644 /var/www/omni/1002/api/omni.php
chmod 644 /var/www/omni/1002/api/OmniCoreClient.php
chmod 644 /var/www/omni/1002/.htaccess
```

### 1.3 VirtualHost Apache

```apache
<VirtualHost *:80>
    ServerName albaranes.josepan.app
    DocumentRoot /var/www/omni/1002

    <Directory /var/www/omni/1002>
        AllowOverride All
        Require all granted
    </Directory>

    # Variable obligatoria para OCR
    SetEnv ANTHROPIC_API_KEY   sk-ant-api03-TU_CLAVE_AQUI
    # Variable opcional: carga lista de sedes sin token de usuario
    SetEnv OMNI_SERVICE_TOKEN  eyJ_TU_TOKEN_SERVICIO_AQUI

    ErrorLog  ${APACHE_LOG_DIR}/albaranes-error.log
    CustomLog ${APACHE_LOG_DIR}/albaranes-access.log combined
</VirtualHost>
```

```bash
a2ensite albaranes.josepan.app.conf
a2enmod rewrite
systemctl reload apache2
```

### 1.4 Certificado SSL

```bash
# Opción A — certbot con Apache (recomendado si Apache arranca bien)
certbot --apache -d albaranes.josepan.app

# Opción B — standalone (si Apache da problemas durante certbot)
systemctl stop apache2
certbot certonly --standalone -d albaranes.josepan.app
systemctl start apache2
a2ensite albaranes.josepan.app-le-ssl.conf
systemctl restart apache2
```

### 1.5 Checklist de verificación

```
[ ] apache2ctl configtest → "Syntax OK"
[ ] curl -I https://albaranes.josepan.app → HTTP/2 200
[ ] curl "https://albaranes.josepan.app/api/omni.php?action=interlocutors&public=1"
    → { "ok": true, "data": { "items": [...] } }
[ ] Login con herman.torres / herman.torres → entra correctamente
[ ] Selector de sede carga la lista de 17 sedes
[ ] Cargar imagen de albarán → OCR detecta datos
[ ] Registrar ítem de prueba → toast verde
[ ] certbot renew --dry-run → sin errores
```

---

## 2. Despliegue en desarrollo local (XAMPP)

```
C:\xampp\htdocs\josepan\360\omni\dev\1002_04\
├── index.html
├── app.js
├── .htaccess          ← RewriteBase /josepan/360/omni/dev/1002_04/
└── api\
    ├── OmniCoreClient.php
    └── omni.php
```

Variables de entorno en `httpd.conf` o VirtualHost:
```apache
SetEnv ANTHROPIC_API_KEY sk-ant-api03-TU_CLAVE
```

Verificar en `httpd.conf` que esté activo:
```apache
LoadModule rewrite_module modules/mod_rewrite.so
```

---

## 3. Variables de entorno

| Variable | Obligatorio | Descripción |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Sí** (para OCR) | Sin ella, el OCR falla pero la app funciona |
| `OMNI_SERVICE_TOKEN` | No | Token de servicio para cargar sedes en login sin autenticación. Si no se configura, usa lista estática de 17 sedes. |

---

## 4. .htaccess

```apache
Options -Indexes
AddType application/javascript .js
AddType application/json .json

<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteBase /          # ← ajustar según entorno

    RewriteCond %{REQUEST_FILENAME} -f [OR]
    RewriteCond %{REQUEST_FILENAME} -d
    RewriteRule ^ - [L]

    RewriteRule ^ index.html [L]
</IfModule>

<FilesMatch "\.(js|css|html|php)$">
    <IfModule mod_headers.c>
        Header set Cache-Control "no-cache, no-store, must-revalidate"
    </IfModule>
</FilesMatch>
```

---

## 5. Troubleshooting

### Error 500 al abrir la aplicación

```bash
tail -50 /var/log/apache2/albaranes-error.log
apache2ctl configtest
# Si hay error de sintaxis en .htaccess → revisar RewriteBase
```

### Error 302 — Los JS devuelven HTML

El `.htaccess` del proyecto padre captura las rutas. Asegúrate de que `RewriteBase` apunta a la ruta exacta del [1002].

### SSLCertificateFile does not exist

El vhost SSL está activo antes de que exista el certificado:
```bash
a2dissite albaranes.josepan.app-le-ssl.conf
systemctl restart apache2
certbot --apache -d albaranes.josepan.app
```

### Certbot falla — Puerto 80 ocupado

```bash
systemctl stop apache2
certbot certonly --standalone -d albaranes.josepan.app
systemctl start apache2
a2ensite albaranes.josepan.app-le-ssl.conf
systemctl restart apache2
```

### Selector de sede vacío en el login

- Si hay `OMNI_SERVICE_TOKEN`: carga sedes del API CORE
- Si no hay token de servicio: usa automáticamente la lista estática de 17 sedes
- Verificar conectividad: `curl https://api.omni.josepan.app/api/v1/catalog/interlocutors`

### OCR no funciona

```bash
# Verificar que la variable está configurada
apache2ctl -S | grep ANTHROPIC
# Reiniciar tras cambiar variables
systemctl restart apache2
# Test manual
curl -s "https://albaranes.josepan.app/api/omni.php?action=ocr_albaran" \
  -X POST -d '{"image_b64":""}' -H "Content-Type: application/json"
# → debe devolver ERR_VALIDATION (no ERR_INTERNAL de clave no encontrada)
```

### Login devuelve "Credenciales incorrectas"

Verificar que la contraseña usada es el propio username del usuario (formato v6.6.0). El formato `DNI@Omni360` era de versiones anteriores y ya no aplica.

---

## 6. Renovación SSL automática

```bash
# Verificar timer de certbot
systemctl list-timers | grep certbot
# Test sin renovar
certbot renew --dry-run
```

---

*JOSEPAN 360 · Ecosistema OMNI · [1002] Albaranes · v10.0 · Junio 2026*
