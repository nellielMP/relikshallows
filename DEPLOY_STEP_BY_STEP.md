# Deploiement pas a pas (Ubuntu + domaine)

Ce guide te permet de mettre ton jeu en ligne pour ton pote.

## 1) Preparer un serveur Ubuntu

- Prends un VPS Ubuntu 22.04 (ou 24.04).
- Connecte-toi en SSH:

```bash
ssh root@IP_DU_SERVEUR
```

## 2) Installer Node.js, Git, Nginx, PM2

```bash
apt update && apt upgrade -y
apt install -y curl git nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm i -g pm2
node -v
npm -v
```

## 3) Copier le projet sur le serveur

Option A (recommande): via Git

```bash
cd /var/www
git clone <URL_DE_TON_REPO> nordhaven
cd nordhaven
```

Option B: upload du dossier local puis:

```bash
cd /var/www/nordhaven
```

## 4) Installer les dependances

```bash
npm install
```

Assure-toi aussi d'avoir une instance MongoDB disponible (locale ou managée), puis garde son URI pour `.env`.

## 5) Configurer les variables d'environnement

```bash
cp .env.example .env
nano .env
```

Mets:

- `GOOGLE_CLIENT_ID=...` (ton vrai client id Google)
- `PORT=3000`
- `MONGODB_URI=mongodb://127.0.0.1:27017`
- `MONGODB_DB_NAME=nordhaven`
- `ADMIN_GOOGLE_EMAILS=ton.email@gmail.com`

## 6) Lancer l'app avec PM2 (restart auto)

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Teste localement sur le serveur:

```bash
curl http://127.0.0.1:3000
```

## 7) Configurer Nginx

```bash
cp deploy.nginx.conf.example /etc/nginx/sites-available/nordhaven
nano /etc/nginx/sites-available/nordhaven
```

Remplace `YOUR_DOMAIN_HERE` par ton domaine.

Puis active:

```bash
ln -s /etc/nginx/sites-available/nordhaven /etc/nginx/sites-enabled/nordhaven
nginx -t
systemctl restart nginx
```

## 8) Ajouter HTTPS (LetsEncrypt)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d TON_DOMAINE -d www.TON_DOMAINE
```

## 9) Configurer Google Login pour la prod

Dans Google Cloud Console > OAuth Client:

- Authorized JavaScript origins:
  - `https://TON_DOMAINE`
  - `https://www.TON_DOMAINE` (si utilise)

Important: sans cette etape, login Google ne marche pas en ligne.

## 10) Ouvrir le firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
ufw status
```

## 11) Verifier que ton pote peut rejoindre

- Ouvre `https://TON_DOMAINE`
- Teste login Google
- Teste chat multijoueur
- Teste que MongoDB est bien utilise (creation guilde, restart serveur, guilde toujours presente)
- Teste `admin.html` avec ton compte allowlist

## Commandes utiles

```bash
pm2 status
pm2 logs nordhaven
pm2 restart nordhaven
systemctl status nginx
```

