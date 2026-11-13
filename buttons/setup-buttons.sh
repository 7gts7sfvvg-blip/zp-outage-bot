#!/bin/bash
# Подключает кнопки: кладёт секреты в Vercel, деплоит и включает webhook в Telegram.
set -e
cd "$(dirname "$0")"
URL="https://zp-outage-buttons.vercel.app/api/tg"

read -rsp "Токен бота (Cmd+V, Enter): " TG_TOKEN; echo
case "$TG_TOKEN" in [0-9]*:*) ;; *) echo "Это не токен"; exit 1;; esac
read -rp "Ваш chat id: " TG_CHAT_ID
SECRET=$(python3 -c "import secrets; print(secrets.token_hex(16))")

for pair in "TG_TOKEN=$TG_TOKEN" "TG_CHAT_ID=$TG_CHAT_ID" "WEBHOOK_SECRET=$SECRET"; do
  name="${pair%%=*}"; val="${pair#*=}"
  vercel env rm "$name" production --yes >/dev/null 2>&1 || true
  printf %s "$val" | vercel env add "$name" production >/dev/null
done

vercel deploy --prod --yes >/dev/null 2>&1
echo "Деплой готов, включаю webhook..."

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$URL")
if [ "$code" = "401" ] || [ "$code" = "403" ]; then
  echo "❌ Vercel Authentication ещё включена (ответ $code). Выключите её: Vercel → проект zp-outage-buttons → Settings → Deployment Protection → Vercel Authentication → Disabled, затем запустите скрипт снова."
  exit 1
fi

curl -s "https://api.telegram.org/bot$TG_TOKEN/setWebhook" \
  --data-urlencode "url=$URL" --data-urlencode "secret_token=$SECRET" \
  --data-urlencode 'allowed_updates=["message","callback_query"]'
echo
curl -s "https://api.telegram.org/bot$TG_TOKEN/sendMessage" \
  --data-urlencode "chat_id=$TG_CHAT_ID" \
  --data-urlencode "text=Бот обновлён: теперь им могут пользоваться и другие. Нажмите /start и выберите очередь." \
echo "Готово. Откройте бота в Telegram."
