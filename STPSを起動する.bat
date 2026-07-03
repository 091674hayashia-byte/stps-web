@echo off
cd /d "C:\仕事関係2\STPS_Web"
echo STPSアプリを起動しています...
start "" "http://localhost:3000"
node server.js
pause
