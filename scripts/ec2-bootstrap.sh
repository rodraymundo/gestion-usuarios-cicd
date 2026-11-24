#!/usr/bin/env bash
# Prepara una instancia EC2 nueva (Ubuntu 22.04/24.04) para recibir los despliegues.
# Uso (en el servidor):  bash ec2-bootstrap.sh
set -euo pipefail

sudo apt-get update -y
sudo apt-get install -y ca-certificates curl rsync

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"

mkdir -p "$HOME/app"
echo
echo "Listo. Cierra la sesión SSH y vuelve a entrar para que el grupo 'docker' tome efecto."
echo "Siguiente paso: crea $HOME/app/.env a partir de .env.example (ver la guía)."
echo "Temperatura: comprueba si existen sensores con:  ls /sys/class/thermal /sys/class/hwmon"
