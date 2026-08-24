@echo off
setlocal
cd /d "%~dp0"
echo Web Graffiti prototype
echo.
echo Opening http://127.0.0.1:4173/
echo Keep this window open while using the prototype.
echo Press Ctrl+C to stop the server.
echo.
start "" "http://127.0.0.1:4173/"
python -m http.server 4173 --bind 127.0.0.1
pause
