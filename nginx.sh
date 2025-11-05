# /etc/nginx/sites-available/rmshowroom.on-forge.com

server {
    listen 80;
    listen [::]:80;
    server_name rmshowroom.on-forge.com;

    root /home/forge/rmshowroom.on-forge.com/current/dist;
    index index.html;

    # Allow Forge to manage SSL; uncomment if you’ve provisioned certificates
    # include /etc/nginx/ssl/rmshowroom.on-forge.com/ssl.conf;

    # log locations (optional)
    access_log /var/log/nginx/rmshowroom.on-forge.com_access.log;
    error_log  /var/log/nginx/rmshowroom.on-forge.com_error.log warn;

    # Serve existing files directly, otherwise fall back to SPA entry point
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Helpful cache headers for static assets
    location ~* \.(?:css|js|mjs|json|txt|xml|ico|svg|eot|ttf|woff|woff2)$ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri /index.html;
    }

    # Optional: gzip (enabled by default on Forge, but explicit here)
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_proxied any;
    gzip_min_length 1024;

    # Allow large uploads if needed
    client_max_body_size 10M;

    # Nginx health-check endpoint
    location = /health {
        access_log off;
        return 200 'OK';
    }
}
