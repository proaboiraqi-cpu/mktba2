@echo off
chcp 65001 >nul
title AK Software
echo AK Software يعمل على http://localhost:8000 ، اترك هذه النافذة مفتوحة
where python >nul 2>nul && (start "" http://localhost:8000 & python -m http.server 8000 & goto :end)
where py >nul 2>nul && (start "" http://localhost:8000 & py -m http.server 8000 & goto :end)
where npx >nul 2>nul && (start "" http://localhost:8000 & npx --yes http-server -p 8000 -c-1 & goto :end)
echo ما لقيت Python ولا Node.js. ثبّت Python من python.org (فعّل Add to PATH) وأعد التشغيل.
pause
:end
