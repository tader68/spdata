@echo off
chcp 65001 >nul
cls

echo ========================================
echo   DEV MODE - Restart All
echo ========================================

REM Dừng tất cả processes
taskkill /F /IM python.exe 2>nul
taskkill /F /IM node.exe 2>nul

timeout /t 2 /nobreak >nul

echo.
echo [1/2] Khởi động Frontend...
cd frontend
start "Frontend" cmd /k "npm run dev"
cd ..

timeout /t 3 /nobreak >nul

echo [2/2] Khởi động Backend (log hiển thị ở đây)...
echo ========================================
echo   Backend Logs:
echo ========================================
cd backend
python app.py
