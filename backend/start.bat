@echo off
chcp 65001 > nul
title YouTube Downloader API
echo.
echo ============================================
echo   🎬 YouTube Downloader API Başlatılıyor
echo ============================================
echo.
echo [1/2] Bağımlılıklar yükleniyor...
..\\.venv\Scripts\python.exe -m pip install -r requirements.txt --quiet
echo.
echo [2/2] Sunucu başlatılıyor...
echo   👉 Tarayıcıda frontend/index.html dosyasını açın
echo.
..\\.venv\Scripts\python.exe server.py
pause
