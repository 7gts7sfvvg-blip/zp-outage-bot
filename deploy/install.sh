#!/bin/bash
# Установка бота на Ubuntu/Debian-сервер как службу systemd (запуск: bash install.sh)
set -e
REPO="https://github.com/7gts7sfvvg-blip/zp-outage-bot.git"
DIR=/opt/zp-outage-bot

echo "Проверяю, открывается ли сайт Запоріжжяобленерго с этого сервера..."
if ! curl -s -m 20 -A "Mozilla/5.0" -o /dev/null -w "%{http_code}\n" https://www.zoe.com.ua/outage/ | grep -q '^200$'; then
  echo "❌ Сайт zoe.com.ua не открывается с этого сервера (скорее всего блокировка по стране)."
  echo "   Нужен сервер с украинским IP. Установка остановлена."
  exit 1
fi
echo "✅ Сайт открывается."

command -v git >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq git python3; }

if [ -d "$DIR/.git" ]; then sudo git -C "$DIR" pull -q; else sudo git clone -q "$REPO" "$DIR"; fi

read -rsp "Токен бота (вставьте и Enter): " TG_TOKEN; echo
read -rp  "Ваш chat id: " TG_CHAT_ID
sudo bash -c "umask 077; printf 'TG_TOKEN=%s\nTG_CHAT_ID=%s\nINTERVAL=60\n' '$TG_TOKEN' '$TG_CHAT_ID' > /etc/zp-outage-bot.env"

sudo tee /etc/systemd/system/zp-outage-bot.service >/dev/null <<UNIT
[Unit]
Description=Zaporizhzhia outage Telegram bot
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/zp-outage-bot.env
WorkingDirectory=$DIR
ExecStart=/usr/bin/python3 $DIR/bot.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now zp-outage-bot
sleep 3
systemctl --no-pager status zp-outage-bot | head -8
echo "Готово. В Telegram должно прийти сообщение «Бот запущен»."
